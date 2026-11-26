import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { defaultSessionConfig } from "../chat/sessionConfig";
import { defaultSearchConfiguration, SEARCH_SETTINGS_KEY, validateSearchConfiguration } from "../search/settings";
import { AyaseDatabase } from "../storage/database";
import { decodeBackup, encodeBackup, readBackupDocument } from "./codec";
import { createBackupDocument, allPreferenceKeys, type LocalSnapshot } from "./snapshot";
import { createRestorePlan } from "./restorePlan";
import { BackupRepository } from "./repository";
import { backupTables, type BackupFiles, type BackupRows } from "./types";

function configuration(prefix = "synthetic") {
  const config = defaultSearchConfiguration();
  config.exaMcp.apiKey = `${prefix}-mcp-key`;
  config.exaApi.apiKey = `${prefix}-exa-key`;
  config.tavily = { ...config.tavily, enabled: true, searchDepth: "advanced", apiKey: `${prefix}-tavily-key` };
  config.zhipu = { ...config.zhipu, enabled: true, searchEngine: "search_pro_sogou", apiKey: `${prefix}-zhipu-key` };
  config.deepseek = { ...config.deepseek, enabled: true, numResults: 8, apiKey: `${prefix}-deepseek-key` };
  return validateSearchConfiguration(config);
}

function snapshot(): LocalSnapshot {
  const rows = Object.fromEntries(backupTables.map(name => [name, []])) as unknown as BackupRows;
  rows.assistants = [{ id: "assistant", name: "synthetic", icon: "", sortOrder: 0, defaultModelId: null,
    defaultConfig: { ...defaultSessionConfig(), webSearch: true, webSearchProvider: "deepseek" } }];
  rows.conversations = [{ id: "chat", assistantId: "assistant", title: "synthetic", createdAt: 1, updatedAt: 2,
    settings: { modelId: null, config: { ...defaultSessionConfig(), webSearch: true, webSearchProvider: "deepseek" } },
    creationConfig: { modelId: null, config: { ...defaultSessionConfig(), webSearch: true, webSearchProvider: "deepseek" } } }];
  rows.legacyConversationConfigs = [{ id: "legacy", generationConfig: { ...defaultSessionConfig(), webSearch: true, webSearchProvider: "deepseek" }, lastUsedModelId: null }];
  rows.chats = [{ id: "chat", updatedAt: 2, messages: [{ id: "answer", role: "assistant", content: "synthetic", status: "complete",
    search: { enabled: true, provider: "deepseek", status: "completed", queries: ['site:deepseek.com "Search API"'],
      sources: [{ id: "s1", title: "source", url: "https://example.invalid/source", excerpt: "summary excerpt" }], citations: [] } }] }];
  return { rows, preferences: { ...Object.fromEntries(allPreferenceKeys.map(key => [key, null])),
    [SEARCH_SETTINGS_KEY]: JSON.stringify(configuration()) } };
}

function files(): BackupFiles {
  return { read: vi.fn(), assertAvailable: vi.fn(), write: vi.fn(), remove: vi.fn() };
}

