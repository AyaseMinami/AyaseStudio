// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { automaticAvatar } from "./automaticAvatar";
import { brandIds } from "./brandIds";
import { brandAvatars, materializeBrandAvatar } from "./brandCatalog";
import { decodeAvatar } from "./image";

vi.mock("./image", async (original) => ({ ...await original<typeof import("./image")>(), decodeAvatar: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

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

it("rasterizes a contained official mark into a transparent source-free centered PNG snapshot", async () => {
  const { context, png } = canvasContext();
  const image = document.createElement("img");
  Object.defineProperties(image, { naturalWidth: { value: 400 }, naturalHeight: { value: 200 } });
  vi.mocked(decodeAvatar).mockResolvedValue(image);
  const fetch = vi.fn().mockResolvedValue(new Response(new Blob(["asset"])));
  vi.stubGlobal("fetch", fetch);
  const result = await materializeBrandAvatar("openrouter");
  expect(fetch).toHaveBeenCalledWith(brandAvatars.find((brand) => brand.id === "openrouter")?.src);
  expect(context.drawImage).toHaveBeenCalledWith(image, 20, 74, 216, 108);
  expect(context.fillRect).not.toHaveBeenCalled();
  expect(result).toEqual({ original: png, thumbnail: png, crop: { x: .5, y: .5, zoom: 1 } });
  expect(result.source).toBeUndefined();
});

it("uses the same automatic initial and identity colors when bundled artwork cannot load", async () => {
  const { context } = canvasContext();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("missing local asset")));
  const result = await materializeBrandAvatar("openrouter");
  const automatic = automaticAvatar("OpenRouter", "openrouter");
  expect(decodeAvatar).not.toHaveBeenCalled();
  expect(context.drawImage).not.toHaveBeenCalled();
  expect(context.fillText).toHaveBeenCalledWith(automatic.initial, 128, 128);
  expect(context.fillStyle).toBe(automatic.color);
  expect(result.thumbnail.type).toBe("image/png");
});

it("reports failed PNG materialization without returning an unusable avatar", async () => {
  canvasContext();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("missing")));
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(null));
  await expect(materializeBrandAvatar("openrouter")).rejects.toThrow("无法保存内置头像");
});

it.each(["light", "dark"])("captures the displayed monochrome color without a backdrop for every brand in %s", async theme => {
  const previousTheme = document.documentElement.getAttribute("data-theme");
  document.documentElement.setAttribute("data-theme", theme);
  const { context, png, drawnFilters } = canvasContext();
  const image = document.createElement("img");
  Object.defineProperties(image, { naturalWidth: { value: 400 }, naturalHeight: { value: 200 } });
  vi.mocked(decodeAvatar).mockResolvedValue(image);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["synthetic-brand"]) }));
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
  const image = document.createElement("img");
  Object.defineProperties(image, { naturalWidth: { value: 256 }, naturalHeight: { value: 256 } });
  let finish!: (image: HTMLImageElement) => void;
  vi.mocked(decodeAvatar).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["synthetic-brand"]) }));
  try {
    const pending = materializeBrandAvatar(id);
    await vi.waitFor(() => expect(decodeAvatar).toHaveBeenCalledOnce());
    document.documentElement.setAttribute("data-theme", "dark");
    finish(image);
    const result = await pending;
    expect(drawnFilters).toEqual([id === "zhipu" ? "invert(1)" : "none"]);
    expect(context.fillRect).not.toHaveBeenCalled();
    expect(result).toEqual({ original: png, thumbnail: png, crop: { x: .5, y: .5, zoom: 1 } });
  } finally {
    if (previousTheme === null) document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", previousTheme);
  }
});
