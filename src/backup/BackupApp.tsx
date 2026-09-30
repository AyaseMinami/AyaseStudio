import { useEffect, useState } from "react";
import App from "../App";
import { startup } from "../appearance/bootstrap";
import { applyBrowserInitialAppearance } from "../appearance/browser";
import { BackupWorkspace } from "../ui/settings/BackupWorkspace";
import { recoverBackupAtStartup, createBackupApi } from "./runtime";

const backupApi = createBackupApi();
export function BackupApp() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => { let alive = true; void startup.then(() => { if (alive) setReady(true); }, () => { if (alive) setError(true); }); return () => { alive = false; }; }, []);
  async function retry() {
    setError(false);
    try { await recoverBackupAtStartup(); applyBrowserInitialAppearance(); setReady(true); }
    catch { setError(true); }
  }
  if (!ready) return <main className="settings-page"><p role={error ? "alert" : "status"}>{error
    ? "上次数据恢复尚未完成回滚。请重试整理；在完成前无法编辑应用数据。" : "正在检查本地数据一致性…"}</p>
    {error && <button type="button" className="settings-button" onClick={() => void retry()}>重试整理</button>}</main>;
  if (window.location.hash === "#backup") return <BackupWorkspace api={backupApi} onExit={() => { window.location.hash = "data"; window.location.reload(); }} />;
  return <App />;
}