describe("Issue 140 DeepSeek search backup compatibility", () => {
  it.each([false, true])("round-trips five profiles and DeepSeek provider identities with credentials=%s", async credentials => {
    const before = snapshot(), original = structuredClone(before), resources = files();
    const doc = await createBackupDocument(before, { connections: credentials, credentials }, resources);
    const encoded = await encodeBackup(doc), decoded = (await decodeBackup(encoded)).document;
    expect(decoded).toEqual(doc);
    expect(doc.searchSettings).toMatchObject({ version: 4, deepseek: { enabled: true, numResults: 8 } });
    expect(doc.version).toBe(5);
    expect(doc.compatibility?.modules.search).toEqual({ version: 5, minimumReaderVersion: 5, requiredCapabilities: [] });
    for (const suffix of ["mcp", "exa", "tavily", "zhipu", "deepseek"]) {
      expect(encoded.includes(`synthetic-${suffix}-key`)).toBe(credentials);
    }
    const current = snapshot(); current.preferences[SEARCH_SETTINGS_KEY] = JSON.stringify(configuration("current"));
    const plan = createRestorePlan(decoded, current, "replace");
    const restored = JSON.parse(plan.after.preferences[SEARCH_SETTINGS_KEY]!);
    for (const key of ["exaMcp", "exaApi", "tavily", "zhipu", "deepseek"] as const) {
      expect(restored[key].apiKey).toBe(configuration(credentials ? "synthetic" : "current")[key].apiKey);
    }
    expect(plan.after.rows.assistants[0].defaultConfig?.webSearchProvider).toBe("deepseek");
    expect(plan.after.rows.conversations[0].settings?.config.webSearchProvider).toBe("deepseek");
    expect(plan.after.rows.conversations[0].creationConfig?.config.webSearchProvider).toBe("deepseek");
    expect(plan.after.rows.legacyConversationConfigs[0].generationConfig?.webSearchProvider).toBe("deepseek");
    expect(plan.after.rows.chats[0].messages[0].search?.provider).toBe("deepseek");
    expect(before).toEqual(original);
    expect(resources.write).not.toHaveBeenCalled();
  });

  it("preserves local DeepSeek profile and credentials when replacing with an older v3 four-profile backup", async () => {
    const before = snapshot(), source = snapshot();
    source.rows.assistants[0].defaultConfig = { ...defaultSessionConfig(), webSearch: true, webSearchProvider: "tavily" };
    source.rows.conversations[0].settings!.config = { ...defaultSessionConfig(), webSearch: true, webSearchProvider: "zhipu" };
    source.rows.conversations[0].creationConfig!.config = defaultSessionConfig();
    source.rows.legacyConversationConfigs[0].generationConfig = defaultSessionConfig();
    source.rows.chats[0].messages[0].search!.provider = "tavily";
    const doc = await createBackupDocument(source, { connections: false, credentials: false }, files()) as any;
    doc.compatibility.modules.search = { version: 3, minimumReaderVersion: 3, requiredCapabilities: [] };
    const { deepseek: _ignored, ...v3Profiles } = doc.searchSettings;
    doc.searchSettings = { ...v3Profiles, version: 3 };
    const decoded = (await decodeBackup(await encodeBackup(doc))).document;
    const plan = createRestorePlan(decoded, before, "replace");
    const result = JSON.parse(plan.after.preferences[SEARCH_SETTINGS_KEY]!);
    expect(result.deepseek).toEqual(configuration().deepseek);
    expect(plan.warnings.some(warning => warning.includes("DeepSeek"))).toBe(true);
  });

  it.each(["profiles", "v3-with-deepseek-key", "assistant", "conversation", "creation", "legacy", "history", "round-history"])(
    "rejects DeepSeek %s under an original search-module v3 stamp before restamping", async variant => {
      const doc = await createBackupDocument(snapshot(), { connections: false, credentials: false }, files());
      const raw = structuredClone(doc) as any;
      raw.compatibility.modules.search.version = 3;
      raw.compatibility.modules.search.minimumReaderVersion = 3;
      const v3Search = { version: 3, exaMcp: raw.searchSettings.exaMcp, exaApi: raw.searchSettings.exaApi,
        tavily: raw.searchSettings.tavily, zhipu: raw.searchSettings.zhipu };
      if (variant === "v3-with-deepseek-key") {
        raw.searchSettings = { ...v3Search, deepseek: raw.searchSettings.deepseek };
      } else if (variant !== "profiles") {
        raw.searchSettings = v3Search;
        raw.rows.assistants[0].defaultConfig = defaultSessionConfig();
        raw.rows.conversations[0].settings.config = defaultSessionConfig();
        raw.rows.conversations[0].creationConfig.config = defaultSessionConfig();
        raw.rows.legacyConversationConfigs[0].generationConfig = defaultSessionConfig();
        const search = raw.rows.chats[0].messages[0].search;
        delete raw.rows.chats[0].messages[0].search;
        if (variant === "assistant") raw.rows.assistants[0].defaultConfig.webSearchProvider = "deepseek";
        if (variant === "conversation") raw.rows.conversations[0].settings.config.webSearchProvider = "deepseek";
        if (variant === "creation") raw.rows.conversations[0].creationConfig.config.webSearchProvider = "deepseek";
        if (variant === "legacy") raw.rows.legacyConversationConfigs[0].generationConfig.webSearchProvider = "deepseek";
        if (variant === "history") raw.rows.chats[0].messages[0].search = search;
        if (variant === "round-history") raw.rows.chats[0].messages[0].roundVersions = { selected: 0, pairs: [[
          { id: "user", role: "user", content: "public", status: "complete" }, { ...raw.rows.chats[0].messages[0], replyToId: "user", search }
        ]] };
      }
      if (variant !== "v3-with-deepseek-key") {
        const supported = structuredClone(raw);
        supported.compatibility.modules.search = structuredClone(doc.compatibility!.modules.search);
        await expect(readBackupDocument(supported)).resolves.toBeDefined();
      }
      const original = structuredClone(raw), current = snapshot(), originalCurrent = structuredClone(current);
      await expect(readBackupDocument(raw)).rejects.toThrow("搜索模块");
      await expect(readBackupDocument(raw).then(decoded => createRestorePlan(decoded, current, "replace"))).rejects.toThrow("搜索模块");
      expect(raw).toEqual(original); expect(current).toEqual(originalCurrent);
    });

  it.each([1, 2, 3])("refuses DeepSeek selections in historical document v%s", async version => {
    const raw = await createBackupDocument(snapshot(), { connections: false, credentials: false }, files()) as any;
    raw.version = version;
    const appearance = JSON.parse(raw.preferences["ayase-studio.appearance.v1"]);
    delete appearance.sidebarGlassEnabled; delete appearance.composerGlassEnabled;
    delete appearance.chromeTransparency; delete appearance.assistantBubbleMode;
    raw.preferences["ayase-studio.appearance.v1"] = JSON.stringify(appearance);
    delete raw.compatibility; delete raw.drawing; delete raw.searchSettings;
    await expect(readBackupDocument(raw)).rejects.toThrow("搜索模块");
  });

  it.each(["future", "unknown-deepseek-credential", "invalid-deepseek-toggle"])("rejects %s before resource writes and preserves raw preferences", async variant => {
    const before = snapshot(), raw = JSON.parse(before.preferences[SEARCH_SETTINGS_KEY]!);
    if (variant === "future") raw.version = 5;
    if (variant === "unknown-deepseek-credential") raw.deepseek.authorization = "synthetic-unknown-key";
    if (variant === "invalid-deepseek-toggle") raw.deepseek.enabled = "yes";
    before.preferences[SEARCH_SETTINGS_KEY] = JSON.stringify(raw);
    const original = structuredClone(before), resources = files();
    await expect(createBackupDocument(before, { connections: true, credentials: true }, resources)).rejects.toThrow();
    expect(before).toEqual(original); expect(resources.read).not.toHaveBeenCalled(); expect(resources.write).not.toHaveBeenCalled();
  });

  it("repairs corrupt local search data only with complete v4 credentials replacement and rolls back cleanly on failure", async () => {
    const db = new AyaseDatabase(`search140-${crypto.randomUUID()}`);
    const values = new Map<string, string>();
    const store = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    const corrupt = "corrupt-local-search-json";
    store.setItem(SEARCH_SETTINGS_KEY, corrupt);
    const repository = new BackupRepository(db, store);
    try {
      const before = await repository.snapshot();
      const doc = await createBackupDocument(snapshot(), { connections: true, credentials: true }, files());
      const decoded = (await decodeBackup(await encodeBackup(doc))).document;
      const plan = createRestorePlan(decoded, before, "replace");
      vi.spyOn(db.backupJournal, "delete").mockRejectedValueOnce(new Error("injected commit failure"));
      await expect(repository.restore(plan, before, files())).rejects.toThrow("已回滚");
      expect(store.getItem(SEARCH_SETTINGS_KEY)).toBe(corrupt);
      await repository.restore(plan, before, files());
      expect(JSON.parse(store.getItem(SEARCH_SETTINGS_KEY)!)).toEqual(configuration());
      expect(await db.backupJournal.count()).toBe(0);

      // Incomplete v3 replacement must refuse to silently overwrite corrupt local search data.
      store.setItem(SEARCH_SETTINGS_KEY, corrupt);
      const corruptBefore = await repository.snapshot();
      const v3Doc = structuredClone(doc) as any;
      v3Doc.compatibility.modules.search = { version: 3, minimumReaderVersion: 3, requiredCapabilities: [] };
      const { deepseek: _ignored, ...v3Search } = v3Doc.searchSettings;
      v3Doc.searchSettings = { ...v3Search, version: 3 };
      v3Doc.rows.assistants[0].defaultConfig = defaultSessionConfig();
      v3Doc.rows.conversations[0].settings.config = defaultSessionConfig();
      v3Doc.rows.conversations[0].creationConfig.config = defaultSessionConfig();
      v3Doc.rows.legacyConversationConfigs[0].generationConfig = defaultSessionConfig();
      delete v3Doc.rows.chats[0].messages[0].search;
      const decodedV3 = (await decodeBackup(await encodeBackup(v3Doc))).document;
      expect(() => createRestorePlan(decodedV3, corruptBefore, "replace")).toThrow("损坏");
      expect(store.getItem(SEARCH_SETTINGS_KEY)).toBe(corrupt);
    } finally {
      db.close();
      await db.delete();
    }
  });
});
