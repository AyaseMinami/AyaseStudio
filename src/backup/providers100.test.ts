import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AyaseDatabase } from "../storage/database";
import { connectionSettingsStorageKey, readConnectionSettingsData, type ConnectionSettingsState } from "../chat/settings";
import type { UserAvatar } from "../avatar/repository";
import { decodeBackup, encodeBackup, readBackupDocument } from "./codec";
import { BackupRepository, type BackupStorage } from "./repository";
import { createRestorePlan } from "./restorePlan";
import { allPreferenceKeys, createBackupDocument, type LocalSnapshot } from "./snapshot";
import { backupTables, preferenceKeys, type BackupFiles, type BackupRows } from "./types";

const databases: AyaseDatabase[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const db of databases.splice(0)) await db.delete(); });
function image(x = .5): UserAvatar {
  const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII="), c => c.charCodeAt(0));
  const original = new Blob([bytes], { type: "image/png" });
  return { original, thumbnail: original, crop: { x, y: .5, zoom: 1 } };
}
function connections(local = false): ConnectionSettingsState {
  return { version: 3, builtinsInitialized: true, activeModelId: local ? "local-model" : "model", providers: [
    { id: local ? "local-provider" : "provider", name: local ? "Local supplier" : "Synthetic supplier", presetId: "openai",
      avatar: { kind: "image", id: "supplier-image" }, connections: [
        { id: local ? "local-connection" : "connection", name: "Own connection", protocol: "openai-chat", presetProtocol: "openai-chat",
          baseUrl: "https://synthetic.invalid/v1", apiKey: local ? "synthetic-local-key" : "synthetic-source-key",
          models: [{ id: local ? "local-model" : "model", modelId: "synthetic-model" }] },
      ] },
    ...(local ? [] : [{ id: "shared-logo", name: "Custom name", avatar: { kind: "builtin" as const, id: "deepseek" as const }, connections: [] }]),
  ] };
}
function snapshot(local = false): LocalSnapshot {
  const rows = Object.fromEntries(backupTables.map(name => [name, []])) as unknown as BackupRows;
  rows.providerAvatars = [{ id: "supplier-image", value: image(local ? .25 : .5) }, { id: "unused-image", value: image(.75) }];
  return { rows, preferences: { ...Object.fromEntries(allPreferenceKeys.map(key => [key, null])),
    [connectionSettingsStorageKey]: JSON.stringify(connections(local)) } };
}
function files(): BackupFiles {
  return { read: vi.fn(), assertAvailable: vi.fn(), write: vi.fn(), remove: vi.fn() };
}
function storage(values: Record<string, string | null>): BackupStorage {
  const map = new Map(Object.entries(values).filter((item): item is [string, string] => item[1] !== null));
  return { getItem: key => map.get(key) ?? null, setItem: vi.fn((key, value) => { map.set(key, value); }), removeItem: vi.fn(key => { map.delete(key); }) };
}
async function setup() {
  const db = new AyaseDatabase(`providers100-${crypto.randomUUID()}`); databases.push(db);
  const source = snapshot(true), store = storage(source.preferences), repository = new BackupRepository(db, store);
  for (const table of backupTables) if (source.rows[table]?.length) await db.table(table).bulkPut(source.rows[table]!);
  return { db, store, repository, before: await repository.snapshot(), resources: files() };
}
function readConnections(value: LocalSnapshot) {
  return JSON.parse(value.preferences[connectionSettingsStorageKey]!) as ConnectionSettingsState;
}

