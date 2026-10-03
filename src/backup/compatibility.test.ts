import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSessionConfig, readSessionConfigData } from "../chat/sessionConfig";
import { AyaseDatabase } from "../storage/database";
import { currentModuleVersions, DATA_COMPATIBILITY_KEY } from "../storage/dataRegistry";
import { dataPolicies } from "../storage/dataPolicies";
import { backupFields } from "../storage/dataContract";
import { decodeBackup, encodeBackup, readBackupDocument, sha256 } from "./codec";
import { compatibilityWarnings } from "./compatibility";
import { createBackupDocument, type LocalSnapshot } from "./snapshot";
import { createRestorePlan } from "./restorePlan";
import { BackupRepository } from "./repository";
import { preferenceKeys, type BackupDocument, type BackupFiles } from "./types";
import { defaultAppearancePreferences, readAppearancePreferences } from "../appearance/appearance";

const databases: AyaseDatabase[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const db of databases.splice(0)) await db.delete(); });
function document(version: 1 | 2 | 3 | 4 = 4): BackupDocument {
  return { format: "ayase-studio-backup", version, createdAt: "2026-10-01T00:00:00Z", options: { connections: false, credentials: false },
    rows: { assistants: [{ id: "a", name: "Synthetic", icon: "", sortOrder: 0, defaultModelId: null, defaultConfig: defaultSessionConfig() }],
      conversations: [{ id: "c", assistantId: "a", title: "Saved", createdAt: 1, updatedAt: 1, settings: { modelId: null, config: defaultSessionConfig() } }],
      chats: [{ id: "c", updatedAt: 1, messages: [{ id: "m", role: "user", content: "Keep this text", status: "complete" }] }],
      workspace: [], avatarLibrary: [], userAvatar: [], cherryImports: [], legacyConversationConfigs: [] },
    preferences: Object.fromEntries(preferenceKeys.map(key => [key, null])) as BackupDocument["preferences"], connections: null, assets: [],
    ...(version === 4 ? { compatibility: { minimumReaderVersion: 4 as const, requiredCapabilities: [], modules: currentModuleVersions() } } : {}) };
}
function future() {
  const doc = document();
  doc.compatibility!.modules.session = { version: 2, minimumReaderVersion: 1, requiredCapabilities: [] };
  const config = (doc.rows.assistants[0] as { defaultConfig: Record<string, unknown> }).defaultConfig;
  config.version = 2;
  config.futureParameter = { text: "never show discarded values" };
  (config.temperature as Record<string, unknown>).futurePrecision = 10;
  return doc;
}
async function envelope(value: unknown) {
  const text = JSON.stringify(value);
  return JSON.stringify({ format: "ayase-studio-envelope", version: 1, encrypted: false,
    payload: JSON.stringify({ document: text, sha256: await sha256(new TextEncoder().encode(text)) }) });
}
const files: BackupFiles = { read: vi.fn(), assertAvailable: vi.fn(async () => {}), write: vi.fn(async () => {}), remove: vi.fn(async () => {}) };

