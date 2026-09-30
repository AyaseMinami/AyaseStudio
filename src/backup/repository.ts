import { AyaseDatabase } from "../storage/database";
import { backupTables, type BackupFiles, type BackupRows } from "./types";
import { allPreferenceKeys, type LocalSnapshot } from "./snapshot";
import type { RestorePlan } from "./restorePlan";
import { BackupRecoveryError } from "./errors";
import { SEARCH_SETTINGS_KEY } from "../search/settings";
import { connectionSettingsStorageKey } from "../chat/settings";
import { isDrawingProtocol } from "../chat/protocolOptions";

export const drawingBackupBlockedMessage = "当前备份格式尚未包含绘图数据；为防止遗漏成果或覆盖配置，暂时禁止备份与恢复，等待 #93 扩展格式。";

export interface BackupJournal { id: "restore"; before: LocalSnapshot; references: string[]; phase: "staging" | "applying" }
export interface BackupStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export class BackupRepository {
  constructor(readonly database = new AyaseDatabase("AyaseStudio"), private storage: BackupStorage = localStorage) {}
  private async assertDrawingAbsent(): Promise<void> {
    const db = this.database;
    const hasData = await db.transaction("r", [db.drawingDrafts, db.drawingTasks, db.drawingResults], async () =>
      (await db.drawingDrafts.count()) > 0 || (await db.drawingTasks.count()) > 0 || (await db.drawingResults.count()) > 0);
    let configured = false;
    try {
      const settings = JSON.parse(this.storage.getItem(connectionSettingsStorageKey) ?? "null");
      configured = settings?.providers?.some((provider: { connections?: { protocol?: string }[] }) =>
        provider.connections?.some(connection => isDrawingProtocol(connection.protocol))) === true;
    } catch { throw new Error("连接配置读取失败，无法安全进入数据维护。"); }
    if (hasData || configured) throw new Error(drawingBackupBlockedMessage);
  }
  async snapshot(): Promise<LocalSnapshot> {
    await this.assertDrawingAbsent();
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
    // Older journals predate search settings and must not erase settings they never captured.
    for (const k of allPreferenceKeys) { if (k === SEARCH_SETTINGS_KEY && !(k in values)) continue; const v = values[k]; if (v == null) this.storage.removeItem(k); else this.storage.setItem(k, v); }
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
    await this.assertDrawingAbsent();
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
