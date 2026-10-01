import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AyaseDatabase } from "../storage/database";
import { currentModuleVersions, DATA_COMPATIBILITY_KEY } from "../storage/dataRegistry";
import { initialDrawingDraft, type DrawingTask, type DrawingResult, type DrawingFiles } from "../drawing/types";
import { DrawingController } from "../drawing/controller";
import { DexieDrawingRepository } from "../drawing/repository";
import { DexieDrawingPresetRepository } from "../drawing/presets";
import { projectDrawingSettings } from "../drawing/settingsData";
import { connectionSettingsStorageKey, type ConnectionSettingsState } from "../chat/settings";
import { readBackupDocument, encodeBackup, decodeBackup } from "./codec";
import { compatibilityWarnings, validateFilteredParameters } from "./compatibility";
import { createBackupApi } from "./runtime";
import { BackupRepository } from "./repository";
import { createRestorePlan } from "./restorePlan";
import { createBackupDocument } from "./snapshot";
import { preferenceKeys, type BackupDocument, type BackupFiles, type RestoreMode } from "./types";

const databases: AyaseDatabase[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const db of databases.splice(0)) await db.delete(); });
const timestamp = "2026-10-01T00:00:00.000Z";
const preset = (id: string, content = "saved text") => ({ id, name: "same display name", content, createdAt: timestamp, updatedAt: timestamp });
const referenceId = "12345678-1234-4123-8123-123456789abc";
const taskId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const imageId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const reference = { id: referenceId, reference: `drawing/references/${referenceId}.png`, mime: "image/png", size: 1, width: 1, height: 1, name: "local.png" };
const localDraft = { ...initialDrawingDraft, prompt: "  local unsaved prompt\n", references: [reference], count: 3,
  concurrency: 2, completionSound: false, openai: { size: "1024x1024", quality: "low" } };
const importedSettings = { ...projectDrawingSettings(), aspectRatio: "16:9", resolution: "2K", count: 7, concurrency: 4,
  openai: { size: "3072x1024", quality: "max" }, reusedProtocol: "openai-images" as const };

function document(version: BackupDocument["version"] = 5, drawing: BackupDocument["drawing"] = { settings: importedSettings,
  presets: [preset("conflict", "incoming conflict"), preset("new", "incoming new")] }): BackupDocument {
  return { format: "ayase-studio-backup", version, createdAt: timestamp, options: { connections: false, credentials: false },
    rows: { assistants: [], conversations: [], chats: [], workspace: [], avatarLibrary: [], userAvatar: [], cherryImports: [], legacyConversationConfigs: [] },
    preferences: Object.fromEntries(preferenceKeys.map(key => [key, null])) as BackupDocument["preferences"], connections: null, assets: [],
    ...(version >= 4 ? { compatibility: { minimumReaderVersion: version as 4 | 5, requiredCapabilities: [], modules: currentModuleVersions(version === 5 ? drawing : undefined) } } : {}),
    ...(version === 5 && drawing ? { drawing: structuredClone(drawing) } : {}) };
}

async function setup() {
  const db = new AyaseDatabase(`drawing-backup-integration-${crypto.randomUUID()}`); databases.push(db);
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }), removeItem: vi.fn((key: string) => { values.delete(key); }) };
  const saved = new Map([[reference.reference, "local reference bytes"], [`drawing/${taskId}/${imageId}.png`, "local result bytes"]]);
  const files: BackupFiles = { read: vi.fn(async (r: string) => saved.get(r)!), assertAvailable: vi.fn(async () => {}),
    write: vi.fn(async (r: string, data: string) => { saved.set(r, data); }), remove: vi.fn(async (refs: string[]) => { for (const r of refs) saved.delete(r); }) };
  const task: DrawingTask = { id: taskId, createdAt: timestamp, updatedAt: timestamp, status: "completed",
    parameters: { protocol: "gemini-image", prompt: "frozen history prompt", aspectRatio: "1:1", resolution: "1K", providerId: "p",
      connectionId: "c", configuredModelId: "m", modelId: "synthetic-image", modelName: "synthetic-image", baseUrl: "https://synthetic.invalid" } };
  const result: DrawingResult = { id: imageId, taskId, createdAt: timestamp, parameters: task.parameters,
    reference: `drawing/${taskId}/${imageId}.png`, mime: "image/png", size: 1, width: 1, height: 1 };
  await db.drawingDrafts.put(localDraft); await db.drawingTasks.put(task); await db.drawingResults.put(result);
  await db.drawingPromptPresets.bulkPut([preset("conflict", "local conflict"), preset("local", "local only")]);
  const repository = new BackupRepository(db, storage);
  const before = await repository.snapshot();
  return { db, values, storage, files, saved, repository, before, task, result };
}

