import { useSyncExternalStore } from "react";

import type { BackgroundFit, ColorPreset, ThemeMode } from "./appearance";
import type { BackgroundFocus } from "./backgroundFocus";
import { getBrowserAppearanceController } from "./browser";

export function useAppearance() {
  const controller = getBrowserAppearanceController();
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );

  return {
    ...snapshot,
    setUnifiedThemeColor: (color: string | null) => controller.setUnifiedThemeColor(color),
    setUserBubbleColor: (color: string | null) => controller.setUserBubbleColor(color),
    setColorPreset: (preset: ColorPreset) => controller.setColorPreset(preset),
    setThemeMode: (themeMode: ThemeMode) =>
      controller.setThemeMode(themeMode),
    setAccentColor: (color: string | null) =>
      controller.setAccentColor(color),
    setCanvasColor: (color: string | null) =>
      controller.setCanvasColor(color),
    setAssistantBubbleColor: (color: string | null) => controller.setAssistantBubbleColor(color),
    setUnifiedTransparency: (value: number | null) => controller.setUnifiedTransparency(value),
    setChromeTransparency: (value: number) => controller.setChromeTransparency(value),
    setSidebarTransparency: (value: number) => controller.setSidebarTransparency(value),
    setComposerTransparency: (value: number) => controller.setComposerTransparency(value),
    setSidebarGlassEnabled: (enabled: boolean) => controller.setSidebarGlassEnabled(enabled),
    setComposerGlassEnabled: (enabled: boolean) => controller.setComposerGlassEnabled(enabled),
    setAssistantBubbleTransparency: (value: number) => controller.setAssistantBubbleTransparency(value),
    setBackgroundFit: (fit: BackgroundFit) =>
      controller.setBackgroundFit(fit),
    setBackgroundMask: (mask: number) =>
      controller.setBackgroundMask(mask),
    setBackgroundBlur: (blur: number) =>
      controller.setBackgroundBlur(blur),
    selectBackground: () => controller.selectBackground(),
    editBackgroundFocus: () => controller.editBackgroundFocus(),
    confirmBackgroundFocus: (focus: BackgroundFocus) => controller.confirmBackgroundFocus(focus),
    cancelBackgroundFocus: () => controller.cancelBackgroundFocus(),
    removeBackground: () => controller.removeBackground(),
    resetCustomAppearance: () => controller.resetCustomAppearance(),
    prepareLibraryBackground: controller.prepareLibraryBackground,
    saveLibraryBackground: controller.saveLibraryBackground,
    discardLibraryBackground: controller.discardLibraryBackground,
    resolveLibraryBackground: controller.resolveLibraryBackground,
    applyLibraryBackground: controller.applyLibraryBackground,
    removeLibraryBackgrounds: controller.removeLibraryBackgrounds,
    restoreBackground: controller.restoreBackground,
  };
}