describe("versioned backup data contracts", () => {
  it.each([1, 2, 3, 4] as const)("reads historical v%s appearance omissions repeatedly with sidebar off and composer on", async version => {
    const old = document(version);
    const { chromeTransparency: _chrome, sidebarGlassEnabled: _sidebar, composerGlassEnabled: _composer, ...appearance } = defaultAppearancePreferences;
    old.preferences[preferenceKeys[0]] = JSON.stringify({ ...appearance, sidebarTransparency: 37, composerTransparency: 62 });
    if (old.compatibility) old.compatibility.modules.appearance = { version: 1, minimumReaderVersion: 1, requiredCapabilities: [] };
    const before = structuredClone(old);
    const first = await readBackupDocument(old);
    expect(await readBackupDocument(first)).toEqual(first);
    expect(readAppearancePreferences({ getItem: () => first.preferences[preferenceKeys[0]] })).toMatchObject({
      chromeTransparency: 40, sidebarGlassEnabled: false, composerGlassEnabled: true, sidebarTransparency: 37, composerTransparency: 62,
    });
    expect(old).toEqual(before);
  });
  it.each([1, 2, 3, 4] as const)("rejects new glass fields falsely declared as legacy v%s", async version => {
    const old = document(version);
    old.preferences[preferenceKeys[0]] = JSON.stringify({ ...defaultAppearancePreferences, sidebarGlassEnabled: true });
    if (old.compatibility) old.compatibility.modules.appearance = { version: 1, minimumReaderVersion: 1, requiredCapabilities: [] };
    const before = structuredClone(old);
    await expect(readBackupDocument(old)).rejects.toThrow("外观模块版本");
    expect(old).toEqual(before);
  });
  it.each([[53, 37, 19], [85, 0, 6], [75, 20, 6]])("projects appearance v3 and roundtrips explicit %s/%s/%s transparencies unchanged", async (chromeTransparency, sidebarTransparency, assistantBubbleTransparency) => {
    const doc = document();
    doc.preferences[preferenceKeys[0]] = JSON.stringify({ ...defaultAppearancePreferences,
      chromeTransparency, sidebarGlassEnabled: true, composerGlassEnabled: false, sidebarTransparency, composerTransparency: 62, assistantBubbleTransparency });
    const snapshot: LocalSnapshot = { rows: doc.rows as LocalSnapshot["rows"], preferences: doc.preferences };
    const exported = await createBackupDocument(snapshot, { connections: false, credentials: false }, files);
    expect(exported.version).toBe(5);
    expect(exported.compatibility!.modules.appearance).toEqual({ version: 3, minimumReaderVersion: 3, requiredCapabilities: [] });
    const preview = await decodeBackup(await encodeBackup(exported));
    expect(preview.document.preferences[preferenceKeys[0]]).toBe(exported.preferences[preferenceKeys[0]]);
    expect(JSON.parse(preview.document.preferences[preferenceKeys[0]]!)).toMatchObject({
      chromeTransparency, sidebarGlassEnabled: true, composerGlassEnabled: false, sidebarTransparency, composerTransparency: 62, assistantBubbleTransparency,
    });
    expect(await readBackupDocument(preview.document)).toEqual(preview.document);
  });
  it.each([0, 10, 65])("roundtrips mask %s through backup export and decode", async backgroundMask => {
    const doc = document();
    doc.preferences[preferenceKeys[0]] = JSON.stringify({ ...defaultAppearancePreferences, backgroundMask });
    const snapshot: LocalSnapshot = { rows: doc.rows as LocalSnapshot["rows"], preferences: doc.preferences };
    const exported = await createBackupDocument(snapshot, { connections: false, credentials: false }, files);
    const preview = await decodeBackup(await encodeBackup(exported));
    expect(JSON.parse(preview.document.preferences[preferenceKeys[0]]!).backgroundMask).toBe(backgroundMask);
    expect(await readBackupDocument(preview.document)).toEqual(preview.document);
  });

  it("reads appearance v2 without chrome through the same defaults and reexports as v3", async () => {
    const old = document();
    const { chromeTransparency: _chrome, ...appearance } = defaultAppearancePreferences;
    old.preferences[preferenceKeys[0]] = JSON.stringify({ ...appearance, sidebarGlassEnabled: true });
    old.compatibility!.modules.appearance = { version: 2, minimumReaderVersion: 2, requiredCapabilities: [] };
    const before = structuredClone(old);
    const first = await readBackupDocument(old);
    expect(await readBackupDocument(first)).toEqual(first);
    expect(readAppearancePreferences({ getItem: () => first.preferences[preferenceKeys[0]] })).toMatchObject({ chromeTransparency: 40, sidebarGlassEnabled: true });
    const exported = await createBackupDocument({ rows: first.rows as LocalSnapshot["rows"], preferences: first.preferences }, { connections: false, credentials: false }, files);
    expect(exported.compatibility!.modules.appearance).toEqual({ version: 3, minimumReaderVersion: 3, requiredCapabilities: [] });
    expect(JSON.parse(exported.preferences[preferenceKeys[0]]!).chromeTransparency).toBe(40);
    expect(old).toEqual(before);
  });
  it.each([1, 2])("refuses chrome transparency stamped as appearance v%s", async moduleVersion => {
    const old = document();
    old.preferences[preferenceKeys[0]] = JSON.stringify(defaultAppearancePreferences);
    old.compatibility!.modules.appearance = { version: moduleVersion, minimumReaderVersion: moduleVersion, requiredCapabilities: [] };
    const before = structuredClone(old);
    await expect(readBackupDocument(old)).rejects.toThrow("外观模块版本");
    expect(old).toEqual(before);
  });
  it.each([1, 2, 3] as const)("reads old v%s exactly and keeps its strict unknown-field boundary", async version => {
    const old = document(version);
    expect((await decodeBackup(await envelope(old))).document).toEqual(old);
    ((old.rows.assistants[0] as { defaultConfig: Record<string, unknown> }).defaultConfig).futureParameter = 1;
    await expect(decodeBackup(await envelope(old))).rejects.toThrow();
  });
  it("filters declared future optional parameters without touching the input, shows paths only and preserves loss on reexport", async () => {
    const raw = future(), original = structuredClone(raw), serialized = await envelope(raw);
    const preview = await decodeBackup(serialized);
    const config = (preview.document.rows.assistants[0] as { defaultConfig: Record<string, unknown> }).defaultConfig;
    expect(config.version).toBe(1);
    expect(config).not.toHaveProperty("futureParameter");
    expect(config.temperature).not.toHaveProperty("futurePrecision");
    expect(preview.document.compatibility!.modules.session.version).toBe(1);
    const warnings = compatibilityWarnings(preview.document.compatibility);
    expect(warnings.join(" ")).toContain("再次保存或导出可能丢失");
    expect(warnings.join(" ")).toContain("defaultConfig.futureParameter");
    expect(warnings.join(" ")).not.toContain("never show discarded values");
    const resaved = await decodeBackup(await encodeBackup(preview.document));
    expect(resaved.document.compatibility!.filteredParameters).toEqual(preview.document.compatibility!.filteredParameters);
    expect(raw).toEqual(original);
    expect(serialized).toBe(await envelope(raw));
  });
  it("uses the same session conversion on local reads and backup normalization", async () => {
    const doc = document();
    const saved = defaultSessionConfig(); saved.temperature = { mode: "custom", value: "editable invalid number" };
    delete saved.webSearchProvider;
    (doc.rows.assistants[0] as { defaultConfig: unknown }).defaultConfig = saved;
    expect((await readBackupDocument(doc)).rows.assistants[0]).toMatchObject({ defaultConfig: readSessionConfigData(saved) });
  });
  it.each([
    (doc: BackupDocument) => { doc.compatibility!.modules.session.minimumReaderVersion = 2; },
    (doc: BackupDocument) => { doc.compatibility!.modules.session.requiredCapabilities = ["mandatory-new-semantics"]; },
    (doc: BackupDocument) => { doc.compatibility!.requiredCapabilities = ["new-top-level-structure"]; },
    (doc: BackupDocument) => { doc.compatibility!.modules.unknownModule = { version: 1, minimumReaderVersion: 1, requiredCapabilities: [] }; },
    (doc: BackupDocument) => { (doc as unknown as Record<string, unknown>).unknownTopLevel = {}; },
    (doc: BackupDocument) => { doc.version = 5 as BackupDocument["version"]; },
    (doc: BackupDocument) => { delete (doc.rows.assistants[0] as { defaultConfig?: unknown }).defaultConfig; },
    (doc: BackupDocument) => { ((doc.rows.assistants[0] as { defaultConfig: Record<string, unknown> }).defaultConfig).customJson = { "future-protocol": "{}" }; },
  ])("rejects incompatible versions/capabilities/structures instead of guessing", async mutate => {
    const doc = future(); mutate(doc); const before = structuredClone(doc);
    await expect(decodeBackup(await envelope(doc))).rejects.toThrow();
    expect(doc).toEqual(before);
  });
  it.each(["apiKey", "sourcePath", "imageReference", "protocol", "requiredCapabilities", "resourceId", "connectionId", "providerId", "endpoint", "auth", "attachment"])("does not filter unsafe %s as an optional parameter", async key => {
    const doc = future(); ((doc.rows.assistants[0] as { defaultConfig: Record<string, unknown> }).defaultConfig)[key] = "synthetic";
    await expect(decodeBackup(await envelope(doc))).rejects.toThrow();
  });
  it("keeps connection and resource security checks strict even when future session parameters are allowed", async () => {
    const doc = future(); doc.options = { connections: true, credentials: true };
    doc.connections = { version: 3, activeModelId: null, providers: [{ id: "p", name: "P", connections: [
      { id: "connection", name: "C", protocol: "future-protocol", baseUrl: "https://synthetic.invalid", apiKey: "synthetic", models: [] },
    ] }] };
    await expect(decodeBackup(await envelope(doc))).rejects.toThrow();
    doc.options = { connections: false, credentials: false }; doc.connections = null;
    (doc.rows.chats[0] as { messages: Record<string, unknown>[] }).messages[0].attachments = [
      { reference: "C:\\synthetic-only\\private.png", name: "image.png", size: 1, mimeType: "image/png" },
    ];
    await expect(decodeBackup(await envelope(doc))).rejects.toThrow();
  });
  it("checks discarded data budgets before filtering", async () => {
    const doc = future(); ((doc.rows.assistants[0] as { defaultConfig: Record<string, unknown> }).defaultConfig).futureParameter = "x".repeat(8 * 1024 * 1024);
    await expect(readBackupDocument(doc)).rejects.toThrow();
  });
  it("explicitly excludes private drawing prompt and references from the future settings projection", () => {
    expect(backupFields(dataPolicies.drawingDraft)).not.toContain("prompt");
    expect(backupFields(dataPolicies.drawingDraft)).not.toContain("references");
    expect(backupFields(dataPolicies.drawingDraft)).toEqual(expect.arrayContaining(["count", "concurrency", "completionSound"]));
    expect(backupFields(dataPolicies.drawingTasks)).toEqual([]);
    expect(backupFields(dataPolicies.drawingResults)).toEqual([]);
  });
});