async function apply(t: Awaited<ReturnType<typeof setup>>, raw: unknown, mode: RestoreMode = "replace") {
  const decoded = await readBackupDocument(raw), plan = createRestorePlan(decoded, t.before, mode);
  await t.repository.restore(plan, t.before, t.files);
  return plan;
}

async function assertPrivateData(t: Awaited<ReturnType<typeof setup>>) {
  expect((await t.db.drawingDrafts.get("current"))?.prompt).toBe(localDraft.prompt);
  expect((await t.db.drawingDrafts.get("current"))?.references).toEqual([reference]);
  expect(await t.db.drawingTasks.toArray()).toEqual([t.task]);
  expect(await t.db.drawingResults.toArray()).toEqual([t.result]);
  expect(t.saved.get(reference.reference)).toBe("local reference bytes");
  expect(t.saved.get(t.result.reference)).toBe("local result bytes");
  expect(t.files.read).not.toHaveBeenCalled();
  expect(await t.db.backupJournal.count()).toBe(0);
}

function drawingConnections(protocol: "gemini-image" | "openai-images" = "gemini-image"): ConnectionSettingsState {
  return { version: 3, activeModelId: null, providers: [{ id: "p", name: "Synthetic", connections: [
    { id: "c", name: "Drawing", protocol, baseUrl: "https://synthetic.invalid", apiKey: "synthetic-key", models: [{ id: "m", modelId: "synthetic-image", displayName: "Pretty image label" }] },
    { id: "chat-connection", name: "Chat", protocol: "openai-chat", baseUrl: "https://synthetic.invalid", apiKey: "synthetic-chat-key", models: [{ id: "chat-model", modelId: "synthetic-chat" }] },
  ] }] };
}

