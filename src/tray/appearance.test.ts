// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { APPEARANCE_STORAGE_KEY } from "../appearance/appearance";
import { installTrayAppearance } from "./appearance";

let dispose: (() => void) | undefined;
let media: MediaQueryList;
beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  media = Object.assign(new EventTarget(), { matches: false }) as MediaQueryList;
  vi.spyOn(window, "matchMedia").mockReturnValue(media);
});
afterEach(() => { dispose?.(); dispose = undefined; vi.restoreAllMocks(); window.localStorage.clear(); });

it("reads appearance without rewriting it and reapplies on storage, focus and system changes", () => {
  const encoded = JSON.stringify({ themeMode: "dark", colorPreset: "rose", backgroundReference: "background-never-loaded" });
  window.localStorage.setItem(APPEARANCE_STORAGE_KEY, encoded);
  const write = vi.spyOn(Storage.prototype, "setItem");
  dispose = installTrayAppearance();
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  expect(document.documentElement.style.getPropertyValue("--appearance-background-image")).toBe("");
  expect(write).not.toHaveBeenCalled();
  expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe(encoded);
  window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({ themeMode: "light" }));
  window.dispatchEvent(new StorageEvent("storage", { key: APPEARANCE_STORAGE_KEY }));
  expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({ themeMode: "dark" }));
  window.dispatchEvent(new Event("focus"));
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  window.localStorage.removeItem(APPEARANCE_STORAGE_KEY);
  Object.assign(media, { matches: true }); media.dispatchEvent(new Event("change"));
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  dispose(); dispose = undefined;
  Object.assign(media, { matches: false }); media.dispatchEvent(new Event("change"));
  window.dispatchEvent(new StorageEvent("storage", { key: null })); window.dispatchEvent(new Event("focus"));
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
});

it("defaults gracefully when local storage and media query access are unavailable", () => {
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("blocked"); });
  vi.mocked(window.matchMedia).mockImplementation(() => { throw new Error("unavailable"); });
  expect(() => { dispose = installTrayAppearance(); }).not.toThrow();
  expect(document.documentElement.getAttribute("data-theme")).toBe("light");
});
