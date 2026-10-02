// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DrawingReferences } from "./DrawingReferences";
import type { DrawingImageInput } from "../../drawing/types";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const image = { mime: "image/png", data: "AQ==" };
function props() {
  return { references: [{ id: "ref", reference: "drawing/references/ref.png", name: "large.png", digest: "hash",
    mime: "image/png", size: 100, width: 4000, height: 2000 }], disabled: false, busy: false,
    read: vi.fn(async () => image), readThumbnail: vi.fn(async () => image),
    onAdd: vi.fn(), onRemove: vi.fn(), onMove: vi.fn() };
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.stubGlobal("IntersectionObserver", undefined);
  let sequence = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:image-${++sequence}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function click(label: string) {
  await act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
}

it("loads only a thumbnail until clicked and releases the separate original on close", async () => {
  const options = props();
  await act(async () => root.render(<DrawingReferences {...options} />));
  expect(options.readThumbnail).toHaveBeenCalledExactlyOnceWith(options.references[0].reference);
  expect(options.read).not.toHaveBeenCalled();
  await click("查看参考图 1");
  expect(options.read).toHaveBeenCalledExactlyOnceWith(options.references[0].reference);
  expect(host.querySelector('[role="dialog"] img')?.getAttribute("src")).toBe("blob:image-2");
  await act(async () => host.querySelector<HTMLButtonElement>('[role="dialog"] button')!.click());
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:image-2");
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:image-1");
  expect(document.activeElement).toBe(host.querySelector('[aria-label="查看参考图 1"]'));
});

it("does not fetch an original for a failed thumbnail but still allows explicit preview", async () => {
  const options = props(); options.readThumbnail.mockRejectedValue(new Error("unavailable"));
  await act(async () => root.render(<DrawingReferences {...options} />));
  expect(options.read).not.toHaveBeenCalled();
  await click("查看参考图 1");
  expect(options.read).toHaveBeenCalledTimes(1);
});

it("discards a late original when its preview closes during loading", async () => {
  const options = props();
  let resolve!: (value: DrawingImageInput) => void;
  options.read.mockImplementation(() => new Promise(done => { resolve = done; }));
  await act(async () => root.render(<DrawingReferences {...options} />));
  await click("查看参考图 1");
  expect(host.textContent).toContain("正在加载原图");
  await act(async () => host.querySelector<HTMLButtonElement>('[role="dialog"] button')!.click());
  await act(async () => resolve(image));
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});

it("waits for visibility before loading a reference thumbnail", async () => {
  let show!: () => void;
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) { show = () => callback([{ isIntersecting: true }]); }
    observe() {} disconnect() {}
  });
  const options = props();
  await act(async () => root.render(<DrawingReferences {...options} />));
  expect(options.readThumbnail).not.toHaveBeenCalled();
  await act(async () => show());
  expect(options.readThumbnail).toHaveBeenCalledTimes(1);
  expect(options.read).not.toHaveBeenCalled();
});

it("previews captured session blobs without native reads and releases each URL at its own lifetime", async () => {
  const options = props();
  const first = { id: "local-one", name: "first.png", blob: new Blob(["original-one"], { type: "image/png" }) };
  const second = { id: "local-two", name: "second.bmp", blob: new Blob(["original-two"], { type: "image/bmp" }) };
  await act(async () => root.render(<DrawingReferences {...options} references={[first, second]} />));
  expect(URL.createObjectURL).toHaveBeenNthCalledWith(1, first.blob);
  expect(URL.createObjectURL).toHaveBeenNthCalledWith(2, second.blob);
  expect(host.textContent).toContain("未提交的参考图仅在本次打开期间保留。");
  await click("查看参考图 1");
  expect(URL.createObjectURL).toHaveBeenNthCalledWith(3, first.blob);
  expect(host.querySelector('[role="dialog"] img')?.getAttribute("src")).toBe("blob:image-3");
  await act(async () => host.querySelector<HTMLButtonElement>('[role="dialog"] button')!.click());
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:image-3");
  expect(document.activeElement).toBe(host.querySelector('[aria-label="查看参考图 1"]'));
  await act(async () => root.render(<DrawingReferences {...options} references={[second, first]} />));
  expect(host.querySelector('[aria-label="查看参考图 1"] img')?.getAttribute("src")).toBe("blob:image-2");
  expect(URL.createObjectURL).toHaveBeenCalledTimes(3);
  await click("查看参考图 2");
  await act(async () => root.render(<DrawingReferences {...options} references={[second]} />));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:image-1");
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:image-4");
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:image-2");
  await act(async () => root.render(null));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:image-2");
  expect(options.read).not.toHaveBeenCalled();
  expect(options.readThumbnail).not.toHaveBeenCalled();
});

it("retains the selected Blob thumbnail when submission promotes it to a managed reference", async () => {
  const options = props();
  const local = { id: "local", name: "local.png", blob: new Blob(["original"], { type: "image/png" }) };
  await act(async () => root.render(<DrawingReferences {...options} references={[local]} />));
  const thumbnail = host.querySelector('.drawing-reference-thumbnail img');
  await act(async () => root.render(<DrawingReferences {...options} references={[{ ...options.references[0], id: local.id }]} />));
  expect(host.querySelector('.drawing-reference-thumbnail img')).toBe(thumbnail);
  expect(options.readThumbnail).not.toHaveBeenCalled();
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  await act(async () => root.render(<DrawingReferences {...options} references={[]} />));
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:image-1");
});

it("releases an open session preview and its thumbnail when unmounted", async () => {
  const options = props();
  const local = { id: "local", name: "local.webp", blob: new Blob(["original"], { type: "image/webp" }) };
  await act(async () => root.render(<DrawingReferences {...options} references={[local]} />));
  await click("查看参考图 1");
  await act(async () => root.render(null));
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:image-1");
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:image-2");
  expect(options.read).not.toHaveBeenCalled();
  expect(options.readThumbnail).not.toHaveBeenCalled();
});

it("does not reuse a retained session preview for a different managed file", async () => {
  const options = props();
  const local = { id: "local", name: "local.png", blob: new Blob(["original"], { type: "image/png" }) };
  const managed = { ...options.references[0], id: local.id };
  await act(async () => root.render(<DrawingReferences {...options} references={[local]} />));
  await act(async () => root.render(<DrawingReferences {...options} references={[managed]} />));
  const replacement = { ...managed, reference: "drawing/references/replacement.png" };
  await act(async () => root.render(<DrawingReferences {...options} references={[replacement]} />));
  expect(options.readThumbnail).toHaveBeenCalledExactlyOnceWith(replacement.reference);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:image-1");
  expect(host.querySelector('.drawing-reference-thumbnail img')?.getAttribute("src")).toBe("blob:image-2");
});

it("keeps managed thumbnails while generation updates unrelated props", async () => {
  const options = props();
  await act(async () => root.render(<DrawingReferences {...options} />));
  const thumbnail = host.querySelector('.drawing-reference-thumbnail img');
  await act(async () => root.render(<DrawingReferences {...options} references={options.references.map(item => ({ ...item }))} disabled />));
  expect(host.querySelector('.drawing-reference-thumbnail img')).toBe(thumbnail);
  expect(options.readThumbnail).toHaveBeenCalledTimes(1);
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
});
