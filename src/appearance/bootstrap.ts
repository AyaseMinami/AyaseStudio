import { applyBrowserInitialAppearance } from "./browser";
import { recoverBackupAtStartup } from "../backup/runtime";
import { loadConnectionSettings } from "../chat/settings";

export function verifyStartupConfiguration(): void {
  // Maintenance can repair supported data through an explicit restore; normal controllers stay unmounted on read failure.
  if (window.location.hash !== "#backup") loadConnectionSettings();
}

// Repair interrupted multi-store restore before any controller can clean files
// or publish mixed database/preferences state.
export const startup = recoverBackupAtStartup().then(() => { verifyStartupConfiguration(); applyBrowserInitialAppearance(); });
// main owns the visible retry state; suppress a premature unhandled rejection.
void startup.catch(() => undefined);
