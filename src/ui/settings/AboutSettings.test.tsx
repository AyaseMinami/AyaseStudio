// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { AboutSettings } from "./AboutSettings";
import { openExternal } from "../../chat/externalLinks";
import { version } from "../../../src-tauri/tauri.conf.json";
import type { UpdateActions, UpdateState } from "../../update/controller";

vi.mock("../../chat/externalLinks", () => ({ openExternal: vi.fn(async () => {}) }));
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
});

it("opens one combined feedback draft only on click and copies only explicit public information", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<AboutSettings />));
    expect(openExternal).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    const channel = /-beta(?:[.-]|$)/i.test(version) ? "Beta" : /-alpha(?:[.-]|$)/i.test(version) ? "Alpha" : "Stable";
    expect(host.querySelector('.about-alpha')?.textContent).toBe(channel);
    const links = [...host.querySelectorAll<HTMLAnchorElement>(".about-feedback-link")];
    expect(links).toHaveLength(1);
    const help = host.querySelector<HTMLButtonElement>('[aria-label="反馈与建议说明"]')!;
    expect(help.closest("a")).toBeNull();
    await act(async () => {
      help.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      help.click();
    });
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("反馈不会自动附带聊天记录、日志或附件。");
    expect(openExternal).not.toHaveBeenCalled();
    await act(async () => help.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    const bug = new URL(links[0].href);
    expect(bug.pathname).toBe("/AyaseMinami/AyaseStudio/issues/new");
    expect(bug.searchParams.get("body")).toContain(version);
    expect(bug.searchParams.get("body")).toContain("问题或建议");
    await act(async () => links[0].click());
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(links[0].href);
    await act(async () => host.querySelector<HTMLButtonElement>(".about-email button")!.click());
    expect(writeText).toHaveBeenLastCalledWith("ayasechikage@gmail.com");
    expect(host.querySelector('.about-email [role="status"]')?.textContent).toBe("已复制邮箱地址");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="复制版本信息"]')!.click());
    expect(writeText).toHaveBeenLastCalledWith(`Ayase Studio ${version}${channel === "Stable" ? "" : ` (${channel})`}`);
    expect(host.querySelector('.about-version [role="status"]')?.textContent).toBe("已复制版本信息");
    expect(host.querySelector('.about-footer [role="status"]')).toBeNull();
    writeText.mockRejectedValueOnce(new Error("clipboard unavailable"));
    await act(async () => host.querySelector<HTMLButtonElement>(".about-email button")!.click());
    expect(host.querySelector('.about-email [role="status"]')?.textContent).toContain("复制失败");
    vi.mocked(openExternal).mockRejectedValueOnce(new Error("opener unavailable"));
    await act(async () => links[0].click());
    expect(host.querySelector('.about-notice[role="status"]')?.textContent).toContain("无法打开链接");
  } finally { await act(async () => root.unmount()); }
});

function actions(state: UpdateState): UpdateActions {
  return { state, check: vi.fn(async () => {}), download: vi.fn(async () => {}), cancel: vi.fn(async () => {}), install: vi.fn(async () => {}) };
}

async function withPage(update: UpdateActions | undefined, test: (host: HTMLDivElement) => Promise<void>) {
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<AboutSettings update={update} />));
    await test(host);
  } finally { await act(async () => root.unmount()); }
}

function button(host: HTMLDivElement, text: string) {
  const result = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === text);
  expect(result).toBeDefined();
  return result!;
}

it("checks only on demand and blocks duplicate checks while pending", async () => {
  let finish!: () => void;
  const update = actions({ phase: "idle" });
  vi.mocked(update.check).mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  await withPage(update, async (host) => {
    expect(update.check).not.toHaveBeenCalled();
    await act(async () => { button(host, "检查更新").click(); button(host, "检查更新").click(); });
    expect(update.check).toHaveBeenCalledTimes(1);
    expect(button(host, "检查更新").disabled).toBe(true);
    await act(async () => finish());
    expect(button(host, "检查更新").disabled).toBe(false);
  });
});

it("downloads an available update and preserves release notes as safe text", async () => {
  const notes = "版本说明\n\n<script>privateCode()</script>\n" + "长说明".repeat(80);
  const update = actions({ phase: "available", update: { session: "synthetic", version: "0.2.0", notes } });
  await withPage(update, async (host) => {
    expect(host.textContent).toContain("新版本 v0.2.0");
    expect(host.querySelector(".about-release-notes > div")?.textContent).toBe(notes);
    expect(host.querySelector("script")).toBeNull();
    expect(update.download).not.toHaveBeenCalled();
    await act(async () => button(host, "下载更新").click());
    expect(update.download).toHaveBeenCalledTimes(1);
    expect(update.install).not.toHaveBeenCalled();
  });
});

it("shows downloaded bytes with indeterminate progress and waits for cancellation", async () => {
  let finish!: () => void;
  const update = actions({ phase: "downloading", downloaded: 2048 });
  vi.mocked(update.cancel).mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  await withPage(update, async (host) => {
    const progress = host.querySelector("progress")!;
    expect(progress.getAttribute("aria-label")).toBe("更新下载进度");
    expect(progress.hasAttribute("value")).toBe(false);
    expect(host.textContent).toContain("2.0 KB · 总大小未知");
    expect(host.textContent).not.toContain("检查更新");
    await act(async () => { button(host, "取消下载").click(); button(host, "取消下载").click(); });
    expect(update.cancel).toHaveBeenCalledTimes(1);
    expect(button(host, "取消中…").disabled).toBe(true);
    expect(host.textContent).toContain("正在取消下载");
    await act(async () => finish());
    expect(button(host, "取消下载").disabled).toBe(false);
  });
});

