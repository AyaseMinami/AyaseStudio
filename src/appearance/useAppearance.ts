import { useSyncExternalStore } from "react";

import type { BackgroundFit, ThemeMode } from "./appearance";
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
    setAccentColor: (color: string | null) =>
      controller.setAccentColor(color),
    setCanvasColor: (color: string | null) =>
      controller.setCanvasColor(color),
    setBackgroundFit: (fit: BackgroundFit) =>
      controller.setBackgroundFit(fit),
    setBackgroundMask: (mask: number) =>
      controller.setBackgroundMask(mask),
    setBackgroundBlur: (blur: number) =>
      controller.setBackgroundBlur(blur),
    selectBackground: () => controller.selectBackground(),
    removeBackground: () => controller.removeBackground(),
    resetCustomAppearance: () => controller.resetCustomAppearance(),
  };
}
