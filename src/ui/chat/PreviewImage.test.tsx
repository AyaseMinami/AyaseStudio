// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SentAttachmentPreview } from "./SentAttachmentPreview";
import type { SentAttachment } from "../../chat/attachments";

const images: SentAttachment[] = ["first", "second"].map(name => ({ name: `${name}.png`, mimeType: "image/png", size: 3, reference: name }));
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let opener: HTMLButtonElement;
let resize: ResizeObserverCallback;
let bounds = { width: 400, height: 300 };
const read = vi.fn(async (item: SentAttachment) => ({ ...item, data: "AQID" }));

async function mount() {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  bounds = { width: 400, height: 300 };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ ...bounds, x: 0, y: 0, left: 0, top: 0, right: bounds.width, bottom: bounds.height, toJSON() {} }));
  vi.stubGlobal("ResizeObserver", class { constructor(callback: ResizeObserverCallback) { resize = callback; } observe() {} disconnect() {} });
  host = document.createElement("div"); opener = document.createElement("button");
  document.body.append(opener, host); root = createRoot(host);
  const navigate = vi.fn(); const close = vi.fn();
  const render = (item = images[0]) => root.render(<SentAttachmentPreview item={item} read={read} images={images} onNavigate={navigate} onClose={close} returnFocus={opener} />);
  await act(async () => render()); await decode();
  return { render, navigate, close };
}
async function decode() {
  const image = host.querySelector<HTMLImageElement>(".attachment-preview-image")!;
  Object.defineProperties(image, { naturalWidth: { value: 800, configurable: true }, naturalHeight: { value: 600, configurable: true } });
  await act(async () => image.dispatchEvent(new Event("load")));
}
const stage = () => host.querySelector<HTMLElement>(".attachment-preview-stage")!;
const transform = () => host.querySelector<HTMLImageElement>(".attachment-preview-image")!.style.transform;
async function click(label: string) { await act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click()); }
async function key(key: string, target: HTMLElement = stage(), shiftKey = false) {
  await act(async () => target.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true })));
}
async function pointer(type: string, x: number, y: number, pointerId = 1) {
  await act(async () => stage().dispatchEvent(new PointerEvent(type, { pointerId, clientX: x, clientY: y, button: 0, bubbles: true })));
}
afterEach(async () => {
  await act(async () => root?.unmount()); host?.remove(); opener?.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); read.mockClear();
});

it("fits without upscaling, bounds zoom, resets and never rereads the attachment to transform it", async () => {
  await mount();
  expect(host.querySelector<HTMLImageElement>("img")!.style.width).toBe("400px");
  expect(transform()).toContain("scale(1)");
  for (let i = 0; i < 12; i++) await click("放大图片");
  expect(host.querySelector("output")!.textContent).toBe("400%");
  expect(host.querySelector('[aria-label="放大图片"]')!.getAttribute("aria-disabled")).toBe("true");
  for (let i = 0; i < 30; i++) await click("缩小图片");
  expect(host.querySelector("output")!.textContent).toBe("25%");
  expect(stage().dataset.pannable).toBe("false");
  await key("0"); expect(transform()).toContain("translate(0px, 0px) scale(1)");
  expect(read).toHaveBeenCalledTimes(1);
});

it("clamps drag movement, ignores other pointers, stops on cancellation and keeps keyboard pan separate from image navigation", async () => {
  const { navigate } = await mount(); await click("放大图片");
  await pointer("pointerdown", 200, 150);
  await pointer("pointermove", 9999, 9999, 2);
  expect(transform()).toContain("translate(0px, 0px)");
  await pointer("pointermove", 9999, 9999);
  expect(transform()).toContain("translate(50px, 37.5px)");
  await pointer("pointercancel", 0, 0); await pointer("pointermove", -999, -999);
  expect(stage().dataset.dragging).toBe("false");
  expect(transform()).toContain("translate(50px, 37.5px)");
  await key("ArrowRight"); expect(transform()).toContain("translate(10px, 37.5px)"); expect(navigate).not.toHaveBeenCalled();
  await key("ArrowRight", host.querySelector('[role="dialog"]')!); expect(navigate).toHaveBeenCalledWith(images[1]);
  await act(async () => host.querySelector<HTMLButtonElement>(".attachment-preview-zoom button:last-child")!.click());
  expect(transform()).toContain("translate(0px, 0px) scale(1)");
});

it("consumes wheel events, clamps positions on resize and resets the view on image switch", async () => {
  const { render } = await mount();
  const wheel = new WheelEvent("wheel", { deltaY: -200, clientX: 200, clientY: 150, bubbles: true, cancelable: true });
  Object.defineProperties(wheel, { clientX: { value: 200 }, clientY: { value: 150 } });
  await act(async () => stage().dispatchEvent(wheel));
  expect(wheel.defaultPrevented).toBe(true); expect(transform()).not.toContain("scale(1)");
  await pointer("pointerdown", 200, 150); await pointer("pointermove", 9999, 9999); await pointer("pointerup", 9999, 9999);
  bounds = { width: 1200, height: 900 };
  await act(async () => resize([], {} as ResizeObserver));
  expect(transform()).toContain("translate(0px, 0px)");
  await act(async () => render(images[1])); await decode();
  expect(transform()).toContain("scale(1)"); expect(read).toHaveBeenCalledTimes(2);
  const outside = new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true });
  host.querySelector(".attachment-preview-heading")!.dispatchEvent(outside); expect(outside.defaultPrevented).toBe(true);
});

it("contains focus through all controls and the canvas, closes with Escape and restores focus without scrolling", async () => {
  const { close } = await mount();
  const button = host.querySelector<HTMLButtonElement>('[aria-label="关闭预览"]')!;
  expect(document.activeElement).toBe(button);
  await key("Tab", button, true); expect(document.activeElement).toBe(stage());
  await key("Tab"); expect(document.activeElement).toBe(button);
  await key("Escape"); expect(close).toHaveBeenCalledTimes(1);
  const focus = vi.spyOn(opener, "focus");
  await act(async () => root.unmount());
  expect(focus).toHaveBeenCalledWith({ preventScroll: true }); expect(document.activeElement).toBe(opener);
});

it("returns focus to Close when decode failure removes a focused canvas, retaining Escape and the focus loop", async () => {
  const { close } = await mount(); stage().focus();
  await act(async () => host.querySelector(".attachment-preview-image")!.dispatchEvent(new Event("error")));
  expect(host.querySelector(".attachment-preview-stage")).toBeNull();
  expect(host.querySelector('[role="alert"]')!.textContent).toContain("图片加载失败");
  const button = host.querySelector<HTMLButtonElement>('[aria-label="关闭预览"]')!;
  expect(document.activeElement).toBe(button);
  await key("Tab", button, true); expect(document.activeElement).toBe(host.querySelector('.attachment-preview-navigation button:last-child'));
  await key("Escape", document.activeElement as HTMLElement); expect(close).toHaveBeenCalledTimes(1);
});

it("keeps modal focus when an externally changed image removes a focused canvas for reloading", async () => {
  const { render } = await mount(); stage().focus();
  await act(async () => render(images[1])); await decode();
  expect(document.activeElement).toBe(host.querySelector('[aria-label="关闭预览"]'));
});
