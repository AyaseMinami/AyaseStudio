import { AyaseDatabase } from "../storage/database";
import { backupTables, type BackupFiles, type BackupRows } from "./types";
import { allPreferenceKeys, type LocalSnapshot } from "./snapshot";
import type { RestorePlan } from "./restorePlan";
import { BackupRecoveryError } from "./errors";

export interface BackupJournal { id: "restore"; before: LocalSnapshot; references: string[]; phase: "staging" | "applying" }
export interface BackupStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export class BackupRepository {
  constructor(readonly database = new AyaseDatabase("AyaseStudio"), private storage: BackupStorage = localStorage) {}
  async snapshot(): Promise<LocalSnapshot> {
    const db = this.database;
    return db.transaction("r", [...backupTables.map(t => db.table(t)), db.drawingDrafts, db.drawingPromptPresets, db.drawingTasks, db.drawingResults, db.backupJournal], async () => {
      if (await db.backupJournal.get("restore")) throw new BackupRecoveryError();
      const preferences = Object.fromEntries(allPreferenceKeys.map(k => [k, this.storage.getItem(k)]));
      const rows = Object.fromEntries(await Promise.all(backupTables.map(async t => [t, await db.table(t).toArray()])));
      const targets: NonNullable<LocalSnapshot["drawing"]>["targets"] = [];
      const seen = new Set<string>();
      const retain = (p: { configuredModelId: string; providerId: string; connectionId: string; protocol: string; baseUrl: string; modelId: string }) => {
        const identity = JSON.stringify([p.configuredModelId, p.providerId, p.connectionId, p.protocol, p.baseUrl, p.modelId]);
        if (!seen.has(identity)) { seen.add(identity); targets.push({ modelId: p.configuredModelId, providerId: p.providerId, connectionId: p.connectionId, protocol: p.protocol, baseUrl: p.baseUrl, upstreamModelId: p.modelId }); }
      };
      // Persisted stages may be stale after a crash. The maintenance root has no
      // drawing controller; the live command gate and native fence establish quiescence.
      await db.drawingTasks.each(t => retain(t.parameters));
      await db.drawingResults.each(t => retain(t.parameters));
      return { rows: rows as unknown as BackupRows, preferences,
        drawing: { draft: await db.drawingDrafts.get("current"), presets: await db.drawingPromptPresets.toArray(), targets } };
    });
  }
  private async replaceRows(rows: BackupRows) {
    for (const t of backupTables) { await this.database.table(t).clear(); if (rows[t].length) await this.database.table(t).bulkPut(rows[t]); }
  }
  private async replaceDrawing(drawing: LocalSnapshot["drawing"]) {
    if (!drawing) return; // Historical journals never captured this scope.
    if (drawing.draft) await this.database.drawingDrafts.put(drawing.draft);
    else await this.database.drawingDrafts.delete("current");
    await this.database.drawingPromptPresets.clear();
    if (drawing.presets.length) await this.database.drawingPromptPresets.bulkPut(drawing.presets);
  }
  private preferences(values: Record<string, string | null>) {
    // Missing keys in older journals are outside their captured scope, not deletion instructions.
    for (const k of allPreferenceKeys) { if (!(k in values)) continue; const v = values[k]; if (v == null) this.storage.removeItem(k); else this.storage.setItem(k, v); }
  }
  async recover(files: BackupFiles): Promise<boolean> {
    const db = this.database, journal = await db.backupJournal.get("restore");
    if (!journal) return false;
    // Restore durable references first; only then remove journal-owned new files.
    await db.transaction("rw", [...backupTables.map(t => db.table(t)), db.drawingDrafts, db.drawingPromptPresets], async () => {
      await this.replaceRows(journal.before.rows); await this.replaceDrawing(journal.before.drawing);
    });
    this.preferences(journal.before.preferences);
    await files.remove(journal.references);
    await db.backupJournal.delete("restore");
    return true;
  }
  async restore(plan: RestorePlan, before: LocalSnapshot, files: BackupFiles): Promise<void> {
    const db = this.database;
    if (await db.backupJournal.get("restore")) throw new Error("上次恢复尚未回滚，请重启或重试恢复整理。");
    // A UUID collision must fail before any journal-owned deletion can be scheduled.
    await files.assertAvailable(plan.writes.map(w => w.reference));
    await db.backupJournal.add({ id: "restore", before, references: plan.writes.map(w => w.reference), phase: "staging" });
    try {
      for (const w of plan.writes) await files.write(w.reference, w.data);
      await db.transaction("rw", [...backupTables.map(t => db.table(t)), db.drawingDrafts, db.drawingPromptPresets, db.backupJournal], async () => {
        await this.replaceRows(plan.after.rows);
        await this.replaceDrawing(plan.after.drawing);
        await db.backupJournal.update("restore", { phase: "applying" });
      });
      this.preferences(plan.after.preferences);
      // This atomic deletion is the commit point across all three storage media.
      await db.backupJournal.delete("restore");
    } catch {
      try { await this.recover(files); } catch { throw new BackupRecoveryError(); }
      throw new Error("恢复失败，本次变更已回滚；现有数据保持不变。");
    }
  }
}
