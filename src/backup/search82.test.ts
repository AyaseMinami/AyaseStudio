import { describe, expect, it, vi } from "vitest";
import { defaultSessionConfig } from "../chat/sessionConfig";
import { defaultSearchConfiguration, SEARCH_SETTINGS_KEY, validateSearchConfiguration } from "../search/settings";
import { decodeBackup, encodeBackup, readBackupDocument } from "./codec";
import { createBackupDocument, allPreferenceKeys, type LocalSnapshot } from "./snapshot";
import { createRestorePlan } from "./restorePlan";
import { backupTables, type BackupFiles, type BackupRows } from "./types";

function configuration(prefix = "synthetic") {
  const config = defaultSearchConfiguration();
  config.exaMcp.apiKey = `${prefix}-mcp-key`;
  config.exaApi.apiKey = `${prefix}-exa-key`;
  config.tavily = { ...config.tavily, enabled: true, searchDepth: "advanced", apiKey: `${prefix}-tavily-key` };
  config.zhipu = { ...config.zhipu, enabled: true, searchEngine: "search_pro_sogou", apiKey: `${prefix}-zhipu-key` };
  return validateSearchConfiguration(config);
}
function snapshot(): LocalSnapshot {
  const rows = Object.fromEntries(backupTables.map(name => [name, []])) as unknown as BackupRows;
  rows.assistants = [{ id: "assistant", name: "synthetic", icon: "", sortOrder: 0, defaultModelId: null,
    defaultConfig: { ...defaultSessionConfig(), webSearch: true, webSearchProvider: "tavily" } }];
  rows.conversations = [{ id: "chat", assistantId: "assistant", title: "synthetic", createdAt: 1, updatedAt: 2,
    settings: { modelId: null, config: { ...defaultSessionConfig(), webSearch: true, webSearchProvider: "zhipu" } } }];
  rows.chats = [{ id: "chat", updatedAt: 2, messages: [{ id: "answer", role: "assistant", content: "synthetic", status: "complete",
    search: { enabled: true, provider: "tavily", status: "completed", queries: ["公开问题"],
      sources: [{ id: "s1", title: "source", url: "https://example.invalid/source", excerpt: "excerpt" }], citations: [] } }] }];
  return { rows, preferences: { ...Object.fromEntries(allPreferenceKeys.map(key => [key, null])),
    [SEARCH_SETTINGS_KEY]: JSON.stringify(configuration()) } };
}
function files(): BackupFiles {
  return { read: vi.fn(), assertAvailable: vi.fn(), write: vi.fn(), remove: vi.fn() };
}

