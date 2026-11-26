import { describe, expect, it, vi } from "vitest";
import {
  APPEARANCE_STORAGE_KEY, createAppearanceController, defaultAppearancePreferences,
  applyInitialAppearance, loadAppearancePreferences, readAppearancePreferences, saveAppearancePreferences,
} from "./appearance";

function storage(encoded: string | null) {
  let value = encoded;
  return { getItem: vi.fn(() => value), setItem: vi.fn((_key: string, next: string) => { value = next; }) };
}
const reference = "backgrounds/01234567-89ab-4cde-8fab-0123456789ab.png";
const unsupported = [
  ...[-1, 91, "0", null].flatMap(mask => [
    JSON.stringify({ backgroundMask: mask }),
    JSON.stringify({ backgroundLibrary: [{ id: "mask", reference, mask }] }),
  ]),
  "{broken", "null", "[]",
  JSON.stringify({ ...defaultAppearancePreferences, securityPolicy: { value: "do not disclose" } }),
  JSON.stringify({ ...defaultAppearancePreferences, backgroundLibrary: {} }),
  JSON.stringify({ ...defaultAppearancePreferences, backgroundLibrary: [{ id: "kept", reference, futureOption: true }] }),
  JSON.stringify({ ...defaultAppearancePreferences, backgroundLibrary: [{ id: "same", reference }, { id: "same", reference }] }),
  JSON.stringify({ ...defaultAppearancePreferences, backgroundFocus: { x: 0.5, y: 0.5, futureOption: true } }),
  JSON.stringify({ ...defaultAppearancePreferences, backgroundReference: "C:\\synthetic-only\\private.png" }),
  JSON.stringify({ ...defaultAppearancePreferences, themeMode: "future" }),
  JSON.stringify({ ...defaultAppearancePreferences, sidebarTransparency: 101 }),
  JSON.stringify({ ...defaultAppearancePreferences, sidebarGlassEnabled: "true" }),
  JSON.stringify({ ...defaultAppearancePreferences, composerGlassEnabled: null }),
  ...["never", "", null, true, 123].map(assistantBubbleMode => JSON.stringify({ ...defaultAppearancePreferences, assistantBubbleMode })),
  ...[85, 105, 1.1, "100", null, true].map(fontScale => JSON.stringify({ ...defaultAppearancePreferences, fontScale })),
  ...[-1, 101, 15.5, "85", null].map(chromeTransparency => JSON.stringify({ ...defaultAppearancePreferences, chromeTransparency })),
];

