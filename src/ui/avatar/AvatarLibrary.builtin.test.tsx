// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { avatarLibrary, type AvatarLibraryEntry } from "../../avatar/library";
import { brandAvatars, materializeBrandAvatar } from "../../avatar/brandCatalog";
import type { UserAvatar } from "../../avatar/repository";
import { AvatarLibraryPanel } from "./AvatarLibrary";

vi.mock("../../avatar/library", () => ({ avatarLibrary: { list: vi.fn(), usages: vi.fn(), select: vi.fn(), replace: vi.fn(), removeMany: vi.fn() } }));
vi.mock("../../avatar/brandCatalog", async (original) => ({ ...await original<typeof import("../../avatar/brandCatalog")>(), materializeBrandAvatar: vi.fn() }));
let root: Root, host: HTMLDivElement;
const apply = vi.fn(), builtinApply = vi.fn(), save = vi.fn();
const snapshot: UserAvatar = { original: new Blob(["png"], { type: "image/png" }), thumbnail: new Blob(["png"], { type: "image/png" }), crop: { x: .5, y: .5, zoom: 1 } };
const entry: AvatarLibraryEntry = { id: "user-picture", name: "我的图片", version: "v1", avatar: snapshot };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.clearAllMocks();
  vi.mocked(avatarLibrary.list).mockResolvedValue([entry]); vi.mocked(avatarLibrary.usages).mockResolvedValue([]);
  vi.mocked(avatarLibrary.select).mockResolvedValue(snapshot); vi.mocked(materializeBrandAvatar).mockResolvedValue(snapshot);
  save.mockResolvedValue(true);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find((button) => button.textContent === label || button.getAttribute("aria-label") === label);
  expect(button, label).toBeTruthy(); await act(async () => button!.click());
}

it("shares all eleven builtins and applies supplier IDs only after explicit use", async () => {
  await act(async () => root.render(<AvatarLibraryPanel inline onApply={apply} onBuiltinApply={builtinApply} />));
  expect(host.querySelector('[aria-label="内置头像"]')?.querySelectorAll("button")).toHaveLength(11);
  expect(host.textContent).toContain("我的头像");
  for (const brand of brandAvatars) expect(host.querySelector(`[aria-label="选择 ${brand.label}"]`)).not.toBeNull();
  await click("选择 OpenAI"); expect(builtinApply).not.toHaveBeenCalled();
  await click("使用此头像"); expect(builtinApply).toHaveBeenCalledWith("openai");
  expect(materializeBrandAvatar).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled();
  await click("选择 我的图片"); await click("使用此头像");
  expect(avatarLibrary.select).toHaveBeenCalledWith(entry.id); expect(apply).toHaveBeenCalledWith(snapshot);
});

it("materializes existing assistant callbacks and user saves as independent snapshots", async () => {
  await act(async () => root.render(<AvatarLibraryPanel inline onApply={apply} />));
  await click("选择 OpenAI"); await click("使用此头像");
  expect(materializeBrandAvatar).toHaveBeenCalledWith("openai"); expect(apply).toHaveBeenCalledWith(snapshot);
  await act(async () => root.render(<AvatarLibraryPanel avatar={{ value: undefined, url: undefined, busy: false, error: undefined, save }} />));
  await click("选择 Anthropic"); await click("用作用户头像");
  expect(materializeBrandAvatar).toHaveBeenCalledWith("anthropic"); expect(save).toHaveBeenCalledWith(snapshot);
  expect(avatarLibrary.select).not.toHaveBeenCalled();
});

it("keeps builtins read-only during management and selects only user entries for deletion", async () => {
  await act(async () => root.render(<AvatarLibraryPanel />));
  await click("管理");
  const builtinButtons = [...host.querySelector('[aria-label="内置头像"]')!.querySelectorAll("button")];
  expect(builtinButtons.every((button) => button.disabled && button.getAttribute("role") !== "checkbox")).toBe(true);
  await click("全选");
  expect(host.querySelectorAll('[role="checkbox"][aria-checked="true"]')).toHaveLength(1);
  expect(host.textContent).toContain("删除所选（1）");
  expect(avatarLibrary.removeMany).not.toHaveBeenCalled(); expect(avatarLibrary.replace).not.toHaveBeenCalled();
});

it("does not apply a materialized builtin after its selector unmounts", async () => {
  let resolve!: (avatar: UserAvatar) => void;
  vi.mocked(materializeBrandAvatar).mockImplementation(() => new Promise((done) => { resolve = done; }));
  await act(async () => root.render(<AvatarLibraryPanel inline onApply={apply} />));
  await click("选择 OpenAI"); await click("使用此头像");
  await act(async () => root.unmount());
  await act(async () => resolve(snapshot));
  expect(apply).not.toHaveBeenCalled();
});

it("prevents duplicate materialization while an application is pending", async () => {
  let resolve!: (avatar: UserAvatar) => void;
  vi.mocked(materializeBrandAvatar).mockImplementation(() => new Promise((done) => { resolve = done; }));
  await act(async () => root.render(<AvatarLibraryPanel inline onApply={apply} />));
  await click("选择 OpenAI"); await click("使用此头像"); await click("使用此头像");
  expect(materializeBrandAvatar).toHaveBeenCalledOnce();
  await act(async () => resolve(snapshot)); expect(apply).toHaveBeenCalledOnce();
});
