import { expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getWindowController } from "./windowController";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));

it("never accesses native APIs in the browser", () => {
  vi.mocked(isTauri).mockReturnValue(false);
  expect(getWindowController()).toBeUndefined();
  expect(getCurrentWindow).not.toHaveBeenCalled();
});

it("delegates to the current native window, retaining event cleanup", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  const cleanup = vi.fn();
  const native = {
    isDecorated: vi.fn().mockResolvedValue(false), isMaximized: vi.fn().mockResolvedValue(true),
    onResized: vi.fn().mockResolvedValue(cleanup), minimize: vi.fn().mockResolvedValue(undefined),
    toggleMaximize: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
  vi.mocked(getCurrentWindow).mockReturnValue(native as unknown as ReturnType<typeof getCurrentWindow>);
  const window = getWindowController()!;
  expect(await window.isDecorated()).toBe(false);
  expect(await window.isMaximized()).toBe(true);
  const listener = vi.fn();
  expect(await window.onResize(listener)).toBe(cleanup);
  expect(native.onResized).toHaveBeenCalledWith(listener);
  await window.minimize(); await window.toggleMaximize(); await window.close();
  expect(native.minimize).toHaveBeenCalledOnce();
  expect(native.toggleMaximize).toHaveBeenCalledOnce();
  expect(native.close).toHaveBeenCalledOnce();
});
