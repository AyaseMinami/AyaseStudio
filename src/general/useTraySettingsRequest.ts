import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Subscribe at the root so a request during startup can wait for the protected workspace to be ready.
export function useTraySettingsRequest(): number {
  const [request, setRequest] = useState(0);
  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    let unlisten: (() => void) | undefined;
    void listen("ayase-open-settings", () => {
      if (alive) setRequest(value => value + 1);
    }).then(release => {
      if (alive) unlisten = release;
      else release();
    }).catch(() => {
      if (alive) window.alert("无法连接托盘设置入口，请重新打开应用。");
    });
    return () => { alive = false; unlisten?.(); };
  }, []);
  return request;
}
