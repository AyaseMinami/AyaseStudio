import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { LogOut, PanelTop, Settings } from "lucide-react";

type TrayAction = "open" | "settings" | "exit" | "dismiss" | "ready";
const items = [
  { action: "open", label: "打开 Ayase Studio", Icon: PanelTop },
  { action: "settings", label: "设置", Icon: Settings },
  { action: "exit", label: "退出", Icon: LogOut },
] as const;

async function sendAction(action: TrayAction): Promise<void> {
  if (isTauri()) await invoke("tray_menu_action", { action });
}

export function TrayMenu() {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const focusFirst = () => buttons.current[0]?.focus();

  useEffect(() => {
    let mounted = true;
    focusFirst();
    window.addEventListener("focus", focusFirst);
    void sendAction("ready").catch(() => {
      if (mounted) setError("菜单初始化失败");
    });
    return () => { mounted = false; window.removeEventListener("focus", focusFirst); };
  }, []);

  const run = async (action: TrayAction) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try { await sendAction(action); }
    catch { setError("操作失败，请重试"); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      void run("dismiss");
      return;
    }
    const current = buttons.current.findIndex(button => button === document.activeElement);
    let next: number;
    switch (event.key) {
      case "Home": next = 0; break;
      case "End": next = items.length - 1; break;
      case "ArrowDown": next = (current + 1) % items.length; break;
      case "ArrowUp": next = (current + items.length - 1) % items.length; break;
      case "Tab": next = (current + (event.shiftKey ? items.length - 1 : 1)) % items.length; break;
      default: return;
    }
    event.preventDefault();
    buttons.current[next]?.focus();
  };

  return <div className="tray-window" onKeyDown={onKeyDown}>
    <div className="tray-menu" role="menu" aria-label="Ayase Studio 托盘菜单" aria-busy={busy} aria-describedby="tray-status">
      {items.map(({ action, label, Icon }, index) => <div key={action}>
        {action === "exit" && <div className="tray-divider" role="separator" />}
        <button ref={button => { buttons.current[index] = button; }} type="button" role="menuitem"
          className={action === "exit" ? "tray-item tray-item-danger" : "tray-item"}
          aria-label={label} aria-disabled={busy} onClick={() => { void run(action); }}>
          <Icon size={17} strokeWidth={1.75} aria-hidden="true" /><span>{label}
            {index === 0 && <span id="tray-status" className="tray-status" role="status" aria-live="polite">{error}</span>}
          </span>
        </button>
      </div>)}
    </div>
  </div>;
}
