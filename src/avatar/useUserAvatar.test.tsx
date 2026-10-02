// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useUserAvatar, type UserAvatarState } from "./useUserAvatar";
import type { AvatarRepository, UserAvatar } from "./repository";
import { centeredCrop } from "./image";
import { decodeAvatar } from "./image";

vi.mock("./image", async (original) => ({ ...await original<typeof import("./image")>(), decodeAvatar: vi.fn(async () => ({})) }));
afterEach(() => vi.restoreAllMocks());

it.each(["missing", "corrupt"])("falls back safely when the persisted avatar is %s", async (failure) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const original: UserAvatar = { original: new Blob(["source"]), thumbnail: new Blob(["broken"]), crop: centeredCrop };
  if (failure === "corrupt") vi.mocked(decodeAvatar).mockRejectedValueOnce(new Error("invalid image"));
  const store: AvatarRepository = {
    load: async () => { if (failure === "missing") throw new Error("missing resource"); return original; },
    save: vi.fn(async () => {}), remove: vi.fn(async () => {}),
  };
  let state!: UserAvatarState;
  function Harness() { state = useUserAvatar(store); return null; }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Harness />));
    expect(state.value).toBeUndefined(); expect(state.url).toBeUndefined();
    expect(state.error).toContain("默认"); expect(state.busy).toBe(false);
    await act(async () => { expect(await state.save()).toBe(true); });
    expect(state.error).toBeUndefined(); expect(store.remove).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); }
});

it("preserves the current avatar when replacement or removal cannot be persisted", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-avatar");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const original: UserAvatar = { original: new Blob(["source"]), thumbnail: new Blob(["preview"]), crop: centeredCrop };
  const store: AvatarRepository = { load: async () => original, save: vi.fn(async () => { throw new Error("quota"); }), remove: vi.fn(async () => { throw new Error("storage"); }) };
  let state!: UserAvatarState;
  function Harness() { state = useUserAvatar(store); return null; }
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<Harness />));
    expect(state.url).toBe("blob:test-avatar");
    await act(async () => { expect(await state.save({ ...original, crop: { ...centeredCrop, zoom: 2 } })).toBe(false); });
    expect(state.value).toBe(original);
    await act(async () => { expect(await state.save()).toBe(false); });
    expect(state.value).toBe(original);
    expect(state.error).toContain("原头像已保留");
    expect(revoke).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); }
  expect(revoke).toHaveBeenCalledWith("blob:test-avatar");
});
