import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { drawingOutputError, getDrawingOutputDirectorySettings, openDrawingOutputDirectory,
  resetDrawingOutputDirectory, selectDrawingOutputDirectory, type DrawingOutputDirectorySettings } from "../../drawing/outputDirectory";
import "./DrawingOutputSettings.css";

type Operation = "load" | "select" | "reset" | "open";
const progress: Record<Operation, string> = {
  load: "正在读取输出目录…", select: "正在选择输出文件夹…", reset: "正在恢复默认目录…", open: "正在打开输出文件夹…",
};

export function DrawingOutputSettings() {
  const native = isTauri();
  const [settings, setSettings] = useState<DrawingOutputDirectorySettings>();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<Operation | null>(native ? "load" : null);
  const [error, setError] = useState<string>();
  const active = useRef(false);
  const busyRef = useRef(false);
  const request = useRef(0);

  async function run(operation: Operation) {
    if (!native || !active.current || busyRef.current || (operation !== "load" && !ready)) return;
    busyRef.current = true;
    const current = ++request.current;
    setBusy(operation);
    setError(undefined);
    try {
      let next: DrawingOutputDirectorySettings | null | undefined;
      switch (operation) {
        case "load": next = await getDrawingOutputDirectorySettings(); break;
        case "select": next = await selectDrawingOutputDirectory(); break;
        case "reset": next = await resetDrawingOutputDirectory(); break;
        case "open": await openDrawingOutputDirectory(); break;
      }
      if (!active.current || current !== request.current) return;
      if (next) { setSettings(next); setReady(true); }
    } catch (cause) {
      if (!active.current || current !== request.current) return;
      const message = drawingOutputError(cause);
      setError(message);
      if (operation === "load" || message === drawingOutputError("drawing-output-config")) setReady(false);
    } finally {
      if (active.current && current === request.current) { busyRef.current = false; setBusy(null); }
    }
  }

  useEffect(() => {
    active.current = true;
    if (native) void run("load");
    return () => { active.current = false; busyRef.current = false; request.current++; };
  }, [native]);

  const disabled = !native || !ready || !!busy;
  return <section className="settings-card general-settings-group drawing-output-settings" aria-labelledby="drawing-output-settings-title" aria-busy={!!busy}>
    <h3 id="drawing-output-settings-title">绘图输出</h3>
    <div className="drawing-output-directory">
      <span className="muted-text">当前目录{settings && ` · ${settings.isDefault ? "默认目录" : "自定义目录"}`}</span>
      <output aria-label="当前绘图输出目录">{settings?.directory ?? (native ? "尚未读取输出目录" : "仅桌面应用可用")}</output>
    </div>
    <div className="drawing-output-actions">
      <button type="button" className="settings-button" aria-label="选择绘图输出文件夹" disabled={disabled} onClick={() => void run("select")}>选择文件夹</button>
      <button type="button" className="settings-button" aria-label="打开绘图输出文件夹" disabled={disabled} onClick={() => void run("open")}>打开文件夹</button>
      <button type="button" className="settings-button" aria-label="恢复默认绘图输出目录" disabled={disabled || !!settings?.isDefault} onClick={() => void run("reset")}>恢复默认</button>
      {error && <button type="button" className="settings-button" aria-label="重新加载绘图输出设置" disabled={!native || !!busy} onClick={() => void run("load")}>重新加载</button>}
    </div>
    <p className="muted-text drawing-output-note">更改目录仅影响之后创建的绘图任务，已有文件保留在原位置。目录设置仅用于本机，不随备份迁移。</p>
    {!native && <p className="muted-text drawing-output-note">请在桌面应用中设置或打开绘图输出文件夹。</p>}
    {busy && <p className="muted-text drawing-output-note" role="status">{progress[busy]}</p>}
    {error && <p className="error-banner" role="alert">{error}</p>}
  </section>;
}
