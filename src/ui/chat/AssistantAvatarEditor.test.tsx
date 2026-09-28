// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { centeredCrop, decodeAvatar, renderAvatar } from "../../avatar/image";
import type { UserAvatar } from "../../avatar/repository";
import { AssistantAvatarEditor } from "./AssistantAvatarEditor";

vi.mock("../../avatar/image", async (original) => ({
  ...await original<typeof import("../../avatar/image")>(), decodeAvatar: vi.fn(), renderAvatar: vi.fn(),
}));
let root: Root;
let host: HTMLDivElement;
const change = vi.fn();
const defaultChange = vi.fn();
const busyChange = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  change.mockReset(); defaultChange.mockReset(); busyChange.mockReset();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:editor");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) { this.open = false; });
  const image = document.createElement("img");
  Object.defineProperties(image, { naturalWidth: { value: 400 }, naturalHeight: { value: 300 } });
  vi.mocked(decodeAvatar).mockReset().mockResolvedValue(image);
  vi.mocked(renderAvatar).mockReset().mockResolvedValue(new Blob(["cropped"], { type: "image/png" }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

async function mount(value?: UserAvatar, parentKeyDown = vi.fn()) {
  await act(async () => root.render(<div onKeyDown={parentKeyDown}><AssistantAvatarEditor value={value} defaultAvatar="blue" onChange={change} onDefaultChange={defaultChange} onBusyChange={busyChange} /></div>));
}
async function select(file: File) {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}
async function click(label: string) {
  await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === label)!.click());
}

it("keeps a crop local until application, isolates nested keys, and releases cancel previews", async () => {
  const parentKeyDown = vi.fn();
  await mount(undefined, parentKeyDown);
  await select(new File(["source"], "photo.png", { type: "image/png" }));
  expect(change).not.toHaveBeenCalled();
  expect(host.querySelector("dialog")?.open).toBe(true);
  expect(busyChange).toHaveBeenLastCalledWith(false);
  await act(async () => {
    host.querySelector("dialog")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    host.querySelector("dialog")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  });
  expect(parentKeyDown).not.toHaveBeenCalled();
  await click("取消");
  expect(change).not.toHaveBeenCalled();
  expect(host.querySelector("dialog")).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:editor");
});

it("rejects unsupported and oversized files without changing the saved draft", async () => {
  await mount();
  await select(new File(["source"], "photo.gif", { type: "image/gif" }));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("20 MB");
  const oversized = new File(["source"], "large.png", { type: "image/png" });
  Object.defineProperty(oversized, "size", { value: 20 * 1024 * 1024 + 1 });
  await select(oversized);
  expect(decodeAvatar).not.toHaveBeenCalled();
  expect(change).not.toHaveBeenCalled();
});

it("recrops the original, applies a local thumbnail, and allows removal or built-in selection", async () => {
  const value: UserAvatar = { original: new Blob(["source"], { type: "image/jpeg" }), thumbnail: new Blob(["old"]), crop: { ...centeredCrop, zoom: 2 } };
  await mount(value);
  await click("重新裁切");
  expect(decodeAvatar).toHaveBeenCalledWith(value.original);
  await click("应用头像");
  expect(renderAvatar).toHaveBeenCalledWith(expect.any(HTMLImageElement), value.crop);
  expect(change).toHaveBeenCalledWith({ original: value.original, thumbnail: expect.any(Blob), crop: value.crop });
  expect(host.querySelector("dialog")).toBeNull();
  await click("移除图片");
  expect(change).toHaveBeenLastCalledWith(undefined);
  await click("青绿");
  expect(defaultChange).toHaveBeenLastCalledWith("green");
});

it("retains the prior value on decoding or crop failure", async () => {
  await mount();
  vi.mocked(decodeAvatar).mockRejectedValueOnce(new Error("无法读取图片"));
  await select(new File(["source"], "photo.png", { type: "image/png" }));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("无法读取");
  await select(new File(["source"], "photo.webp", { type: "image/webp" }));
  vi.mocked(renderAvatar).mockRejectedValueOnce(new Error("canvas"));
  await click("应用头像");
  expect(change).not.toHaveBeenCalled();
  expect(host.querySelector("dialog")).not.toBeNull();
  expect(host.textContent).toContain("原头像已保留");
});

it("ignores a late decode after unmount without allocating a preview", async () => {
  await mount();
  let resolve!: (image: HTMLImageElement) => void;
  vi.mocked(decodeAvatar).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  await select(new File(["source"], "photo.png", { type: "image/png" }));
  await act(async () => root.render(null));
  await act(async () => resolve(document.createElement("img")));
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(change).not.toHaveBeenCalled();
});

it("ignores a late rendered crop after unmount", async () => {
  await mount();
  await select(new File(["source"], "photo.png", { type: "image/png" }));
  let resolve!: (blob: Blob) => void;
  vi.mocked(renderAvatar).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  await click("应用头像");
  expect(busyChange).toHaveBeenLastCalledWith(true);
  await act(async () => root.render(null));
  await act(async () => resolve(new Blob(["late"])));
  expect(change).not.toHaveBeenCalled();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:editor");
});
