// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UpdateNotice } from "./UpdateNotice";

let host: HTMLDivElement, root: Root;
const onOpen = vi.fn(), onDismiss = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

it("announces the new version without stealing focus or opening a modal", async () => {
  const focused = document.createElement("button"); document.body.append(focused); focused.focus();
  try {
    await act(async () => root.render(<UpdateNotice version="0.2.0-beta.1" onOpen={onOpen} onDismiss={onDismiss} />));
    expect(host.querySelector('[role="status"]')?.textContent).toBe("发现新版本 v0.2.0-beta.1");
    expect(document.activeElement).toBe(focused);
    expect(host.querySelector('dialog, [role="dialog"], [aria-modal="true"]')).toBeNull();
    expect(onOpen).not.toHaveBeenCalled(); expect(onDismiss).not.toHaveBeenCalled();
  } finally { focused.remove(); }
});

it("routes the explicit view and close actions independently", async () => {
  await act(async () => root.render(<UpdateNotice version="0.2.0" onOpen={onOpen} onDismiss={onDismiss} />));
  await act(async () => host.querySelector<HTMLButtonElement>(".update-notice-open")!.click());
  expect(onOpen).toHaveBeenCalledTimes(1); expect(onDismiss).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="关闭更新提示"]')!.click());
  expect(onDismiss).toHaveBeenCalledTimes(1); expect(onOpen).toHaveBeenCalledTimes(1);
});

it("stays visible without a timeout and renders version strings as safe text", async () => {
  vi.useFakeTimers();
  const version = "<script>unsafe()</script>";
  await act(async () => root.render(<UpdateNotice version={version} onOpen={onOpen} onDismiss={onDismiss} />));
  await act(async () => vi.advanceTimersByTime(120_000));
  expect(host.querySelector(".update-notice")).not.toBeNull();
  expect(host.querySelector('[role="status"]')?.textContent).toBe(`发现新版本 v${version}`);
  expect(host.querySelector("script")).toBeNull(); expect(onDismiss).not.toHaveBeenCalled();
});
