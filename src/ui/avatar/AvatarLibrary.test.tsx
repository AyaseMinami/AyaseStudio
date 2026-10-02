// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { avatarLibrary } from "../../avatar/library";
import { centeredCrop, decodeAvatar, renderAvatar } from "../../avatar/image";
import type { AvatarLibraryEntry } from "../../avatar/library";
import { AvatarLibraryPanel, AssistantAvatarSelector } from "./AvatarLibrary";
import { AvatarSettings } from "../settings/AvatarSettings";

vi.mock("../../avatar/library", () => ({ avatarLibrary: { list: vi.fn(), usages: vi.fn(), select: vi.fn(), import: vi.fn(), rename: vi.fn(), replace: vi.fn(), remove: vi.fn(), removeMany: vi.fn() } }));
vi.mock("../../avatar/image", async (original) => ({ ...await original<typeof import("../../avatar/image")>(), decodeAvatar: vi.fn(), renderAvatar: vi.fn() }));
let root: Root, host: HTMLDivElement;
const save = vi.fn(), apply = vi.fn(), close = vi.fn();
const entry: AvatarLibraryEntry = { id: "one", name: "雪", version: "v1", avatar: { original: new Blob(["original"], { type: "image/png" }), thumbnail: new Blob(["thumbnail"]), crop: centeredCrop } };
let entries: AvatarLibraryEntry[];
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.clearAllMocks(); save.mockResolvedValue(true); entries = [entry];
  vi.mocked(avatarLibrary.list).mockImplementation(async () => entries); vi.mocked(avatarLibrary.usages).mockResolvedValue([]); vi.mocked(avatarLibrary.select).mockResolvedValue(entry.avatar);
  vi.mocked(avatarLibrary.import).mockImplementation(async (name, avatar) => { const added = { id: "two", name, version: "v1", avatar }; entries = [...entries, added]; return added; });
  vi.mocked(avatarLibrary.replace).mockResolvedValue({ ...entry, version: "v2" });
  vi.mocked(avatarLibrary.remove).mockImplementation(async (id) => { entries = entries.filter((entry) => entry.id !== id); });
  vi.mocked(avatarLibrary.removeMany).mockImplementation(async (ids) => { entries = entries.filter((entry) => !ids.includes(entry.id)); });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview"); vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) { this.open = true; }); vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) { this.open = false; });
  const image = document.createElement("img"); Object.defineProperties(image, { naturalWidth: { value: 400 }, naturalHeight: { value: 300 } });
  vi.mocked(decodeAvatar).mockResolvedValue(image); vi.mocked(renderAvatar).mockResolvedValue(new Blob(["crop"], { type: "image/png" }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
async function mount(selector = false) { await act(async () => root.render(selector ? <AssistantAvatarSelector assistantName="晴" onApply={apply} onClose={close} /> : <AvatarLibraryPanel avatar={{ busy: false, value: undefined, url: undefined, error: undefined, save }} />)); }
async function click(label: string) { const button = [...host.querySelectorAll("button")].find((button) => button.textContent === label || button.getAttribute("aria-label") === label); expect(button, label).toBeTruthy(); await act(async () => button!.click()); }
async function file(next = new File(["source"], "photo.png", { type: "image/png" })) { const input = host.querySelector<HTMLInputElement>('input[type="file"]')!; Object.defineProperty(input, "files", { configurable: true, value: [next] }); await act(async () => input.dispatchEvent(new Event("change", { bubbles: true }))); }

it("offers one name-based automatic candidate and applies it only after explicit use", async () => {
  await act(async () => root.render(<AssistantAvatarSelector assistantName="晴" assistantId="a" value={entry.avatar} defaultAvatar="green" onApply={apply} onClose={close} />));
  expect(host.querySelectorAll(".assistant-avatar-default-choice")).toHaveLength(1);
  expect(host.querySelector(".assistant-avatar-default-choice .assistant-avatar-initial")?.textContent).toBe("晴");
  expect(host.textContent).not.toContain("晴蓝"); expect(host.textContent).not.toContain("当前草稿");
  await click("选择自动头像"); expect(apply).not.toHaveBeenCalled();
  await click("清除选择");
  expect([...host.querySelectorAll("button")].find((button) => button.textContent === "使用此头像")?.disabled).toBe(true);
  await click("选择自动头像"); await click("使用此头像");
  expect(apply).toHaveBeenCalledWith(undefined, undefined);
  expect(avatarLibrary.select).not.toHaveBeenCalled(); expect(avatarLibrary.removeMany).not.toHaveBeenCalled();
});

it("does not label the automatic candidate as the draft when a legacy emoji is present", async () => {
  await act(async () => root.render(<AssistantAvatarSelector assistantName="晴" assistantId="a" legacyIcon="😀" onApply={apply} onClose={close} />));
  expect(host.textContent).not.toContain("当前草稿");
  await click("选择自动头像"); await click("取消"); expect(apply).not.toHaveBeenCalled(); expect(close).toHaveBeenCalled();
});

it("imports with crop and name without applying, then explicitly applies a selected candidate", async () => {
  await mount();
  expect(host.querySelectorAll(".avatar-card")).toHaveLength(1);
  expect(host.querySelectorAll("[data-import-avatar]")).toHaveLength(1);
  const picker = vi.spyOn(host.querySelector<HTMLInputElement>('input[type="file"]')!, "click");
  await click("导入图片"); expect(picker).toHaveBeenCalledOnce();
  await file(); expect(save).not.toHaveBeenCalled(); await click("保存到头像库");
  expect(avatarLibrary.import).toHaveBeenCalledWith("photo", expect.objectContaining({ crop: centeredCrop })); expect(save).not.toHaveBeenCalled();
  expect(host.querySelector('[aria-label="选择 photo"]')?.getAttribute("aria-pressed")).toBe("true");
  await click("用作用户头像"); expect(avatarLibrary.select).toHaveBeenLastCalledWith("two");
  save.mockClear();
  await click("选择 雪"); expect(save).not.toHaveBeenCalled(); await click("清除选择"); expect(host.querySelector('[aria-label="选择 雪"]')?.getAttribute("aria-pressed")).toBe("false");
  await click("选择 雪"); await click("用作用户头像"); expect(save).toHaveBeenCalledWith(entry.avatar);
});
it("cancels a settings import without saving or changing the selected candidate", async () => {
  await mount(); await click("选择 雪"); await file(); await click("取消");
  expect(avatarLibrary.import).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  expect(host.querySelector('[aria-label="选择 雪"]')?.getAttribute("aria-pressed")).toBe("true");
  expect(document.activeElement?.textContent).toBe("导入图片");
});
it("keeps import in the same assistant modal and preserves its candidate on return and selector cancel", async () => {
  await mount(true); await click("选择 雪"); await file(); expect(host.querySelectorAll("dialog")).toHaveLength(1);
  await click("取消"); expect(host.querySelector('[aria-label="选择 雪"]')?.getAttribute("aria-pressed")).toBe("true");
  await file(); await click("保存到头像库"); await click("取消"); expect(close).toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled(); expect(avatarLibrary.import).toHaveBeenCalledTimes(1);
});
it("rejects oversized and unsupported imports before decoding", async () => {
  await mount(); await file(new File(["bad"], "photo.gif", { type: "image/gif" }));
  const oversized = new File(["big"], "photo.png", { type: "image/png" }); Object.defineProperty(oversized, "size", { value: 20 * 1024 * 1024 + 1 }); await file(oversized);
  expect(decodeAvatar).not.toHaveBeenCalled(); expect(host.textContent).toContain("20 MB"); expect(avatarLibrary.import).not.toHaveBeenCalled();
});
it("allows removing an in-use entry from the library without changing its owners", async () => {
  vi.mocked(avatarLibrary.usages).mockResolvedValue([{ id: "user", name: "用户头像" }, { id: "assistant", name: "晴" }]); await mount();
  await click("管理"); await click("勾选 雪"); expect(host.textContent).not.toContain("重命名");
  await click("删除所选（1）");
  expect(host.querySelector("dialog")?.textContent).toContain("已使用此图片的头像不受影响");
  expect(host.querySelector("dialog")?.textContent).not.toContain("用户头像、晴");
  expect(avatarLibrary.removeMany).not.toHaveBeenCalled();
  await click("取消"); expect(avatarLibrary.removeMany).not.toHaveBeenCalled();
  await click("删除所选（1）"); await click("确认删除");
  expect(avatarLibrary.removeMany).toHaveBeenCalledWith(["one"]);
  expect(save).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled();
});
it("warns that replacements retain existing snapshots and deletes unused entries only after confirmation", async () => {
  await mount(); await click("管理"); await click("勾选 雪"); await click("替换图片"); await file(); expect(host.textContent).toContain("保留原头像");
  await click("保存替换"); expect(avatarLibrary.replace).toHaveBeenCalledWith("one", expect.objectContaining({ crop: centeredCrop })); expect(save).not.toHaveBeenCalled();
  await click("删除所选（1）"); expect(avatarLibrary.removeMany).not.toHaveBeenCalled(); await click("确认删除"); expect(avatarLibrary.removeMany).toHaveBeenCalledWith(["one"]);
});
it("returns from inline crop on Escape and restores focus when the selector unmounts", async () => {
  const trigger = document.createElement("button"); document.body.append(trigger); trigger.focus(); await mount(true); await file();
  await act(async () => host.querySelector("section")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(host.querySelector("svg.avatar-crop-stage")).toBeNull(); expect(close).not.toHaveBeenCalled();
  await act(async () => root.render(null)); expect(document.activeElement).toBe(trigger); trigger.remove();
});

it("keeps the apply candidate separate from management multi-selection and clears it only if deleted", async () => {
  entries = [entry, { ...entry, id: "two", name: "月" }, { ...entry, id: "three", name: "星" }];
  await mount(); await click("选择 雪"); await click("管理");
  expect(host.querySelector('[aria-label="勾选 雪"]')?.getAttribute("aria-checked")).toBe("false");
  await click("勾选 月"); await click("勾选 星");
  expect([...host.querySelectorAll('button')].find((button) => button.textContent === "替换图片")?.disabled).toBe(true);
  expect(host.textContent).not.toContain("用作用户头像");
  await click("删除所选（2）"); await click("取消");
  expect(avatarLibrary.removeMany).not.toHaveBeenCalled();
  expect(host.querySelectorAll('[aria-checked="true"]')).toHaveLength(2);
  await click("删除所选（2）"); await click("确认删除");
  expect(avatarLibrary.removeMany).toHaveBeenCalledWith(["two", "three"]);
  expect(save).not.toHaveBeenCalled();
  await click("完成管理"); expect(host.querySelector('[aria-label="选择 雪"]')?.getAttribute("aria-pressed")).toBe("true");
  await click("管理"); await click("全选"); await click("取消全选"); expect(host.querySelectorAll('[aria-checked="true"]')).toHaveLength(0);
  await click("全选"); await click("删除所选（1）"); await click("确认删除"); await click("完成管理");
  expect([...host.querySelectorAll('button')].find((button) => button.textContent === "用作用户头像")?.disabled).toBe(true);
});

it("retains the management selection after failed deletion and retries without applying", async () => {
  await mount(); await click("管理"); await click("全选"); await click("删除所选（1）");
  vi.mocked(avatarLibrary.removeMany).mockRejectedValueOnce(new Error("删除失败"));
  await click("确认删除"); expect(host.querySelector('dialog')?.textContent).toContain("删除失败");
  expect(host.querySelector('[aria-label="勾选 雪"]')?.getAttribute("aria-checked")).toBe("true");
  await click("确认删除"); expect(host.querySelector('dialog')).toBeNull(); expect(save).not.toHaveBeenCalled();
});

it("imports without a name input and restores focus on cancellation", async () => {
  await mount(true); await file();
  expect(host.querySelector('input:not([type="file"]):not([type="range"])')).toBeNull();
  await click("取消"); expect(host.querySelector("svg.avatar-crop-stage")).toBeNull(); expect(document.activeElement?.textContent).toBe("导入图片");
  expect(avatarLibrary.import).not.toHaveBeenCalled();
});
it("uses a fallback label for a filename without a usable stem", async () => {
  await mount(); await file(new File(["source"], ".png", { type: "image/png" })); await click("保存到头像库");
  expect(avatarLibrary.import).toHaveBeenCalledWith("头像", expect.anything()); expect(save).not.toHaveBeenCalled();
});

it("restores a user default without removing library resources and recrops with source metadata", async () => {
  const current = { ...entry.avatar, source: { resourceId: entry.id, version: entry.version } };
  await act(async () => root.render(<AvatarSettings avatar={{ value: current, url: "blob:current", busy: false, error: undefined, save }} onImport={() => {}} />));
  expect(host.querySelector('input[type="file"]')).toBeNull();
  await click("重新裁切"); await click("应用头像"); expect(save).toHaveBeenCalledWith(expect.objectContaining({ source: current.source, original: current.original }));
  await click("恢复默认"); expect(save).toHaveBeenLastCalledWith(); expect(avatarLibrary.remove).not.toHaveBeenCalled();
});

it("drains a usage refresh queued by user restore during the initial load", async () => {
  let resolve!: (entries: AvatarLibraryEntry[]) => void;
  vi.mocked(avatarLibrary.list).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  vi.mocked(avatarLibrary.usages).mockResolvedValueOnce([{ id: "user", name: "用户头像" }]).mockResolvedValue([]);
  const current = { ...entry.avatar, source: { resourceId: entry.id, version: entry.version } };
  await act(async () => root.render(<AvatarLibraryPanel avatar={{ value: current, url: "blob:current", busy: false, error: undefined, save }} />));
  await act(async () => root.render(<AvatarLibraryPanel avatar={{ value: undefined, url: undefined, busy: false, error: undefined, save }} />));
  await act(async () => resolve([entry]));
  expect(avatarLibrary.list).toHaveBeenCalledTimes(2); expect(avatarLibrary.usages).toHaveBeenCalledTimes(2);
  expect(host.textContent).not.toContain("使用中");
});

it("closes an import after commit even if list reload fails, so retry only reloads", async () => {
  await mount(); await file(); vi.mocked(avatarLibrary.list).mockRejectedValueOnce(new Error("read failure"));
  await click("保存到头像库");
  expect(host.querySelector("dialog")).toBeNull(); expect(host.textContent).toContain("更改已保存");
  expect(host.querySelector('[aria-label="选择 photo"]')).not.toBeNull(); expect(avatarLibrary.import).toHaveBeenCalledTimes(1);
  expect([...host.querySelectorAll("button")].some((button) => button.textContent === "保存到头像库")).toBe(false);
  await click("刷新头像库"); expect(avatarLibrary.import).toHaveBeenCalledTimes(1); expect(host.querySelector('[role="alert"]')).toBeNull();
});
