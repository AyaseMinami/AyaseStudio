import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultAppearancePreferences } from "../../appearance/appearance";

const css = readFileSync("src/App.css", "utf8");

describe("navigation material stylesheet contract", () => {
  it("keeps first-render alpha fallbacks aligned with the shared defaults", () => {
    for (const [variable, transparency] of [
      ["chrome-background-opacity", defaultAppearancePreferences.chromeTransparency],
      ["sidebar-background-opacity", defaultAppearancePreferences.sidebarTransparency],
      ["assistant-bubble-opacity", defaultAppearancePreferences.assistantBubbleTransparency],
    ] as const) {
      const value = css.match(new RegExp(`--${variable}:\\s*([\\d.]+);`));
      expect(value).not.toBeNull();
      expect(Number(value![1])).toBeCloseTo(1 - transparency / 100);
    }
  });

  it("scopes the coverage floor to open non-glass overlays and retains the saved alpha", () => {
    const rule = css.match(/:root\[data-sidebar-glass="false"\] \.conversation-workspace-body\[data-navigation-open="true"\]\[data-navigation-docked="false"\]::before\s*\{([^}]+)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toContain("max(0.94, var(--sidebar-background-opacity))");
    expect(rule![1]).not.toContain("--sidebar-background-opacity:");
  });

  it("keeps composer backdrop-filter on ::before, scopes preview blur to data-has-image, and covers reduced transparency", () => {
    const composerRule = css.match(/\.composer-frame\s*\{([^}]+)\}/)?.[1];
    expect(composerRule).not.toContain("backdrop-filter");
    expect(css).toContain(":root[data-has-background=\"true\"][data-composer-glass=\"false\"] .composer-frame::before");
    expect(css).toContain(".appearance-background-preview[data-has-image=\"true\"] .app-window-chrome");
    expect(css).toContain(".appearance-background-preview[data-has-image=\"true\"] .composer-frame::before");
    expect(css).toContain(".appearance-background-preview[data-has-image=\"true\"] .appearance-preview-navigation");
    expect(css).toMatch(/@media \(forced-colors: active\), \(prefers-reduced-transparency: reduce\)[\s\S]*?:root\[data-has-background="true"\] \.app-window-chrome[\s\S]*?backdrop-filter: none/);
    expect(css).toMatch(/@media \(forced-colors: active\), \(prefers-reduced-transparency: reduce\)[\s\S]*?:root\[data-composer-glass="false"\] \.composer-frame:focus-within::before[\s\S]*?outline: 2px solid/);
    expect(css).toMatch(/@media \(forced-colors: active\), \(prefers-reduced-transparency: reduce\)[\s\S]*?:root\[data-sidebar-glass="false"\] \.conversation-workspace-body\[data-navigation-open="true"\]\[data-navigation-docked="false"\]::before[\s\S]*?backdrop-filter: none/);
  });

  it("keeps light-theme inline code overrides excluded from user message bubbles", () => {
    expect(css).toContain(":root[data-theme=\"light\"] .markdown:not(.user-message) code");
    expect(css).not.toMatch(/:root\[data-theme="light"\] \.markdown code\b/);
    expect(css).toContain(".user-message.markdown code { border-color: rgb(var(--color-user-message-text) / 0.16); background: rgb(var(--color-user-message-text) / 0.1); color: inherit; }");
  });

  it("keeps narrow chat column width at 55rem and aligned with the appearance preview", () => {
    const appearanceCss = readFileSync("src/ui/settings/AppearanceSettings.css", "utf8");
    expect(css).toContain("[data-chat-layout=\"narrow\"] { --chat-content-width: 55rem; }");
    expect(css).toContain("max-width: var(--chat-content-width, 55rem);");
    expect(appearanceCss).toContain("width: 880px;");
    expect(appearanceCss).toContain("calc((1920px - var(--app-navigation-width) - 508px - 880px) / 2)");
  });

  it("enforces bubbleless default, frosted wallpaper assistant bubbles, decoupled user bubbles, and accessibility fallbacks", () => {
    expect(css).not.toContain("--message-bubble-opacity");
    expect(css).toContain(".assistant-message-group.message-surface { background: transparent; box-shadow: none; color: rgb(var(--color-text-soft)); }");
    expect(css).toContain(":root[data-assistant-bubble-mode=\"always\"]:not([data-has-background=\"true\"]):not([data-assistant-bubble-transparent=\"true\"]) .message-list .assistant-message-group.message-surface");
    expect(css).toContain(":root[data-assistant-bubble-mode=\"always\"]:not([data-assistant-bubble-transparent=\"true\"]) :is(.appearance-reading-preview, .avatar-preview) .assistant-message-group.message-surface");
    expect(css).toContain(":root[data-has-background=\"true\"]:not([data-assistant-bubble-mode=\"off\"]):not([data-assistant-bubble-transparent=\"true\"]) .message-list .assistant-message-group.message-surface");
    expect(css).toContain("background: rgb(var(--color-assistant-bubble, var(--color-panel)) / var(--assistant-bubble-opacity));");
    expect(css).toContain("backdrop-filter: blur(12px) saturate(1.12);");
    expect(css).toContain("box-shadow: inset 0 0 0 1px rgb(var(--color-text) / 0.07);");
    expect(css).toContain("box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.08);");
    expect(css).toContain(":root[data-has-background=\"true\"] .message-list .user-message-group.message-surface,");
    expect(css).toContain("background: rgb(var(--color-user-message) / var(--user-bubble-wallpaper-opacity, 0.88));");
    expect(css).toContain(":root[data-has-background=\"true\"]:not([data-assistant-bubble-mode=\"off\"]):not([data-assistant-bubble-transparent=\"true\"]) .message-scroll-region");
    expect(css).toMatch(/@media \(forced-colors: active\), \(prefers-reduced-transparency: reduce\)[\s\S]*?\.message-list \.assistant-message-group\.message-surface[\s\S]*?background: rgb\(var\(--color-assistant-bubble, var\(--color-panel\)\)\);[\s\S]*?backdrop-filter: none;/);
    expect(css).toContain("--color-user-message-text: var(--color-user-message-text-solid);");
  });
});
