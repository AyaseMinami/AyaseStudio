export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = Exclude<ThemeMode, "system">;

export interface AppearancePreferences {
  themeMode: ThemeMode;
  settingsOpen: boolean;
}

export interface AppearanceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ThemeTarget {
  style: { colorScheme: string };
  setAttribute(name: string, value: string): void;
}

export interface SystemThemeSource {
  isDark(): boolean;
  subscribe(listener: (prefersDark: boolean) => void): () => void;
}

export interface AppearanceSnapshot extends AppearancePreferences {
  resolvedTheme: ResolvedTheme;
}

export interface AppearanceController {
  getSnapshot(): AppearanceSnapshot;
  subscribe(listener: () => void): () => void;
  setThemeMode(themeMode: ThemeMode): void;
  setSettingsOpen(settingsOpen: boolean): void;
  destroy(): void;
}

export const APPEARANCE_STORAGE_KEY = "ayase-studio.appearance.v1";

export const defaultAppearancePreferences: Readonly<AppearancePreferences> = {
  themeMode: "system",
  settingsOpen: true,
};

export function loadAppearancePreferences(
  storage: AppearanceStorage,
): AppearancePreferences {
  try {
    const stored = JSON.parse(
      storage.getItem(APPEARANCE_STORAGE_KEY) ?? "null",
    ) as Partial<AppearancePreferences> | null;

    if (stored === null || typeof stored !== "object") {
      return { ...defaultAppearancePreferences };
    }

    return {
      themeMode:
        stored.themeMode === "light" ||
        stored.themeMode === "dark" ||
        stored.themeMode === "system"
          ? stored.themeMode
          : defaultAppearancePreferences.themeMode,
      settingsOpen:
        typeof stored.settingsOpen === "boolean"
          ? stored.settingsOpen
          : defaultAppearancePreferences.settingsOpen,
    };
  } catch {
    return { ...defaultAppearancePreferences };
  }
}

export function saveAppearancePreferences(
  storage: AppearanceStorage,
  preferences: AppearancePreferences,
): void {
  storage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(preferences));
}

export function resolveTheme(
  themeMode: ThemeMode,
  systemPrefersDark: boolean,
): ResolvedTheme {
  return themeMode === "system"
    ? systemPrefersDark
      ? "dark"
      : "light"
    : themeMode;
}

export function applyResolvedTheme(
  target: ThemeTarget,
  resolvedTheme: ResolvedTheme,
): void {
  target.setAttribute("data-theme", resolvedTheme);
  target.style.colorScheme = resolvedTheme;
}

export function applyInitialAppearance({
  storage,
  systemPrefersDark,
  target,
}: {
  storage: AppearanceStorage;
  systemPrefersDark: boolean;
  target: ThemeTarget;
}): AppearanceSnapshot {
  const preferences = loadAppearancePreferences(storage);
  const snapshot = {
    ...preferences,
    resolvedTheme: resolveTheme(preferences.themeMode, systemPrefersDark),
  };
  applyResolvedTheme(target, snapshot.resolvedTheme);
  return snapshot;
}

export function createAppearanceController({
  storage,
  systemTheme,
  target,
}: {
  storage: AppearanceStorage;
  systemTheme: SystemThemeSource;
  target: ThemeTarget;
}): AppearanceController {
  let snapshot = applyInitialAppearance({
    storage,
    systemPrefersDark: systemTheme.isDark(),
    target,
  });
  let preferences: AppearancePreferences = {
    themeMode: snapshot.themeMode,
    settingsOpen: snapshot.settingsOpen,
  };
  const listeners = new Set<() => void>();

  function notify(): void {
    listeners.forEach((listener) => listener());
  }

  function updatePreferences(next: AppearancePreferences): void {
    preferences = next;
    snapshot = {
      ...preferences,
      resolvedTheme: resolveTheme(preferences.themeMode, systemTheme.isDark()),
    };
    applyResolvedTheme(target, snapshot.resolvedTheme);
    try {
      saveAppearancePreferences(storage, preferences);
    } catch {
      // Appearance changes remain usable if local storage is unavailable.
    }
    notify();
  }

  const unsubscribeFromSystem = systemTheme.subscribe((prefersDark) => {
    if (preferences.themeMode !== "system") {
      return;
    }
    const resolvedTheme = resolveTheme(preferences.themeMode, prefersDark);
    if (resolvedTheme === snapshot.resolvedTheme) {
      return;
    }
    snapshot = { ...snapshot, resolvedTheme };
    applyResolvedTheme(target, resolvedTheme);
    notify();
  });

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setThemeMode(themeMode) {
      if (themeMode !== preferences.themeMode) {
        updatePreferences({ ...preferences, themeMode });
      }
    },
    setSettingsOpen(settingsOpen) {
      if (settingsOpen !== preferences.settingsOpen) {
        updatePreferences({ ...preferences, settingsOpen });
      }
    },
    destroy() {
      unsubscribeFromSystem();
      listeners.clear();
    },
  };
}
