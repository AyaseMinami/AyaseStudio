// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { brandIds } from "./brandIds";
import { brandAvatars, materializeBrandAvatar } from "./brandCatalog";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

function bundledImage(width = 400, height = 200) {
  const image = document.createElement("img");
  Object.defineProperties(image, { naturalWidth: { value: width }, naturalHeight: { value: height } });
  vi.spyOn(image, "decode").mockResolvedValue();
  vi.stubGlobal("Image", vi.fn(function () { return image; }));
  return image;
}

function canvasContext() {
  const drawnFilters: string[] = [];
  const context = { filter: "none", fillStyle: "", font: "", textAlign: "", textBaseline: "", fillRect: vi.fn(), fillText: vi.fn(), drawImage: vi.fn() };
  context.drawImage.mockImplementation(() => { drawnFilters.push(context.filter); });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => context as unknown as CanvasRenderingContext2D);
  const png = new Blob(["png"], { type: "image/png" });
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(png));
  return { context, png, drawnFilters };
}

it("exposes every stable brand once and only bundled asset URLs", () => {
  expect(brandAvatars.map((brand) => brand.id)).toEqual([...brandIds]);
  expect(new Set(brandAvatars.map((brand) => brand.id)).size).toBe(11);
  for (const brand of brandAvatars) {
    expect(brand.label).not.toBe("");
    if (brand.src) expect(brand.src).not.toMatch(/^https?:\/\//);
  }
});

it("materializes Doubao artwork when the desktop CSP blocks fetch but permits bundled images", async () => {
  const { context } = canvasContext();
  const image = bundledImage(192, 192);
  const fetch = vi.fn().mockRejectedValue(new TypeError("Blocked by connect-src"));
  vi.stubGlobal("fetch", fetch);

  await materializeBrandAvatar("doubao");

  expect(context.drawImage).toHaveBeenCalledWith(image, 20, 20, 216, 216);
  expect(context.fillText).not.toHaveBeenCalled();
  expect(image.getAttribute("src")).toBe(brandAvatars.find(brand => brand.id === "doubao")?.src);
  expect(fetch).not.toHaveBeenCalled();
});

it("rasterizes a contained official mark into a transparent source-free centered PNG snapshot", async () => {
  const { context, png } = canvasContext();
  const image = bundledImage();
  const result = await materializeBrandAvatar("openrouter");
  expect(image.getAttribute("src")).toBe(brandAvatars.find((brand) => brand.id === "openrouter")?.src);
  expect(image.decode).toHaveBeenCalledOnce();
  expect(context.drawImage).toHaveBeenCalledWith(image, 20, 74, 216, 108);
  expect(context.fillRect).not.toHaveBeenCalled();
  expect(result).toEqual({ original: png, thumbnail: png, crop: { x: .5, y: .5, zoom: 1 } });
  expect(result.source).toBeUndefined();
});

it("reports unreadable artwork without saving the fallback initial as an image", async () => {
  const { context } = canvasContext();
  vi.mocked(bundledImage().decode).mockRejectedValue(new Error("invalid image"));
  await expect(materializeBrandAvatar("doubao")).rejects.toThrow("原头像已保留");
  expect(context.drawImage).not.toHaveBeenCalled();
  expect(context.fillText).not.toHaveBeenCalled();
  expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
});

it("rejects decoded artwork with empty dimensions before encoding a snapshot", async () => {
  canvasContext(); bundledImage(0, 0);
  await expect(materializeBrandAvatar("doubao")).rejects.toThrow("原头像已保留");
  expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
});

it("reports failed PNG materialization without returning an unusable avatar", async () => {
  canvasContext();
  bundledImage();
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(null));
  await expect(materializeBrandAvatar("openrouter")).rejects.toThrow("无法保存内置头像");
});

it.each(["light", "dark"])("captures the displayed monochrome color without a backdrop for every brand in %s", async theme => {
  const previousTheme = document.documentElement.getAttribute("data-theme");
  document.documentElement.setAttribute("data-theme", theme);
  const { context, png, drawnFilters } = canvasContext();
  const image = bundledImage();
  try {
    for (const id of brandIds) {
      const result = await materializeBrandAvatar(id);
      const invert = theme === "dark" ? ["openai", "anthropic", "xai"].includes(id) : ["zhipu", "moonshot"].includes(id);
      expect(drawnFilters[drawnFilters.length - 1], id).toBe(invert ? "invert(1)" : "none");
      expect(context.drawImage).toHaveBeenLastCalledWith(image, 20, 74, 216, 108);
      expect(context.fillRect).not.toHaveBeenCalled(); expect(context.fillText).not.toHaveBeenCalled();
      expect(result).toEqual({ original: png, thumbnail: png, crop: { x: .5, y: .5, zoom: 1 } });
      expect(result.original.type).toBe("image/png"); expect(result.source).toBeUndefined();
    }
    expect(drawnFilters).toHaveLength(11);
  } finally {
    if (previousTheme === null) document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", previousTheme);
  }
});

it.each(["openai", "zhipu"] as const)("keeps the selected light-theme color for %s when the theme changes during decode", async id => {
  const previousTheme = document.documentElement.getAttribute("data-theme");
  document.documentElement.setAttribute("data-theme", "light");
  const { context, png, drawnFilters } = canvasContext();
  const image = bundledImage(256, 256);
  let finish!: () => void;
  vi.mocked(image.decode).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  try {
    const pending = materializeBrandAvatar(id);
    expect(image.decode).toHaveBeenCalledOnce();
    document.documentElement.setAttribute("data-theme", "dark");
    finish();
    const result = await pending;
    expect(drawnFilters).toEqual([id === "zhipu" ? "invert(1)" : "none"]);
    expect(context.fillRect).not.toHaveBeenCalled();
    expect(result).toEqual({ original: png, thumbnail: png, crop: { x: .5, y: .5, zoom: 1 } });
  } finally {
    if (previousTheme === null) document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", previousTheme);
  }
});