describe("Issue 82 portable search compatibility", () => {
  it.each([false, true])("round-trips four profiles and provider identities with credentials=%s", async credentials => {
    const before = snapshot(), original = structuredClone(before), resources = files();
    const doc = await createBackupDocument(before, { connections: credentials, credentials }, resources);
    const encoded = await encodeBackup(doc), decoded = (await decodeBackup(encoded)).document;
    expect(decoded).toEqual(doc);
    expect(doc.searchSettings).toMatchObject({ version: 3, tavily: { enabled: true, searchDepth: "advanced" },
      zhipu: { enabled: true, searchEngine: "search_pro_sogou" } });
    expect(doc.version).toBe(5);
    expect(doc.compatibility?.modules.search.version).toBe(3);
    for (const suffix of ["mcp", "exa", "tavily", "zhipu"]) expect(encoded.includes(`synthetic-${suffix}-key`)).toBe(credentials);
    const current = snapshot(); current.preferences[SEARCH_SETTINGS_KEY] = JSON.stringify(configuration("current"));
    const plan = createRestorePlan(decoded, current, "replace");
    const restored = JSON.parse(plan.after.preferences[SEARCH_SETTINGS_KEY]!);
    for (const key of ["exaMcp", "exaApi", "tavily", "zhipu"] as const) {
      expect(restored[key].apiKey).toBe(configuration(credentials ? "synthetic" : "current")[key].apiKey);
    }
    expect(plan.after.rows.assistants[0].defaultConfig?.webSearchProvider).toBe("tavily");
    expect(plan.after.rows.conversations[0].settings?.config.webSearchProvider).toBe("zhipu");
    expect(plan.after.rows.chats[0].messages[0].search?.provider).toBe("tavily");
    expect(before).toEqual(original);
    expect(resources.write).not.toHaveBeenCalled();
  });

  it("preserves independently enabled new profiles and credentials when replacing an old two-profile backup", async () => {
    const before = snapshot(), source = snapshot();
    source.rows.assistants[0].defaultConfig = defaultSessionConfig();
    source.rows.conversations[0].settings!.config = defaultSessionConfig();
    delete source.rows.chats[0].messages[0].search;
    const doc = await createBackupDocument(source, { connections: false, credentials: false }, files());
    const old = configuration("old");
    const { apiKey: _mcpKey, ...exaMcp } = old.exaMcp;
    const { apiKey: _exaKey, ...exaApi } = old.exaApi;
    doc.searchSettings = { version: 2, exaMcp, exaApi };
    const decoded = (await decodeBackup(await encodeBackup(doc))).document;
    const plan = createRestorePlan(decoded, before, "replace");
    const result = JSON.parse(plan.after.preferences[SEARCH_SETTINGS_KEY]!);
    expect(result.tavily).toEqual(configuration().tavily);
    expect(result.zhipu).toEqual(configuration().zhipu);
  });

  it.each(["profiles", "session", "history", "round-history"])("rejects new %s structure under an original search-module v2 stamp", async variant => {
    const doc = await createBackupDocument(snapshot(), { connections: false, credentials: false }, files());
    const raw = structuredClone(doc) as any;
    raw.compatibility.modules.search.version = 2;
    raw.compatibility.modules.search.minimumReaderVersion = 2;
    if (variant !== "profiles") {
      raw.searchSettings = { version: 2, exaMcp: raw.searchSettings.exaMcp, exaApi: raw.searchSettings.exaApi };
      raw.rows.assistants[0].defaultConfig = defaultSessionConfig();
      raw.rows.conversations[0].settings.config = defaultSessionConfig();
      const search = raw.rows.chats[0].messages[0].search;
      delete raw.rows.chats[0].messages[0].search;
      if (variant === "session") raw.rows.conversations[0].settings.config.webSearchProvider = "zhipu";
      if (variant === "history") raw.rows.chats[0].messages[0].search = search;
      if (variant === "round-history") raw.rows.chats[0].messages[0].roundVersions = { selected: 0, pairs: [[
        { id: "user", role: "user", content: "public", status: "complete" }, { ...raw.rows.chats[0].messages[0], replyToId: "user", search }
      ]] };
    }
    const supported = structuredClone(raw);
    supported.compatibility.modules.search = structuredClone(doc.compatibility!.modules.search);
    await expect(readBackupDocument(supported)).resolves.toBeDefined();
    const original = structuredClone(raw), current = snapshot(), originalCurrent = structuredClone(current);
    await expect(readBackupDocument(raw)).rejects.toThrow("搜索模块");
    await expect(readBackupDocument(raw).then(decoded => createRestorePlan(decoded, current, "replace"))).rejects.toThrow("搜索模块");
    expect(raw).toEqual(original); expect(current).toEqual(originalCurrent);
  });

  it.each(["future", "unknown-credential", "invalid-engine"])("rejects %s before resource writes and preserves raw preferences", async variant => {
    const before = snapshot(), raw = JSON.parse(before.preferences[SEARCH_SETTINGS_KEY]!);
    if (variant === "future") raw.version = 4;
    if (variant === "unknown-credential") raw.tavily.authorization = "synthetic-unknown-key";
    if (variant === "invalid-engine") raw.zhipu.searchEngine = "future-engine";
    before.preferences[SEARCH_SETTINGS_KEY] = JSON.stringify(raw);
    const original = structuredClone(before), resources = files();
    await expect(createBackupDocument(before, { connections: true, credentials: true }, resources)).rejects.toThrow();
    expect(before).toEqual(original); expect(resources.read).not.toHaveBeenCalled(); expect(resources.write).not.toHaveBeenCalled();
  });

  it.each([1, 2, 3])("refuses new provider selections in historical document v%s", async version => {
    const raw = await createBackupDocument(snapshot(), { connections: false, credentials: false }, files()) as any;
    raw.version = version;
    const appearance = JSON.parse(raw.preferences["ayase-studio.appearance.v1"]);
    delete appearance.sidebarGlassEnabled; delete appearance.composerGlassEnabled;
    raw.preferences["ayase-studio.appearance.v1"] = JSON.stringify(appearance);
    delete raw.compatibility; delete raw.drawing; delete raw.searchSettings;
    await expect(readBackupDocument(raw)).rejects.toThrow("搜索模块");
  });

  it.each([false, true])("accepts v4 with matching original search support, new providers=%s", async additional => {
    const raw = await createBackupDocument(snapshot(), { connections: false, credentials: false }, files()) as any;
    raw.version = 4; raw.compatibility.minimumReaderVersion = 4;
    delete raw.drawing;
    delete raw.compatibility.modules.drawingSettings;
    delete raw.compatibility.modules.drawingPresets;
    if (!additional) {
      raw.compatibility.modules.search.version = 2;
      raw.compatibility.modules.search.minimumReaderVersion = 2;
      raw.searchSettings = { version: 2, exaMcp: raw.searchSettings.exaMcp, exaApi: raw.searchSettings.exaApi };
      raw.rows.assistants[0].defaultConfig = defaultSessionConfig();
      raw.rows.conversations[0].settings.config = defaultSessionConfig();
      delete raw.rows.chats[0].messages[0].search;
    }
    await expect(readBackupDocument(raw)).resolves.toBeDefined();
  });
});