describe("compatibility loss reports follow restore transactions", () => {
  async function setup() {
    const db = new AyaseDatabase(`contract-backup-${crypto.randomUUID()}`); databases.push(db);
    const local = document();
    for (const [table, rows] of Object.entries(local.rows)) if (rows.length) await db.table(table).bulkPut(rows);
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null,
      setItem: vi.fn((key: string, value: string) => { values.set(key, value); }), removeItem: (key: string) => { values.delete(key); } };
    const repository = new BackupRepository(db, storage), before = await repository.snapshot();
    const incoming = (await decodeBackup(await envelope(future()))).document;
    return { db, values, storage, repository, before, incoming };
  }
  it.each(["merge", "copy", "replace"] as const)("%s retains loss warnings for subsequent actual exports without provider calls", async mode => {
    const t = await setup(), plan = createRestorePlan(t.incoming, t.before, mode);
    await t.repository.restore(plan, t.before, files);
    expect(JSON.parse(t.values.get(DATA_COMPATIBILITY_KEY)!)).toContain("rows.assistants[0].defaultConfig.futureParameter");
    const exported = await createBackupDocument(await t.repository.snapshot(), { connections: false, credentials: false }, files);
    expect(compatibilityWarnings((await decodeBackup(await encodeBackup(exported))).document.compatibility).join(" ")).toContain("可能丢失");
    expect(await t.db.backupJournal.count()).toBe(0);
  });
  it("a preference-stage failure restores records and loss reports together, then permits retry", async () => {
    const t = await setup(), plan = createRestorePlan(t.incoming, t.before, "replace");
    const set = t.storage.setItem.getMockImplementation()!; let fail = true;
    t.storage.setItem.mockImplementation((key, value) => { if (key === DATA_COMPATIBILITY_KEY && fail) { fail = false; throw new Error("synthetic failure"); } set(key, value); });
    await expect(t.repository.restore(plan, t.before, files)).rejects.toThrow("已回滚");
    expect(await t.repository.snapshot()).toEqual(t.before);
    expect(t.values.has(DATA_COMPATIBILITY_KEY)).toBe(false);
    await t.repository.restore(plan, t.before, files);
    expect(t.values.has(DATA_COMPATIBILITY_KEY)).toBe(true);
  });
  it.each(["staging", "applying"] as const)("restart repairs a %s journal and restores the previous report", async phase => {
    const t = await setup();
    t.values.set(DATA_COMPATIBILITY_KEY, JSON.stringify(["rows.assistants[0].defaultConfig.previousParameter"]));
    const before = await t.repository.snapshot();
    await t.db.backupJournal.put({ id: "restore", before, references: [], phase });
    await t.db.assistants.update("a", { name: "Interrupted write" });
    t.values.set(DATA_COMPATIBILITY_KEY, JSON.stringify(["rows.assistants[0].defaultConfig.futureParameter"]));
    const name = t.db.name;
    t.db.close();
    const reopened = new AyaseDatabase(name); databases.push(reopened);
    const reboot = new BackupRepository(reopened, t.storage);
    expect(await reboot.recover(files)).toBe(true);
    expect(await reboot.snapshot()).toEqual(before);
    expect(await reboot.recover(files)).toBe(false);
  });
  it("old journals do not erase private report keys they never captured", async () => {
    const t = await setup();
    t.values.set(DATA_COMPATIBILITY_KEY, JSON.stringify(["rows.assistants[0].defaultConfig.previousParameter"]));
    const old: LocalSnapshot = structuredClone(t.before); delete old.preferences[DATA_COMPATIBILITY_KEY];
    await t.db.backupJournal.put({ id: "restore", before: old, references: [], phase: "applying" });
    await t.repository.recover(files);
    expect(t.values.has(DATA_COMPATIBILITY_KEY)).toBe(true);
  });
  it.each([false, true])("explicit full replacement repairs parseable unsupported connections, rollback=%s", async failure => {
    const t = await setup(), original = JSON.stringify({ version: 9, providers: [], activeModelId: null });
    t.values.set("ayase-studio.connection-settings.v3", original);
    const before = await t.repository.snapshot();
    t.incoming.options = { connections: true, credentials: true };
    t.incoming.connections = { version: 3, activeModelId: null, providers: [] };
    await readBackupDocument(t.incoming);
    expect(() => createRestorePlan(t.incoming, before, "merge")).toThrow();
    expect(() => createRestorePlan(t.incoming, before, "copy")).toThrow();
    const plan = createRestorePlan(t.incoming, before, "replace");
    expect(plan.warnings.join(" ")).toContain("原配置由恢复日志保护");
    if (failure) {
      const set = t.storage.setItem.getMockImplementation()!; let fail = true;
      t.storage.setItem.mockImplementation((key, value) => { if (key === DATA_COMPATIBILITY_KEY && fail) { fail = false; throw new Error("synthetic failure"); } set(key, value); });
      await expect(t.repository.restore(plan, before, files)).rejects.toThrow("已回滚");
      expect(t.values.get("ayase-studio.connection-settings.v3")).toBe(original);
      expect(await t.repository.snapshot()).toEqual(before);
    } else {
      await t.repository.restore(plan, before, files);
      expect(JSON.parse(t.values.get("ayase-studio.connection-settings.v3")!)).toEqual({ version: 3, activeModelId: null, providers: [] });
    }
  });
});
