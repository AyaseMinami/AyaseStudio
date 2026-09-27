// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SettingsHelp } from "./SettingsHelp";

it.each([20, 740])("keeps focused help inside the viewport at trigger y=%s", async (top) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("innerHeight", 768);
  const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("settings-help-tooltip") ? new DOMRect(0, 0, 280, 60) : new DOMRect(20, top, 20, 20);
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<SettingsHelp label="区域透明度差异">各区域透明度不同，调整统一滑块将覆盖三个区域的设置。</SettingsHelp>));
    await act(async () => host.querySelector("button")!.focus());
    const tooltip = document.querySelector<HTMLSpanElement>('[role="tooltip"]')!;
    const actualTop = Number.parseFloat(tooltip.style.top);
    expect(actualTop).toBeGreaterThanOrEqual(8);
    expect(actualTop + 60).toBeLessThanOrEqual(760);
    expect(actualTop).toBe(top === 20 ? 46 : 674);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    bounds.mockRestore();
    vi.unstubAllGlobals();
  }
});
