import { applyBrowserInitialAppearance } from "./browser";
import { recoverBackupAtStartup } from "../backup/runtime";

// Repair interrupted multi-store restore before any controller can clean files
// or publish mixed database/preferences state.
export const startup = recoverBackupAtStartup().then(() => applyBrowserInitialAppearance());
// main owns the visible retry state; suppress a premature unhandled rejection.
void startup.catch(() => undefined);
