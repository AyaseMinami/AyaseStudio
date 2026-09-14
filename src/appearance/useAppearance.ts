import { useSyncExternalStore } from "react";

import type { ThemeMode } from "./appearance";
import { getBrowserAppearanceController } from "./browser";

export function useAppearance() {
  const controller = getBrowserAppearanceController();
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );

  return {
    ...snapshot,
    setThemeMode: (themeMode: ThemeMode) =>
      controller.setThemeMode(themeMode),
    setSettingsOpen: (settingsOpen: boolean) =>
      controller.setSettingsOpen(settingsOpen),
  };
}
