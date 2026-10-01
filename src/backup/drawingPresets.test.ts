import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AyaseDatabase } from "../storage/database";
import { DexieDrawingPresetRepository } from "../drawing/presets";
import { BackupRepository, drawingBackupBlockedMessage } from "./repository";
import type { RestorePlan } from "./restorePlan";
import type { BackupFiles } from "./types";

const databases: AyaseDatabase[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const db of databases.splice(0)) await db.delete(); });

describe("pre-#93 backup gate with only drawing presets", () => {
  it("blocks snapshot and restore before file, journal, preference or chat writes", async () => {
    const db = new AyaseDatabase(`backup-presets-${crypto.randomUUID()}`); databases.push(db);
    const values = new Map<string, string>(), storage = { getItem: (key: string) => values.get(key) ?? null,
      setItem: vi.fn((key: string, value: string) => { values.set(key, value); }), removeItem: vi.fn((key: string) => { values.delete(key); }) };
    const repository = new BackupRepository(db, storage), before = await repository.snapshot();
    const plan: RestorePlan = { after: { ...before, preferences: { ...before.preferences, "ayase-studio.appearance.v1": "changed" } },
      writes: [{ reference: "attachments/synthetic.txt", data: "synthetic" }], conflicts: 0, warnings: [] };
    const files: BackupFiles = { read: vi.fn(async () => ""), assertAvailable: vi.fn(async () => {}),
      write: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
    const presets = new DexieDrawingPresetRepository(db), preset = await presets.create({ name: "only preset", content: "text" });
    expect(await db.drawingDrafts.count()).toBe(0); expect(await db.drawingTasks.count()).toBe(0); expect(await db.drawingResults.count()).toBe(0);
    await expect(repository.snapshot()).rejects.toThrow(drawingBackupBlockedMessage);
    await expect(repository.restore(plan, before, files)).rejects.toThrow(drawingBackupBlockedMessage);
    expect(await presets.load()).toEqual([preset]); expect(await db.backupJournal.count()).toBe(0);
    expect(await db.chats.count()).toBe(0); expect(storage.setItem).not.toHaveBeenCalled(); expect(storage.removeItem).not.toHaveBeenCalled();
    expect(files.assertAvailable).not.toHaveBeenCalled(); expect(files.write).not.toHaveBeenCalled(); expect(files.remove).not.toHaveBeenCalled();
    await presets.remove(preset.id);
    expect(await repository.snapshot()).toEqual(before);
  });
});
