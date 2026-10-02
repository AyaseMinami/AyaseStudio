import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AyaseDatabase } from "../storage/database";
import { defaultSessionConfig } from "../chat/sessionConfig";
import type { StoredChatMessage } from "../chat/repository";
import { createBackupDocument, allPreferenceKeys, type LocalSnapshot } from "./snapshot";
import { readBackupDocument, encodeBackup, decodeBackup } from "./codec";
import { validateDocument } from "./validation";
import { BackupRepository } from "./repository";
import { createRestorePlan } from "./restorePlan";
import { backupTables, type BackupFiles } from "./types";

const databases: AyaseDatabase[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const db of databases.splice(0)) await db.delete(); });
const options = { connections: false, credentials: false };
function files(): BackupFiles {
  return { read: vi.fn(async () => ""), write: vi.fn(async () => {}), remove: vi.fn(async () => {}), assertAvailable: vi.fn(async () => {}) };
}
function state(): LocalSnapshot {
  const u: StoredChatMessage = { id: "u", role: "user", content: "question", status: "complete" };
  const a: StoredChatMessage = { id: "a", role: "assistant", replyToId: "u", content: "reply", status: "complete", generationModel: "  API/model-original  " };
  return { rows: {
    assistants: [{ id: "default", name: "Synthetic", icon: "", sortOrder: 0, defaultModelId: null, defaultConfig: defaultSessionConfig() }],
    conversations: [{ id: "c", assistantId: "default", title: "Synthetic", createdAt: 1, updatedAt: 1, settings: { modelId: null, config: defaultSessionConfig() } }],
    chats: [{ id: "c", updatedAt: 1, messages: [{ ...u, roundVersions: { selected: 0, pairs: [[u, { ...a, generationModel: "older/API-model" }]] } }, a] }],
    workspace: [], avatarLibrary: [], userAvatar: [], cherryImports: [], legacyConversationConfigs: [],
  }, preferences: Object.fromEntries(allPreferenceKeys.map(k => [k, null])) };
}
function messages(document: { rows: { chats: unknown[] } }): StoredChatMessage[] {
  return (document.rows.chats[0] as { messages: StoredChatMessage[] }).messages;
}
async function target() {
  const db = new AyaseDatabase(`model-backup-${crypto.randomUUID()}`); databases.push(db);
  const storage = { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() };
  const repository = new BackupRepository(db, storage), before = await repository.snapshot();
  return { db, repository, before, storage };
}

