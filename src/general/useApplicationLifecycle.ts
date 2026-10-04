import { useCallback, useEffect, useRef } from "react";
import { isTauri, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { ApplicationLifecycle, type ExitGuard, type RegisterExitGuard, type InstallUpdate } from "./lifecycle";
import type { GeneralSettingsState } from "./preferences";
import type { ConfirmationOptions } from "../ui/useConfirmation";

export function useApplicationLifecycle(settings: GeneralSettingsState,
  confirm: (options: ConfirmationOptions) => Promise<boolean>, canExit: () => boolean): { registerExitGuard: RegisterExitGuard; installUpdate: InstallUpdate } {
  const current = useRef({ settings, confirm, canExit });
  current.current = { settings, confirm, canExit };
  const owner = useRef<ApplicationLifecycle | null>(null);
  const guard = useRef<ExitGuard | undefined>(undefined);
  const releaseGuard = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    if (!isTauri()) return;
    const window = getCurrentWindow();
    const lifecycle = new ApplicationLifecycle({ hide: () => invoke("hide_main_window"), close: () => window.close(),
      onClose: handler => window.onCloseRequested(handler), onExit: handler => listen("ayase-request-exit", handler) },
    () => current.current.settings, options => current.current.confirm(options), message => globalThis.window.alert(message), () => current.current.canExit());
    owner.current = lifecycle;
    if (guard.current) releaseGuard.current = lifecycle.registerExitGuard(guard.current);
    void lifecycle.start().catch(() => globalThis.window.alert("无法连接窗口退出控制，请重新打开应用。"));
    return () => { lifecycle.dispose(); if (owner.current === lifecycle) owner.current = null; };
  }, []);
  const registerExitGuard: RegisterExitGuard = useCallback(guardValue => {
    guard.current = guardValue;
    releaseGuard.current = owner.current?.registerExitGuard(guardValue);
    return () => {
      if (guard.current === guardValue) {
        releaseGuard.current?.(); releaseGuard.current = undefined; guard.current = undefined;
      }
    };
  }, []);
  const installUpdate: InstallUpdate = useCallback(async install => owner.current ? owner.current.runForUpdate(install) : false, []);
  return { registerExitGuard, installUpdate };
}