describe("drawing backup category integration", () => {
  it.each(["replace", "merge", "copy"] as const)("round-trips v2 Gemini controls under %s while retaining excluded local data", async mode => {
    const t = await setup(), gemini = { temperature: 0, safetyThreshold: "BLOCK_NONE" as const, outputMode: "image" as const };
    const raw = document(5, { settings: { ...importedSettings, gemini }, presets: [] });
    expect(raw.compatibility!.modules.drawingSettings).toEqual({ version: 2, minimumReaderVersion: 2, requiredCapabilities: [] });
    const decoded = (await decodeBackup(await encodeBackup(raw))).document;
    expect(decoded.drawing!.settings!.gemini).toEqual(gemini);
    await apply(t, decoded, mode);
    expect((await t.db.drawingDrafts.get("current"))?.gemini).toEqual(mode === "replace" ? gemini : undefined);
    await assertPrivateData(t);
  });
  it("reads old module v1 defaults and clears newer local controls only when settings are replaced", async () => {
    const t = await setup(), old = document();
    old.compatibility!.modules.drawingSettings = { version: 1, minimumReaderVersion: 1, requiredCapabilities: [] };
    const draft = { ...localDraft, gemini: { temperature: 2, safetyThreshold: "OFF" as const, outputMode: "image" as const } };
    await t.db.drawingDrafts.put(draft); t.before = await t.repository.snapshot();
    await apply(t, old);
    expect((await t.db.drawingDrafts.get("current"))?.gemini).toBeUndefined();
    await assertPrivateData(t);
  });
  it.each(["moduleMismatch", "unsafeFuture", "futureOutput", "openaiSafety", "invalidTemperature", "invalidSafety"])("rejects new Gemini %s before any durable writes", async fault => {
    const t = await setup(), raw = document();
    raw.drawing!.settings!.gemini = { temperature: 0, outputMode: "image" };
    if (fault === "moduleMismatch") raw.compatibility!.modules.drawingSettings = { version: 1, minimumReaderVersion: 1, requiredCapabilities: [] };
    if (fault === "unsafeFuture" || fault === "futureOutput") {
      raw.compatibility!.modules.drawingSettings.version = 3;
      (raw.drawing!.settings!.gemini as Record<string, unknown>)[fault === "unsafeFuture" ? "futureSafety" : "outputModeV2"] = "unknown";
    }
    if (fault === "openaiSafety") {
      raw.compatibility!.modules.drawingSettings.version = 3;
      (raw.drawing!.settings!.openai as Record<string, unknown>).safetyPolicy = "unknown";
    }
    if (fault === "invalidTemperature") raw.drawing!.settings!.gemini.temperature = 2.1;
    if (fault === "invalidSafety") (raw.drawing!.settings!.gemini as Record<string, unknown>).safetyThreshold = "UNKNOWN";
    const original = structuredClone(raw);
    await expect(apply(t, raw)).rejects.toThrow();
    expect(raw).toEqual(original); expect(await t.repository.snapshot()).toEqual(t.before);
    expect(t.files.write).not.toHaveBeenCalled(); expect(t.storage.setItem).not.toHaveBeenCalled();
    expect(await t.db.backupJournal.count()).toBe(0);
  });
  it.each([1, 2, 3, 4] as const)("historical v%s absence preserves local drawing data during replacement", async version => {
    const t = await setup(), plan = await apply(t, document(version));
    expect((await t.repository.snapshot()).drawing).toEqual(t.before.drawing);
    expect(plan.warnings.join(" ")).toContain("不含绘图设置");
    await assertPrivateData(t);
    expect(t.files.write).not.toHaveBeenCalled(); expect(t.files.remove).not.toHaveBeenCalled();
  });

  it.each(["replace", "merge", "copy"] as const)("v5 %s applies preset conflict rules and preserves private drawing history", async mode => {
    const t = await setup(), plan = await apply(t, document(), mode);
    const presets = await t.db.drawingPromptPresets.toArray();
    if (mode === "replace") {
      expect(presets).toEqual([preset("conflict", "incoming conflict"), preset("new", "incoming new")]);
      expect(await t.db.drawingDrafts.get("current")).toEqual({ ...localDraft, ...importedSettings });
    } else if (mode === "merge") {
      expect(presets).toEqual([preset("conflict", "local conflict"), preset("local", "local only"), preset("new", "incoming new")]);
      expect(await t.db.drawingDrafts.get("current")).toEqual(localDraft);
    } else {
      expect(presets).toHaveLength(4);
      expect(presets.filter(p => ["conflict", "local"].includes(p.id))).toEqual([preset("conflict", "local conflict"), preset("local", "local only")]);
      const clones = presets.filter(p => !["conflict", "local"].includes(p.id));
      expect(clones.map(p => p.content).sort()).toEqual(["incoming conflict", "incoming new"]);
      expect(clones.every(p => /^[0-9a-f-]{36}$/.test(p.id) && p.id !== "new")).toBe(true);
      expect(new Set(presets.map(p => p.id)).size).toBe(4);
      expect(await t.db.drawingDrafts.get("current")).toEqual(localDraft);
    }
    expect(plan.conflicts).toBe(mode === "copy" ? 0 : 1);
    await assertPrivateData(t);
  });

  it.each(["settings", "presets", "emptyPresets", "emptySettings", "absent"] as const)("v5 %s distinguishes missing categories from explicit empty data", async category => {
    const t = await setup();
    const drawing = category === "settings" ? { settings: importedSettings }
      : category === "presets" ? { presets: [preset("new")] }
      : category === "emptyPresets" ? { presets: [] }
      : category === "emptySettings" ? { settings: {} as ReturnType<typeof projectDrawingSettings> } : undefined;
    const doc = document(5, drawing);
    // Passing undefined invokes the fixture default; remove the category explicitly.
    if (category === "absent") { delete doc.drawing; doc.compatibility!.modules = currentModuleVersions(); }
    await apply(t, doc);
    expect(await t.db.drawingPromptPresets.toArray()).toEqual(category === "presets" ? [preset("new")]
      : category === "emptyPresets" ? [] : t.before.drawing!.presets);
    expect(await t.db.drawingDrafts.get("current")).toEqual(category === "settings" ? { ...localDraft, ...importedSettings }
      : category === "emptySettings" ? { ...localDraft, ...projectDrawingSettings() } : localDraft);
    await assertPrivateData(t);
  });

  it("exports only settings and saved presets without reading excluded drawing files", async () => {
    const t = await setup(), exported = await createBackupDocument(t.before, { connections: false, credentials: false }, t.files);
    expect(exported.version).toBe(5);
    expect(exported.drawing).toEqual({ settings: projectDrawingSettings(localDraft), presets: t.before.drawing!.presets });
    expect(exported.assets).toEqual([]);
    expect(exported.drawing!.settings).not.toHaveProperty("prompt");
    expect(exported.drawing!.settings).not.toHaveProperty("references");
    expect(exported.rows).not.toHaveProperty("drawingTasks");
    expect(t.files.read).not.toHaveBeenCalled();
    expect((await decodeBackup(await encodeBackup(exported))).document.drawing).toEqual(exported.drawing);
  });
});

