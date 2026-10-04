import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { AyaseDatabase } from "../storage/database";
import { connectionSettingsStorageKey, readConnectionSettingsData, type ConnectionSettingsState } from "../chat/settings";
import { readBackupDocument } from "./codec";
import { BackupRepository } from "./repository";
import { createRestorePlan } from "./restorePlan";
import { allPreferenceKeys, createBackupDocument, type LocalSnapshot } from "./snapshot";
import { backupTables, type BackupFiles, type BackupRows } from "./types";

function connections(): ConnectionSettingsState {
  return { version: 3, activeModelId: "model", providers: [{ id: "provider", name: "Synthetic", connections: [{
    id: "connection", name: "Main", protocol: "openai-chat", baseUrl: "https://example.invalid", apiKey: "synthetic-only",
    modelGroups: [{ id: "group", name: "常用" }, { id: "empty", name: "空组" }],
    models: [{ id: "model", modelId: "gpt-5.3-chat", groupId: "group" }, { id: "auto", modelId: "gpt-5.3-thinking" }],
  }] }] };
}
function snapshot(state?: ConnectionSettingsState): LocalSnapshot {
  return { rows: Object.fromEntries(backupTables.map(table => [table, []])) as unknown as BackupRows,
    preferences: { ...Object.fromEntries(allPreferenceKeys.map(key => [key, null])),
      ...(state ? { [connectionSettingsStorageKey]: JSON.stringify(state) } : {}) } };
}
function files(): BackupFiles { return { read: vi.fn(), assertAvailable: vi.fn(), write: vi.fn(), remove: vi.fn() }; }
function restored(value: LocalSnapshot) { return readConnectionSettingsData(JSON.parse(value.preferences[connectionSettingsStorageKey]!)); }

describe("model group backup contract", () => {
  it.each([false, true])("exports groups through policies and conditions on included connections (%s)", async included => {
    const doc = await createBackupDocument(snapshot(connections()), { connections: included, credentials: false }, files());
    expect(doc.compatibility!.modules.connections).toEqual({ version: 6, minimumReaderVersion: 6, requiredCapabilities: [] });
    if (included) {
      const connection = (doc.connections as ConnectionSettingsState).providers[0].connections[0];
      expect(connection.modelGroups).toEqual(connections().providers[0].connections[0].modelGroups);
      expect(connection.models[0].groupId).toBe("group");
      expect(connection.apiKey).toBeUndefined();
    } else expect(doc.connections).toBeNull();
    expect(await readBackupDocument(doc)).toEqual(doc);
  });
  it.each(["merge", "copy", "replace"] as const)("preserves connection-scoped group identity through %s and re-export", async mode => {
    const doc = await createBackupDocument(snapshot(connections()), { connections: true, credentials: false }, files());
    const before = snapshot();
    const plan = createRestorePlan(await readBackupDocument(doc), before, mode);
    const state = restored(plan.after), connection = state.providers[0].connections[0];
    expect(connection.modelGroups).toEqual(connections().providers[0].connections[0].modelGroups);
    expect(connection.models[0].groupId).toBe("group");
    if (mode === "copy") { expect(connection.id).not.toBe("connection"); expect(connection.models[0].id).not.toBe("model"); }
    const exported = await createBackupDocument(plan.after, { connections: true, credentials: false }, files());
    expect((await readBackupDocument(exported)).connections).toEqual(exported.connections);
  });
  it("merge retains local groups for conflicting connections and copy isolates same-ID groups", async () => {
    const source = connections(), local = connections();
    local.providers[0].connections[0].modelGroups![0].name = "本机组";
    const doc = await createBackupDocument(snapshot(source), { connections: true, credentials: false }, files());
    const before = snapshot(local);
    expect(restored(createRestorePlan(doc, before, "merge").after)).toEqual(local);
    const copied = restored(createRestorePlan(doc, before, "copy").after);
    expect(copied.providers).toHaveLength(2);
    expect(copied.providers[0].connections[0].modelGroups![0].name).toBe("本机组");
    expect(copied.providers[1].connections[0].modelGroups![0].name).toBe("常用");
  });
  it("accepts older module data without groups, but refuses grouped data with old or future stamps", async () => {
    const doc = await createBackupDocument(snapshot(connections()), { connections: true, credentials: false }, files());
    const old: any = structuredClone(doc);
    old.compatibility.modules.connections = { version: 5, minimumReaderVersion: 5, requiredCapabilities: [] };
    await expect(readBackupDocument(old)).rejects.toThrow();
    delete old.connections.providers[0].connections[0].modelGroups;
    delete old.connections.providers[0].connections[0].models[0].groupId;
    expect(((await readBackupDocument(old)).connections as ConnectionSettingsState).providers[0].connections[0].modelGroups).toBeUndefined();
    const future: any = structuredClone(doc);
    future.compatibility.modules.connections = { version: 7, minimumReaderVersion: 7, requiredCapabilities: [] };
    await expect(readBackupDocument(future)).rejects.toThrow();
    const dangling: any = structuredClone(doc);
    dangling.connections.providers[0].connections[0].modelGroups = [];
    await expect(readBackupDocument(dangling)).rejects.toThrow();
    const unknown: any = structuredClone(doc);
    unknown.connections.providers[0].connections[0].modelGroups[0].apiKey = "synthetic";
    await expect(readBackupDocument(unknown)).rejects.toThrow();
  });
  it("rolls back the exact old group state when restoring preferences fails", async () => {
    const doc = await createBackupDocument(snapshot(connections()), { connections: true, credentials: false }, files());
    const local = connections(); local.providers[0].connections[0].modelGroups![0].name = "本机组";
    const before = snapshot(local), values = new Map(Object.entries(before.preferences).filter((pair): pair is [string, string] => pair[1] !== null));
    let fail = true;
    const storage = { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { if (fail && key === connectionSettingsStorageKey) { fail = false; throw new Error("synthetic quota"); } values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); } };
    const db = new AyaseDatabase(`groups119-${crypto.randomUUID()}`);
    try {
      const repository = new BackupRepository(db, storage);
      await expect(repository.restore(createRestorePlan(doc, before, "replace"), before, files())).rejects.toThrow("已回滚");
      expect(values.get(connectionSettingsStorageKey)).toBe(before.preferences[connectionSettingsStorageKey]);
      expect(await db.backupJournal.get("restore")).toBeUndefined();
    } finally { await db.delete(); }
  });
});
