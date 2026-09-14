import {
  applyInitialAppearance,
  createAppearanceController,
  type AppearanceController,
  type SystemThemeSource,
} from "./appearance";

export const darkModeMediaQuery = "(prefers-color-scheme: dark)";

export function createBrowserSystemThemeSource(
  mediaQuery: MediaQueryList,
): SystemThemeSource {
  return {
    isDark: () => mediaQuery.matches,
    subscribe(listener) {
      const handleChange = (event: MediaQueryListEvent) => listener(event.matches);
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    },
  };
}

export function applyBrowserInitialAppearance(): void {
  const mediaQuery = window.matchMedia(darkModeMediaQuery);
  applyInitialAppearance({
    storage: window.localStorage,
    systemPrefersDark: mediaQuery.matches,
    target: document.documentElement,
  });
}

let browserController: AppearanceController | undefined;

export function getBrowserAppearanceController(): AppearanceController {
  browserController ??= createAppearanceController({
    storage: window.localStorage,
    systemTheme: createBrowserSystemThemeSource(
      window.matchMedia(darkModeMediaQuery),
    ),
    target: document.documentElement,
  });
  return browserController;
}