describe("drawing review regressions", () => {
  it("refuses an excluded prompt even under a forward-readable drawing settings stamp", async () => {
    const t = await setup(), raw = document();
    raw.compatibility!.modules.drawingSettings = { version: 3, minimumReaderVersion: 2, requiredCapabilities: [] };
    (raw.drawing!.settings as unknown as Record<string, unknown>).prompt = "excluded private text";
    const source = structuredClone(raw);
    await expect(apply(t, raw)).rejects.toThrow();
    expect(raw).toEqual(source); expect(await t.repository.snapshot()).toEqual(t.before);
    expect(t.files.assertAvailable).not.toHaveBeenCalled(); expect(t.files.write).not.toHaveBeenCalled();
    expect(t.storage.setItem).not.toHaveBeenCalled(); expect(await t.db.backupJournal.count()).toBe(0);
  });

  it("rejects drawing filtered paths in v4 while retaining them in the shared local report", async () => {
    const t = await setup(), raw = document(4), paths = ["drawing.settings.futureParameter"];
    raw.compatibility!.filteredParameters = paths;
    expect(() => validateFilteredParameters(paths)).not.toThrow();
    await expect(apply(t, raw)).rejects.toThrow();
    expect(await t.repository.snapshot()).toEqual(t.before);
    expect(t.files.write).not.toHaveBeenCalled(); expect(t.storage.setItem).not.toHaveBeenCalled();
  });

  it("matches history to upstream model IDs when display labels differ", async () => {
    const t = await setup(), connections = drawingConnections();
    t.values.set(connectionSettingsStorageKey, JSON.stringify(connections));
    const task = { ...t.task, parameters: { ...t.task.parameters, modelName: "Pretty image label" } };
    const result = { ...t.result, parameters: task.parameters };
    await t.db.drawingTasks.put(task); await t.db.drawingResults.put(result);
    const snapshot = await t.repository.snapshot();
    expect(snapshot.drawing!.targets).toEqual([{ modelId: "m", providerId: "p", connectionId: "c", protocol: "gemini-image", baseUrl: "https://synthetic.invalid", upstreamModelId: "synthetic-image" }]);
    const plan = createRestorePlan(await readBackupDocument(document()), snapshot, "merge");
    expect(plan.warnings.some(w => w.includes("历史目标无法解析"))).toBe(false);
    expect(plan.after.preferences[connectionSettingsStorageKey]).toBe(JSON.stringify(connections));
  });

  it("warns when replacement moves the configured model to another provider and connection while retaining frozen history", async () => {
    const t = await setup(), connections = drawingConnections();
    t.values.set(connectionSettingsStorageKey, JSON.stringify(connections));
    const before = await t.repository.snapshot();
    const tasksBefore = JSON.stringify(await t.db.drawingTasks.toArray());
    const resultsBefore = JSON.stringify(await t.db.drawingResults.toArray());
    const incoming = document(); incoming.options = { connections: true, credentials: true };
    const moved = drawingConnections();
    moved.providers[0].id = "replacement-provider";
    moved.providers[0].connections[0].id = "replacement-connection";
    incoming.connections = moved; incoming.drawing!.settings!.modelId = "m";
    const plan = createRestorePlan(await readBackupDocument(incoming), before, "replace");
    expect(plan.warnings.some(w => w.includes("历史目标无法解析或连接已改变"))).toBe(true);
    expect(plan.after.drawing!.draft!.modelId).toBe("m");
    await t.repository.restore(plan, before, t.files);
    expect(JSON.stringify(await t.db.drawingTasks.toArray())).toBe(tasksBefore);
    expect(JSON.stringify(await t.db.drawingResults.toArray())).toBe(resultsBefore);
    expect(t.files.read).not.toHaveBeenCalled(); expect(t.files.write).not.toHaveBeenCalled(); expect(t.files.remove).not.toHaveBeenCalled();
  });

  it.each(["running", "dispatching", "saving"] as const)("cold maintenance restores complete credentials with stale %s history and unsupported local config", async status => {
    const t = await setup(), stale = { ...t.task, status };
    await t.db.drawingTasks.put(stale);
    t.values.set(connectionSettingsStorageKey, JSON.stringify({ version: 999, activeModelId: null, providers: [] }));
    const raw = document(); raw.options = { connections: true, credentials: true }; raw.connections = drawingConnections();
    const nativeSaveLog = `drawing/${taskId}/synthetic.pending-save-log`;
    t.saved.set(nativeSaveLog, "preserved pending image bytes");
    const filesBefore = [...t.saved];
    const initialize = vi.spyOn(DrawingController.prototype, "initialize");
    const provider = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected provider dispatch"));
    const api = createBackupApi(t.repository, t.files);
    const preview = await api.inspect(await encodeBackup(raw), "");
    const conflicts = await api.conflicts(preview, "replace");
    expect(conflicts.warnings.some(w => w.includes("当前连接配置无法读取"))).toBe(true);
    await api.restore(preview, "replace");
    expect(JSON.parse(t.values.get(connectionSettingsStorageKey)!)).toEqual(drawingConnections());
    expect(await t.db.drawingTasks.toArray()).toEqual([stale]);
    expect(await t.db.drawingResults.toArray()).toEqual([t.result]);
    expect([...t.saved]).toEqual(filesBefore);
    expect(initialize).not.toHaveBeenCalled(); expect(provider).not.toHaveBeenCalled();
    expect(t.files.read).not.toHaveBeenCalled(); expect(t.files.write).not.toHaveBeenCalled(); expect(t.files.remove).not.toHaveBeenCalled();
    expect(await t.db.backupJournal.count()).toBe(0);
  });

  it("repeated merge keeps preset IDs/count stable while copy creates new independent IDs", async () => {
    const t = await setup(), raw = document();
    await apply(t, raw, "merge");
    const afterFirst = await t.repository.snapshot(), second = createRestorePlan(await readBackupDocument(raw), afterFirst, "merge");
    await t.repository.restore(second, afterFirst, t.files);
    expect(await t.db.drawingPromptPresets.toArray()).toEqual(afterFirst.drawing!.presets);
    expect(second.conflicts).toBe(2);
    const afterSecond = await t.repository.snapshot(), copied = createRestorePlan(await readBackupDocument(raw), afterSecond, "copy");
    await t.repository.restore(copied, afterSecond, t.files);
    const presets = await t.db.drawingPromptPresets.toArray(), originalIds = new Set(afterSecond.drawing!.presets.map(p => p.id));
    expect(presets).toHaveLength(5);
    expect(presets.filter(p => !originalIds.has(p.id))).toHaveLength(2);
    expect(new Set(presets.map(p => p.id)).size).toBe(5);
  });

  it.each(["gemini-image", "openai-images", "chat"] as const)("replacement resolves drawing model mapping for %s", async target => {
    const t = await setup(), raw = document();
    raw.options = { connections: true, credentials: true };
    raw.connections = drawingConnections(target === "chat" ? "gemini-image" : target);
    raw.drawing!.settings!.modelId = target === "chat" ? "chat-model" : "m";
    const plan = await apply(t, raw);
    expect((await t.db.drawingDrafts.get("current"))?.modelId).toBe(target === "chat" ? null : "m");
    expect(plan.warnings.some(w => w.includes("绘图模型引用不可用"))).toBe(target === "chat");
    expect(t.files.read).not.toHaveBeenCalled();
  });

  it("copies drawing connection/model identities without changing the local global drawing selection", async () => {
    const t = await setup(), raw = document();
    raw.options = { connections: true, credentials: true }; raw.connections = drawingConnections(); raw.drawing!.settings!.modelId = "m";
    await apply(t, raw, "copy");
    const restored = JSON.parse(t.values.get(connectionSettingsStorageKey)!) as ConnectionSettingsState;
    const drawing = restored.providers.flatMap(p => p.connections).find(c => c.protocol === "gemini-image")!;
    expect(drawing.id).not.toBe("c"); expect(drawing.models[0].id).not.toBe("m"); expect(drawing.models[0].modelId).toBe("synthetic-image");
    expect(await t.db.drawingDrafts.get("current")).toEqual(localDraft);
  });

  it.each([101, 20000])("reopens autosaved editable OpenAI size text of length %s", async length => {
    const t = await setup(), size = "x".repeat(length), draft = { ...localDraft, openai: { size, quality: "auto" } };
    const repository = new DexieDrawingRepository(t.db);
    await repository.saveDraft(draft);
    t.db.close();
    const reopened = new AyaseDatabase(t.db.name); databases.push(reopened);
    expect((await new DexieDrawingRepository(reopened).load()).draft!.openai!.size).toBe(size);
    expect((await reopened.drawingDrafts.get("current"))!.openai!.size).toBe(size);
  });
});

