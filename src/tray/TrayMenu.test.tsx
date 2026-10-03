// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TrayMenu } from "./TrayMenu";

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  native.invoke.mockReset().mockResolvedValue(undefined);
  native.isTauri.mockReset().mockReturnValue(true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
async function render() { await act(async () => root.render(<TrayMenu />)); }
function buttons() { return Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')); }
async function press(key: string, shiftKey = false) {
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true })));
}

it("registers ready after mounting, focuses first item and restores it on window focus", async () => {
  await render();
  expect(native.invoke).toHaveBeenCalledExactlyOnceWith("tray_menu_action", { action: "ready" });
  expect(document.activeElement).toBe(buttons()[0]);
  await act(async () => buttons()[2].focus());
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(document.activeElement).toBe(buttons()[0]);
  expect(native.invoke).toHaveBeenCalledTimes(1);
});

it("cycles Arrow and Tab keys with Home/End and dismisses on Escape", async () => {
  await render();
  const cases = [["ArrowUp", 2], ["ArrowDown", 0], ["End", 2], ["Home", 0], ["Tab", 1], ["Tab", 2], ["Tab", 0]] as const;
  for (const [key, index] of cases) { await press(key); expect(document.activeElement).toBe(buttons()[index]); }
  await press("Tab", true); expect(document.activeElement).toBe(buttons()[2]);
  await press("Escape");
  expect(native.invoke).toHaveBeenLastCalledWith("tray_menu_action", { action: "dismiss" });
});

it("sends each requested action without an extra native close command", async () => {
  await render();
  for (const [index, action] of ["open", "settings", "exit"].entries()) {
    await act(async () => buttons()[index].click());
    expect(native.invoke).toHaveBeenLastCalledWith("tray_menu_action", { action });
  }
  expect(native.invoke).toHaveBeenCalledTimes(4);
});

it("guards duplicate actions while pending and permits retry after an accessible rejection", async () => {
  await render();
  let reject!: (reason: unknown) => void;
  native.invoke.mockImplementationOnce(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
  await act(async () => { buttons()[1].click(); buttons()[2].click(); });
  await press("Escape");
  expect(native.invoke).toHaveBeenCalledTimes(2);
  expect(host.querySelector('[role="menu"]')!.getAttribute("aria-busy")).toBe("true");
  expect(buttons().every(button => button.getAttribute("aria-disabled") === "true")).toBe(true);
  await act(async () => reject(new Error("private native error")));
  expect(host.querySelector('[role="status"]')!.textContent).toBe("操作失败，请重试");
  expect(host.textContent).not.toContain("private native error");
  expect(host.querySelector('[role="menu"]')!.getAttribute("aria-busy")).toBe("false");
  await act(async () => buttons()[1].click());
  expect(native.invoke).toHaveBeenCalledTimes(3);
  expect(host.querySelector('[role="status"]')!.textContent).toBe("");
});

it("reports readiness failure and renders in a browser without native IPC", async () => {
  native.invoke.mockRejectedValueOnce(new Error("unavailable"));
  await render();
  expect(host.querySelector('[role="status"]')!.textContent).toBe("菜单初始化失败");
  await act(async () => root.unmount()); root = createRoot(host);
  native.invoke.mockClear(); native.isTauri.mockReturnValue(false);
  await render();
  await act(async () => buttons()[0].click());
  await press("Escape");
  expect(native.invoke).not.toHaveBeenCalled();
  expect(host.querySelector('[role="status"]')!.textContent).toBe("");
});

it("removes its window focus handler when unmounted", async () => {
  await render(); const first = buttons()[0]; const focus = vi.spyOn(first, "focus");
  await act(async () => root.render(<input />));
  const input = host.querySelector("input")!; input.focus();
  window.dispatchEvent(new Event("focus"));
  expect(focus).not.toHaveBeenCalled(); expect(document.activeElement).toBe(input);
});
