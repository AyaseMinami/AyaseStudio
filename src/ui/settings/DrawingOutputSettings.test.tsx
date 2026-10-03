// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { drawingOutputError, type DrawingOutputDirectorySettings } from "../../drawing/outputDirectory";
import { DrawingOutputSettings } from "./DrawingOutputSettings";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const initial: DrawingOutputDirectorySettings = { directory: "D:\\Drawing outputs\\original", defaultDirectory: "C:\\Ayase\\drawing", isDefault: false };
const selected: DrawingOutputDirectorySettings = { ...initial, directory: "E:\\Images\\new output" };
const defaultSettings: DrawingOutputDirectorySettings = { ...initial, directory: initial.defaultDirectory, isDefault: true };
const cleanups: (() => Promise<void>)[] = [];

beforeEach(() => {
  vi.mocked(isTauri).mockReset().mockReturnValue(true);
  vi.mocked(invoke).mockReset().mockResolvedValue(initial);
});
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function mount(strict = false) {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(strict ? <StrictMode><DrawingOutputSettings /></StrictMode> : <DrawingOutputSettings />));
  const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  const click = async (label: string) => { await act(async () => button(label).click()); };
  let mounted = true;
  const cleanup = async () => { if (mounted) { await act(async () => root.unmount()); mounted = false; host.remove(); } };
  cleanups.push(cleanup);
  return { host, button, click, cleanup, path: () => host.querySelector("output")!.textContent };
}

it("loads and displays the full native path, with device and future-task boundaries", async () => {
  const ui = await mount();
  expect(invoke).toHaveBeenCalledExactlyOnceWith("get_drawing_output_directory_settings");
  expect(ui.path()).toBe(initial.directory);
  expect(ui.host.textContent).toContain("已有文件保留在原位置");
  expect(ui.host.textContent).toContain("不随备份迁移");
  expect(ui.button("选择绘图输出文件夹").disabled).toBe(false);
});

it("keeps the path on chooser cancellation and updates it on a successful selection", async () => {
  const ui = await mount();
  vi.mocked(invoke).mockResolvedValueOnce(null);
  await ui.click("选择绘图输出文件夹");
  expect(ui.path()).toBe(initial.directory);
  expect(ui.host.querySelector('[role="alert"]')).toBeNull();
  vi.mocked(invoke).mockResolvedValueOnce(selected);
  await ui.click("选择绘图输出文件夹");
  expect(ui.path()).toBe(selected.directory);
  expect(invoke).toHaveBeenLastCalledWith("select_drawing_output_directory");
});

it("preserves the original path when native write validation fails", async () => {
  const ui = await mount();
  vi.mocked(invoke).mockRejectedValueOnce("drawing-output-unwritable");
  await ui.click("选择绘图输出文件夹");
  expect(ui.path()).toBe(initial.directory);
  expect(ui.host.querySelector('[role="alert"]')!.textContent).toBe(drawingOutputError("drawing-output-unwritable"));
  expect(ui.button("选择绘图输出文件夹").disabled).toBe(false);
});

it("restores the default path and opens the current directory without sending paths", async () => {
  const ui = await mount();
  vi.mocked(invoke).mockResolvedValueOnce(undefined);
  await ui.click("打开绘图输出文件夹");
  expect(invoke).toHaveBeenLastCalledWith("open_drawing_output_directory");
  vi.mocked(invoke).mockResolvedValueOnce(defaultSettings);
  await ui.click("恢复默认绘图输出目录");
  expect(invoke).toHaveBeenLastCalledWith("reset_drawing_output_directory");
  expect(ui.path()).toBe(initial.defaultDirectory);
  expect(ui.button("恢复默认绘图输出目录").disabled).toBe(true);
});

it("blocks writes after a read error and allows an explicit reload", async () => {
  vi.mocked(invoke).mockRejectedValueOnce("drawing-output-config");
  const ui = await mount();
  expect(ui.path()).toBe("尚未读取输出目录");
  expect(ui.button("选择绘图输出文件夹").disabled).toBe(true);
  expect(ui.button("恢复默认绘图输出目录").disabled).toBe(true);
  await ui.click("重新加载绘图输出设置");
  expect(ui.path()).toBe(initial.directory);
  expect(ui.button("选择绘图输出文件夹").disabled).toBe(false);
});

