import { invoke, isTauri } from "@tauri-apps/api/core";
import { BackupRepository } from "./repository";
import { createBackupDocument } from "./snapshot";
import { createRestorePlan } from "./restorePlan";
import { check, decodeBackup, decode64, encodeBackup, readBackupDocument } from "./codec";
import { decodeAvatar } from "../avatar/image";
import type { BackupDocument, BackupFiles, BackupPreview, RestoreMode } from "./types";
import type { BackupWorkspaceApi } from "../ui/settings/BackupWorkspace";
import { checkImageBudget } from "./imageBudget";
import { BackupRecoveryError } from "./errors";

export const nativeBackupFiles: BackupFiles = {
  read: reference => invoke("read_ayase_resource", { reference }),
  assertAvailable: references => invoke("assert_ayase_resources_available", { references }),
  write: (reference, data) => invoke("write_ayase_resource", { reference, data }),
  remove: references => invoke("remove_ayase_resources", { references }),
};
async function images(document: BackupDocument) {
  for (const asset of document.assets) if (asset.mime.startsWith("image/")) {
    const bytes = decode64(asset.data, asset.size);
    checkImageBudget(bytes, asset.mime);
    const image = await decodeAvatar(new Blob([bytes], { type: asset.mime }));
    check(image.naturalWidth > 0 && image.naturalHeight > 0 && image.naturalWidth * image.naturalHeight <= 40_000_000, "备份图片损坏或像素数过大。");
    image.src = "";
  }
}
// All operations here are invoked only in a freshly reloaded maintenance root,
// before chat, avatar and appearance controllers have been mounted.
export function createBackupApi(repository = new BackupRepository(), files = nativeBackupFiles): BackupWorkspaceApi {
  let running = false, failed = false;
  async function exclusive<T>(action: () => Promise<T>): Promise<T> {
    check(!running && !failed, "请等待当前操作完成，或重新进入数据管理以完成回滚。");
    running = true;
    try { return await action(); } finally { running = false; }
  }
  async function plan(preview: BackupPreview, mode: RestoreMode) {
    check(["merge", "copy", "replace"].includes(mode));
    const document = await readBackupDocument(preview.document);
    await images(document);
    const before = await repository.snapshot();
    return { before, plan: createRestorePlan(document, before, mode) };
  }
  return {
    exportBackup: (options, password, confirmation) => exclusive(async () => {
      check(isTauri(), "请在桌面应用中保存备份。");
      const document = await createBackupDocument(await repository.snapshot(), { connections: true, credentials: true }, files);
      await images(document);
      const serialized = await encodeBackup(document, options.encrypted, password, confirmation);
      const preview = await decodeBackup(serialized, password);
      const saved = await invoke<boolean>("save_ayase_backup", { data: serialized });
      return { saved, preview };
    }),
    selectBackup: () => exclusive(() => invoke<string | null>("select_ayase_backup")),
    inspect: (serialized, password) => exclusive(async () => { const preview = await decodeBackup(serialized, password); await images(preview.document); return preview; }),
    conflicts: (preview, mode) => exclusive(async () => { const result = await plan(preview, mode); return { conflicts: result.plan.conflicts, warnings: result.plan.warnings }; }),
    restore: (preview, mode) => exclusive(async () => {
      const prepared = await plan(preview, mode);
      try { await repository.restore(prepared.plan, prepared.before, files); }
      catch (error) {
        if (error instanceof BackupRecoveryError) { failed = true; throw error; }
        try { failed = Boolean(await repository.database.backupJournal.get("restore")); }
        catch { failed = true; }
        if (failed) throw new BackupRecoveryError();
        throw error;
      }
      return prepared.plan.warnings;
    }),
  };
}
export async function recoverBackupAtStartup(): Promise<boolean> {
  if (isTauri()) await invoke("ayase_backup_fence");
  return new BackupRepository().recover(nativeBackupFiles);
}
