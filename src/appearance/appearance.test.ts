import { describe, expect, it, vi } from "vitest";
import { centerBackgroundFocus } from "./backgroundFocus";

import {
  APPEARANCE_STORAGE_KEY,
  applyInitialAppearance,
  createAppearanceController,
  loadAppearancePreferences,
  saveAppearancePreferences,
  BackgroundResourceError,
  type BackgroundResourceStore,
  type SystemThemeSource,
  type ThemeTarget,
} from "./appearance";

const expectedDefaultPreferences = {
  userBubbleColor: null,
  unifiedThemeColor: null,
  colorPreset: "default" as const,
  themeMode: "system" as const,
  accentColor: null,
  canvasColor: null,
  assistantBubbleColor: null,
  unifiedTransparency: 0,
  sidebarTransparency: 0,
  composerTransparency: 0,
  assistantBubbleTransparency: 6,
  backgroundReference: null,
  backgroundFocus: null,
  backgroundFit: "cover" as const,
  backgroundMask: 65,
  backgroundBlur: 0,
};

const expectedDefaultRuntime = {
  backgroundDraft: null,
  backgroundUrl: null,
  backgroundStatus: "none" as const,
  backgroundBusy: false,
  backgroundError: null,
};

function createThemeHarness(initiallyDark = false) {
  let dark = initiallyDark;
  let listener: ((prefersDark: boolean) => void) | undefined;
  const attributes = new Map<string, string>();
  const styleProperties = new Map<string, string>();
  const target: ThemeTarget = {
    style: {
      colorScheme: "",
      removeProperty(name) {
        styleProperties.delete(name);
      },
      setProperty(name, value) {
        styleProperties.set(name, value);
      },
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    removeAttribute(name) {
      attributes.delete(name);
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
    styleProperties,
    systemTheme,
    target,
    setSystemTheme(prefersDark: boolean) {
      dark = prefersDark;
      listener?.(dark);
    },
  };
}

describe("appearance preferences", () => {
  it("unifies only component and user colors, then preserves independent edits across restart", async () => {
    let saved: string | null = null;
    const storage = { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } };
    const harness = createThemeHarness();
    const controller = createAppearanceController({ storage, systemTheme: harness.systemTheme, target: harness.target });
    await controller.ready;
    expect(controller.getSnapshot()).toMatchObject({ effectiveAccentColor: "#2563eb", effectiveUserBubbleColor: "#d2e3f7" });
    controller.setAssistantBubbleColor("#eeeeee");
    controller.setCanvasColor("#fafafa");
    controller.setUnifiedThemeColor("#ddeeff");
    expect(controller.getSnapshot()).toMatchObject({ accentColor: "#ddeeff", userBubbleColor: "#ddeeff", unifiedThemeColor: "#ddeeff", assistantBubbleColor: "#eeeeee", canvasColor: "#fafafa" });
    expect(harness.styleProperties.get("--color-accent")).toBe("221 238 255");
    expect(harness.styleProperties.get("--color-user-message")).toBe("221 238 255");
    controller.setUserBubbleColor("#eedddd");
    expect(controller.getSnapshot()).toMatchObject({ accentColor: "#ddeeff", userBubbleColor: "#eedddd", unifiedThemeColor: "#ddeeff" });
    controller.setAccentColor("#eedddd");
    expect(controller.getSnapshot().unifiedThemeColor).toBe("#eedddd");
    const restarted = createAppearanceController({ storage, systemTheme: harness.systemTheme, target: harness.target });
    await restarted.ready;
    expect(restarted.getSnapshot()).toMatchObject({ effectiveAccentColor: "#eedddd", effectiveUserBubbleColor: "#eedddd" });
    restarted.setColorPreset("reading");
    expect(restarted.getSnapshot()).toMatchObject({ effectiveAccentColor: "#2563eb", effectiveUserBubbleColor: "#eef2f6", unifiedThemeColor: null });
    await restarted.resetCustomAppearance();
    expect(restarted.getSnapshot()).toMatchObject({ effectiveAccentColor: "#2563eb", effectiveUserBubbleColor: "#d2e3f7" });
    restarted.destroy();
    controller.destroy();
  });

  it("keeps user text readable as its bubble fades into either solid canvas", () => {
    function brightness(rgb: number[]) {
      const linear = rgb.map(channel => channel / 255 <= 0.04045 ? channel / 255 / 12.92 : ((channel / 255 + 0.055) / 1.055) ** 2.4);
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    }
    for (const dark of [false, true]) {
      const harness = createThemeHarness(dark);
      const controller = createAppearanceController({ storage: { getItem: () => null, setItem: () => {} }, systemTheme: harness.systemTheme, target: harness.target });
      for (const custom of [false, true]) {
        controller.setAccentColor(custom ? "#802040" : null);
        controller.setCanvasColor(custom ? "#345678" : null);
        for (let transparency = 0; transparency <= 100; transparency++) {
          controller.setAssistantBubbleTransparency(transparency);
          const vars = harness.styleProperties;
          const accent = (vars.get("--color-user-message") ?? (dark ? "147 197 253" : "210 227 247")).split(" ").map(Number);
          const canvas = (vars.get("--color-canvas") ?? (dark ? "12 10 9" : "250 250 250")).split(" ").map(Number);
          const foreground = (vars.get("--color-user-message-text") ?? (dark ? "15 23 42" : "41 42 45")).split(" ").map(Number);
          const background = accent.map((channel, index) => Math.round(channel * (1 - transparency / 100) + canvas[index] * transparency / 100));
          const a = brightness(foreground), b = brightness(background);
          expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);
        }
      }
      controller.destroy();
    }
  });

  it("applies one unified adjustment atomically, then lets individual adjustments win and converge", async () => {
    let saved: string | null = null;
    const writes: string[] = [];
    const storage = { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; writes.push(value); } };
    const harness = createThemeHarness();
    const controller = createAppearanceController({ storage, systemTheme: harness.systemTheme, target: harness.target });
    controller.setUnifiedTransparency(48);
    expect(writes).toHaveLength(1);
    expect(controller.getSnapshot()).toMatchObject({ unifiedTransparency: 48, sidebarTransparency: 48, composerTransparency: 48, assistantBubbleTransparency: 48 });
    expect(harness.styleProperties.get("--sidebar-background-opacity")).toBe("0.52");
    controller.setSidebarTransparency(22);
    expect(controller.getSnapshot()).toMatchObject({ unifiedTransparency: 48, sidebarTransparency: 22, composerTransparency: 48, assistantBubbleTransparency: 48 });
    controller.setComposerTransparency(22);
    controller.setAssistantBubbleTransparency(22);
    expect(controller.getSnapshot()).toMatchObject({ unifiedTransparency: 22, sidebarTransparency: 22, composerTransparency: 22, assistantBubbleTransparency: 22 });
    const restarted = createAppearanceController({ storage, systemTheme: harness.systemTheme, target: harness.target });
    await restarted.ready;
    expect(restarted.getSnapshot()).toMatchObject({ unifiedTransparency: 22, sidebarTransparency: 22, composerTransparency: 22, assistantBubbleTransparency: 22 });
    controller.setUnifiedTransparency(100);
    expect(harness.styleProperties.get("--message-bubble-opacity")).toBe("0");
    expect(harness.styleProperties.get("--composer-background-opacity")).toBe("0");
    await controller.resetCustomAppearance();
    expect(loadAppearancePreferences(storage)).toMatchObject({ unifiedTransparency: 0, sidebarTransparency: 0, composerTransparency: 0, assistantBubbleTransparency: 6 });
  });

  it("uses per-field defaults for old, missing, and invalid transparency values", () => {
    let saved: string | null = JSON.stringify({ assistantBubbleTransparency: 37 });
    const storage = { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } };
    expect(loadAppearancePreferences(storage)).toMatchObject({ unifiedTransparency: 0, sidebarTransparency: 0, composerTransparency: 0, assistantBubbleTransparency: 37 });
    saved = JSON.stringify({ unifiedTransparency: -1, sidebarTransparency: 101, composerTransparency: 9.5, assistantBubbleTransparency: "42" });
    expect(loadAppearancePreferences(storage)).toMatchObject({ unifiedTransparency: 0, sidebarTransparency: 0, composerTransparency: 0, assistantBubbleTransparency: 6 });
    saved = JSON.stringify({ unifiedTransparency: -1, sidebarTransparency: 40, composerTransparency: 40, assistantBubbleTransparency: 40 });
    expect(loadAppearancePreferences(storage)).toMatchObject({ unifiedTransparency: 40, sidebarTransparency: 40, composerTransparency: 40, assistantBubbleTransparency: 40 });
    saved = "{";
    expect(loadAppearancePreferences(storage)).toMatchObject({ unifiedTransparency: 0, sidebarTransparency: 0, composerTransparency: 0, assistantBubbleTransparency: 6 });
  });

  it("persists independent bubble color and transparency including both endpoints, and resets them", async () => {
    let saved: string | null = null;
    const storage = { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } };
    const harness = createThemeHarness();
    const controller = createAppearanceController({ storage, systemTheme: harness.systemTheme, target: harness.target });
    controller.setAssistantBubbleColor("#123456");
    controller.setAssistantBubbleTransparency(100);
    expect(harness.styleProperties.get("--message-bubble-opacity")).toBe("0");
    expect(harness.styleProperties.get("--color-assistant-bubble")).toBe("18 52 86");
    expect(harness.styleProperties.has("--color-user-message")).toBe(false);
    controller.setThemeMode("dark");
    const restored = applyInitialAppearance({ storage, systemPrefersDark: false, target: harness.target });
    expect(restored).toMatchObject({ assistantBubbleColor: "#123456", assistantBubbleTransparency: 100, backgroundMask: 65 });
    controller.setAssistantBubbleTransparency(0);
    expect(harness.styleProperties.get("--message-bubble-opacity")).toBe("1");
    await controller.resetCustomAppearance();
    expect(loadAppearancePreferences(storage)).toMatchObject({ assistantBubbleColor: null, assistantBubbleTransparency: 6, themeMode: "dark" });
    expect(harness.styleProperties.has("--color-assistant-bubble")).toBe(false);
  });

  it("cancels imported drafts, restores saved crops, and recrops the original without changing other preferences", async () => {
    const original = "backgrounds/01234567-89ab-4cde-8fab-0123456789ab.png";
    const replacement = "backgrounds/abcdefab-cdef-4abc-8def-abcdefabcdef.jpg";
    const focus = { x: 0.1, y: 0.2 };
    let saved = JSON.stringify({ ...expectedDefaultPreferences, backgroundReference: original, backgroundFocus: focus, backgroundMask: 48, backgroundBlur: 9, backgroundFit: "contain", assistantBubbleColor: "#123456" });
    const storage = { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } };
    const harness = createThemeHarness();
    const cleanup = vi.fn(async (_references: readonly string[]) => undefined);
    const selectAndImport = vi.fn(async () => ({ reference: replacement, url: "asset://replacement" }));
    const resources = { cleanup, selectAndImport, resolve: async (reference: string) => ({ reference, url: "asset://original" }) };
    const controller = createAppearanceController({ storage, systemTheme: harness.systemTheme, target: harness.target, backgroundResources: resources });
    await controller.ready;
    await controller.selectBackground();
    await controller.cancelBackgroundFocus();
    expect(controller.getSnapshot()).toMatchObject({ backgroundReference: original, backgroundFocus: focus, backgroundDraft: null });
    expect(cleanup).toHaveBeenLastCalledWith([original]);
    controller.editBackgroundFocus();
    expect(controller.getSnapshot().backgroundDraft).toMatchObject({ reference: original, focus });
    await controller.confirmBackgroundFocus(centerBackgroundFocus);
    expect(selectAndImport).toHaveBeenCalledTimes(1);
    const restarted = createAppearanceController({ storage, systemTheme: harness.systemTheme, target: harness.target, backgroundResources: resources });
    await restarted.ready;
    expect(restarted.getSnapshot()).toMatchObject({ backgroundReference: original, backgroundFocus: centerBackgroundFocus, backgroundFit: "contain", backgroundMask: 48, backgroundBlur: 9, assistantBubbleColor: "#123456" });
  });

  it("falls back to system theme when storage is empty", () => {
    const storage = {
      getItem: () => null,
      setItem: () => undefined,
    };

    expect(loadAppearancePreferences(storage)).toEqual(
      expectedDefaultPreferences,
    );
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
      ...expectedDefaultPreferences,
      themeMode: "dark",
      accentColor: null,
      canvasColor: null,
      backgroundReference: null,
      backgroundFit: "cover",
      backgroundMask: 65,
      backgroundBlur: 0,
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
      ...expectedDefaultPreferences,
      themeMode: "light",
    });

    expect(savedKey).toBe(APPEARANCE_STORAGE_KEY);
    expect(JSON.parse(savedValue)).toEqual({
      ...expectedDefaultPreferences,
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

    expect(loadAppearancePreferences(malformedStorage)).toEqual(
      expectedDefaultPreferences,
    );
    expect(loadAppearancePreferences(invalidThemeStorage)).toEqual(
      expectedDefaultPreferences,
    );
  });

  it("restores valid custom appearance fields and rejects unsafe stored values", () => {
    const validStorage = {
      getItem: () =>
        JSON.stringify({
          themeMode: "system",
          accentColor: "#A855F7",
          canvasColor: "#112233",
          backgroundReference:
            "backgrounds/01234567-89ab-4cde-8fab-0123456789ab.webp",
          backgroundFit: "contain",
          backgroundMask: 48,
          backgroundBlur: 12,
        }),
      setItem: () => undefined,
    };
    const unsafeStorage = {
      getItem: () =>
        JSON.stringify({
          themeMode: "dark",
          accentColor: "red",
          canvasColor: "#12345g",
          backgroundReference: "C:\\Users\\someone\\wallpaper.png",
          backgroundFit: "stretch",
          backgroundMask: 10,
          backgroundBlur: 99,
        }),
      setItem: () => undefined,
    };

    expect(loadAppearancePreferences(validStorage)).toEqual({
      ...expectedDefaultPreferences,
      themeMode: "system",
      accentColor: "#a855f7",
      userBubbleColor: "#a855f7",
      canvasColor: "#112233",
      backgroundReference:
        "backgrounds/01234567-89ab-4cde-8fab-0123456789ab.webp",
      backgroundFit: "contain",
      backgroundMask: 48,
      backgroundBlur: 12,
    });
    expect(loadAppearancePreferences(unsafeStorage)).toEqual({
      ...expectedDefaultPreferences,
      themeMode: "dark",
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
      ...expectedDefaultPreferences,
      ...expectedDefaultRuntime,
      resolvedTheme: "light",
      effectiveAccentColor: "#2563eb",
      effectiveUserBubbleColor: "#d2e3f7",
      effectiveCanvasColor: "#fafafa",
      readabilityWarnings: [],
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
      ...expectedDefaultPreferences,
      ...expectedDefaultRuntime,
      themeMode: "light",
      resolvedTheme: "light",
      effectiveAccentColor: "#2563eb",
      effectiveUserBubbleColor: "#d2e3f7",
      effectiveCanvasColor: "#fafafa",
      readabilityWarnings: [],
    });
    expect(JSON.parse(saved)).toEqual({
      ...expectedDefaultPreferences,
      themeMode: "light",
    });
    expect(harness.attributes.get("data-theme")).toBe("light");
  });

  it("applies custom colors through safe semantic variables", () => {
    const harness = createThemeHarness(false);
    let saved = "";
    const controller = createAppearanceController({
      storage: {
        getItem: () => null,
        setItem: (_key, value) => {
          saved = value;
        },
      },
      systemTheme: harness.systemTheme,
      target: harness.target,
    });

    controller.setAccentColor("#ffffff");
    controller.setCanvasColor("#000000");

    expect(controller.getSnapshot().accentColor).toBe("#ffffff");
    expect(controller.getSnapshot().canvasColor).toBe("#000000");
    expect(controller.getSnapshot().readabilityWarnings).toEqual([
      "画布颜色已自动调整，以匹配当前基础主题的可读表面。",
    ]);
    expect(harness.styleProperties.get("--color-accent")).toBe(
      "255 255 255",
    );
    expect(harness.styleProperties.get("--color-canvas")).not.toBe("0 0 0");
    expect(harness.styleProperties.get("--color-accent-text")).not.toBe("255 255 255");
    expect(JSON.parse(saved)).toMatchObject({
      accentColor: "#ffffff",
      canvasColor: "#000000",
    });
  });

  it("restores a stable private background reference before exposing its URL", async () => {
    const harness = createThemeHarness(false);
    const reference =
      "backgrounds/01234567-89ab-4cde-8fab-0123456789ab.webp";
    const cleanupCalls: string[][] = [];
    const resources: BackgroundResourceStore = {
      selectAndImport: async () => null,
      resolve: async (requestedReference) => ({
        reference: requestedReference,
        url: "asset://localhost/private/background.webp",
      }),
      cleanup: async (retainedReferences) => {
        cleanupCalls.push([...retainedReferences]);
      },
    };
    const controller = createAppearanceController({
      storage: {
        getItem: () =>
          JSON.stringify({
            ...expectedDefaultPreferences,
            backgroundReference: reference,
          }),
        setItem: () => undefined,
      },
      systemTheme: harness.systemTheme,
      target: harness.target,
      backgroundResources: resources,
    });

    expect(controller.getSnapshot().backgroundStatus).toBe("loading");
    await controller.ready;

    expect(controller.getSnapshot().backgroundStatus).toBe("ready");
    expect(controller.getSnapshot().backgroundUrl).toBe(
      "asset://localhost/private/background.webp",
    );
    expect(harness.attributes.get("data-has-background")).toBe("true");
    expect(cleanupCalls).toEqual([[reference]]);
  });

  it("imports a replacement before persisting its stable reference and cleaning old copies", async () => {
    const harness = createThemeHarness(true);
    const previousReference =
      "backgrounds/01234567-89ab-4cde-8fab-0123456789ab.png";
    const nextReference =
      "backgrounds/abcdefab-cdef-4abc-8def-abcdefabcdef.jpg";
    const cleanupCalls: string[][] = [];
    let saved = "";
    const resources: BackgroundResourceStore = {
      selectAndImport: async () => ({
        reference: nextReference,
        url: "asset://localhost/private/replacement.jpg",
      }),
      resolve: async (reference) => ({
        reference,
        url: "asset://localhost/private/original.png",
      }),
      cleanup: async (retainedReferences) => {
        cleanupCalls.push([...retainedReferences]);
      },
    };
    const controller = createAppearanceController({
      storage: {
        getItem: () =>
          JSON.stringify({
            ...expectedDefaultPreferences,
            backgroundReference: previousReference,
          }),
        setItem: (_key, value) => {
          saved = value;
        },
      },
      systemTheme: harness.systemTheme,
      target: harness.target,
      backgroundResources: resources,
    });
    await controller.ready;

    await controller.selectBackground();

    expect(controller.getSnapshot().backgroundReference).toBe(previousReference);
    expect(controller.getSnapshot().backgroundDraft?.reference).toBe(nextReference);
    expect(saved).toBe("");
    expect(cleanupCalls).toEqual([[previousReference]]);
    await controller.confirmBackgroundFocus(centerBackgroundFocus);

    expect(controller.getSnapshot()).toMatchObject({
      backgroundReference: nextReference,
      backgroundUrl: "asset://localhost/private/replacement.jpg",
      backgroundStatus: "ready",
      backgroundBusy: false,
      backgroundError: null,
    });
    expect(JSON.parse(saved).backgroundReference).toBe(nextReference);
    expect(cleanupCalls).toEqual([[previousReference], [nextReference]]);
  });

  it("removes only the managed background reference and cleans private copies", async () => {
    const harness = createThemeHarness(false);
    const reference =
      "backgrounds/01234567-89ab-4cde-8fab-0123456789ab.png";
    const cleanupCalls: string[][] = [];
    let saved = "";
    const controller = createAppearanceController({
      storage: {
        getItem: () =>
          JSON.stringify({
            ...expectedDefaultPreferences,
            backgroundReference: reference,
          }),
        setItem: (_key, value) => {
          saved = value;
        },
      },
      systemTheme: harness.systemTheme,
      target: harness.target,
      backgroundResources: {
        selectAndImport: async () => null,
        resolve: async (requestedReference) => ({
          reference: requestedReference,
          url: "asset://localhost/private/original.png",
        }),
        cleanup: async (retainedReferences) => {
          cleanupCalls.push([...retainedReferences]);
        },
      },
    });
    await controller.ready;

    await controller.removeBackground();

    expect(controller.getSnapshot()).toMatchObject({
      backgroundReference: null,
      backgroundUrl: null,
      backgroundStatus: "none",
      backgroundBusy: false,
    });
    expect(JSON.parse(saved).backgroundReference).toBeNull();
    expect(cleanupCalls).toEqual([[reference], []]);
    expect(harness.attributes.has("data-has-background")).toBe(false);
  });

  it("persists fit, readability mask, and blur within safe bounds", () => {
    const harness = createThemeHarness(false);
    let saved = "";
    const controller = createAppearanceController({
      storage: {
        getItem: () => null,
        setItem: (_key, value) => {
          saved = value;
        },
      },
      systemTheme: harness.systemTheme,
      target: harness.target,
    });

    controller.setBackgroundFit("contain");
    controller.setBackgroundMask(10);
    controller.setBackgroundBlur(99);

    expect(controller.getSnapshot()).toMatchObject({
      backgroundFit: "contain",
      backgroundMask: 35,
      backgroundBlur: 32,
    });
    expect(harness.styleProperties.get("--appearance-background-fit")).toBe(
      "contain",
    );
    expect(harness.styleProperties.get("--appearance-background-mask")).toBe(
      "0.35",
    );
    expect(harness.styleProperties.get("--appearance-background-blur")).toBe(
      "32px",
    );
    expect(JSON.parse(saved)).toMatchObject({
      backgroundFit: "contain",
      backgroundMask: 35,
      backgroundBlur: 32,
    });
  });

  it("resets custom appearance while preserving the selected base theme", async () => {
    const harness = createThemeHarness(true);
    const reference =
      "backgrounds/01234567-89ab-4cde-8fab-0123456789ab.webp";
    const cleanupCalls: string[][] = [];
    let saved = "";
    const controller = createAppearanceController({
      storage: {
        getItem: () =>
          JSON.stringify({
            ...expectedDefaultPreferences,
            themeMode: "dark",
            accentColor: "#22c55e",
            canvasColor: "#0f172a",
            backgroundReference: reference,
            backgroundFit: "contain",
            backgroundMask: 48,
            backgroundBlur: 14,
          }),
        setItem: (_key, value) => {
          saved = value;
        },
      },
      systemTheme: harness.systemTheme,
      target: harness.target,
      backgroundResources: {
        selectAndImport: async () => null,
        resolve: async (requestedReference) => ({
          reference: requestedReference,
          url: "asset://localhost/private/background.webp",
        }),
        cleanup: async (retainedReferences) => {
          cleanupCalls.push([...retainedReferences]);
        },
      },
    });
    await controller.ready;

    await controller.resetCustomAppearance();

    expect(controller.getSnapshot()).toMatchObject({
      ...expectedDefaultPreferences,
      themeMode: "dark",
      resolvedTheme: "dark",
      backgroundUrl: null,
      backgroundStatus: "none",
    });
    expect(JSON.parse(saved)).toEqual({
      ...expectedDefaultPreferences,
      themeMode: "dark",
    });
    expect(cleanupCalls).toEqual([[reference], []]);
    expect(harness.styleProperties.has("--color-accent")).toBe(false);
    expect(harness.styleProperties.has("--color-canvas")).toBe(false);
  });

  it("keeps custom values while system mode recomputes safe light and dark surfaces", () => {
    const harness = createThemeHarness(false);
    const controller = createAppearanceController({
      storage: {
        getItem: () =>
          JSON.stringify({
            ...expectedDefaultPreferences,
            accentColor: "#ffffff",
            canvasColor: "#000000",
          }),
        setItem: () => undefined,
      },
      systemTheme: harness.systemTheme,
      target: harness.target,
    });
    const lightCanvas = controller.getSnapshot().effectiveCanvasColor;
    const lightAccent = controller.getSnapshot().effectiveAccentColor;

    harness.setSystemTheme(true);

    expect(controller.getSnapshot()).toMatchObject({
      themeMode: "system",
      resolvedTheme: "dark",
      accentColor: "#ffffff",
      canvasColor: "#000000",
    });
    expect(controller.getSnapshot().effectiveCanvasColor).not.toBe(lightCanvas);
    expect(controller.getSnapshot().effectiveAccentColor).toBe(lightAccent);
  });

  it("clears a missing private background reference without blocking startup", async () => {
    const harness = createThemeHarness(false);
    const reference =
      "backgrounds/01234567-89ab-4cde-8fab-0123456789ab.webp";
    let saved = "";
    const cleanupCalls: string[][] = [];
    const controller = createAppearanceController({
      storage: {
        getItem: () =>
          JSON.stringify({
            ...expectedDefaultPreferences,
            backgroundReference: reference,
          }),
        setItem: (_key, value) => {
          saved = value;
        },
      },
      systemTheme: harness.systemTheme,
      target: harness.target,
      backgroundResources: {
        selectAndImport: async () => null,
        resolve: async () => {
          throw new BackgroundResourceError("missing");
        },
        cleanup: async (retainedReferences) => {
          cleanupCalls.push([...retainedReferences]);
        },
      },
    });

    await controller.ready;

    expect(controller.getSnapshot()).toMatchObject({
      backgroundReference: null,
      backgroundUrl: null,
      backgroundStatus: "error",
      backgroundBusy: false,
      backgroundError: "已保存的背景不可用，已回退到基础主题。",
    });
    expect(JSON.parse(saved).backgroundReference).toBeNull();
    expect(cleanupCalls).toEqual([[]]);
  });

  it("keeps the current background when a replacement is rejected", async () => {
    const harness = createThemeHarness(false);
    const reference =
      "backgrounds/01234567-89ab-4cde-8fab-0123456789ab.png";
    const cleanupCalls: string[][] = [];
    const controller = createAppearanceController({
      storage: {
        getItem: () =>
          JSON.stringify({
            ...expectedDefaultPreferences,
            backgroundReference: reference,
          }),
        setItem: () => undefined,
      },
      systemTheme: harness.systemTheme,
      target: harness.target,
      backgroundResources: {
        selectAndImport: async () => {
          throw new BackgroundResourceError(
            "背景图片不能超过 20 MB，现有背景未发生变化。",
          );
        },
        resolve: async (requestedReference) => ({
          reference: requestedReference,
          url: "asset://localhost/private/original.png",
        }),
        cleanup: async (retainedReferences) => {
          cleanupCalls.push([...retainedReferences]);
        },
      },
    });
    await controller.ready;

    await controller.selectBackground();

    expect(controller.getSnapshot()).toMatchObject({
      backgroundReference: reference,
      backgroundUrl: "asset://localhost/private/original.png",
      backgroundStatus: "ready",
      backgroundError: "背景图片不能超过 20 MB，现有背景未发生变化。",
    });
    expect(cleanupCalls).toEqual([[reference]]);
  });

  it("retains both persisted and preview resources when preference storage fails", async () => {
    const harness = createThemeHarness(false);
    const previousReference =
      "backgrounds/01234567-89ab-4cde-8fab-0123456789ab.png";
    const nextReference =
      "backgrounds/abcdefab-cdef-4abc-8def-abcdefabcdef.webp";
    const cleanupCalls: string[][] = [];
    const controller = createAppearanceController({
      storage: {
        getItem: () =>
          JSON.stringify({
            ...expectedDefaultPreferences,
            backgroundReference: previousReference,
          }),
        setItem: () => {
          throw new Error("storage unavailable");
        },
      },
      systemTheme: harness.systemTheme,
      target: harness.target,
      backgroundResources: {
        selectAndImport: async () => ({
          reference: nextReference,
          url: "asset://localhost/private/preview.webp",
        }),
        resolve: async (reference) => ({
          reference,
          url: "asset://localhost/private/original.png",
        }),
        cleanup: async (retainedReferences) => {
          cleanupCalls.push([...retainedReferences]);
        },
      },
    });
    await controller.ready;

    await controller.selectBackground();

    await controller.confirmBackgroundFocus(centerBackgroundFocus);
    expect(controller.getSnapshot().backgroundError).toBe(
      "背景已预览，但本机偏好暂时无法保存。",
    );
    expect(cleanupCalls).toEqual([
      [previousReference],
      [previousReference, nextReference],
    ]);
  });

  it("keeps background operations busy until deferred cleanup finishes", async () => {
    const harness = createThemeHarness(false);
    const previousReference =
      "backgrounds/01234567-89ab-4cde-8fab-0123456789ab.png";
    const nextReference =
      "backgrounds/abcdefab-cdef-4abc-8def-abcdefabcdef.webp";
    let importCalls = 0;
    let finishCleanup: () => void = () => undefined;
    const cleanupGate = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    const cleanupCalls: string[][] = [];
    const controller = createAppearanceController({
      storage: {
        getItem: () =>
          JSON.stringify({
            ...expectedDefaultPreferences,
            backgroundReference: previousReference,
          }),
        setItem: () => undefined,
      },
      systemTheme: harness.systemTheme,
      target: harness.target,
      backgroundResources: {
        selectAndImport: async () => {
          importCalls += 1;
          return {
            reference: nextReference,
            url: "asset://localhost/private/next.webp",
          };
        },
        resolve: async (reference) => ({
          reference,
          url: "asset://localhost/private/original.png",
        }),
        cleanup: async (retainedReferences) => {
          cleanupCalls.push([...retainedReferences]);
          if (cleanupCalls.length === 2) {
            await cleanupGate;
          }
        },
      },
    });
    await controller.ready;

    await controller.selectBackground();
    const firstSelection = controller.confirmBackgroundFocus(centerBackgroundFocus);
    for (let attempt = 0; attempt < 10 && cleanupCalls.length < 2; attempt += 1) {
      await Promise.resolve();
    }

    expect(controller.getSnapshot().backgroundBusy).toBe(true);
    await controller.selectBackground();
    expect(importCalls).toBe(1);

    finishCleanup();
    await firstSelection;
    expect(controller.getSnapshot().backgroundBusy).toBe(false);
  });

  it("blocks imports while startup cleanup is still running", async () => {
    const harness = createThemeHarness(false);
    let importCalls = 0;
    let finishCleanup: () => void = () => undefined;
    const cleanupGate = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    const controller = createAppearanceController({
      storage: {
        getItem: () => null,
        setItem: () => undefined,
      },
      systemTheme: harness.systemTheme,
      target: harness.target,
      backgroundResources: {
        selectAndImport: async () => {
          importCalls += 1;
          return null;
        },
        resolve: async (reference) => ({ reference, url: "asset://unused" }),
        cleanup: async () => cleanupGate,
      },
    });

    expect(controller.getSnapshot().backgroundBusy).toBe(true);
    await controller.selectBackground();
    expect(importCalls).toBe(0);

    finishCleanup();
    await controller.ready;
    expect(controller.getSnapshot().backgroundBusy).toBe(false);
  });

  it("keeps a restored background busy until startup cleanup finishes", async () => {
    const harness = createThemeHarness(false);
    const reference =
      "backgrounds/01234567-89ab-4cde-8fab-0123456789ab.png";
    let importCalls = 0;
    let finishCleanup: () => void = () => undefined;
    const cleanupGate = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    const controller = createAppearanceController({
      storage: {
        getItem: () =>
          JSON.stringify({
            ...expectedDefaultPreferences,
            backgroundReference: reference,
          }),
        setItem: () => undefined,
      },
      systemTheme: harness.systemTheme,
      target: harness.target,
      backgroundResources: {
        selectAndImport: async () => {
          importCalls += 1;
          return null;
        },
        resolve: async (requestedReference) => ({
          reference: requestedReference,
          url: "asset://localhost/private/background.png",
        }),
        cleanup: async () => cleanupGate,
      },
    });

    await vi.waitFor(() => {
      expect(controller.getSnapshot().backgroundStatus).toBe("ready");
    });
    expect(controller.getSnapshot().backgroundBusy).toBe(true);
    await controller.selectBackground();
    expect(importCalls).toBe(0);

    finishCleanup();
    await controller.ready;
    expect(controller.getSnapshot().backgroundBusy).toBe(false);
  });

  it("protects the last persisted reference across repeated storage failures", async () => {
    const harness = createThemeHarness(false);
    const persistedReference =
      "backgrounds/01234567-89ab-4cde-8fab-0123456789ab.png";
    const firstPreview =
      "backgrounds/abcdefab-cdef-4abc-8def-abcdefabcdef.webp";
    const secondPreview =
      "backgrounds/11111111-2222-4333-8444-555555555555.jpg";
    const imports = [firstPreview, secondPreview];
    const cleanupCalls: string[][] = [];
    const controller = createAppearanceController({
      storage: {
        getItem: () =>
          JSON.stringify({
            ...expectedDefaultPreferences,
            backgroundReference: persistedReference,
          }),
        setItem: () => {
          throw new Error("storage unavailable");
        },
      },
      systemTheme: harness.systemTheme,
      target: harness.target,
      backgroundResources: {
        selectAndImport: async () => {
          const reference = imports.shift();
          if (!reference) {
            throw new Error("unexpected import");
          }
          return { reference, url: `asset://localhost/private/${reference}` };
        },
        resolve: async (reference) => ({
          reference,
          url: "asset://localhost/private/original.png",
        }),
        cleanup: async (retainedReferences) => {
          cleanupCalls.push([...retainedReferences]);
        },
      },
    });
    await controller.ready;

    await controller.selectBackground();
    await controller.confirmBackgroundFocus(centerBackgroundFocus);
    await controller.selectBackground();
    await controller.confirmBackgroundFocus(centerBackgroundFocus);
    await controller.removeBackground();

    expect(cleanupCalls).toEqual([
      [persistedReference],
      [persistedReference, firstPreview],
      [persistedReference, secondPreview],
      [persistedReference],
    ]);
  });
});