describe("drawing backup validation and rollback", () => {
  it.each(["preset", "futureParameter"])("rejects oversized drawing %s before filtering or durable effects", async category => {
    const t = await setup(), raw = document(), oversized = "x".repeat(8 * 1024 * 1024 + 1);
    if (category === "preset") raw.drawing!.presets![0].content = oversized;
    else {
      raw.compatibility!.modules.drawingSettings = { version: 3, minimumReaderVersion: 2, requiredCapabilities: [] };
      (raw.drawing!.settings as unknown as Record<string, unknown>).futureParameter = oversized;
    }
    const original = structuredClone(raw), filesBefore = [...t.saved], restore = vi.spyOn(t.repository, "restore");
    await expect(apply(t, raw)).rejects.toThrow();
    expect(raw).toEqual(original);
    expect(raw.compatibility).not.toHaveProperty("filteredParameters");
    expect(await t.repository.snapshot()).toEqual(t.before); expect([...t.saved]).toEqual(filesBefore);
    expect(restore).not.toHaveBeenCalled(); expect(await t.db.backupJournal.count()).toBe(0);
    expect(t.storage.setItem).not.toHaveBeenCalled(); expect(t.storage.removeItem).not.toHaveBeenCalled();
    expect(t.files.assertAvailable).not.toHaveBeenCalled(); expect(t.files.read).not.toHaveBeenCalled();
    expect(t.files.write).not.toHaveBeenCalled(); expect(t.files.remove).not.toHaveBeenCalled();
  });

  it.each(["futureRequired", "prompt", "references", "apiKey", "nestedCredential", "unknownOuter", "presetBinding", "presetDuplicate"])(
    "rejects %s before database, preference or file writes", async fault => {
      const t = await setup(), raw = document();
      const settings = raw.drawing!.settings as unknown as Record<string, unknown>;
      if (fault === "futureRequired") raw.compatibility!.modules.drawingSettings = { version: 3, minimumReaderVersion: 3, requiredCapabilities: [] };
      if (["prompt", "references", "apiKey"].includes(fault)) settings[fault] = "synthetic private value";
      if (fault === "nestedCredential") (settings.openai as Record<string, unknown>).token = "synthetic";
      if (fault === "unknownOuter") (raw.drawing as unknown as Record<string, unknown>).history = [];
      if (fault === "presetBinding") (raw.drawing!.presets![0] as unknown as Record<string, unknown>).modelId = "m";
      if (fault === "presetDuplicate") raw.drawing!.presets!.push(raw.drawing!.presets![0]);
      const original = structuredClone(raw), filesBefore = [...t.saved];
      await expect(apply(t, raw)).rejects.toThrow();
      expect(raw).toEqual(original); expect(await t.repository.snapshot()).toEqual(t.before);
      expect([...t.saved]).toEqual(filesBefore);
      expect(t.storage.setItem).not.toHaveBeenCalled(); expect(t.storage.removeItem).not.toHaveBeenCalled();
      expect(t.files.assertAvailable).not.toHaveBeenCalled(); expect(t.files.write).not.toHaveBeenCalled(); expect(t.files.remove).not.toHaveBeenCalled();
      expect(await t.db.backupJournal.count()).toBe(0);
    },
  );

  it("filters forward optional drawing parameters into path-only reports and retains reexport warnings", async () => {
    const t = await setup(), raw = document();
    raw.compatibility!.modules.drawingSettings.version = 3;
    const settings = raw.drawing!.settings as unknown as Record<string, unknown>;
    settings.futureParameter = { text: "discarded value must stay private" };
    (settings.openai as Record<string, unknown>).futurePrecision = 4;
    settings.gemini = { temperature: 0, outputMode: "image", futurePrecision: 2 };
    const source = structuredClone(raw), incoming = await readBackupDocument(raw);
    const paths = ["drawing.settings.futureParameter", "drawing.settings.openai.futurePrecision", "drawing.settings.gemini.futurePrecision"];
    expect(incoming.compatibility!.filteredParameters).toEqual(paths);
    expect(incoming.compatibility!.modules.drawingSettings.version).toBe(2);
    expect(incoming.drawing!.settings).toEqual({ ...importedSettings, gemini: { temperature: 0, outputMode: "image" } });
    expect(raw).toEqual(source);
    const plan = createRestorePlan(incoming, t.before, "replace");
    expect(plan.warnings.join(" ")).toContain("再次保存或导出可能丢失");
    expect(plan.warnings.join(" ")).not.toContain("discarded value must stay private");
    await t.repository.restore(plan, t.before, t.files);
    expect(JSON.parse(t.values.get(DATA_COMPATIBILITY_KEY)!)).toEqual(paths);
    const exported = await createBackupDocument(await t.repository.snapshot(), { connections: false, credentials: false }, t.files);
    const decoded = await decodeBackup(await encodeBackup(exported));
    expect(decoded.document.compatibility!.filteredParameters).toEqual(paths);
    expect(compatibilityWarnings(decoded.document.compatibility).join(" ")).toContain("可能丢失");
    await assertPrivateData(t);
  });

  it("rolls drawing rows, preferences and staged files back after preference failure", async () => {
    const t = await setup(), raw = document(); raw.preferences["ayase-studio.chat-layout.v1"] = "wide";
    const incoming = await readBackupDocument(raw), plan = createRestorePlan(incoming, t.before, "replace");
    const staged = `attachments/${crypto.randomUUID()}.txt`; plan.writes.push({ reference: staged, data: "synthetic new file" });
    const set = t.storage.setItem.getMockImplementation()!;
    let fail = true;
    t.storage.setItem.mockImplementation((key, value) => { if (fail) { fail = false; throw new Error("synthetic preference failure"); } set(key, value); });
    await expect(t.repository.restore(plan, t.before, t.files)).rejects.toThrow("已回滚");
    expect(await t.repository.snapshot()).toEqual(t.before);
    expect(t.saved.has(staged)).toBe(false);
    expect(t.files.remove).toHaveBeenCalledWith([staged]);
    await assertPrivateData(t);
  });

  it("recovers older journals without touching drawing categories outside the captured scope", async () => {
    const t = await setup(), { drawing: _drawing, ...historical } = t.before;
    await t.db.backupJournal.add({ id: "restore", before: historical, phase: "applying", references: [] });
    expect(await t.repository.recover(t.files)).toBe(true);
    expect((await t.repository.snapshot()).drawing).toEqual(t.before.drawing);
    await assertPrivateData(t);
  });

  it("strict local draft and preset reads preserve damaged rows", async () => {
    const t = await setup();
    const broken = { ...localDraft, futureParameter: "unknown" };
    await t.db.drawingDrafts.put(broken);
    await expect(new DexieDrawingRepository(t.db).load()).rejects.toThrow();
    expect(await t.db.drawingDrafts.get("current")).toEqual(broken);
    expect(await t.db.drawingTasks.toArray()).toEqual([t.task]);
    const brokenPreset = { ...preset("bad"), apiKey: "synthetic" };
    await t.db.drawingPromptPresets.put(brokenPreset);
    await expect(new DexieDrawingPresetRepository(t.db).load()).rejects.toThrow();
    expect(await t.db.drawingPromptPresets.get("bad")).toEqual(brokenPreset);
    expect(t.files.read).not.toHaveBeenCalled(); expect(t.files.write).not.toHaveBeenCalled(); expect(t.files.remove).not.toHaveBeenCalled();
  });

  it.each(["draft", "preset"])("invalid local %s blocks controller recovery before durable task or file effects", async category => {
    const t = await setup();
    const preparing: DrawingTask = { ...t.task, id: "preparing", status: "preparing" };
    const running: DrawingTask = { ...t.task, status: "running" };
    await t.db.drawingTasks.bulkPut([preparing, running]);
    const brokenDraft = { ...localDraft, futureField: "unknown" };
    const brokenPreset = { ...preset("bad"), filePath: "synthetic-path" };
    if (category === "draft") await t.db.drawingDrafts.put(brokenDraft);
    else await t.db.drawingPromptPresets.put(brokenPreset);
    const beforeTasks = await t.db.drawingTasks.toArray();
    const files: DrawingFiles = { importReference: vi.fn(), removeReferences: vi.fn(), save: vi.fn(), recover: vi.fn(), read: vi.fn(), export: vi.fn() };
    const repository = new DexieDrawingRepository(t.db);
    const save = vi.spyOn(repository, "saveTask"), complete = vi.spyOn(repository, "complete"), transport = vi.fn();
    const controller = new DrawingController({ repository, presetRepository: new DexieDrawingPresetRepository(t.db), files, transport });
    await controller.initialize();
    expect(controller.getSnapshot().ready).toBe(false);
    expect(controller.getSnapshot().error).toContain("禁止生成");
    expect(await t.db.drawingTasks.toArray()).toEqual(beforeTasks);
    expect(save).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
    expect(files.recover).not.toHaveBeenCalled(); expect(files.read).not.toHaveBeenCalled(); expect(files.save).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });
});