describe("historical reply model backup contract", () => {
  it("exports chat v3 and retains exact main/round snapshots through actual restore and re-export", async () => {
    const input = state(), original = structuredClone(input), io = files();
    const document = await createBackupDocument(input, options, io);
    expect(document.compatibility!.modules.chat).toEqual({ version: 3, minimumReaderVersion: 3, requiredCapabilities: [] });
    const read = (await decodeBackup(await encodeBackup(document))).document;
    const { repository, before } = await target();
    await repository.restore(createRestorePlan(read, before, "replace"), before, io);
    const restored = await repository.snapshot();
    const reexport = await createBackupDocument(restored, options, io);
    const roundTrip = (await decodeBackup(await encodeBackup(reexport))).document;
    expect(messages(roundTrip)[1].generationModel).toBe("  API/model-original  ");
    expect(messages(roundTrip)[0].roundVersions!.pairs[0][1].generationModel).toBe("older/API-model");
    expect(messages(roundTrip)[0]).not.toHaveProperty("generationModel"); expect(input).toEqual(original);
  });
  it.each([1, 2])("keeps legacy chat v%s snapshots absent after actual restore/re-export", async version => {
    const input = state(), io = files();
    input.rows.chats[0].messages[1].generationModel = undefined;
    delete input.rows.chats[0].messages[0].roundVersions!.pairs[0][1].generationModel;
    const document = await createBackupDocument(input, options, io);
    document.compatibility!.modules.chat = { version, minimumReaderVersion: version, requiredCapabilities: [] };
    const read = await readBackupDocument(document), { repository, before } = await target();
    await repository.restore(createRestorePlan(read, before, "replace"), before, io);
    const reexport = await createBackupDocument(await repository.snapshot(), options, io);
    expect(messages(reexport)[1]).not.toHaveProperty("generationModel");
    expect(messages(reexport)[0].roundVersions!.pairs[0][1]).not.toHaveProperty("generationModel");
  });
  it.each(["document1", "document2", "document3", "chat1", "chat2", "round-chat1", "round-chat2", "v4-chat1", "v4-chat2", "v4-round-chat1", "v4-round-chat2", "empty", "null", "user"])(
    "rejects %s before restamping, file access or durable writes and preserves original input", async fault => {
      const io = files(), document = await createBackupDocument(state(), options, io);
      if (fault.startsWith("document")) { Object.assign(document, { version: Number(fault.slice(-1)) }); delete document.compatibility; delete document.drawing; }
      if (fault.includes("chat")) {
        const version = Number(fault.slice(-1)); document.compatibility!.modules.chat = { version, minimumReaderVersion: version, requiredCapabilities: [] };
        if (fault.includes("round")) delete messages(document)[1].generationModel;
        if (fault.startsWith("v4")) {
          document.version = 4; delete document.drawing; document.compatibility!.minimumReaderVersion = 4;
          delete document.compatibility!.modules.drawingSettings; delete document.compatibility!.modules.drawingPresets;
        }
      }
      if (fault === "empty") messages(document)[1].generationModel = " \t";
      if (fault === "null") Object.assign(messages(document)[1], { generationModel: null });
      if (fault === "user") messages(document)[0].generationModel = "user/model";
      const original = structuredClone(document), { db, repository, before, storage } = await target();
      const writes = backupTables.flatMap(table => [vi.spyOn(db.table(table), "bulkPut"), vi.spyOn(db.table(table), "clear")]);
      const journal = vi.spyOn(db.backupJournal, "add");
      await expect((async () => {
        const read = await readBackupDocument(document);
        await repository.restore(createRestorePlan(read, before, "replace"), before, io);
      })()).rejects.toThrow();
      await expect(validateDocument(document)).rejects.toThrow();
      expect(document).toEqual(original); expect(await repository.snapshot()).toEqual(before);
      for (const write of writes) expect(write).not.toHaveBeenCalled();
      expect(journal).not.toHaveBeenCalled(); expect(storage.setItem).not.toHaveBeenCalled(); expect(storage.removeItem).not.toHaveBeenCalled();
      expect(io.read).not.toHaveBeenCalled(); expect(io.write).not.toHaveBeenCalled(); expect(io.remove).not.toHaveBeenCalled(); expect(io.assertAvailable).not.toHaveBeenCalled();
    },
  );
  it("refuses invalid local export data before resources and retains the raw snapshot", async () => {
    const input = state(), io = files();
    Object.assign(input.rows.chats[0].messages[0].roundVersions!.pairs[0][1], { generationModel: { future: true } });
    const original = structuredClone(input);
    await expect(createBackupDocument(input, options, io)).rejects.toThrow();
    expect(input).toEqual(original); expect(io.read).not.toHaveBeenCalled(); expect(io.write).not.toHaveBeenCalled();
  });
  it("preserves unsupported original model metadata in private rollback recovery", async () => {
    const { db, repository } = await target(), input = state(), io = files();
    Object.assign(input.rows.chats[0].messages[0].roundVersions!.pairs[0][1], { generationModel: { future: "preserve" } });
    for (const table of backupTables) if (input.rows[table]?.length) await db.table(table).bulkPut(input.rows[table] ?? []);
    const before = await repository.snapshot();
    await db.backupJournal.put({ id: "restore", before, phase: "applying", references: [] });
    await db.chats.clear(); await repository.recover(io);
    expect(await repository.snapshot()).toEqual(before);
  });
});