describe("Issue 100 conditional supplier image backup", () => {
  it.each([false, true])("exports only referenced snapshots when connections=%s, without copying shared logos or orphan images", async included => {
    const before = snapshot(), original = structuredClone(before), resources = files();
    const doc = await createBackupDocument(before, { connections: included, credentials: false }, resources);
    expect(doc.compatibility?.modules.connections.version).toBe(5);
    expect(doc.rows.providerAvatars?.map((row: any) => row.id) ?? []).toEqual(included ? ["supplier-image"] : []);
    if (!included) expect(doc.rows.providerAvatars).toBeUndefined();
    expect(doc.assets).toHaveLength(included ? 1 : 0);
    expect(doc.connections).toEqual(included ? expect.objectContaining({ builtinsInitialized: true }) : null);
    const encoded = await encodeBackup(doc), decoded = (await decodeBackup(encoded)).document;
    expect(decoded).toEqual(doc);
    expect(encoded).not.toContain("synthetic-source-key");
    expect(encoded).not.toContain("unused-image");
    if (included) expect((doc.connections as ConnectionSettingsState).providers[1].avatar).toEqual({ kind: "builtin", id: "deepseek" });
    expect(before).toEqual(original);
    expect(resources.read).not.toHaveBeenCalled(); expect(resources.write).not.toHaveBeenCalled();
  });

  it("round-trips supplied image and free protocol override with included credentials", async () => {
    const before = snapshot(), config = connections();
    config.providers[0].connections[0].protocol = "anthropic-native";
    before.preferences[connectionSettingsStorageKey] = JSON.stringify(config);
    const doc = await createBackupDocument(before, { connections: true, credentials: true }, files());
    const decoded = (await decodeBackup(await encodeBackup(doc))).document;
    expect(decoded.connections).toEqual(config);
    expect(decoded.assets[0].mime).toBe("image/png");
    expect(decoded.rows.providerAvatars).toHaveLength(1);
  });

  it("fails missing referenced local snapshots before file reads/writes", async () => {
    const before = snapshot(); before.rows.providerAvatars = [];
    const original = structuredClone(before), resources = files();
    await expect(createBackupDocument(before, { connections: true, credentials: false }, resources)).rejects.toThrow("供应商头像缺失");
    expect(before).toEqual(original);
    expect(resources.read).not.toHaveBeenCalled(); expect(resources.write).not.toHaveBeenCalled();
  });

  it.each(["row", "value", "crop"].flatMap(scope => [false, true].flatMap(included =>
    ["supplier-image", "unused-image"].map(id => ({ scope, included, id })))))(
    "rejects future $scope fields from $id with connections=$included before projection/filtering", async ({ scope, included, id }) => {
      const before = snapshot(), row = before.rows.providerAvatars!.find(value => value.id === id) as any;
      const target = scope === "row" ? row : scope === "value" ? row.value : row.value.crop;
      target.futureImageMetadata = { version: 2, retained: "synthetic-future-data" };
      const original = structuredClone(before), resources = files();
      await expect(createBackupDocument(before, { connections: included, credentials: false }, resources)).rejects.toThrow();
      expect(before).toEqual(original);
      expect(resources.read).not.toHaveBeenCalled(); expect(resources.write).not.toHaveBeenCalled();
    });
});

