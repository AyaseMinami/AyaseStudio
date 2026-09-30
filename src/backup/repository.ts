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
    return db.transaction("r", backupTables.map(t => db.table(t)), async () => {
      const preferences = Object.fromEntries(allPreferenceKeys.map(k => [k, this.storage.getItem(k)]));
      const rows = Object.fromEntries(await Promise.all(backupTables.map(async t => [t, await db.table(t).toArray()])));
      return { rows: rows as unknown as BackupRows, preferences };
    });
  }
  private async replaceRows(rows: BackupRows) {
    for (const t of backupTables) { await this.database.table(t).clear(); if (rows[t].length) await this.database.table(t).bulkPut(rows[t]); }
  }
  private preferences(values: Record<string, string | null>) {
    for (const k of allPreferenceKeys) { const v = values[k]; if (v == null) this.storage.removeItem(k); else this.storage.setItem(k, v); }
  }
  async recover(files: BackupFiles): Promise<boolean> {
    const db = this.database, journal = await db.backupJournal.get("restore");
    if (!journal) return false;
    // Restore durable references first; only then remove journal-owned new files.
    await db.transaction("rw", backupTables.map(t => db.table(t)), () => this.replaceRows(journal.before.rows));
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
      await db.transaction("rw", [...backupTables.map(t => db.table(t)), db.backupJournal], async () => {
        await this.replaceRows(plan.after.rows);
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
