import { describe, expect, it, vi } from "vitest";
import {
  APPEARANCE_STORAGE_KEY, createAppearanceController, defaultAppearancePreferences,
  loadAppearancePreferences, readAppearancePreferences, saveAppearancePreferences,
} from "./appearance";

function storage(encoded: string | null) {
  let value = encoded;
  return { getItem: vi.fn(() => value), setItem: vi.fn((_key: string, next: string) => { value = next; }) };
}
const reference = "backgrounds/01234567-89ab-4cde-8fab-0123456789ab.png";
const unsupported = [
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
];

describe("appearance durable compatibility boundary", () => {
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
});
