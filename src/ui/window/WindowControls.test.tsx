// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WindowControls } from "./WindowControls";
import { getWindowController, type WindowController } from "./windowController";

vi.mock("./windowController", () => ({ getWindowController: vi.fn() }));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let resized: () => void;
let controller: WindowController;
const stop = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  stop.mockReset();
  controller = {
    isDecorated: vi.fn().mockResolvedValue(false),
    isMaximized: vi.fn().mockResolvedValue(false),
    onResize: vi.fn(async (listener) => { resized = listener; return stop; }),
    minimize: vi.fn().mockResolvedValue(undefined),
    toggleMaximize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  vi.mocked(getWindowController).mockReturnValue(controller);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const mount = () => act(async () => root.render(<WindowControls />));
const button = (label: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;

it("hides controls in browsers and when the native titlebar is restored", async () => {
  vi.mocked(getWindowController).mockReturnValue(undefined);
  await mount();
  expect(host.querySelector("button")).toBeNull();
  await act(async () => root.render(<WindowControls key="native" />));
  vi.mocked(controller.isDecorated).mockResolvedValue(true);
  vi.mocked(getWindowController).mockReturnValue(controller);
  await act(async () => root.render(<WindowControls key="decorated" />));
  expect(host.querySelector("button")).toBeNull();
  expect(controller.onResize).not.toHaveBeenCalled();
});

it("routes the three buttons to the native window and tracks external maximize/restore", async () => {
  await mount();
  await act(async () => button("最小化窗口").click());
  await act(async () => button("最大化窗口").click());
  expect(controller.minimize).toHaveBeenCalledOnce();
  expect(controller.toggleMaximize).toHaveBeenCalledOnce();
  vi.mocked(controller.isMaximized).mockResolvedValue(true);
  await act(async () => resized());
  expect(button("还原窗口")).not.toBeNull();
  await act(async () => button("关闭窗口").click());
  expect(controller.close).toHaveBeenCalledOnce();
  expect(host.querySelector("[data-tauri-drag-region]")).toBeNull();
});

it("does not replay failed operations and makes the failure visible", async () => {
  vi.mocked(controller.minimize).mockRejectedValue(new Error("denied"));
  await mount();
  await act(async () => button("最小化窗口").click());
  expect(controller.minimize).toHaveBeenCalledOnce();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("窗口操作失败");
  expect(button("最小化窗口").disabled).toBe(false);
});

it("prevents duplicate native commands until the pending command settles", async () => {
  let finish!: () => void;
  vi.mocked(controller.toggleMaximize).mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  await mount();
  await act(async () => { button("最大化窗口").click(); button("最大化窗口").click(); });
  expect(controller.toggleMaximize).toHaveBeenCalledOnce();
  expect(button("最大化窗口").disabled).toBe(true);
  await act(async () => finish());
  expect(button("最大化窗口").disabled).toBe(false);
});

it("disposes a native event listener even when registration completes after unmount", async () => {
  let registered!: (stop: () => void) => void;
  vi.mocked(controller.onResize).mockImplementation(() => new Promise((resolve) => { registered = resolve; }));
  await mount();
  await act(async () => root.render(null));
  await act(async () => registered(stop));
  expect(stop).toHaveBeenCalledOnce();
});

it("ignores an older maximize query that resolves after a newer resize", async () => {
  await mount();
  let first!: (value: boolean) => void;
  vi.mocked(controller.isMaximized).mockImplementationOnce(() => new Promise((resolve) => { first = resolve; }));
  await act(async () => resized());
  vi.mocked(controller.isMaximized).mockResolvedValue(true);
  await act(async () => resized());
  await act(async () => first(false));
  expect(button("还原窗口")).not.toBeNull();
});
