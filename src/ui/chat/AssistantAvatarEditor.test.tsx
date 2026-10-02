// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { centeredCrop, decodeAvatar, renderAvatar } from "../../avatar/image";
import { avatarLibrary } from "../../avatar/library";
import type { UserAvatar } from "../../avatar/repository";
import { AssistantAvatarEditor } from "./AssistantAvatarEditor";

vi.mock("../../avatar/image", async (original) => ({ ...await original<typeof import("../../avatar/image")>(), decodeAvatar: vi.fn(), renderAvatar: vi.fn() }));
vi.mock("../../avatar/library", () => ({ avatarLibrary: { list: vi.fn(), usages: vi.fn(), select: vi.fn(), import: vi.fn(), rename: vi.fn(), replace: vi.fn(), remove: vi.fn() } }));
let root: Root;
let host: HTMLDivElement;
const change = vi.fn(), defaultChange = vi.fn(), busyChange = vi.fn();
const value: UserAvatar = { original: new Blob(["source"], { type: "image/jpeg" }), thumbnail: new Blob(["old"]), crop: { ...centeredCrop, zoom: 2 }, source: { resourceId: "saved", version: "v1" } };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  change.mockReset(); defaultChange.mockReset(); busyChange.mockReset();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:editor"); vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) { this.open = false; });
  const image = document.createElement("img"); Object.defineProperties(image, { naturalWidth: { value: 400 }, naturalHeight: { value: 300 } });
  vi.mocked(decodeAvatar).mockReset().mockResolvedValue(image); vi.mocked(renderAvatar).mockReset().mockResolvedValue(new Blob(["cropped"], { type: "image/png" }));
  vi.mocked(avatarLibrary.list).mockResolvedValue([{ id: "saved", name: "照片", version: "v1", avatar: value }]);
  vi.mocked(avatarLibrary.usages).mockResolvedValue([]); vi.mocked(avatarLibrary.select).mockReset().mockResolvedValue(value);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
async function mount(avatar?: UserAvatar, parentKeyDown = vi.fn()) { await act(async () => root.render(<div onKeyDown={parentKeyDown}><AssistantAvatarEditor assistantName="晴" assistantId="a" value={avatar} defaultAvatar="blue" onChange={change} onDefaultChange={defaultChange} onBusyChange={busyChange} /></div>)); }
async function click(label: string) { const button = [...host.querySelectorAll("button")].find((button) => button.textContent === label || button.getAttribute("aria-label") === label); expect(button, label).toBeTruthy(); await act(async () => button!.click()); }

it("names the selector and separates candidates, cancellation, and explicit draft application", async () => {
  const parentKeyDown = vi.fn(); await mount(undefined, parentKeyDown); await click("选择头像");
  expect(host.querySelector("dialog")?.getAttribute("aria-label")).toBe("为 晴 选择头像");
  await click("选择 照片"); expect(change).not.toHaveBeenCalled();
  await act(async () => host.querySelector("dialog")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
  expect(parentKeyDown).not.toHaveBeenCalled(); await click("取消"); expect(change).not.toHaveBeenCalled();
  await click("选择头像"); await click("选择 照片"); await click("使用此头像");
  expect(change).toHaveBeenCalledWith(value); expect(host.querySelector("dialog")).toBeNull(); expect(busyChange).toHaveBeenLastCalledWith(false);
});
it("requires explicit use for automatic avatars and clears image and legacy default only on apply", async () => {
  await mount(value); await click("选择头像"); await click("选择自动头像");
  expect(host.querySelector('.assistant-avatar-default-choice .assistant-avatar-initial')?.textContent).toBe("晴");
  expect(defaultChange).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled();
  await click("取消"); expect(defaultChange).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled();
  await click("选择头像"); await click("选择自动头像"); await click("使用此头像");
  expect(defaultChange).toHaveBeenCalledWith(undefined); expect(change).toHaveBeenCalledWith(undefined);
  expect(avatarLibrary.remove).not.toHaveBeenCalled();
});
it("recrops legacy or library snapshots and preserves source metadata", async () => {
  await mount(value); await click("重新裁切"); expect(decodeAvatar).toHaveBeenCalledWith(value.original);
  await click("应用头像"); expect(change).toHaveBeenCalledWith({ ...value, thumbnail: expect.any(Blob) });
  await click("移除图片"); expect(change).toHaveBeenLastCalledWith(undefined);
  expect(defaultChange).toHaveBeenLastCalledWith(undefined); expect(avatarLibrary.remove).not.toHaveBeenCalled();
});
it("retains the prior value on crop failure and releases cancelled previews", async () => {
  await mount(value); await click("重新裁切"); vi.mocked(renderAvatar).mockRejectedValueOnce(new Error("canvas"));
  await click("应用头像"); expect(change).not.toHaveBeenCalled(); expect(host.textContent).toContain("原头像已保留");
  await click("取消"); expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:editor");
});
it("ignores a late recrop decode after unmount", async () => {
  await mount(value); const allocated = vi.mocked(URL.createObjectURL).mock.calls.length;
  let resolve!: (image: HTMLImageElement) => void; vi.mocked(decodeAvatar).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  await click("重新裁切"); await act(async () => root.render(null)); await act(async () => resolve(document.createElement("img")));
  expect(URL.createObjectURL).toHaveBeenCalledTimes(allocated); expect(change).not.toHaveBeenCalled();
});

it("blocks Escape while a rendered crop is pending", async () => {
  await mount(value); await click("重新裁切");
  let resolve!: (blob: Blob) => void; vi.mocked(renderAvatar).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  await click("应用头像");
  await act(async () => host.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true })));
  expect(host.querySelector("dialog")).not.toBeNull(); expect(change).not.toHaveBeenCalled();
  await act(async () => resolve(new Blob(["rendered"])));
  expect(change).toHaveBeenCalledTimes(1); expect(host.querySelector("dialog")).toBeNull();
});

it("previews the current edited name with a stable identity color", async () => {
  const render = (assistantName: string) => root.render(<AssistantAvatarEditor assistantName={assistantName} assistantId="a" onChange={change} onDefaultChange={defaultChange} />);
  await act(async () => render("alice"));
  const background = host.querySelector<HTMLElement>(".assistant-avatar-editor-preview")!.style.background;
  expect(host.querySelector(".assistant-avatar-initial")?.textContent).toBe("A");
  await act(async () => render("晴"));
  expect(host.querySelector(".assistant-avatar-initial")?.textContent).toBe("晴");
  expect(host.querySelector<HTMLElement>(".assistant-avatar-editor-preview")!.style.background).toBe(background);
  expect(change).not.toHaveBeenCalled(); expect(defaultChange).not.toHaveBeenCalled();
});
