import { useEffect, useState } from "react";
import App from "../App";
import { startup, verifyStartupConfiguration } from "../appearance/bootstrap";
import { applyBrowserInitialAppearance } from "../appearance/browser";
import { BackupWorkspace } from "../ui/settings/BackupWorkspace";
import { recoverBackupAtStartup, createBackupApi } from "./runtime";
import { useDefaultContextMenuPolicy } from "../ui/ActionMenu";
import { useGeneralSettings } from "../general/preferences";
import { useApplicationLifecycle } from "../general/useApplicationLifecycle";
import { useConfirmation } from "../ui/useConfirmation";

const backupApi = createBackupApi();
export function BackupApp() {
  useDefaultContextMenuPolicy();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const general = useGeneralSettings();
  const exitConfirmation = useConfirmation();
  const registerExitGuard = useApplicationLifecycle(general, exitConfirmation.confirm,
    () => (ready || error) && window.location.hash !== "#backup");
  useEffect(() => { let alive = true; void startup.then(() => { if (alive) setReady(true); }, () => { if (alive) setError(true); }); return () => { alive = false; }; }, []);
  async function retry() {
    setError(false);
    try { await recoverBackupAtStartup(); verifyStartupConfiguration(); applyBrowserInitialAppearance(); setReady(true); }
    catch { setError(true); }
  }
  if (!ready) return <>{exitConfirmation.dialog}<main className="settings-page"><p role={error ? "alert" : "status"}>{error
    ? "本地配置无法安全读取，或上次恢复尚未完成回滚。原数据已保留，请升级应用或修复后重试；在完成前无法编辑应用数据。" : "正在检查本地数据一致性…"}</p>
    {error && <><button type="button" className="settings-button" onClick={() => void retry()}>重试整理</button>
      <button type="button" className="settings-button" onClick={() => { window.location.hash = "backup"; window.location.reload(); }}>恢复 Ayase 备份</button></>}</main></>;
  if (window.location.hash === "#backup") return <>{exitConfirmation.dialog}<BackupWorkspace api={backupApi} onExit={() => { window.location.hash = "data"; window.location.reload(); }} /></>;
  return <>{exitConfirmation.dialog}<App general={general} registerExitGuard={registerExitGuard} /></>;
}