describe("Issue 100 original connection module stamps", () => {
  it.each([1, 2, 3, 4, 5] as const)("accepts historical document v%s without supplier fields/rows, without seeding or mutating the input", async version => {
    const raw = await createBackupDocument(snapshot(), { connections: true, credentials: true }, files()) as any;
    raw.version = version; raw.assets = []; delete raw.rows.providerAvatars;
    if (version <= 3) {
      const appearance = JSON.parse(raw.preferences[preferenceKeys[0]]);
      delete appearance.sidebarGlassEnabled; delete appearance.composerGlassEnabled;
      delete appearance.chromeTransparency;
      raw.preferences[preferenceKeys[0]] = JSON.stringify(appearance);
    }
    delete raw.connections.builtinsInitialized;
    raw.connections.providers = [raw.connections.providers[0]];
    delete raw.connections.providers[0].presetId; delete raw.connections.providers[0].avatar;
    delete raw.connections.providers[0].connections[0].presetProtocol;
    delete raw.searchSettings; delete raw.drawing;
    if (version < 4) delete raw.compatibility;
    else {
      raw.compatibility.minimumReaderVersion = version;
      raw.compatibility.modules.connections = { version: 4, minimumReaderVersion: 4, requiredCapabilities: [] };
      delete raw.compatibility.modules.drawingSettings; delete raw.compatibility.modules.drawingPresets;
    }
    const original = structuredClone(raw), read = await readBackupDocument(raw);
    expect((read.connections as ConnectionSettingsState).providers).toHaveLength(1);
    expect((read.connections as ConnectionSettingsState).builtinsInitialized).toBeUndefined();
    expect(await readBackupDocument(read)).toEqual(read);
    expect(raw).toEqual(original);
  });

  it.each(["rows", "initialized", "preset", "avatar", "connection-preset"])("rejects %s under original module 4 before restamping, with a positive module 5 control", async variant => {
    const raw = await createBackupDocument(snapshot(), { connections: true, credentials: true }, files()) as any;
    raw.connections.providers = [raw.connections.providers[0]];
    delete raw.connections.builtinsInitialized; delete raw.connections.providers[0].presetId;
    delete raw.connections.providers[0].avatar; delete raw.connections.providers[0].connections[0].presetProtocol;
    delete raw.rows.providerAvatars; raw.assets = [];
    if (variant === "rows") raw.rows.providerAvatars = [];
    if (variant === "initialized") raw.connections.builtinsInitialized = true;
    if (variant === "preset") raw.connections.providers[0].presetId = "openai";
    if (variant === "avatar") raw.connections.providers[0].avatar = { kind: "builtin", id: "openai" };
    if (variant === "connection-preset") {
      raw.connections.providers[0].presetId = "openai";
      raw.connections.providers[0].connections[0].presetProtocol = "openai-chat";
    }
    await expect(readBackupDocument(raw)).resolves.toBeDefined();
    raw.compatibility.modules.connections = { version: 4, minimumReaderVersion: 4, requiredCapabilities: [] };
    const original = structuredClone(raw), current = snapshot(true), originalCurrent = structuredClone(current);
    await expect(readBackupDocument(raw).then(doc => createRestorePlan(doc, current, "replace"))).rejects.toThrow();
    expect(raw).toEqual(original); expect(current).toEqual(originalCurrent);
  });
});

