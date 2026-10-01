import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AyaseDatabase } from "../storage/database";
import { defaultSessionConfig } from "../chat/sessionConfig";
import { connectionSettingsStorageKey, type ConnectionSettingsState } from "../chat/settings";
import { defaultAppearancePreferences } from "../appearance/appearance";
import { BackupRepository, type BackupStorage } from "./repository";
import { createRestorePlan } from "./restorePlan";
import { allPreferenceKeys, type LocalSnapshot } from "./snapshot";
import { backupTables, preferenceKeys, type BackupDocument, type BackupFiles, type BackupRows } from "./types";
import { bytesToBase64 } from "../chat/attachments";
import { sha256 } from "./codec";
import { encodeBackup, decodeBackup } from "./codec";
import { createBackupDocument } from "./snapshot";
import { createChatRepository } from "../chat/repository";
import { SEARCH_SETTINGS_KEY } from "../search/settings";
import { object } from "./validation";

const databases: AyaseDatabase[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const db of databases.splice(0)) await db.delete(); });
const emptyRows = () => Object.fromEntries(backupTables.map(t => [t, []])) as unknown as BackupRows;
function state(): LocalSnapshot {
  const rows = emptyRows();
  rows.assistants = [{ id: "default", name: "current", icon: "", sortOrder: 0, defaultModelId: "model", defaultConfig: defaultSessionConfig() }];
  rows.conversations = [{ id: "chat", assistantId: "default", title: "current", createdAt: 1, updatedAt: 2, settings: { modelId: "model", config: defaultSessionConfig() } }];
  rows.chats = [{ id: "chat", updatedAt: 2, messages: [{ id: "u", role: "user", content: "current", status: "complete" }] }];
  rows.workspace = [{ id: "selection", activeAssistantId: "default", lastSelected: { default: "chat" } }];
  rows.userAvatar = [{ id: "user" }];
  return { rows, preferences: Object.fromEntries(allPreferenceKeys.map(k => [k, k === connectionSettingsStorageKey ? JSON.stringify(connections("existing-key"))
    : k === SEARCH_SETTINGS_KEY ? JSON.stringify({ version: 1, baseUrl: "https://local.invalid/mcp", apiKey: "existing-search-key", numResults: 3 }) : null])) };
}
function connections(apiKey: string): ConnectionSettingsState {
  return { version: 3, activeModelId: "model", providers: [{ id: "p", name: "provider", connections: [{ id: "c", name: "connection", protocol: "openai-chat", baseUrl: "https://example.invalid", apiKey, models: [{ id: "model", modelId: "synthetic" }] }] }] };
}
function searchConfiguration(prefix = "existing") {
  return { version: 2 as const,
    exaMcp: { version: 1 as const, baseUrl: `https://${prefix}.invalid/mcp`, apiKey: `${prefix}-mcp-key`, numResults: 3 },
    exaApi: { version: 1 as const, baseUrl: `https://${prefix}.invalid/api`, apiKey: `${prefix}-api-key`, numResults: 7 } };
}
function document(credentials = false, included = true): BackupDocument {
  const local = state();
  local.rows.assistants[0]!.name = "backup"; local.rows.chats[0]!.messages[0]!.content = "backup";
  local.rows.cherryImports = [{ id: "marker", conversationIds: ["chat"] }];
  const config = connections("backup-key");
  if (!credentials) delete (config.providers[0]!.connections[0] as Partial<typeof config.providers[0]["connections"][number]>).apiKey;
  return { format: "ayase-studio-backup", version: 1, createdAt: "2026-09-30T00:00:00Z", options: { connections: included, credentials },
    rows: local.rows as unknown as BackupDocument["rows"], preferences: Object.fromEntries(preferenceKeys.map(k => [k, null])) as BackupDocument["preferences"], connections: included ? config : null, assets: [] };
}
function storage(values: Record<string, string | null>): BackupStorage & { values: Map<string, string> } {
  const map = new Map(Object.entries(values).filter((pair): pair is [string, string] => pair[1] !== null));
  return { values: map, getItem: k => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); }, removeItem: k => { map.delete(k); } };
}
async function setup() {
  const db = new AyaseDatabase(`backup-test-${crypto.randomUUID()}`); databases.push(db);
  const before = state(), store = storage(before.preferences);
  for (const t of backupTables) if (before.rows[t].length) await db.table(t).bulkPut(before.rows[t]);
  const repository = new BackupRepository(db, store);
  before.drawing = { draft: undefined, presets: [], targets: [] };
  const saved = new Map<string, string>();
  const files: BackupFiles = { read: async r => saved.get(r)!, assertAvailable: vi.fn(async () => {}), write: vi.fn(async (r, data) => { saved.set(r, data); }), remove: vi.fn(async refs => { for (const r of refs) saved.delete(r); }) };
  return { db, before, store, repository, saved, files };
}
async function assetDocument() {
  const doc = document(); const bytes = new TextEncoder().encode("synthetic file");
  const reference = `attachments/${crypto.randomUUID()}.txt`;
  doc.assets.push({ id: reference, mime: "text/plain", size: bytes.length, data: bytesToBase64(bytes), sha256: await sha256(bytes) });
  (doc.rows.chats[0] as any).messages[0].attachments = [{ reference, name: "synthetic.txt", mimeType: "text/plain", size: bytes.length }];
  return doc;
}
describe("restore conflict strategies", () => {
  it.each(["replace", "copy"] as const)("preserves manual conversation ranks during %s", mode => {
    const doc = document(), before = state();
    object(doc.rows.conversations[0]);
    doc.rows.conversations[0].sortOrder = 4;
    const plan = createRestorePlan(doc, before, mode);
    const restored = plan.after.rows.conversations.find(c => c.title === "current" && (mode === "replace" || c.id !== "chat"));
    expect(restored?.sortOrder).toBe(4);
    expect(restored?.assistantId).toBe(plan.after.rows.assistants.find(a => a.name === "backup")?.id);
  });
  it.each(["merge", "copy", "replace"] as const)("v3 %s isolates API/MCP configs and preserves corresponding excluded keys", async mode => {
    const before = state(), current = searchConfiguration(); before.preferences[SEARCH_SETTINGS_KEY] = JSON.stringify(current);
    for (const credentials of [false, true]) {
      const doc = document(credentials); doc.version = 3;
      const exported = searchConfiguration("backup") as any;
      if (!credentials) { delete exported.exaMcp.apiKey; delete exported.exaApi.apiKey; }
      doc.searchSettings = exported;
      const preview = await decodeBackup(await encodeBackup(doc));
      const plan = createRestorePlan(preview.document, before, mode), result = JSON.parse(plan.after.preferences[SEARCH_SETTINGS_KEY]!);
      expect(result).toEqual(mode === "replace" ? { ...exported,
        exaMcp: { ...exported.exaMcp, apiKey: credentials ? "backup-mcp-key" : "existing-mcp-key" },
        exaApi: { ...exported.exaApi, apiKey: credentials ? "backup-api-key" : "existing-api-key" } } : current);
    }
  });
  it("v2 replace migrates only MCP while retaining API configuration and key", async () => {
    const before = state(), current = searchConfiguration(); before.preferences[SEARCH_SETTINGS_KEY] = JSON.stringify(current);
    for (const credentials of [false, true]) {
      const doc = document(credentials); doc.version = 2;
      doc.searchSettings = { version: 1, baseUrl: "https://backup.invalid/mcp", numResults: 5, ...(credentials ? { apiKey: "backup-mcp-key" } : {}) };
      const decoded = (await decodeBackup(await encodeBackup(doc))).document;
      const plan = createRestorePlan(decoded, before, "replace"), result = JSON.parse(plan.after.preferences[SEARCH_SETTINGS_KEY]!);
      expect(result.exaApi).toEqual(current.exaApi);
      expect(result.exaMcp).toEqual({ ...doc.searchSettings, apiKey: credentials ? "backup-mcp-key" : "existing-mcp-key" });
      expect(plan.warnings.some(w => w.includes("保留本机 Exa API"))).toBe(true);
    }
  });
  it.each(["merge", "copy", "replace"] as const)("v1 %s retains local search configuration/key and never enables search", mode => {
    const before = state(), plan = createRestorePlan(document(), before, mode);
    expect(plan.after.preferences[SEARCH_SETTINGS_KEY]).toBe(before.preferences[SEARCH_SETTINGS_KEY]);
    expect(plan.warnings.some(w => w.includes("不含网络搜索设置"))).toBe(true);
    for (const c of plan.after.rows.conversations) { expect(c.settings?.config.webSearchProvider).toBeUndefined(); expect(c.settings?.config.webSearch).not.toBe(true); }
    before.preferences[SEARCH_SETTINGS_KEY] = null;
    expect(createRestorePlan(document(), before, mode).after.preferences[SEARCH_SETTINGS_KEY]).toBeNull();
  });
  it.each(["merge", "copy", "replace"] as const)("v2 %s applies search settings only in replace, respecting the credential selection", mode => {
    const before = state();
    for (const credentials of [false, true]) {
      const doc = document(credentials); doc.version = 2;
      doc.searchSettings = { version: 1, baseUrl: "https://backup.invalid/mcp", numResults: 7, ...(credentials ? { apiKey: "backup-search-key" } : {}) };
      const plan = createRestorePlan(doc, before, mode);
      const restored = JSON.parse(plan.after.preferences[SEARCH_SETTINGS_KEY]!);
      expect(mode === "replace" ? restored.exaMcp : restored).toEqual(mode === "replace"
        ? { version: 1, baseUrl: "https://backup.invalid/mcp", numResults: 7, apiKey: credentials ? "backup-search-key" : "existing-search-key" }
        : JSON.parse(before.preferences[SEARCH_SETTINGS_KEY]!));
      expect(plan.warnings.some(w => w.includes("搜索"))).toBe(true);
    }
  });
  it("v2 excluded credentials preserve the current search key and default to anonymous without local settings", () => {
    const before = state(), doc = document(); doc.version = 2;
    doc.searchSettings = { version: 1, baseUrl: "https://backup.invalid/mcp", numResults: 7 };
    before.preferences[SEARCH_SETTINGS_KEY] = null;
    expect(JSON.parse(createRestorePlan(doc, before, "replace").after.preferences[SEARCH_SETTINGS_KEY]!).exaMcp.apiKey).toBe("");
  });
  it.each(["merge", "copy", "replace"] as const)("v2 %s retains search-source ownership and session choices in imported candidates", async mode => {
    const before = state(), doc = document(); doc.version = 2;
    const config = { ...defaultSessionConfig(), webSearch: true, webSearchProvider: "exa-mcp" as const };
    (doc.rows.assistants[0] as any).defaultConfig = config;
    const conversation = doc.rows.conversations[0] as any;
    if (mode === "merge") { conversation.id = "imported-chat"; (doc.rows.chats[0] as any).id = "imported-chat"; (doc.rows.workspace[0] as any).lastSelected.default = "imported-chat"; }
    conversation.settings.config = config; conversation.creationConfig = { modelId: null, config };
    const chat = doc.rows.chats[0] as any;
    const search = { enabled: true, provider: "exa-mcp", status: "completed", queries: ["query"], warning: "bounded warning", sources: [{ id: "s1", title: "title", url: "https://example.invalid", excerpt: "excerpt" }], citations: [{ start: 0, end: 6, sourceIds: ["s1"] }] };
    const answer = { id: "answer", role: "assistant", replyToId: "u", content: "answer", status: "complete", search };
    chat.messages.push(answer); chat.messages[0].roundVersions = { selected: 0, pairs: [[{ ...chat.messages[0] }, structuredClone(answer)]] };
    const decoded = (await decodeBackup(await encodeBackup(doc))).document;
    const plan = createRestorePlan(decoded, before, mode);
    const imported = plan.after.rows.chats[mode === "replace" ? 0 : 1];
    expect(imported.messages[1].search).toEqual(search);
    expect(imported.messages[0].roundVersions!.pairs[0][1].search).toEqual(search);
    expect(plan.after.rows.conversations[mode === "replace" ? 0 : 1].settings!.config.webSearchProvider).toBe("exa-mcp");
    expect(plan.after.rows.conversations[mode === "replace" ? 0 : 1].creationConfig!.config.webSearchProvider).toBe("exa-mcp");
  });
  it.each([1, 2, 3] as const)("normalizes unfinished search on v%s restore including candidates", version => {
    const doc = document(); doc.version = version;
    const chat = doc.rows.chats[0] as any;
    const answer = { id: "a", role: "assistant", replyToId: "u", content: "partial", status: "complete", search: { enabled: true, status: "searching", queries: [], sources: [], citations: [] } };
    chat.messages.push(answer); chat.messages[0].roundVersions = { selected: 0, pairs: [[{ ...chat.messages[0] }, structuredClone(answer)]] };
    const plan = createRestorePlan(doc, state(), "replace");
    expect(plan.after.rows.chats[0].messages[1]).toMatchObject({ status: "incomplete", search: { status: "cancelled" } });
    expect(plan.after.rows.chats[0].messages[0].roundVersions!.pairs[0][1]).toMatchObject({ status: "incomplete", search: { status: "cancelled" } });
  });
  it("backs up an orphaned answer after deleting its question through the real repository", async () => {
    const test = await setup(), repo = createChatRepository(test.db.name);
    await repo.save({ id: "chat", updatedAt: 3, messages: [{ id: "u", role: "user", content: "question", status: "complete" }, { id: "a", role: "assistant", content: "answer", replyToId: "u", status: "complete" }] });
    await repo.execute({ type: "delete-message", conversationId: "chat", messageId: "u" });
    const snapshot = await test.repository.snapshot();
    const doc = await createBackupDocument(snapshot, { connections: false, credentials: false }, test.files);
    const preview = await decodeBackup(await encodeBackup(doc));
    const replace = createRestorePlan(preview.document, snapshot, "replace");
    expect(replace.after.rows.chats[0]!.messages[0]!.content).toBe("answer");
    expect(replace.after.rows.chats[0]!.messages[0]!.replyToId).toBeNull();
    const copy = createRestorePlan(preview.document, snapshot, "copy");
    expect(copy.after.rows.chats[1]!.messages[0]!.replyToId).toBeNull();
  });
  it("merge preserves conflicting transcripts, credentials and selection, and does not stage orphan files", async () => {
    const before = state(), doc = await assetDocument();
    const plan = createRestorePlan(doc, before, "merge");
    expect(plan.after.rows.chats).toEqual(before.rows.chats);
    expect(plan.after.rows.assistants).toEqual(before.rows.assistants);
    expect(JSON.parse(plan.after.preferences[connectionSettingsStorageKey]!)).toEqual(connections("existing-key"));
    expect(plan.after.rows.workspace).toEqual(before.rows.workspace);
    expect(plan.writes).toEqual([]); expect(plan.conflicts).toBeGreaterThan(0);
  });
  it("copy remaps assistants, models, conversations, messages, replies, source markers and resources", async () => {
    const before = state(), doc = await assetDocument(); const chat = doc.rows.chats[0] as any;
    chat.messages.push({ id: "a", role: "assistant", content: "answer", replyToId: "u", status: "complete" });
    chat.messages[0].roundVersions = { selected: 0, pairs: [[{ ...chat.messages[0] }, { ...chat.messages[1] }]] };
    const plan = createRestorePlan(doc, before, "copy"), restored = plan.after.rows.chats[1]!;
    expect(plan.after.rows.assistants[1]!.id).not.toBe("default");
    expect(restored.id).toBe(plan.after.rows.conversations[1]!.id); expect(restored.id).not.toBe("chat");
    expect(restored.messages[0]!.id).not.toBe("u"); expect(restored.messages[1]!.replyToId).toBe(restored.messages[0]!.id);
    expect(restored.messages[0]!.roundVersions!.pairs[0]![1].replyToId).toBe(restored.messages[0]!.id);
    expect(plan.after.rows.conversations[1]!.assistantId).toBe(plan.after.rows.assistants[1]!.id);
    const config = JSON.parse(plan.after.preferences[connectionSettingsStorageKey]!);
    expect(config.providers[1].connections[0].apiKey).toBe("");
    expect(plan.after.rows.conversations[1]!.settings!.modelId).toBe(config.providers[1].connections[0].models[0].id);
    expect(plan.after.rows.cherryImports[0]).toEqual({ id: "marker", conversationIds: [restored.id] });
    expect(plan.writes).toHaveLength(1); expect(restored.messages[0]!.attachments![0]!.reference).toBe(plan.writes[0]!.reference);
    expect(before.rows.chats).toHaveLength(1);
  });
  it("replace excludes absent connections, clears imported bindings, tombstones missing avatars", () => {
    const doc = document(false, false), before = state(); doc.rows.userAvatar = [];
    const plan = createRestorePlan(doc, before, "replace");
    expect(plan.conflicts).toBeGreaterThan(0);
    expect(plan.after.preferences[connectionSettingsStorageKey]).toBe(before.preferences[connectionSettingsStorageKey]);
    expect(plan.after.rows.conversations[0]!.settings!.modelId).toBeNull(); expect(plan.after.rows.assistants[0]!.defaultModelId).toBeNull();
    expect(plan.after.rows.userAvatar).toEqual([{ id: "user" }]); expect(plan.warnings.some(w => w.includes("模型"))).toBe(true);
  });
  it("included credentials restore into a new copy or explicit replacement while merge retains existing keys", () => {
    const before = state(), doc = document(true);
    expect(JSON.parse(createRestorePlan(doc, before, "merge").after.preferences[connectionSettingsStorageKey]!).providers[0].connections[0].apiKey).toBe("existing-key");
    expect(JSON.parse(createRestorePlan(doc, before, "replace").after.preferences[connectionSettingsStorageKey]!).providers[0].connections[0].apiKey).toBe("backup-key");
    expect(JSON.parse(createRestorePlan(doc, before, "copy").after.preferences[connectionSettingsStorageKey]!).providers[1].connections[0].apiKey).toBe("backup-key");
  });
  it("retains existing avatar Blobs when merging and hydrates imported own snapshots", async () => {
    const before = state(), original = new Blob(["old"], { type: "image/png" });
    before.rows.userAvatar = [{ id: "user", value: { original, thumbnail: original, crop: { x: .5, y: .5, zoom: 1 } } }];
    const plan = createRestorePlan(document(), before, "merge");
    expect(await plan.after.rows.userAvatar[0]!.value!.original.text()).toBe("old");
  });
  it("appends background library in copy without applying it or staging duplicate retained originals", () => {
    const before = state(); const reference = `backgrounds/${crypto.randomUUID()}.png`;
    const background = { id: "b", reference, name: "image", focus: null, fit: "cover", mask: 65, blur: 0 };
    before.preferences[preferenceKeys[0]] = JSON.stringify({ ...defaultAppearancePreferences, backgroundLibrary: [background], backgroundReference: reference });
    const doc = document(); doc.preferences[preferenceKeys[0]] = JSON.stringify({ ...defaultAppearancePreferences, backgroundLibrary: [background] });
    doc.assets = [{ id: reference, mime: "image/png", data: "aGk=", size: 2, sha256: "test" }];
    const plan = createRestorePlan(doc, before, "copy"), prefs = JSON.parse(plan.after.preferences[preferenceKeys[0]]!);
    expect(prefs.backgroundReference).toBe(reference); expect(prefs.backgroundLibrary).toHaveLength(2);
    expect(prefs.backgroundLibrary[0].reference).toBe(reference); expect(prefs.backgroundLibrary[1].reference).toBe(plan.writes[0]!.reference);
  });
});
describe("multi-store restore journal", () => {
  it("repairs corrupt local profiles with a complete v3 replacement and rolls back raw data on failure", async () => {
    const test = await setup();
    const corrupt = "corrupt-local-search-json";
    test.before.preferences[SEARCH_SETTINGS_KEY] = corrupt; test.store.setItem(SEARCH_SETTINGS_KEY, corrupt);
    const doc = document(true); doc.version = 3; doc.searchSettings = searchConfiguration("backup");
    const validated = (await decodeBackup(await encodeBackup(doc))).document;
    const plan = createRestorePlan(validated, test.before, "replace");
    vi.spyOn(test.db.backupJournal, "delete").mockRejectedValueOnce(Error("injected"));
    await expect(test.repository.restore(plan, test.before, test.files)).rejects.toThrow("已回滚");
    expect(test.store.getItem(SEARCH_SETTINGS_KEY)).toBe(corrupt);
    await test.repository.restore(plan, test.before, test.files);
    expect(JSON.parse(test.store.getItem(SEARCH_SETTINGS_KEY)!)).toEqual(doc.searchSettings);
    expect(await test.db.backupJournal.count()).toBe(0);
  });
  it.each(["storage", "commit"])("v3 rolls back both profile configs/keys after %s failure, then commits retry", async failure => {
    const test = await setup(), current = searchConfiguration();
    test.before.preferences[SEARCH_SETTINGS_KEY] = JSON.stringify(current); test.store.setItem(SEARCH_SETTINGS_KEY, JSON.stringify(current));
    const doc = document(true); doc.version = 3; doc.searchSettings = searchConfiguration("backup");
    const plan = createRestorePlan((await decodeBackup(await encodeBackup(doc))).document, test.before, "replace");
    if (failure === "commit") vi.spyOn(test.db.backupJournal, "delete").mockRejectedValueOnce(Error("injected"));
    else { const write = test.store.setItem; let fail = true; vi.spyOn(test.store, "setItem").mockImplementation((key, value) => { write(key, value); if (key === SEARCH_SETTINGS_KEY && fail) { fail = false; throw Error("quota"); } }); }
    await expect(test.repository.restore(plan, test.before, test.files)).rejects.toThrow("已回滚");
    expect(await test.repository.snapshot()).toEqual(test.before);
    await test.repository.restore(plan, test.before, test.files);
    expect(JSON.parse(test.store.getItem(SEARCH_SETTINGS_KEY)!)).toEqual(doc.searchSettings);
    expect(await test.db.backupJournal.count()).toBe(0);
  });
  it("commits v2 search settings and rolls them back when commit-point deletion fails", async () => {
    const test = await setup(), doc = document(true); doc.version = 2;
    doc.searchSettings = { version: 1, baseUrl: "https://backup.invalid/mcp", apiKey: "backup-search-key", numResults: 7 };
    const plan = createRestorePlan(doc, test.before, "replace");
    vi.spyOn(test.db.backupJournal, "delete").mockRejectedValueOnce(Error("injected"));
    await expect(test.repository.restore(plan, test.before, test.files)).rejects.toThrow("已回滚");
    expect(await test.repository.snapshot()).toEqual(test.before);
    await test.repository.restore(plan, test.before, test.files);
    expect(JSON.parse(test.store.getItem(SEARCH_SETTINGS_KEY)!).exaMcp).toEqual(doc.searchSettings);
    expect(await test.db.backupJournal.count()).toBe(0);
  });
  it("rolls back after a search-settings storage write fails", async () => {
    const test = await setup(), doc = document(true); doc.version = 2;
    doc.searchSettings = { version: 1, baseUrl: "https://backup.invalid/mcp", apiKey: "backup-search-key", numResults: 7 };
    const write = test.store.setItem;
    let fail = true;
    vi.spyOn(test.store, "setItem").mockImplementation((key, value) => { if (key === SEARCH_SETTINGS_KEY && fail) { fail = false; throw Error("quota"); } write(key, value); });
    await expect(test.repository.restore(createRestorePlan(doc, test.before, "replace"), test.before, test.files)).rejects.toThrow("已回滚");
    expect(await test.repository.snapshot()).toEqual(test.before);
  });
  it.each(["staging", "applying"] as const)("cold-start recovery restores search config/key in phase %s", async phase => {
    const test = await setup();
    await test.db.backupJournal.put({ id: "restore", before: test.before, references: [], phase });
    test.store.setItem(SEARCH_SETTINGS_KEY, "partial");
    expect(await new BackupRepository(test.db, test.store).recover(test.files)).toBe(true);
    expect(test.store.getItem(SEARCH_SETTINGS_KEY)).toBe(test.before.preferences[SEARCH_SETTINGS_KEY]);
  });
  it("recovering an older journal preserves search settings absent from its snapshot", async () => {
    const test = await setup(), old = structuredClone(test.before); delete old.preferences[SEARCH_SETTINGS_KEY];
    await test.db.backupJournal.put({ id: "restore", before: old, references: [], phase: "applying" });
    expect(await test.repository.recover(test.files)).toBe(true);
    expect(test.store.getItem(SEARCH_SETTINGS_KEY)).toBe(test.before.preferences[SEARCH_SETTINGS_KEY]);
  });
  it("commits data, preferences and resource ownership, then removes journal", async () => {
    const test = await setup(), plan = createRestorePlan(await assetDocument(), test.before, "replace");
    await test.repository.restore(plan, test.before, test.files);
    expect(await test.db.backupJournal.count()).toBe(0); expect((await test.db.chats.get("chat"))!.messages[0]!.content).toBe("backup");
    expect(test.saved.size).toBe(1); expect(await test.repository.recover(test.files)).toBe(false);
  });
  it("records every reserved file before write and cleans a partial write failure", async () => {
    const test = await setup(), plan = createRestorePlan(await assetDocument(), test.before, "replace");
    vi.mocked(test.files.write).mockImplementation(async (r, data) => { expect((await test.db.backupJournal.get("restore"))!.references).toContain(r); test.saved.set(r, data); throw Error("injected"); });
    await expect(test.repository.restore(plan, test.before, test.files)).rejects.toThrow("已回滚");
    expect(await test.repository.snapshot()).toEqual(test.before); expect(test.saved.size).toBe(0); expect(await test.db.backupJournal.count()).toBe(0);
  });
  it("rolls back database commit failure including writes made earlier in its transaction", async () => {
    const test = await setup(), plan = createRestorePlan(await assetDocument(), test.before, "replace");
    let fail = true;
    test.db.conversations.hook("creating", () => { if (fail) { fail = false; throw Error("injected"); } });
    await expect(test.repository.restore(plan, test.before, test.files)).rejects.toThrow("已回滚");
    expect(await test.repository.snapshot()).toEqual(test.before); expect(test.saved.size).toBe(0);
  });
  it("rolls back database and earlier preference writes after a later localStorage failure", async () => {
    const test = await setup(), plan = createRestorePlan(await assetDocument(), test.before, "replace");
    vi.spyOn(test.store, "removeItem").mockImplementationOnce(() => { throw Error("quota"); });
    await expect(test.repository.restore(plan, test.before, test.files)).rejects.toThrow("已回滚");
    expect(await test.repository.snapshot()).toEqual(test.before); expect(test.saved.size).toBe(0);
  });
  it("a commit-point deletion failure still rolls back all media", async () => {
    const test = await setup(), plan = createRestorePlan(await assetDocument(), test.before, "replace");
    vi.spyOn(test.db.backupJournal, "delete").mockRejectedValueOnce(Error("injected"));
    await expect(test.repository.restore(plan, test.before, test.files)).rejects.toThrow("已回滚");
    expect(await test.repository.snapshot()).toEqual(test.before); expect(test.saved.size).toBe(0);
  });
  it.each(["staging", "applying"] as const)("restart repairs a crash in %s without mounting other writers", async phase => {
    const test = await setup(), plan = createRestorePlan(await assetDocument(), test.before, "replace");
    await test.db.backupJournal.put({ id: "restore", before: test.before, references: plan.writes.map(w => w.reference), phase });
    test.saved.set(plan.writes[0]!.reference, "partial");
    if (phase === "applying") { for (const t of backupTables) { await test.db.table(t).clear(); if (plan.after.rows[t].length) await test.db.table(t).bulkPut(plan.after.rows[t]); } test.store.setItem(connectionSettingsStorageKey, "partial settings"); }
    const restarted = new BackupRepository(test.db, test.store);
    expect(await restarted.recover(test.files)).toBe(true); expect(await restarted.snapshot()).toEqual(test.before);
    expect(test.saved.size).toBe(0); expect(await restarted.recover(test.files)).toBe(false);
  });
  it("retains journal on cleanup failure and safely repeats recovery", async () => {
    const test = await setup(), plan = createRestorePlan(await assetDocument(), test.before, "replace");
    vi.mocked(test.files.write).mockImplementation(async (r, data) => { test.saved.set(r, data); throw Error("partial"); });
    vi.mocked(test.files.remove).mockRejectedValueOnce(Error("locked file"));
    await expect(test.repository.restore(plan, test.before, test.files)).rejects.toThrow("回滚尚未完成");
    expect(await test.db.backupJournal.count()).toBe(1); await expect(test.repository.snapshot()).rejects.toThrow("回滚尚未完成");
    expect(await test.db.chats.toArray()).toEqual(test.before.rows.chats);
    expect(await test.repository.recover(test.files)).toBe(true); expect(test.saved.size).toBe(0);
  });
  it("journal creation failure performs no data or file writes", async () => {
    const test = await setup(), plan = createRestorePlan(await assetDocument(), test.before, "replace");
    vi.spyOn(test.db.backupJournal, "add").mockRejectedValueOnce(Error("quota"));
    await expect(test.repository.restore(plan, test.before, test.files)).rejects.toThrow("quota");
    expect(test.files.write).not.toHaveBeenCalled(); expect(await test.repository.snapshot()).toEqual(test.before);
  });
  it("reserved path collisions fail before journaling and never delete existing files", async () => {
    const test = await setup(), plan = createRestorePlan(await assetDocument(), test.before, "replace");
    test.saved.set(plan.writes[0]!.reference, "existing");
    vi.mocked(test.files.assertAvailable).mockRejectedValueOnce(Error("collision"));
    await expect(test.repository.restore(plan, test.before, test.files)).rejects.toThrow("collision");
    expect(test.files.remove).not.toHaveBeenCalled(); expect(test.files.write).not.toHaveBeenCalled();
    expect(await test.db.backupJournal.count()).toBe(0); expect(test.saved.get(plan.writes[0]!.reference)).toBe("existing");
  });
});