describe("appearance durable compatibility boundary", () => {
  it.each([0, 10, 35, 65, 90])("preserves explicit mask %s in local and shared backup reads", mask => {
    const original = storage(JSON.stringify({ backgroundReference: reference, backgroundMask: mask }));
    const first = readAppearancePreferences(original);
    expect(first.backgroundMask).toBe(mask);
    expect(first.backgroundLibrary[0].mask).toBe(mask);
    expect(readAppearancePreferences(original)).toEqual(first);
    expect(original.setItem).not.toHaveBeenCalled();
    saveAppearancePreferences(original, first);
    expect(readAppearancePreferences(original)).toEqual(first);
  });
  it("defaults missing masks to 50 without rewriting old records", () => {
    for (const encoded of [null, JSON.stringify({ backgroundReference: reference }),
      JSON.stringify({ backgroundLibrary: [{ id: "legacy", reference }] })]) {
      const original = storage(encoded);
      const preferences = readAppearancePreferences(original);
      expect(preferences.backgroundMask).toBe(50);
      for (const entry of preferences.backgroundLibrary) expect(entry.mask).toBe(50);
      expect(original.setItem).not.toHaveBeenCalled();
    }
  });
  it("applies the tuned alpha and bubble attributes before first render in either theme without writes", () => {
    for (const systemPrefersDark of [false, true]) {
      const original = storage(null);
      const properties = new Map<string, string>();
      const attributes = new Map<string, string>();
      applyInitialAppearance({ storage: original, systemPrefersDark,
        target: { style: { colorScheme: "", setProperty: (key, value) => { properties.set(key, value); }, removeProperty() {} },
          setAttribute: (key, value) => { attributes.set(key, value); }, removeAttribute: key => { attributes.delete(key); } },
      });
      expect(properties.get("--chrome-background-opacity")).toBe("0.6");
      expect(properties.get("--sidebar-background-opacity")).toBe("0.5");
      expect(properties.get("--assistant-bubble-opacity")).toBe("0.75");
      expect(properties.get("--font-scale")).toBe("1");
      expect(properties.has("--message-bubble-opacity")).toBe(false);
      expect(attributes.get("data-assistant-bubble-mode")).toBe("auto");
      expect(attributes.get("data-assistant-bubble-transparent")).toBe("false");
      expect(original.setItem).not.toHaveBeenCalled();
    }
  });
  it.each([[85, 0, 6], [75, 20, 6], [40, 50, 12]])("uses missing-field defaults without overwriting saved %s/%s/%s choices", (chromeTransparency, sidebarTransparency, assistantBubbleTransparency) => {
    const empty = storage(null);
    expect(readAppearancePreferences(empty)).toMatchObject({ chromeTransparency: 40, sidebarTransparency: 50, assistantBubbleMode: "auto", assistantBubbleTransparency: 25 });
    expect(empty.setItem).not.toHaveBeenCalled();
    const encoded = JSON.stringify({ chromeTransparency, sidebarTransparency, assistantBubbleTransparency });
    const existing = storage(encoded);
    expect(readAppearancePreferences(existing)).toMatchObject({ chromeTransparency, sidebarTransparency, assistantBubbleMode: "auto", assistantBubbleTransparency });
    expect(loadAppearancePreferences(existing)).toMatchObject({ chromeTransparency, sidebarTransparency, assistantBubbleMode: "auto", assistantBubbleTransparency });
    expect(existing.getItem()).toBe(encoded);
    expect(existing.setItem).not.toHaveBeenCalled();
  });
  it("defaults old records without writes and persists independent chrome, unified changes and reset", async () => {
    const original = storage(JSON.stringify({ sidebarTransparency: 37, composerTransparency: 62, assistantBubbleTransparency: 19 }));
    expect(readAppearancePreferences(original).chromeTransparency).toBe(40);
    expect(readAppearancePreferences(original)).toEqual(readAppearancePreferences(original));
    expect(original.setItem).not.toHaveBeenCalled();
    const properties = new Map<string, string>();
    const controller = createAppearanceController({ storage: original,
      systemTheme: { isDark: () => false, subscribe: () => () => {} },
      target: { style: { colorScheme: "", setProperty: (key, value) => { properties.set(key, value); }, removeProperty() {} }, setAttribute() {}, removeAttribute() {} },
    });
    try {
      await controller.ready;
      controller.setChromeTransparency(60);
      expect(readAppearancePreferences(original)).toMatchObject({ chromeTransparency: 60, sidebarTransparency: 37, composerTransparency: 62, assistantBubbleTransparency: 19 });
      expect(properties.get("--chrome-background-opacity")).toBe("0.4");
      controller.setChromeTransparency(Number.NaN);
      expect(readAppearancePreferences(original).chromeTransparency).toBe(60);
      controller.setUnifiedTransparency(24);
      expect(readAppearancePreferences(original)).toMatchObject({ chromeTransparency: 24, sidebarTransparency: 24, composerTransparency: 24, assistantBubbleTransparency: 24, unifiedTransparency: 24 });
      controller.setChromeTransparency(40);
      expect(readAppearancePreferences(original).unifiedTransparency).toBe(24);
      controller.setSidebarTransparency(40); controller.setComposerTransparency(40); controller.setAssistantBubbleTransparency(40);
      expect(readAppearancePreferences(original).unifiedTransparency).toBe(40);
      controller.setUnifiedTransparency(null);
      expect(readAppearancePreferences(original)).toMatchObject({ chromeTransparency: 40, sidebarTransparency: 50, composerTransparency: 0, assistantBubbleTransparency: 25 });
      controller.setChromeTransparency(45);
      await controller.resetCustomAppearance();
      expect(readAppearancePreferences(original)).toMatchObject({ chromeTransparency: 40, sidebarTransparency: 50, assistantBubbleMode: "auto", assistantBubbleTransparency: 25 });
    } finally { controller.destroy(); }
  });

  it("defaults omitted glass flags without writes and persists independent toggles across reload", async () => {
    const original = storage(JSON.stringify({ sidebarTransparency: 37, composerTransparency: 62, assistantBubbleTransparency: 19 }));
    expect(readAppearancePreferences(original)).toMatchObject({ sidebarGlassEnabled: false, composerGlassEnabled: true });
    expect(original.setItem).not.toHaveBeenCalled();
    const attributes = new Map<string, string>();
    const create = () => createAppearanceController({ storage: original,
      systemTheme: { isDark: () => false, subscribe: () => () => {} },
      target: { style: { colorScheme: "", setProperty: () => {}, removeProperty: () => {} },
        setAttribute: (key, value) => { attributes.set(key, value); }, removeAttribute: key => { attributes.delete(key); } },
    });
    const controller = create(); await controller.ready;
    expect(controller.getSnapshot()).toMatchObject({ sidebarGlassEnabled: false, composerGlassEnabled: true });
    expect(attributes.get("data-sidebar-glass")).toBe("false");
    expect(attributes.get("data-composer-glass")).toBe("true");
    const transparencies = { sidebarTransparency: 37, composerTransparency: 62, assistantBubbleTransparency: 19, unifiedTransparency: 0 };
    try {
      for (const [sidebar, composer] of [[true, false], [true, true], [false, true], [false, false], [true, true]]) {
        controller.setSidebarGlassEnabled(sidebar); controller.setComposerGlassEnabled(composer);
        expect(controller.getSnapshot()).toMatchObject({ ...transparencies, sidebarGlassEnabled: sidebar, composerGlassEnabled: composer });
        expect(readAppearancePreferences(original)).toMatchObject({ ...transparencies, sidebarGlassEnabled: sidebar, composerGlassEnabled: composer });
        expect(attributes.get("data-sidebar-glass")).toBe(String(sidebar));
        expect(attributes.get("data-composer-glass")).toBe(String(composer));
      }
    } finally { controller.destroy(); }
    const reloaded = create(); await reloaded.ready;
    try {
      expect(reloaded.getSnapshot()).toMatchObject({ ...transparencies, sidebarGlassEnabled: true, composerGlassEnabled: true });
      reloaded.setThemeMode("dark");
      expect(reloaded.getSnapshot()).toMatchObject({ sidebarGlassEnabled: true, composerGlassEnabled: true });
      await reloaded.resetCustomAppearance();
      expect(reloaded.getSnapshot()).toMatchObject({ sidebarGlassEnabled: false, composerGlassEnabled: true });
    } finally { reloaded.destroy(); }
  });
  it.each(["auto", "always", "off"] as const)("persists explicit assistantBubbleMode %s across reload and background toggles without overwriting saved color/transparency", async mode => {
    const original = storage(JSON.stringify({
      ...defaultAppearancePreferences,
      backgroundReference: reference,
      backgroundEnabled: true,
      assistantBubbleColor: "#e6eef8",
      assistantBubbleTransparency: 33,
      assistantBubbleMode: mode,
    }));
    const attributes = new Map<string, string>();
    const create = () => createAppearanceController({
      storage: original,
      systemTheme: { isDark: () => false, subscribe: () => () => {} },
      target: {
        style: { colorScheme: "", setProperty() {}, removeProperty() {} },
        setAttribute: (key, value) => { attributes.set(key, value); },
        removeAttribute: key => { attributes.delete(key); },
      },
      backgroundResources: {
        selectAndImport: async () => null,
        resolve: async ref => ({ reference: ref, url: "asset://localhost/private/bg.png" }),
        cleanup: async () => {},
      },
    });
    const controller = create();
    await controller.ready;
    try {
      expect(controller.getSnapshot()).toMatchObject({ assistantBubbleMode: mode, assistantBubbleColor: "#e6eef8", assistantBubbleTransparency: 33 });
      expect(attributes.get("data-assistant-bubble-mode")).toBe(mode);
      expect(attributes.get("data-assistant-bubble-transparent")).toBe("false");
      expect(attributes.get("data-has-background")).toBe("true");
      await controller.removeBackground();
      expect(attributes.has("data-has-background")).toBe(false);
      expect(controller.getSnapshot()).toMatchObject({ assistantBubbleMode: mode, assistantBubbleColor: "#e6eef8", assistantBubbleTransparency: 33, backgroundEnabled: false });
      await controller.restoreBackground();
      expect(attributes.get("data-has-background")).toBe("true");
      expect(controller.getSnapshot()).toMatchObject({ assistantBubbleMode: mode, assistantBubbleColor: "#e6eef8", assistantBubbleTransparency: 33, backgroundEnabled: true });
      controller.setAssistantBubbleTransparency(100);
      expect(attributes.get("data-assistant-bubble-transparent")).toBe("true");
      controller.setAssistantBubbleTransparency(33);
      expect(attributes.get("data-assistant-bubble-transparent")).toBe("false");
      controller.setAssistantBubbleMode("invalid" as never);
      expect(controller.getSnapshot().assistantBubbleMode).toBe(mode);
    } finally { controller.destroy(); }
    const reloaded = create();
    await reloaded.ready;
    try {
      expect(reloaded.getSnapshot()).toMatchObject({ assistantBubbleMode: mode, assistantBubbleColor: "#e6eef8", assistantBubbleTransparency: 33 });
      await reloaded.resetCustomAppearance();
      expect(reloaded.getSnapshot()).toMatchObject({ assistantBubbleMode: "auto", assistantBubbleColor: null, assistantBubbleTransparency: 25 });
      expect(attributes.get("data-assistant-bubble-mode")).toBe("auto");
    } finally { reloaded.destroy(); }
  });

  it.each([false, true])("preserves an explicit composer glass choice %s across reads", enabled => {
    const encoded = JSON.stringify({ ...defaultAppearancePreferences, composerGlassEnabled: enabled });
    const original = storage(encoded);
    expect(readAppearancePreferences(original).composerGlassEnabled).toBe(enabled);
    expect(loadAppearancePreferences(original).composerGlassEnabled).toBe(enabled);
    expect(original.getItem()).toBe(encoded);
    expect(original.setItem).not.toHaveBeenCalled();
  });
  it("shares pure legacy defaults, crop migration and original resource ownership without writes", () => {
    const encoded = JSON.stringify({ themeMode: "dark", accentColor: "#ABCDEF", backgroundReference: reference,
      backgroundCrop: { x: 0.1, y: 0.2, width: 0.6, height: 0.4 }, backgroundMask: 72 });
    const original = storage(encoded);
    const first = readAppearancePreferences(original);
    expect(first).toEqual(loadAppearancePreferences(original));
    expect(first).toMatchObject({ userBubbleColor: "#abcdef", backgroundFocus: { x: 0.4, y: 0.4 },
      backgroundLibrary: [{ reference, focus: { x: 0.4, y: 0.4 }, mask: 72 }] });
    first.backgroundLibrary[0].name = "private edit";
    expect(readAppearancePreferences(original).backgroundLibrary[0].name).toBe("原有背景");
    expect(original.getItem()).toBe(encoded);
    expect(original.setItem).not.toHaveBeenCalled();
    const empty = storage(null);
    const defaults = readAppearancePreferences(empty); defaults.backgroundLibrary.push(first.backgroundLibrary[0]);
    expect(defaults).toMatchObject({ sidebarGlassEnabled: false, composerGlassEnabled: true });
    expect(readAppearancePreferences(empty).backgroundLibrary).toEqual([]);
  });

  it.each(unsupported)("keeps unsupported raw data through display fallback, setters and direct save: case %#", async encoded => {
    const original = storage(encoded);
    expect(() => readAppearancePreferences(original)).toThrow();
    expect(() => saveAppearancePreferences(original, structuredClone(defaultAppearancePreferences))).toThrow();
    const cleanup = vi.fn(async () => {});
    const controller = createAppearanceController({ storage: original,
      systemTheme: { isDark: () => false, subscribe: () => () => {} },
      target: { style: { colorScheme: "", setProperty: () => {}, removeProperty: () => {} }, setAttribute: () => {}, removeAttribute: () => {} },
      backgroundResources: { selectAndImport: async () => null, resolve: async () => { throw Error("synthetic missing resource"); }, cleanup },
    });
    try {
      await controller.ready;
      controller.setThemeMode("dark");
      controller.setChromeTransparency(12);
      controller.setAccentColor("#123456");
      controller.setSidebarGlassEnabled(true);
      controller.setComposerGlassEnabled(true);
      expect(controller.getSnapshot().backgroundError).toContain("数据");
      expect(original.setItem).not.toHaveBeenCalled();
      expect(original.getItem()).toBe(encoded);
      expect(cleanup).not.toHaveBeenCalled();
    } finally { controller.destroy(); }
  });

  it("rechecks storage at save time and permits only supported explicit edits", () => {
    const original = storage(JSON.stringify({ themeMode: "light" }));
    saveAppearancePreferences(original, { ...structuredClone(defaultAppearancePreferences), themeMode: "dark" });
    expect(readAppearancePreferences(original).themeMode).toBe("dark");
    original.setItem(APPEARANCE_STORAGE_KEY, unsupported[3]);
    original.setItem.mockClear();
    expect(() => saveAppearancePreferences(original, structuredClone(defaultAppearancePreferences))).toThrow();
    expect(original.setItem).not.toHaveBeenCalled();
  });

  it("defaults omitted fontScale to 100 without writes and preserves last saved state on setFontScale save failure", async () => {
    const legacy = storage(JSON.stringify({ themeMode: "light" }));
    expect(readAppearancePreferences(legacy).fontScale).toBe(100);
    expect(readAppearancePreferences(legacy).fontScale).toBe(100);
    expect(legacy.setItem).not.toHaveBeenCalled();

    // Corrupt record: setFontScale keeps display fallback 100, does not write, surfaces fontScaleError
    const corruptEncoded = JSON.stringify({ ...defaultAppearancePreferences, fontScale: 105 });
    const corrupt = storage(corruptEncoded);
    const corruptProps = new Map<string, string>();
    const corruptController = createAppearanceController({
      storage: corrupt,
      systemTheme: { isDark: () => false, subscribe: () => () => {} },
      target: { style: { colorScheme: "", setProperty: (k, v) => { corruptProps.set(k, v); }, removeProperty() {} }, setAttribute() {}, removeAttribute() {} },
    });
    try {
      await corruptController.ready;
      corruptController.setFontScale(125);
      expect(corruptController.getSnapshot().fontScale).toBe(100);
      expect(corruptProps.get("--font-scale")).toBe("1");
      expect(corruptController.getSnapshot().fontScaleError).toContain("外观配置");
      expect(corrupt.setItem).not.toHaveBeenCalled();
      expect(corrupt.getItem()).toBe(corruptEncoded);
    } finally { corruptController.destroy(); }

    // Unknown field alongside a valid non-default fontScale: strict read rejects, bootstrap display falls back to 100% with zero writes while preserving theme fallback
    const unknownWithValidScaleEncoded = JSON.stringify({ ...defaultAppearancePreferences, themeMode: "dark", fontScale: 125, futureDisplayToken: true });
    const unknownWithValidScale = storage(unknownWithValidScaleEncoded);
    expect(() => readAppearancePreferences(unknownWithValidScale)).toThrow();
    const fallbackProps = new Map<string, string>();
    const fallbackAttributes = new Map<string, string>();
    const fallbackInitial = applyInitialAppearance({
      storage: unknownWithValidScale,
      systemPrefersDark: false,
      target: {
        style: { colorScheme: "", setProperty: (k, v) => { fallbackProps.set(k, v); }, removeProperty() {} },
        setAttribute: (k, v) => { fallbackAttributes.set(k, v); },
        removeAttribute: k => { fallbackAttributes.delete(k); },
      },
    });
    expect(fallbackInitial.fontScale).toBe(100);
    expect(fallbackInitial.themeMode).toBe("dark");
    expect(fallbackProps.get("--font-scale")).toBe("1");
    expect(fallbackAttributes.get("data-theme")).toBe("dark");
    expect(unknownWithValidScale.setItem).not.toHaveBeenCalled();
    expect(unknownWithValidScale.getItem()).toBe(unknownWithValidScaleEncoded);

    // Storage write rejection: retains previous saved fontScale and clears error after retry succeeds
    let raw: string | null = JSON.stringify({ ...defaultAppearancePreferences, fontScale: 110 });
    let failWrites = true;
    const flaky = {
      getItem: vi.fn(() => raw),
      setItem: vi.fn((_key: string, next: string) => {
        if (failWrites) throw new Error("QuotaExceededError");
        raw = next;
      }),
    };
    const props = new Map<string, string>();
    const controller = createAppearanceController({
      storage: flaky,
      systemTheme: { isDark: () => false, subscribe: () => () => {} },
      target: { style: { colorScheme: "", setProperty: (k, v) => { props.set(k, v); }, removeProperty() {} }, setAttribute() {}, removeAttribute() {} },
    });
    try {
      await controller.ready;
      expect(controller.getSnapshot().fontScale).toBe(110);
      expect(props.get("--font-scale")).toBe("1.1");
      controller.setFontScale(125);
      expect(controller.getSnapshot().fontScale).toBe(110);
      expect(props.get("--font-scale")).toBe("1.1");
      expect(controller.getSnapshot().fontScaleError).toContain("无法保存字体比例设置");
      failWrites = false;
      controller.setFontScale(125);
      expect(controller.getSnapshot().fontScale).toBe(125);
      expect(props.get("--font-scale")).toBe("1.25");
      expect(controller.getSnapshot().fontScaleError).toBeNull();
    } finally { controller.destroy(); }
  });
});
