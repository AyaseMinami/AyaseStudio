import { describe, expect, it, vi } from "vitest";
import { bytesToBase64, type SentAttachment } from "../chat/attachments";
import { defaultSessionConfig } from "../chat/sessionConfig";
import { connectionSettingsStorageKey, type ConnectionSettingsState } from "../chat/settings";
import type { StoredChatMessage } from "../chat/repository";
import { decodeBackup, encodeBackup, sha256 } from "./codec";
import { createBackupDocument, type LocalSnapshot } from "./snapshot";
import { backupTables, preferenceKeys, type BackupFiles } from "./types";
import { SEARCH_SETTINGS_KEY } from "../search/settings";

const syntheticKey = "synthetic-key-never-a-real-credential";
const reference = "attachments/00000000-0000-4000-8000-000000000001.txt";
const sourcePath = "C:\\synthetic-only\\source-backup.zip";
const nativeBytes = new TextEncoder().encode("synthetic text attachment");

function files(): BackupFiles {
  return { read: vi.fn(async () => bytesToBase64(nativeBytes)), assertAvailable: vi.fn(async () => {}), write: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
}

function connections(): ConnectionSettingsState {
  return { version: 3, activeModelId: "model", providers: [{ id: "provider", name: "Synthetic", connections: [
    { id: "connection", name: "Synthetic", protocol: "openai-chat", baseUrl: "https://synthetic.invalid/v1", apiKey: syntheticKey,
      models: [{ id: "model", modelId: "synthetic-model", displayName: "Synthetic model" }] },
  ] }] };
}

function snapshot(): LocalSnapshot {
  const config = defaultSessionConfig();
  return {
    rows: {
      assistants: [{ id: "assistant", name: "Synthetic assistant", icon: "", sortOrder: 0, defaultModelId: "model", defaultConfig: config }],
      conversations: [{ id: "conversation", assistantId: "assistant", title: "Synthetic conversation", createdAt: 1, updatedAt: 2,
        titleNaming: { source: "runtime", sourceMessageId: "user", status: "pending" },
        settings: { modelId: "model", config }, creationConfig: { modelId: null, config: defaultSessionConfig() } }],
      chats: [{ id: "conversation", updatedAt: 2, messages: [
        { id: "user", role: "user", content: "synthetic text", status: "complete", source: { source: "cherry", id: "source-user", createdAt: 1, unavailableAttachments: ["missing.txt"] } },
        { id: "answer", role: "assistant", replyToId: "user", content: "partial", status: "streaming" },
      ] }],
      workspace: [{ id: "selection", activeAssistantId: "assistant", lastSelected: { assistant: "conversation" } }],
      avatarLibrary: [], userAvatar: [{ id: "user" }],
      cherryImports: [{ id: "synthetic-marker", conversationIds: ["conversation"] }],
      legacyConversationConfigs: [{ id: "conversation", lastUsedModelId: "model", generationConfig: defaultSessionConfig() }],
    },
    preferences: { ...Object.fromEntries(preferenceKeys.map(key => [key, null])), [connectionSettingsStorageKey]: JSON.stringify(connections()) },
  };
}

describe("backup snapshot", () => {
  it.each([false, true])("exports v3 search configuration with credentials=%s under the existing options contract", async credentials => {
    const input = snapshot();
    input.preferences[SEARCH_SETTINGS_KEY] = JSON.stringify({ version: 1, baseUrl: "https://mcp.exa.ai/mcp", apiKey: "synthetic-search-key", numResults: 7 });
    input.rows.assistants[0].defaultConfig = { ...defaultSessionConfig(), webSearch: true, webSearchProvider: "exa-mcp" };
    input.rows.conversations[0].settings!.config.webSearchProvider = "native";
    input.rows.conversations[0].creationConfig!.config.webSearchProvider = "exa-mcp";
    input.rows.legacyConversationConfigs[0].generationConfig!.webSearchProvider = "native";
    const answer = input.rows.chats[0].messages[1];
    answer.search = { enabled: true, provider: "exa-mcp", status: "searching", queries: ["query"], warning: "warning", sources: [{ id: "s", title: "title", url: "https://example.invalid", excerpt: "excerpt" }], citations: [] };
    Object.assign(answer.search, { apiKey: syntheticKey, headers: { secret: syntheticKey } });
    Object.assign(answer.search.sources[0], { apiKey: syntheticKey });
    const doc = await createBackupDocument(input, { connections: credentials, credentials }, files());
    expect(doc.version).toBe(3);
    expect(doc.searchSettings).toEqual({ version: 2,
      exaMcp: { version: 1, baseUrl: "https://mcp.exa.ai/mcp", numResults: 7, ...(credentials ? { apiKey: "synthetic-search-key" } : {}) },
      exaApi: { version: 1, baseUrl: "https://api.exa.ai", numResults: 5, ...(credentials ? { apiKey: "" } : {}) } });
    expect((doc.rows.assistants[0] as any).defaultConfig.webSearchProvider).toBe("exa-mcp");
    expect((doc.rows.conversations[0] as any).settings.config.webSearchProvider).toBe("native");
    expect((doc.rows.conversations[0] as any).creationConfig.config.webSearchProvider).toBe("exa-mcp");
    expect((doc.rows.legacyConversationConfigs[0] as any).generationConfig.webSearchProvider).toBe("native");
    expect((doc.rows.chats[0] as any).messages[1]).toMatchObject({ status: "incomplete", search: { provider: "exa-mcp", status: "cancelled", warning: "warning", sources: [{ excerpt: "excerpt" }] } });
    expect(answer.search.status).toBe("searching");
    const serialized = await encodeBackup(doc);
    expect(serialized.includes("synthetic-search-key")).toBe(credentials);
    expect(serialized).not.toContain("headers");
    expect((await decodeBackup(serialized)).document).toEqual(doc);
  });
  it.each([false, true])("exports both independent profiles and keys with credentials=%s", async credentials => {
    const input = snapshot();
    const configuration = { version: 2, exaMcp: { version: 1, baseUrl: "https://mcp.exa.ai/mcp", apiKey: "synthetic-mcp-key", numResults: 7 }, exaApi: { version: 1, baseUrl: "https://api.exa.ai/", apiKey: "synthetic-api-search-key", numResults: 3 } };
    input.preferences[SEARCH_SETTINGS_KEY] = JSON.stringify(configuration);
    input.rows.conversations[0].settings!.config.webSearchProvider = "exa-api";
    input.rows.chats[0].messages[1].search = { enabled: true, provider: "exa-api", status: "completed", queries: ["query"], sources: [{ id: "s", title: "source", url: "https://example.invalid", excerpt: "bounded" }], citations: [] };
    const doc = await createBackupDocument(input, { connections: credentials, credentials }, files());
    const expected = structuredClone(configuration) as any;
    if (!credentials) { delete expected.exaMcp.apiKey; delete expected.exaApi.apiKey; }
    expect(doc.searchSettings).toEqual(expected);
    const serialized = await encodeBackup(doc);
    expect(serialized.includes("synthetic-mcp-key")).toBe(credentials);
    expect(serialized.includes("synthetic-api-search-key")).toBe(credentials);
    expect((await decodeBackup(serialized)).document).toEqual(doc);
    expect(input.preferences[SEARCH_SETTINGS_KEY]).toBe(JSON.stringify(configuration));
  });
  it("exports every supported table, saved configuration and source marker without mutating the source", async () => {
    const input = snapshot();
    const before = structuredClone(input);
    const native = files();
    const document = await createBackupDocument(input, { connections: false, credentials: false }, native);
    expect(Object.keys(document.rows).sort()).toEqual([...backupTables].sort());
    expect(document.rows.assistants).toEqual(input.rows.assistants);
    expect(document.rows.conversations[0]).toMatchObject({ settings: input.rows.conversations[0].settings,
      creationConfig: input.rows.conversations[0].creationConfig, titleNaming: "manual" });
    expect(document.rows.workspace).toEqual(input.rows.workspace);
    expect(document.rows.userAvatar).toEqual([{ id: "user" }]);
    expect(document.rows.cherryImports).toEqual(input.rows.cherryImports);
    expect(document.rows.legacyConversationConfigs).toEqual(input.rows.legacyConversationConfigs);
    expect(document.connections).toBeNull();
    expect(document.options).toEqual({ connections: false, credentials: false });
    expect(JSON.stringify(document)).not.toContain(syntheticKey);
    expect(JSON.stringify(document)).not.toContain("apiKey");
    expect(document.preferences[preferenceKeys[0]]).toBeTypeOf("string");
    expect(input).toEqual(before);
    expect(native.read).not.toHaveBeenCalled();
    expect(native.write).not.toHaveBeenCalled();
    expect(native.remove).not.toHaveBeenCalled();
    expect((await decodeBackup(await encodeBackup(document))).counts).toMatchObject({ assistants: 1, conversations: 1, messages: 2 });
  });

  it("supports an entirely empty local snapshot", async () => {
    const input = snapshot();
    for (const table of backupTables) input.rows[table] = [];
    const document = await createBackupDocument(input, { connections: false, credentials: false }, files());
    expect((await decodeBackup(await encodeBackup(document))).counts).toEqual({ assistants: 0, conversations: 0, messages: 0,
      avatars: 0, files: 0, connections: 0 });
  });

  it("exports connection metadata without keys and strips injected non-allowlisted fields throughout saved rows", async () => {
    const input = snapshot();
    const state = connections();
    Object.assign(state, { apiKey: syntheticKey });
    Object.assign(state.providers[0], { apiKey: syntheticKey });
    Object.assign(state.providers[0].connections[0].models[0], { apiKey: syntheticKey });
    input.preferences[connectionSettingsStorageKey] = JSON.stringify(state);
    input.preferences["unknown-secret-store"] = syntheticKey;
    Object.assign(input.rows.assistants[0], { apiKey: syntheticKey });
    Object.assign(input.rows.assistants[0].defaultConfig, { apiKey: syntheticKey });
    Object.assign(input.rows.assistants[0].defaultConfig.temperature, { apiKey: syntheticKey });
    Object.assign(input.rows.assistants[0].defaultConfig.customJson, { apiKey: syntheticKey });
    Object.assign(input.rows.conversations[0], { apiKey: syntheticKey, sourcePath });
    Object.assign(input.rows.conversations[0].settings!, { apiKey: syntheticKey });
    Object.assign(input.rows.chats[0], { apiKey: syntheticKey });
    Object.assign(input.rows.chats[0].messages[0], { apiKey: syntheticKey, sourcePath, continuation: { apiKey: syntheticKey, responseId: "synthetic-response" } });
    Object.assign(input.rows.chats[0].messages[0].source!, { apiKey: syntheticKey, sourcePath });
    Object.assign(input.rows.workspace[0], { apiKey: syntheticKey });
    Object.assign(input.rows.userAvatar[0], { apiKey: syntheticKey });
    Object.assign(input.rows.cherryImports[0], { apiKey: syntheticKey, sourcePath });
    Object.assign(input.rows.legacyConversationConfigs[0], { apiKey: syntheticKey });
    const document = await createBackupDocument(input, { connections: true, credentials: false }, files());
    expect(document.connections).toEqual({ version: 3, activeModelId: "model", providers: [{ id: "provider", name: "Synthetic", connections: [
      { id: "connection", name: "Synthetic", protocol: "openai-chat", baseUrl: "https://synthetic.invalid/v1",
        models: [{ id: "model", modelId: "synthetic-model", displayName: "Synthetic model" }] },
    ] }] });
    const output = await encodeBackup(document);
    expect(output).not.toContain(syntheticKey);
    expect(output).not.toContain("apiKey");
    expect(output).not.toContain("sourcePath");
    expect(output).not.toContain("continuation");
    expect(Object.keys(document.preferences).sort()).toEqual([...preferenceKeys].sort());
    expect((await decodeBackup(output)).counts.connections).toBe(1);
  });

  it("includes synthetic credentials only when explicitly requested with connections", async () => {
    const document = await createBackupDocument(snapshot(), { connections: true, credentials: true }, files());
    expect(document.connections).toEqual(connections());
    const password = "synthetic-password-12";
    const output = await encodeBackup(document, true, password, password);
    expect(output).not.toContain(syntheticKey);
    expect((await decodeBackup(output, password)).document.connections).toEqual(connections());
    await expect(createBackupDocument(snapshot(), { connections: false, credentials: true }, files())).rejects.toThrow();
  });

  it("preserves all round alternatives and normalizes streaming/paused status without continuation metadata", async () => {
    const input = snapshot();
    const [user, answer] = input.rows.chats[0].messages;
    const otherUser: StoredChatMessage = { ...user, id: "alternate-user", content: "alternate question" };
    const otherAnswer: StoredChatMessage = { ...answer, id: "alternate-answer", replyToId: otherUser.id, status: "paused", content: "alternate partial" };
    Object.assign(otherAnswer, { continuation: { responseId: "synthetic-response" }, apiKey: syntheticKey });
    user.roundVersions = { selected: 1, pairs: [[otherUser, otherAnswer], [{ ...user }, { ...answer }]] };
    const document = await createBackupDocument(input, { connections: false, credentials: false }, files());
    const restored = (await decodeBackup(await encodeBackup(document))).document.rows.chats[0] as { messages: StoredChatMessage[] };
    expect(restored.messages[1].status).toBe("incomplete");
    expect(restored.messages[0].roundVersions).toMatchObject({ selected: 1, pairs: [
      [{ id: "alternate-user", content: "alternate question" }, { id: "alternate-answer", content: "alternate partial", status: "incomplete" }],
      [{ id: "user" }, { id: "answer", status: "incomplete" }],
    ] });
    expect(JSON.stringify(document)).not.toContain("continuation");
    expect(JSON.stringify(document)).not.toContain(syntheticKey);
    expect(answer.status).toBe("streaming");
    expect(otherAnswer.status).toBe("paused");
  });

  it("reads and checksums each referenced native attachment once, including inactive round alternatives", async () => {
    const input = snapshot();
    const attachment: SentAttachment = { reference, name: "synthetic.txt", mimeType: "text/plain", size: nativeBytes.length };
    const [user, answer] = input.rows.chats[0].messages;
    user.attachments = [attachment];
    user.roundVersions = { selected: 0, pairs: [[{ ...user }, { ...answer }], [
      { ...user, id: "alternate-user" }, { ...answer, id: "alternate-answer", replyToId: "alternate-user", attachments: [attachment] },
    ]] };
    const native = files();
    const document = await createBackupDocument(input, { connections: false, credentials: false }, native);
    expect(document.assets).toEqual([{ id: reference, mime: "text/plain", data: bytesToBase64(nativeBytes), size: nativeBytes.length,
      sha256: await sha256(nativeBytes) }]);
    expect(native.read).toHaveBeenCalledExactlyOnceWith(reference);
    expect(native.write).not.toHaveBeenCalled();
    expect(native.remove).not.toHaveBeenCalled();
    expect((await decodeBackup(await encodeBackup(document))).counts.files).toBe(1);
  });

  it("encodes synthetic avatar Blobs as deduplicated managed resources with their crop and provenance", async () => {
    const input = snapshot();
    // Header-only synthetic data: this tests serialization, not browser image decoding.
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const avatar = { original: new Blob([png], { type: "image/png" }), thumbnail: new Blob([png], { type: "image/png" }),
      crop: { x: 0.5, y: 0.5, zoom: 1 }, source: { resourceId: "avatar", version: "version" } };
    Object.assign(avatar, { apiKey: syntheticKey, sourcePath });
    Object.assign(avatar.crop, { apiKey: syntheticKey });
    Object.assign(avatar.source, { apiKey: syntheticKey, sourcePath });
    input.rows.avatarLibrary = [{ id: "avatar", name: "Synthetic avatar", version: "version", avatar }];
    input.rows.assistants[0].avatar = avatar;
    input.rows.userAvatar[0].value = avatar;
    const native = files();
    const document = await createBackupDocument(input, { connections: false, credentials: false }, native);
    expect(document.assets).toHaveLength(1);
    expect(document.assets[0]).toMatchObject({ id: expect.stringMatching(/^blob:/), mime: "image/png", data: bytesToBase64(png), size: png.length,
      sha256: await sha256(png) });
    const marker = { $blob: document.assets[0].id, type: "image/png" };
    expect(document.rows.avatarLibrary[0]).toEqual({ id: "avatar", name: "Synthetic avatar", version: "version", avatar: {
      original: marker, thumbnail: marker, crop: { x: 0.5, y: 0.5, zoom: 1 }, source: { resourceId: "avatar", version: "version" },
    } });
    expect(JSON.stringify(document)).not.toContain(syntheticKey);
    expect(JSON.stringify(document)).not.toContain("sourcePath");
    expect(native.read).not.toHaveBeenCalled();
    expect((await decodeBackup(await encodeBackup(document))).counts).toMatchObject({ avatars: 1, files: 1 });
  });

  it.each(["missing", "size", "invalid data", "unsafe reference", "inconsistent metadata"])("aborts snapshot on %s attachment", async failure => {
    const input = snapshot();
    const attachment: SentAttachment = { reference, name: "synthetic.txt", mimeType: "text/plain", size: nativeBytes.length };
    input.rows.chats[0].messages[0].attachments = [attachment];
    const native = files();
    if (failure === "missing") vi.mocked(native.read).mockRejectedValue(new Error("synthetic missing resource"));
    if (failure === "size") attachment.size++;
    if (failure === "invalid data") vi.mocked(native.read).mockResolvedValue("not canonical base64");
    if (failure === "unsafe reference") attachment.reference = "attachments/../synthetic.txt";
    if (failure === "inconsistent metadata") input.rows.chats[0].messages[1].attachments = [{ ...attachment, mimeType: "application/pdf" }];
    await expect(createBackupDocument(input, { connections: false, credentials: false }, native)).rejects.toThrow();
    expect(native.write).not.toHaveBeenCalled();
    expect(native.remove).not.toHaveBeenCalled();
    if (["unsafe reference", "inconsistent metadata"].includes(failure)) expect(native.read).not.toHaveBeenCalled();
  });
});