it("shows determinate progress when the download total is known", async () => {
  await withPage(actions({ phase: "downloading", downloaded: 1024, total: 2048 }), async (host) => {
    const progress = host.querySelector("progress")!;
    expect(progress.value).toBe(1024);
    expect(progress.max).toBe(2048);
    expect(host.textContent).toContain("1.0 KB / 2.0 KB");
  });
});

it("allows cancellation while the native download action remains pending", async () => {
  let finishDownload!: () => void;
  const update = actions({ phase: "available" });
  vi.mocked(update.download).mockImplementation(() => new Promise<void>((resolve) => { finishDownload = resolve; }));
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<AboutSettings update={update} />));
    await act(async () => button(host, "下载更新").click());
    update.state = { phase: "downloading", downloaded: 0 };
    await act(async () => root.render(<AboutSettings update={update} />));
    expect(button(host, "取消下载").disabled).toBe(false);
    await act(async () => button(host, "取消下载").click());
    expect(update.cancel).toHaveBeenCalledTimes(1);
    await act(async () => finishDownload());
  } finally { await act(async () => root.unmount()); }
});

it("requires the explicit install action after displaying the draft warning", async () => {
  const update = actions({ phase: "ready" });
  await withPage(update, async (host) => {
    expect(host.textContent).toContain("安装将退出并重启应用，请先保存未发送的内容。");
    expect(update.install).not.toHaveBeenCalled();
    await act(async () => button(host, "安装并重启").click());
    expect(update.install).toHaveBeenCalledTimes(1);
    expect(update.download).not.toHaveBeenCalled();
  });
});

it("shows safe error feedback and keeps manual download available", async () => {
  const update = actions({ phase: "error", message: "暂时无法检查更新，请稍后重试。" });
  vi.mocked(update.check).mockRejectedValueOnce(new Error("secret raw native diagnostic"));
  await withPage(update, async (host) => {
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("暂时无法检查更新");
    await act(async () => button(host, "检查更新").click());
    expect(host.textContent).toContain("更新操作未完成");
    expect(host.textContent).not.toContain("secret raw native diagnostic");
    expect(host.querySelector('a[href="https://github.com/AyaseMinami/AyaseStudio/releases"]')).not.toBeNull();
  });
});
it("explains a blocked installation while keeping the downloaded package actionable", async () => {
  await withPage(actions({ phase: "ready", message: "请等待任务结束后再次安装。" }), async host => {
    expect(host.querySelector('[role="status"]')?.textContent).toBe("请等待任务结束后再次安装。");
    expect(button(host, "安装并重启").disabled).toBe(false);
  });
});
it("shows cancellation failure while retaining the active transfer controls", async () => {
  await withPage(actions({ phase: "downloading", message: "取消失败，请等待下载结束或重试。" }), async host => {
    expect(host.querySelector('[role="status"]')?.textContent).toContain("取消失败");
    expect(button(host, "取消下载").disabled).toBe(false);
  });
});

it("offers official downloads without an automatic check in unavailable environments", async () => {
  const update = actions({ phase: "unavailable", message: "此构建未配置应用内更新。" });
  await withPage(update, async (host) => {
    expect(host.textContent).toContain("请使用官方下载");
    expect(host.querySelector(".about-update-actions button")).toBeNull();
    expect(update.check).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
    const download = host.querySelector<HTMLAnchorElement>('a[href="https://github.com/AyaseMinami/AyaseStudio/releases"]')!;
    expect(download.textContent).toBe("官方下载 (GitHub)");
    expect(host.textContent).not.toContain("网盘下载");
    await act(async () => download.click());
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(download.href);
  });
});

it.each([
  ["checking", "正在检查更新", true],
  ["current", "当前已是最新版本", false],
  ["cancelled", "已取消下载", false],
  ["installing", "正在准备安装并重启", true],
] as const)("renders the %s phase without automatic actions", async (phase, text, isBusy) => {
  const update = actions({ phase });
  await withPage(update, async (host) => {
    expect(host.textContent).toContain(text);
    expect(update.check).not.toHaveBeenCalled();
    expect(update.install).not.toHaveBeenCalled();
    for (const control of host.querySelectorAll<HTMLButtonElement>(".about-update-actions button")) expect(control.disabled).toBe(isBusy);
  });
});

it("opens a provided mirror only on click and copies its extraction code explicitly", async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<AboutSettings downloadMirror={{ url: "https://example.org/synthetic-download", code: "test" }} />));
    expect(openExternal).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    const mirror = host.querySelector<HTMLAnchorElement>('a[href="https://example.org/synthetic-download"]')!;
    await act(async () => mirror.click());
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(mirror.href);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="复制提取码"]')!.click());
    expect(writeText).toHaveBeenCalledExactlyOnceWith("test");
    expect(host.querySelector('.about-notice[role="status"]')?.textContent).toBe("已复制提取码");
  } finally { await act(async () => root.unmount()); }
});
