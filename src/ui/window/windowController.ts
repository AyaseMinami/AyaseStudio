import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** The only native window dependency used by the titlebar. */
export interface WindowController {
  isDecorated(): Promise<boolean>;
  isMaximized(): Promise<boolean>;
  onResize(listener: () => void): Promise<() => void>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
}

export function getWindowController(): WindowController | undefined {
  if (!isTauri()) return undefined;
  const window = getCurrentWindow();
  return {
    isDecorated: () => window.isDecorated(),
    isMaximized: () => window.isMaximized(),
    onResize: (listener) => window.onResized(listener),
    minimize: () => window.minimize(),
    toggleMaximize: () => window.toggleMaximize(),
    close: () => window.close(),
  };
}
