import { describe, expect, it } from "vitest";

import {
  APPEARANCE_STORAGE_KEY,
  applyInitialAppearance,
  createAppearanceController,
  loadAppearancePreferences,
  saveAppearancePreferences,
  type SystemThemeSource,
  type ThemeTarget,
} from "./appearance";

function createThemeHarness(initiallyDark = false) {
  let dark = initiallyDark;
  let listener: ((prefersDark: boolean) => void) | undefined;
  const attributes = new Map<string, string>();
  const target: ThemeTarget = {
    style: { colorScheme: "" },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
  };
  const systemTheme: SystemThemeSource = {
    isDark: () => dark,
    subscribe(nextListener) {
      listener = nextListener;
      return () => {
        listener = undefined;
      };
    },
  };

  return {
    attributes,
    systemTheme,
    target,
    setSystemTheme(prefersDark: boolean) {
      dark = prefersDark;
      listener?.(dark);
    },
  };
}

describe("appearance preferences", () => {
  it("falls back to system theme when storage is empty", () => {
    const storage = {
      getItem: () => null,
      setItem: () => undefined,
    };

    expect(loadAppearancePreferences(storage)).toEqual({
      themeMode: "system",
    });
  });

  it("loads a valid persisted theme from the older preference shape", () => {
    const storage = {
      getItem: (key: string) =>
        key === APPEARANCE_STORAGE_KEY
          ? JSON.stringify({ themeMode: "dark", settingsOpen: false })
          : null,
      setItem: () => undefined,
    };

    expect(loadAppearancePreferences(storage)).toEqual({
      themeMode: "dark",
    });
  });

  it("persists the theme as a versioned preference", () => {
    let savedKey = "";
    let savedValue = "";
    const storage = {
      getItem: () => null,
      setItem: (key: string, value: string) => {
        savedKey = key;
        savedValue = value;
      },
    };

    saveAppearancePreferences(storage, {
      themeMode: "light",
    });

    expect(savedKey).toBe(APPEARANCE_STORAGE_KEY);
    expect(JSON.parse(savedValue)).toEqual({
      themeMode: "light",
    });
  });

  it("falls back field by field when persisted preferences are corrupt", () => {
    const malformedStorage = {
      getItem: () => "{not json",
      setItem: () => undefined,
    };
    const invalidThemeStorage = {
      getItem: () =>
        JSON.stringify({ themeMode: "sepia", settingsOpen: false }),
      setItem: () => undefined,
    };

    expect(loadAppearancePreferences(malformedStorage)).toEqual({
      themeMode: "system",
    });
    expect(loadAppearancePreferences(invalidThemeStorage)).toEqual({
      themeMode: "system",
    });
  });

  it("applies the stored theme to the document target during bootstrap", () => {
    const harness = createThemeHarness(false);
    const storage = {
      getItem: () => JSON.stringify({ themeMode: "dark", settingsOpen: true }),
      setItem: () => undefined,
    };

    const snapshot = applyInitialAppearance({
      storage,
      systemPrefersDark: harness.systemTheme.isDark(),
      target: harness.target,
    });

    expect(snapshot.resolvedTheme).toBe("dark");
    expect(harness.attributes.get("data-theme")).toBe("dark");
    expect(harness.target.style.colorScheme).toBe("dark");
  });
});

describe("appearance controller", () => {
  it("resolves system mode and reacts to operating-system theme changes", () => {
    const harness = createThemeHarness(false);
    const storage = {
      getItem: () => null,
      setItem: () => undefined,
    };
    const controller = createAppearanceController({
      storage,
      systemTheme: harness.systemTheme,
      target: harness.target,
    });
    let notifications = 0;
    controller.subscribe(() => {
      notifications += 1;
    });

    expect(controller.getSnapshot()).toEqual({
      themeMode: "system",
      resolvedTheme: "light",
    });
    expect(harness.attributes.get("data-theme")).toBe("light");
    expect(harness.target.style.colorScheme).toBe("light");

    harness.setSystemTheme(true);

    expect(controller.getSnapshot().resolvedTheme).toBe("dark");
    expect(harness.attributes.get("data-theme")).toBe("dark");
    expect(harness.target.style.colorScheme).toBe("dark");
    expect(notifications).toBe(1);
  });

  it("persists an explicit choice and ignores later system theme changes", () => {
    const harness = createThemeHarness(true);
    let saved = "";
    const storage = {
      getItem: () => null,
      setItem: (_key: string, value: string) => {
        saved = value;
      },
    };
    const controller = createAppearanceController({
      storage,
      systemTheme: harness.systemTheme,
      target: harness.target,
    });

    controller.setThemeMode("light");
    harness.setSystemTheme(false);
    harness.setSystemTheme(true);

    expect(controller.getSnapshot()).toEqual({
      themeMode: "light",
      resolvedTheme: "light",
    });
    expect(JSON.parse(saved)).toEqual({
      themeMode: "light",
    });
    expect(harness.attributes.get("data-theme")).toBe("light");
  });
});
