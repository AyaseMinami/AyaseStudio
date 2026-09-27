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
    onThemeModeChange: vi.fn(), onAccentColorChange: vi.fn(), onCanvasColorChange: vi.fn(),
    onAssistantBubbleColorChange: vi.fn(), onAssistantBubbleTransparencyChange: vi.fn(), onEditBackgroundFocus: vi.fn(),
    onBackgroundFitChange: vi.fn(), onBackgroundMaskChange: vi.fn(), onBackgroundBlurChange: vi.fn(),
    onSelectBackground: vi.fn(), onRemoveBackground: vi.fn(), onResetCustomAppearance: vi.fn(),
  };
  const props: AppearanceSettingsProps = {
    themeMode: "system", resolvedTheme: "light", accentColor: null, canvasColor: null,
    assistantBubbleColor: "#123456", assistantBubbleTransparency: 6, effectiveAccentColor: "#6d28d9", effectiveCanvasColor: "#fafaf9",
    backgroundReference: "backgrounds/example.webp", backgroundUrl: "asset://localhost/example.webp", backgroundFocus: null, backgroundFit: "cover",
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
  it("sends numeric range values for transparency and background controls", async () => {
    const { handlers } = await render();
    await act(async () => {
      changeRange(host!.querySelector<HTMLInputElement>('[aria-label="助手回复气泡透明度"]')!, "42");
      changeRange(host!.querySelector<HTMLInputElement>('[aria-label="背景遮罩强度"]')!, "57");
    });
    expect(handlers.onAssistantBubbleTransparencyChange).toHaveBeenCalledWith(42);
    expect(handlers.onBackgroundMaskChange).toHaveBeenCalledWith(57);
  });

  it("changes theme by radio and resets only the assistant bubble color", async () => {
    const { handlers } = await render();
    await act(async () => {
      host!.querySelector<HTMLInputElement>('input[value="dark"]')!.click();
      host!.querySelector<HTMLButtonElement>(".appearance-secondary-action")!.click();
    });
    expect(handlers.onThemeModeChange).toHaveBeenCalledWith("dark");
    expect(handlers.onAssistantBubbleColorChange).toHaveBeenCalledWith(null);
    expect(handlers.onAssistantBubbleTransparencyChange).not.toHaveBeenCalled();
  });
});
