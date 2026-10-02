import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { AyaseDatabase } from "../storage/database";
import { defaultSessionConfig } from "../chat/sessionConfig";
import type { StoredChatMessage } from "../chat/repository";
import type { GenerationMetrics } from "../chat/generationMetrics";
import { createBackupDocument, allPreferenceKeys, type LocalSnapshot } from "./snapshot";
import { readBackupDocument, encodeBackup, decodeBackup } from "./codec";
import { validateDocument } from "./validation";
import { BackupRepository } from "./repository";
import { createRestorePlan } from "./restorePlan";
import { backupTables, type BackupFiles } from "./types";

const metric = (): GenerationMetrics => ({ version: 1, protocol: "anthropic-native", streaming: true, status: "paused",
  elapsedMs: 15.5, firstThinkingMs: 1, usageComplete: true, usage: { inputTokens: 10, outputTokens: 3, cacheReadTokens: 0 } });
const files: BackupFiles = { read: vi.fn(async () => ""), write: vi.fn(async () => {}), remove: vi.fn(async () => {}), assertAvailable: vi.fn(async () => {}) };
function state(): LocalSnapshot {
  const u: StoredChatMessage = { id: "u", role: "user", content: "question", status: "complete" };
  const a: StoredChatMessage = { id: "a", role: "assistant", replyToId: "u", content: "reply", status: "paused",
    generationMetrics: [metric(), { ...metric(), status: "complete" }] };
  return { rows: {
    assistants: [{ id: "default", name: "Synthetic", icon: "", sortOrder: 0, defaultModelId: null, defaultConfig: defaultSessionConfig() }],
    conversations: [{ id: "c", assistantId: "default", title: "Synthetic", createdAt: 1, updatedAt: 1, settings: { modelId: null, config: defaultSessionConfig() } }],
    chats: [{ id: "c", updatedAt: 1, messages: [{ ...u, roundVersions: { selected: 0, pairs: [[u, a]] } }, a] }],
    workspace: [], avatarLibrary: [], userAvatar: [], cherryImports: [], legacyConversationConfigs: [],
  }, preferences: Object.fromEntries(allPreferenceKeys.map(k => [k, null])) };
}
function messages(document: { rows: { chats: unknown[] } }): StoredChatMessage[] {
  return (document.rows.chats[0] as { messages: StoredChatMessage[] }).messages;
}
const options = { connections: false, credentials: false };

describe("generation metrics backup contract", () => {
  it("exports chat v3 and preserves each invocation and round history through restore/re-export", async () => {
    const input = state(), original = structuredClone(input);
    const document = await createBackupDocument(input, options, files);
    expect(document.compatibility!.modules.chat).toEqual({ version: 3, minimumReaderVersion: 3, requiredCapabilities: [] });
    const read = (await decodeBackup(await encodeBackup(document))).document;
    expect(messages(read)[1].generationMetrics).toEqual(input.rows.chats[0].messages[1].generationMetrics);
    expect(messages(read)[0].roundVersions!.pairs[0][1].generationMetrics).toEqual(messages(read)[1].generationMetrics);
    expect(input).toEqual(original);
    const plan = createRestorePlan(read, input, "replace");
    const reexport = await createBackupDocument(plan.after, options, files);
    expect(messages(reexport)[1].generationMetrics).toEqual(messages(read)[1].generationMetrics);
  });
  it("keeps legacy chat v1 without measurements readable without fabricating any", async () => {
    const input = state();
    delete input.rows.chats[0].messages[1].generationMetrics;
    delete input.rows.chats[0].messages[0].roundVersions!.pairs[0][1].generationMetrics;
    const document = await createBackupDocument(input, options, files);
    document.compatibility!.modules.chat = { version: 1, minimumReaderVersion: 1, requiredCapabilities: [] };
    const result = await readBackupDocument(document);
    expect(messages(result)[1]).not.toHaveProperty("generationMetrics");
    expect(messages(result)[0].roundVersions!.pairs[0][1]).not.toHaveProperty("generationMetrics");
  });
  it.each([1, 2, 3, 4, 5] as const)("rejects metrics in old document/module %s before restamping", async version => {
    const document = await createBackupDocument(state(), options, files);
    Object.assign(document, { version });
    if (version < 4) { delete document.compatibility; delete document.drawing; }
    else if (version === 4 || version === 5) { if (version === 4) delete document.drawing;
      document.compatibility!.minimumReaderVersion = version;
      delete document.compatibility!.modules.drawingSettings; delete document.compatibility!.modules.drawingPresets;
      document.compatibility!.modules.chat = { version: 1, minimumReaderVersion: 1, requiredCapabilities: [] };
    }
    const original = structuredClone(document);
    await expect(readBackupDocument(document)).rejects.toThrow(); await expect(validateDocument(document)).rejects.toThrow();
    expect(document).toEqual(original);
  });
  it.each([{ version: 2 }, { future: true }, { elapsedMs: -1 }, { usage: { future: 1 } }])(
    "rejects unsupported nested statistics %# before resources or durable writes", async patch => {
      const input = state(), db = new AyaseDatabase(`metrics-backup-${crypto.randomUUID()}`);
      for (const table of backupTables) if (input.rows[table]?.length) await db.table(table).bulkPut(input.rows[table] ?? []);
      const repository = new BackupRepository(db, { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
      const before = await repository.snapshot(), document = await createBackupDocument(input, options, files);
      Object.assign(messages(document)[0].roundVersions!.pairs[0][1].generationMetrics![0], patch);
      const original = structuredClone(document), write = vi.spyOn(db.chats, "bulkPut");
      await expect(readBackupDocument(document)).rejects.toThrow();
      expect(document).toEqual(original); expect(write).not.toHaveBeenCalled(); expect(await repository.snapshot()).toEqual(before);
      Object.assign(input.rows.chats[0].messages[1].generationMetrics![0], patch);
      const localOriginal = structuredClone(input);
      await expect(createBackupDocument(input, options, files)).rejects.toThrow(); expect(input).toEqual(localOriginal);
    },
  );
  it("retains exact stats in private native rollback snapshots even when unsupported", async () => {
    const db = new AyaseDatabase(`metrics-rollback-${crypto.randomUUID()}`), input = state();
    Object.assign(input.rows.chats[0].messages[1].generationMetrics![0], { future: "preserve-original" });
    for (const table of backupTables) if (input.rows[table]?.length) await db.table(table).bulkPut(input.rows[table] ?? []);
    const repository = new BackupRepository(db, { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    const before = await repository.snapshot();
    await db.backupJournal.put({ id: "restore", before, phase: "applying", references: [] });
    await db.chats.clear(); await repository.recover(files);
    expect(await repository.snapshot()).toEqual(before);
  });
});
