import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { AyaseDatabase } from "../storage/database";
import { createChatRepository } from "../chat/repository";
import { defaultSessionConfig } from "../chat/sessionConfig";
import { currentModuleVersions } from "../storage/dataRegistry";
import { readAssistantAvatarSelection } from "../avatar/assistantDefaults";
import { dataRecord } from "../storage/dataContract";
import { BackupRepository } from "./repository";
import { createBackupDocument, allPreferenceKeys, type LocalSnapshot } from "./snapshot";
import { createRestorePlan } from "./restorePlan";
import { readBackupDocument, decodeBackup, encodeBackup } from "./codec";
import { backupTables, preferenceKeys, type BackupDocument, type BackupFiles, type BackupRows } from "./types";

const databases: AyaseDatabase[] = [];
afterEach(async () => { for (const db of databases.splice(0)) await db.delete(); });
const files: BackupFiles = { read: vi.fn(), assertAvailable: vi.fn(async () => {}), write: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
const input = { name: "写作助手", icon: "", defaultModelId: null, defaultConfig: defaultSessionConfig() };
function document(version: 1 | 2 | 3 | 4 | 5): BackupDocument {
  return { format: "ayase-studio-backup", version, createdAt: "2026-10-02T00:00:00Z", options: { connections: false, credentials: false },
    rows: { assistants: [{ id: "automatic", sortOrder: 0, ...input },
      { id: "emoji", sortOrder: 1, ...input, icon: "👩‍💻" }, { id: "builtin", sortOrder: 2, ...input, defaultAvatar: "violet" }],
      conversations: [], chats: [], workspace: [], avatarLibrary: [], userAvatar: [], cherryImports: [], legacyConversationConfigs: [] },
    preferences: Object.fromEntries(preferenceKeys.map(k => [k, k === "ayase-studio.assistant-default-avatar" ? "blue" : null])) as BackupDocument["preferences"],
    connections: null, assets: [], ...(version >= 4 ? { compatibility: { minimumReaderVersion: version as 4 | 5, requiredCapabilities: [], modules: currentModuleVersions() } } : {}) };
}
it.each([1, 2, 3, 4, 5] as const)("reads v%s avatar selections repeatedly without converting legacy records", async version => {
  const raw = document(version), before = structuredClone(raw);
  const read = await readBackupDocument(raw);
  expect(read.rows.assistants).toEqual(before.rows.assistants);
  expect((await readBackupDocument(read)).rows.assistants).toEqual(read.rows.assistants);
  expect(raw).toEqual(before);
  expect((await decodeBackup(await encodeBackup(read))).document.rows.assistants).toEqual(read.rows.assistants);
});
it("persists an explicit switch from legacy image/builtin/emoji to automatic through restart, restore and reexport", async () => {
  const name = `avatar81-${crypto.randomUUID()}`, db = new AyaseDatabase(name); databases.push(db);
  const repo = createChatRepository(name);
  await repo.initializeWorkspace(null, []);
  const avatar = { original: new Blob(["image"], { type: "image/png" }), thumbnail: new Blob(["thumb"], { type: "image/png" }), crop: { x: .5, y: .5, zoom: 1 } };
  await repo.execute({ type: "create-assistant", id: "a", input: { ...input, icon: "✦", defaultAvatar: "green", avatar } });
  await repo.execute({ type: "edit-assistant", id: "a", input: { ...input, avatar: undefined, defaultAvatar: undefined } });
  const fresh = createChatRepository(name), snapshot = await fresh.initializeWorkspace(null, []);
  expect(snapshot.assistants.find(a => a.id === "a")).toMatchObject({ icon: "", avatar: undefined, defaultAvatar: undefined });
  const values = new Map<string, string>([["ayase-studio.assistant-default-avatar", "violet"]]);
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
  const backups = new BackupRepository(db, storage);
  const original = await backups.snapshot();
  const encoded = await createBackupDocument(original, { connections: false, credentials: false }, files);
  expect(encoded.preferences["ayase-studio.assistant-default-avatar"]).toBe("violet");
  const preview = (await decodeBackup(await encodeBackup(encoded))).document;
  await fresh.execute({ type: "edit-assistant", id: "a", input: { ...input, defaultAvatar: "blue" } });
  const before = await backups.snapshot();
  await backups.restore(createRestorePlan(preview, before, "replace"), before, files);
  const restored = await fresh.initializeWorkspace(null, []);
  expect(restored.assistants.find(a => a.id === "a")?.defaultAvatar).toBeUndefined();
  expect(restored.assistants.find(a => a.id === "a")?.icon).toBe("");
  expect(restored.assistants.find(a => a.id === "a")?.avatar).toBeUndefined();
  const reexport = await createBackupDocument(await backups.snapshot(), { connections: false, credentials: false }, files);
  expect(reexport.rows.assistants.find(a => { dataRecord(a); return a.id === "a"; })).not.toHaveProperty("defaultAvatar");
  expect(values.get("ayase-studio.assistant-default-avatar")).toBe("violet");
});
it.each(["future-mode", null, 12])("refuses unsupported selection %s before local initialization writes or backup projection", async defaultAvatar => {
  const name = `avatar81-bad-${crypto.randomUUID()}`, db = new AyaseDatabase(name); databases.push(db);
  const row = { id: "invalid", sortOrder: 0, ...input, defaultAvatar };
  await db.table("assistants").put(row);
  const repo = createChatRepository(name);
  await expect(repo.initializeWorkspace(null, [])).rejects.toThrow("助手头像选择不受支持");
  expect(await db.table("assistants").toArray()).toEqual([row]);
  expect(await db.conversations.count()).toBe(0);
  expect(await db.workspace.count()).toBe(0);
  expect(await db.chats.count()).toBe(0);
  const raw = document(5), invalid = raw.rows.assistants[0]; dataRecord(invalid); Object.assign(invalid, { defaultAvatar });
  const original = structuredClone(raw);
  await expect(readBackupDocument(raw)).rejects.toThrow();
  expect(raw).toEqual(original);
  const snapshot: LocalSnapshot = { rows: Object.fromEntries(backupTables.map(t => [t, t === "assistants" ? [row] : []])) as unknown as BackupRows,
    preferences: Object.fromEntries(allPreferenceKeys.map(k => [k, null])) };
  await expect(createBackupDocument(snapshot, { connections: false, credentials: false }, files)).rejects.toThrow();
  expect(readAssistantAvatarSelection({ icon: "" })).toEqual({ icon: "", defaultAvatar: undefined });
});
