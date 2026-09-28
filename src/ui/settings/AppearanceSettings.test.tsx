// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppearanceSettings, type AppearanceSettingsProps } from "./AppearanceSettings";

let host: HTMLDivElement | undefined;
let root: ReturnType<typeof createRoot> | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

async function render(overrides: Partial<AppearanceSettingsProps> = {}) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const handlers = {
    onUnifiedThemeColorChange: vi.fn(), onUserBubbleColorChange: vi.fn(),
    onColorPresetChange: vi.fn(),
    onThemeModeChange: vi.fn(), onAccentColorChange: vi.fn(), onCanvasColorChange: vi.fn(),
    onAssistantBubbleColorChange: vi.fn(), onAssistantBubbleTransparencyChange: vi.fn(), onEditBackgroundFocus: vi.fn(),
    onUnifiedTransparencyChange: vi.fn(), onSidebarTransparencyChange: vi.fn(), onComposerTransparencyChange: vi.fn(),
    onBackgroundFitChange: vi.fn(), onBackgroundMaskChange: vi.fn(), onBackgroundBlurChange: vi.fn(),
    onPrepareLibraryBackground: vi.fn().mockResolvedValue(null), onSaveLibraryBackground: vi.fn(),
    onDiscardLibraryBackground: vi.fn().mockResolvedValue(undefined), onResolveLibraryBackground: vi.fn().mockResolvedValue({ reference: "backgrounds/example.webp", url: "asset://localhost/example.webp" }),
    onApplyLibraryBackground: vi.fn().mockResolvedValue(undefined), onRemoveLibraryBackgrounds: vi.fn().mockResolvedValue(undefined),
    onRestoreBackground: vi.fn().mockResolvedValue(undefined), onRemoveBackground: vi.fn(), onResetCustomAppearance: vi.fn(),
  };
  const props: AppearanceSettingsProps = {
    unifiedThemeColor: null, effectiveUserBubbleColor: "#d2e3f7",
    colorPreset: "default",
    themeMode: "system", resolvedTheme: "light", accentColor: null, canvasColor: null,
    assistantBubbleColor: "#123456", unifiedTransparency: 0, sidebarTransparency: 0, composerTransparency: 0,
    assistantBubbleTransparency: 6, effectiveAccentColor: "#6d28d9", effectiveCanvasColor: "#fafaf9",
    backgroundReference: "backgrounds/example.webp", backgroundUrl: "asset://localhost/example.webp", backgroundFocus: null, backgroundFit: "cover",
    backgroundLibrary: [], backgroundEnabled: true, backgroundName: "example.webp",
    backgroundMask: 65, backgroundBlur: 0, backgroundBusy: false, backgroundError: null, readabilityWarnings: [],
    ...handlers, ...overrides,
  };
  await act(async () => root?.render(<AppearanceSettings {...props} />));
  return { handlers, props };
}

function changeRange(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("AppearanceSettings", () => {
  it("retains the current thumbnail and parameter controls when disabled and explicitly reenables", async () => {
    const { handlers } = await render({ backgroundEnabled: false, backgroundUrl: null });
    expect(host!.querySelector<HTMLImageElement>('[alt="当前背景缩略图"]')?.src).toBe("asset://localhost/example.webp");
    expect(host!.textContent).toContain("已停用，图片和参数已保留");
    expect(host!.querySelector<HTMLInputElement>('[aria-label="背景遮罩强度"]')!.disabled).toBe(false);
    await act(async () => [...host!.querySelectorAll("button")].find((button) => button.textContent === "重新启用背景")!.click());
    expect(handlers.onRestoreBackground).toHaveBeenCalledOnce();
    expect(handlers.onRemoveBackground).not.toHaveBeenCalled();
  });
  it("rescales the fixed 1080p canvas when its preview container changes size", async () => {
    let notify: (() => void) | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { notify = callback; }
      observe() {}
      disconnect = disconnect;
    });
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(960);
    try {
      await render();
      const stage = host!.querySelector<HTMLElement>(".appearance-preview-stage")!;
      expect(stage.style.transform).toBe("scale(0.5)");
      width.mockReturnValue(480);
      await act(async () => notify?.());
      expect(stage.style.transform).toBe("scale(0.25)");
      await act(async () => root?.unmount());
      root = undefined;
      expect(disconnect).toHaveBeenCalledOnce();
    } finally {
      width.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("sends numeric range values for transparency and background controls", async () => {
    const { handlers } = await render();
    await act(async () => {
      changeRange(host!.querySelector<HTMLInputElement>('[aria-label="消息气泡透明度"]')!, "42");
      changeRange(host!.querySelector<HTMLInputElement>('[aria-label="背景遮罩强度"]')!, "57");
    });
    expect(handlers.onAssistantBubbleTransparencyChange).toHaveBeenCalledWith(42);
    expect(handlers.onBackgroundMaskChange).toHaveBeenCalledWith(57);
  });

  it("shows an accessible mixed warning and preserves the last unified thumb position", async () => {
    const { handlers } = await render({ unifiedTransparency: 27, sidebarTransparency: 50, composerTransparency: 27, assistantBubbleTransparency: 6 });
    const unified = host!.querySelector<HTMLInputElement>('[aria-label="统一透明度"]')!;
    expect(unified.value).toBe("27");
    expect(host!.textContent).toContain("已分别调整");
    expect(host!.textContent).toContain("各项不同");
    const help = host!.querySelector<HTMLButtonElement>('[aria-label="区域透明度差异说明"]')!;
    expect(help).not.toBeNull();
    await act(async () => help.focus());
    const tooltipId = help.getAttribute("aria-describedby");
    expect(tooltipId).toBeTruthy();
    expect(document.getElementById(tooltipId!)?.textContent).toBe("各区域透明度不同，调整统一滑块将覆盖三个区域的设置。");
    expect(host!.querySelector('[role="tooltip"]')).toBeNull();
    await act(async () => help.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(help.hasAttribute("aria-describedby")).toBe(false);
    expect(document.getElementById(tooltipId!)).toBeNull();
    expect(host!.querySelectorAll(".appearance-preview-sidebar")).toHaveLength(2);
    expect(host!.querySelector(".appearance-preview-composer")).not.toBeNull();
    await act(async () => changeRange(unified, "60"));
    expect(handlers.onUnifiedTransparencyChange).toHaveBeenCalledWith(60);
  });

  it("changes theme by radio and resets only the assistant bubble color", async () => {
    const { handlers } = await render();
    await act(async () => {
      host!.querySelector<HTMLInputElement>('input[value="dark"]')!.click();
      host!.querySelector<HTMLButtonElement>('button[aria-label="恢复助手回复气泡颜色默认值"]')!.click();
    });
    expect(handlers.onThemeModeChange).toHaveBeenCalledWith("dark");
    expect(handlers.onAssistantBubbleColorChange).toHaveBeenCalledWith(null);
    expect(handlers.onAssistantBubbleTransparencyChange).not.toHaveBeenCalled();
  });
});
