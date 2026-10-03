import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultAppearancePreferences } from "../../appearance/appearance";

const css = readFileSync("src/App.css", "utf8");

describe("navigation material stylesheet contract", () => {
  it("keeps first-render alpha fallbacks aligned with the shared defaults", () => {
    for (const [variable, transparency] of [
      ["chrome-background-opacity", defaultAppearancePreferences.chromeTransparency],
      ["sidebar-background-opacity", defaultAppearancePreferences.sidebarTransparency],
      ["message-bubble-opacity", defaultAppearancePreferences.assistantBubbleTransparency],
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
});