it("preserves a displayed path and requires reload after a config write error", async () => {
  const ui = await mount();
  vi.mocked(invoke).mockRejectedValueOnce("drawing-output-config");
  await ui.click("恢复默认绘图输出目录");
  expect(ui.path()).toBe(initial.directory);
  expect(ui.button("选择绘图输出文件夹").disabled).toBe(true);
  expect(ui.button("恢复默认绘图输出目录").disabled).toBe(true);
  await ui.click("重新加载绘图输出设置");
  expect(ui.button("选择绘图输出文件夹").disabled).toBe(false);
});

it("guards duplicate commands synchronously and disables other actions while busy", async () => {
  const ui = await mount();
  let complete!: (value: DrawingOutputDirectorySettings) => void;
  vi.mocked(invoke).mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
  await act(async () => {
    ui.button("选择绘图输出文件夹").click();
    ui.button("选择绘图输出文件夹").click();
    ui.button("打开绘图输出文件夹").click();
  });
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(ui.host.querySelector("section")!.getAttribute("aria-busy")).toBe("true");
  expect(ui.button("恢复默认绘图输出目录").disabled).toBe(true);
  await act(async () => complete(selected));
  expect(ui.path()).toBe(selected.directory);
  expect(ui.button("打开绘图输出文件夹").disabled).toBe(false);
});

it("ignores stale reads after StrictMode cleanup", async () => {
  let firstRead!: (value: DrawingOutputDirectorySettings) => void;
  vi.mocked(invoke).mockReturnValueOnce(new Promise(resolve => { firstRead = resolve; })).mockResolvedValueOnce(selected);
  const ui = await mount(true);
  expect(ui.path()).toBe(selected.directory);
  await act(async () => firstRead(initial));
  expect(ui.path()).toBe(selected.directory);
});

it("safely finishes a command after unmount", async () => {
  const ui = await mount();
  let complete!: (value: DrawingOutputDirectorySettings) => void;
  vi.mocked(invoke).mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
  await ui.click("选择绘图输出文件夹");
  await ui.cleanup();
  await act(async () => complete(selected));
  expect(invoke).toHaveBeenCalledTimes(2);
});

it("disables native actions in the browser and never invokes IPC", async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  const ui = await mount();
  expect(ui.host.textContent).toContain("请在桌面应用中设置或打开绘图输出文件夹");
  expect([...ui.host.querySelectorAll("button")].every(button => button.disabled)).toBe(true);
  expect(invoke).not.toHaveBeenCalled();
});

it("translates only known native errors and never renders raw error details", async () => {
  expect(drawingOutputError({ code: "drawing-output-unavailable" })).toContain("检查磁盘连接");
  expect(drawingOutputError(new Error("drawing-output-unwritable"))).toContain("无法写入");
  const ui = await mount();
  vi.mocked(invoke).mockRejectedValueOnce(new Error("Secret path C:\\private\\credentials"));
  await ui.click("打开绘图输出文件夹");
  expect(ui.host.querySelector('[role="alert"]')!.textContent).toBe("绘图输出目录操作失败，请重试。");
  expect(ui.host.textContent).not.toContain("credentials");
  expect(ui.path()).toBe(initial.directory);
});

it("preserves the path on unavailable or unknown reset and select failures", async () => {
  const ui = await mount();
  for (const label of ["恢复默认绘图输出目录", "选择绘图输出文件夹"]) {
    for (const cause of ["drawing-output-unavailable", { unexpected: "C:\\private\\path" }]) {
      vi.mocked(invoke).mockRejectedValueOnce(cause);
      await ui.click(label);
      expect(ui.path()).toBe(initial.directory);
      expect(ui.host.querySelector('[role="alert"]')!.textContent).toBe(drawingOutputError(cause));
      expect(ui.button(label).disabled).toBe(false);
      expect(ui.host.textContent).not.toContain("private");
    }
  }
});
