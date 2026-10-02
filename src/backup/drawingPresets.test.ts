import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AyaseDatabase } from "../storage/database";
import { DexieDrawingPresetRepository } from "../drawing/presets";
import { BackupRepository } from "./repository";
import type { RestorePlan } from "./restorePlan";
import type { BackupFiles } from "./types";

const databases: AyaseDatabase[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const db of databases.splice(0)) await db.delete(); });

describe("#93 snapshot with only drawing presets", () => {
  it("captures explicit presets in the private snapshot without altering existing data", async () => {
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
    expect((await repository.snapshot()).drawing?.presets).toEqual([preset]);
    expect(plan.writes).toHaveLength(1); // Merely preparing an internal plan has no effects.
    expect(await presets.load()).toEqual([preset]); expect(await db.backupJournal.count()).toBe(0);
    expect(await db.chats.count()).toBe(0); expect(storage.setItem).not.toHaveBeenCalled(); expect(storage.removeItem).not.toHaveBeenCalled();
    expect(files.assertAvailable).not.toHaveBeenCalled(); expect(files.write).not.toHaveBeenCalled(); expect(files.remove).not.toHaveBeenCalled();
    await presets.remove(preset.id);
    expect(await repository.snapshot()).toEqual(before);
  });
});
