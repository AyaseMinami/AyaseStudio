import { useEffect, useRef, useState } from "react";
import { Minus, Square, Copy, X } from "lucide-react";
import { getWindowController, type WindowController } from "./windowController";
import "./WindowControls.css";

export function WindowControls() {
  const [controller] = useState(getWindowController);
  const [visible, setVisible] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  useEffect(() => {
    if (!controller) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let revision = 0;
    const refresh = async () => {
      const current = ++revision;
      try {
        const value = await controller.isMaximized();
        if (!disposed && current === revision) setMaximized(value);
      } catch {
        if (!disposed) setError("无法读取窗口状态");
      }
    };
    void (async () => {
      try {
        // Native decorations can be restored without showing duplicate controls.
        const decorated = await controller.isDecorated();
        if (disposed || decorated) return;
        setVisible(true);
        const stop = await controller.onResize(() => void refresh());
        if (disposed) { stop(); return; }
        unlisten = stop;
        await refresh();
      } catch {
        if (!disposed) setError("无法连接窗口控件");
      }
    })();
    return () => { disposed = true; unlisten?.(); };
  }, [controller]);

  async function run(action: "minimize" | "toggleMaximize" | "close", window: WindowController) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try { await window[action](); }
    catch { setError("窗口操作失败，请重试"); }
    finally { pending.current = false; setBusy(false); }
  }

  if (!controller || !visible) return null;
  return <div className="window-controls" role="group" aria-label="窗口操作">
    <button type="button" aria-label="最小化窗口" title="最小化" disabled={busy}
      onClick={() => void run("minimize", controller)}><Minus size={15} aria-hidden="true" /></button>
    <button type="button" aria-label={maximized ? "还原窗口" : "最大化窗口"}
      title={maximized ? "还原" : "最大化"} disabled={busy}
      onClick={() => void run("toggleMaximize", controller)}>
      {maximized ? <Copy size={13} aria-hidden="true" /> : <Square size={13} aria-hidden="true" />}
    </button>
    <button className="window-close" type="button" aria-label="关闭窗口" title="关闭" disabled={busy}
      onClick={() => void run("close", controller)}><X size={17} aria-hidden="true" /></button>
    {error && <span className="window-control-error" role="alert">{error}</span>}
  </div>;
}