describe("Issue 100 restore image ownership and durable protection", () => {
  it.each(["replace", "merge", "copy"] as const)("%s remaps conflicting image IDs with provider references and re-exports a readable result", async mode => {
    const current = snapshot(true), before = structuredClone(current), resources = files();
    const document = await readBackupDocument(await createBackupDocument(snapshot(), { connections: true, credentials: true }, resources));
    const plan = createRestorePlan(document, current, mode), restored = readConnections(plan.after);
    const supplier = restored.providers.find(p => p.name === "Synthetic supplier")!;
    expect(supplier.avatar?.kind).toBe("image");
    expect(supplier.avatar?.id).not.toBe("supplier-image");
    if (mode === "copy") {
      expect(supplier.id).not.toBe("provider");
      expect(supplier.connections[0].id).not.toBe("connection");
      expect(supplier.connections[0].models[0].id).not.toBe("model");
    } else expect(supplier.id).toBe("provider");
    expect(supplier.presetId).toBe("openai");
    expect(supplier.connections[0]).toMatchObject({ presetProtocol: "openai-chat", apiKey: "synthetic-source-key" });
    expect(restored.builtinsInitialized).toBe(true);
    expect(restored.providers.find(p => p.name === "Custom name")?.avatar).toEqual({ kind: "builtin", id: "deepseek" });
    const owned = plan.after.rows.providerAvatars!.find(row => row.id === supplier.avatar?.id)!;
    expect(owned.value.source).toBeUndefined();
    expect(owned.value.crop).toEqual(image().crop);
    expect(await owned.value.original.arrayBuffer()).toEqual(await image().original.arrayBuffer());
    if (mode === "replace") {
      expect(restored.activeModelId).toBe(supplier.connections[0].models[0].id);
      expect(plan.after.rows.providerAvatars).toHaveLength(1);
    } else {
      expect(restored.activeModelId).toBe("local-model");
      expect(plan.after.rows.providerAvatars!.find(row => row.id === "supplier-image")?.value.crop.x).toBe(.25);
    }
    const reexport = await readBackupDocument(await createBackupDocument(plan.after, { connections: true, credentials: true }, resources));
    expect((reexport.connections as ConnectionSettingsState).providers).toEqual(restored.providers);
    expect(reexport.rows.providerAvatars?.map((row: any) => row.id)).toContain(supplier.avatar?.id);
    expect(current).toEqual(before); expect(plan.writes).toEqual([]); expect(resources.write).not.toHaveBeenCalled();
  });

  it("merge keeps a conflicting local supplier image and does not import the unused incoming snapshot", async () => {
    const current = snapshot(true), config = connections(true); config.providers[0].id = "provider";
    current.preferences[connectionSettingsStorageKey] = JSON.stringify(config);
    const doc = await readBackupDocument(await createBackupDocument(snapshot(), { connections: true, credentials: true }, files()));
    const plan = createRestorePlan(doc, current, "merge"), result = readConnections(plan.after);
    expect(result.providers[0].avatar).toEqual({ kind: "image", id: "supplier-image" });
    expect(result.providers[0].name).toBe("Local supplier");
    expect(plan.after.rows.providerAvatars).toEqual(current.rows.providerAvatars);
  });

  it.each(["custom", "anthropic"] as const)("merge retains local %s identity and strips the conflicting incoming OpenAI template identity from new connections", async identity => {
    const current = snapshot(true), config = connections(true), local = config.providers[0];
    local.id = "provider";
    if (identity === "custom") {
      delete local.presetId;
      delete local.connections[0].presetProtocol;
    } else {
      local.presetId = "anthropic";
      local.connections[0].protocol = "anthropic-native";
      local.connections[0].presetProtocol = "anthropic-native";
    }
    current.preferences[connectionSettingsStorageKey] = JSON.stringify(config);
    const original = structuredClone(current), resources = files();
    const doc = await readBackupDocument(await createBackupDocument(snapshot(), { connections: true, credentials: true }, resources));
    const plan = createRestorePlan(doc, current, "merge"), restored = readConnections(plan.after);
    const retained = restored.providers.find(provider => provider.id === "provider")!;
    expect(retained.presetId).toBe(identity === "custom" ? undefined : "anthropic");
    expect(retained.name).toBe(local.name);
    expect(retained.avatar).toEqual(local.avatar);
    expect(retained.connections[0]).toEqual(local.connections[0]);
    const imported = retained.connections.find(connection => connection.id === "connection")!;
    const expected = { ...connections().providers[0].connections[0] }; delete expected.presetProtocol;
    expect(imported).toEqual(expected);
    expect(imported.presetProtocol).toBeUndefined();
    expect(readConnectionSettingsData(restored)).toEqual(restored);
    const reexport = await createBackupDocument(plan.after, { connections: true, credentials: true }, resources);
    const decoded = (await decodeBackup(await encodeBackup(reexport))).document;
    expect((decoded.connections as ConnectionSettingsState).providers.find(provider => provider.id === "provider")?.connections).toEqual(retained.connections);
    expect(current).toEqual(original);
    expect(resources.write).not.toHaveBeenCalled();
  });

  it.each(["replace", "merge", "copy"] as const)("%s without connections preserves every local supplier image and raw settings", async mode => {
    const current = snapshot(true), doc = await readBackupDocument(await createBackupDocument(snapshot(), { connections: false, credentials: false }, files()));
    const plan = createRestorePlan(doc, current, mode);
    expect(plan.after.rows.providerAvatars).toEqual(current.rows.providerAvatars);
    expect(plan.after.preferences[connectionSettingsStorageKey]).toBe(current.preferences[connectionSettingsStorageKey]);
  });

  it.each(["replace", "merge", "copy"] as const)("%s preserves absent historical initialization markers rather than initializing during restore", async mode => {
    const current = snapshot(true), local = readConnections(current); delete local.builtinsInitialized;
    current.preferences[connectionSettingsStorageKey] = JSON.stringify(local);
    const raw = await createBackupDocument(snapshot(), { connections: true, credentials: true }, files()) as any;
    delete raw.connections.builtinsInitialized;
    const document = await readBackupDocument(raw), plan = createRestorePlan(document, current, mode);
    expect(readConnections(plan.after).builtinsInitialized).toBeUndefined();
    expect(readConnections(plan.after).providers).toHaveLength(mode === "replace" ? 2 : 3);
  });

  it.each(["future-module", "future-local-version", "unknown-brand", "missing-image", "orphan-image", "source-provenance", "unknown-avatar-kind", "unknown-field"])(
    "rejects %s before durable rows/preferences/journal/files change", async variant => {
      const test = await setup(), raw = await createBackupDocument(snapshot(), { connections: true, credentials: true }, files()) as any;
      if (variant === "future-module") raw.compatibility.modules.connections = { version: 99, minimumReaderVersion: 99, requiredCapabilities: [] };
      if (variant === "future-local-version") raw.connections.version = 4;
      if (variant === "unknown-brand") raw.connections.providers[1].avatar.id = "future-brand";
      if (variant === "missing-image") raw.connections.providers[0].avatar.id = "missing";
      if (variant === "orphan-image") raw.rows.providerAvatars.push({ ...raw.rows.providerAvatars[0], id: "orphan" });
      if (variant === "source-provenance") raw.rows.providerAvatars[0].value.source = { resourceId: "external-library", version: "synthetic" };
      if (variant === "unknown-avatar-kind") raw.connections.providers[0].avatar.kind = "external-url";
      if (variant === "unknown-field") raw.connections.providers[0].authorization = "synthetic-unknown-key";
      const original = structuredClone(raw), restore = vi.spyOn(test.repository, "restore");
      await expect(readBackupDocument(raw).then(doc => test.repository.restore(createRestorePlan(doc, test.before, "replace"), test.before, test.resources))).rejects.toThrow();
      expect(restore).not.toHaveBeenCalled();
      expect(await test.repository.snapshot()).toEqual(test.before);
      expect(await test.db.backupJournal.count()).toBe(0);
      expect(test.store.setItem).not.toHaveBeenCalled(); expect(test.store.removeItem).not.toHaveBeenCalled();
      expect(test.resources.assertAvailable).not.toHaveBeenCalled(); expect(test.resources.write).not.toHaveBeenCalled(); expect(test.resources.remove).not.toHaveBeenCalled();
      expect(raw).toEqual(original);
    });

  it("rolls back supplier rows and raw connection preference after failure following the database commit", async () => {
    const test = await setup(), doc = await readBackupDocument(await createBackupDocument(snapshot(), { connections: true, credentials: true }, files()));
    const plan = createRestorePlan(doc, test.before, "replace"), originalSet = vi.mocked(test.store.setItem).getMockImplementation()!;
    let fail = true;
    vi.spyOn(test.store, "setItem").mockImplementation((key, value) => {
      if (key === connectionSettingsStorageKey && fail) { fail = false; throw new Error("Synthetic preference write failure"); }
      originalSet(key, value);
    });
    await expect(test.repository.restore(plan, test.before, test.resources)).rejects.toThrow("已回滚");
    expect(await test.repository.snapshot()).toEqual(test.before);
    expect(await test.db.backupJournal.count()).toBe(0);
    expect(test.resources.write).not.toHaveBeenCalled();
  });

  it("recovers historical journals without a supplier-image table while preserving current images", async () => {
    const test = await setup(), oldJournal = structuredClone(test.before);
    delete oldJournal.rows.providerAvatars;
    await test.db.backupJournal.put({ id: "restore", before: oldJournal, references: [], phase: "applying" });
    expect(await test.repository.recover(test.resources)).toBe(true);
    expect(await test.db.providerAvatars.toArray()).toEqual(test.before.rows.providerAvatars);
    expect(await test.repository.snapshot()).toEqual(test.before);
    expect(await test.db.backupJournal.count()).toBe(0);
  });
});
