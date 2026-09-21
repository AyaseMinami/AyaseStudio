// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AboutSettings } from "./AboutSettings";
import { openExternal } from "../../chat/externalLinks";
import { version } from "../../../src-tauri/tauri.conf.json";

vi.mock("../../chat/externalLinks", () => ({ openExternal: vi.fn(async () => {}) }));

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
    const links = [...host.querySelectorAll<HTMLAnchorElement>(".about-feedback-link")];
    expect(links).toHaveLength(1);
    const bug = new URL(links[0].href);
    expect(bug.pathname).toBe("/AyaseMinami/AyaseStudio/issues/new");
    expect(bug.searchParams.get("body")).toContain(version);
    expect(bug.searchParams.get("body")).toContain("问题或建议");
    await act(async () => links[0].click());
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(links[0].href);
    await act(async () => host.querySelector<HTMLButtonElement>(".about-email button")!.click());
    expect(writeText).toHaveBeenLastCalledWith("ayasechikage@gmail.com");
    expect(host.querySelector('[role="status"]')?.textContent).toBe("已复制邮箱地址");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="复制版本信息"]')!.click());
    expect(writeText).toHaveBeenLastCalledWith(`Ayase Studio ${version} (Alpha)`);
    expect(host.querySelector('.about-version [role="status"]')?.textContent).toBe("已复制版本信息");
    expect(host.querySelector('.about-footer [role="status"]')).toBeNull();
    writeText.mockRejectedValueOnce(new Error("clipboard unavailable"));
    await act(async () => host.querySelector<HTMLButtonElement>(".about-email button")!.click());
    expect(host.querySelector('[role="status"]')?.textContent).toContain("复制失败");
    vi.mocked(openExternal).mockRejectedValueOnce(new Error("opener unavailable"));
    await act(async () => links[0].click());
    expect(host.querySelector('[role="status"]')?.textContent).toContain("无法打开链接");
  } finally { await act(async () => root.unmount()); }
});
