import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appCss = readFileSync("src/App.css", "utf8");
const drawingCss = readFileSync("src/ui/drawing/DrawingWorkspace.css", "utf8");

describe("workbench material stylesheet contract", () => {
  it("derives an opaque surface from theme colors independently of chat alpha", () => {
    const surface = appCss.match(/--workbench-surface:\s*([^;]+);/)?.[1];
    expect(surface).toBe("color-mix(in srgb, rgb(var(--color-panel)) 98%, rgb(var(--color-text)))");
    expect(surface).not.toMatch(/opacity|transparency|sidebar|message/);
  });

  it("shares surface and border tokens across settings panels", () => {
    for (const file of ["AppearanceSettings", "ConnectionSettings", "AvatarSettings", "AboutSettings", "NetworkSearchSettings", "DataManagementSettings"]) {
      const css = readFileSync(`src/ui/settings/${file}.css`, "utf8");
      expect(css).toContain("var(--workbench-surface)");
      expect(css).toContain("var(--workbench-border)");
    }
  });

  it("keeps the actual drawing canvas opaque and separate from workbench fill", () => {
    const stage = drawingCss.match(/\.drawing-result-stage\s*\{([^}]+)\}/)?.[1];
    expect(stage).toContain("background: rgb(var(--color-canvas))");
    expect(stage).not.toContain("workbench-surface");
    expect(stage).not.toContain("backdrop-filter");
  });

  it("keeps drawing configuration and tasks beside artwork with 8px gaps and high contrast boundaries", () => {
    const layout = drawingCss.match(/\.drawing-layout\s*\{([^}]+)\}/)?.[1];
    expect(layout).toContain("gap: 8px");
    expect(layout).toContain('grid-template-areas: "configuration preview" "tasks preview"');
    for (const [panel, area] of [["form", "configuration"], ["task-panel", "tasks"], ["preview-panel", "preview"]]) {
      const rule = drawingCss.match(new RegExp(`\\.drawing-${panel}\\s*\\{([^}]+)\\}`))?.[1];
      expect(rule).toContain(`grid-area: ${area}`);
    }
    expect(appCss).toContain("--workbench-border: CanvasText");
    expect(drawingCss).toContain("border: 1px dashed CanvasText");
    expect(drawingCss).toContain(".drawing-workspace .drawing-references { border: 1px dashed CanvasText");
  });

  it("renders settings headings borderless on a separate frosted content surface without trapping fixed modals", () => {
    const settingsDesignCss = readFileSync("src/ui/settings/SettingsDesign.css", "utf8");
    const heading = settingsDesignCss.match(/\.settings-workspace \.settings-page > \.settings-page-heading\s*\{([^}]+)\}/)?.[1];
    expect(heading).toContain("background: transparent");
    expect(heading).toContain("border: 0");

    const scroll = appCss.match(/\.settings-page-scroll\s*\{([^}]+)\}/)?.[1];
    expect(scroll).not.toContain("backdrop-filter");
    expect(appCss).toContain(":root[data-has-background=\"true\"] .settings-content-surface");
    expect(appCss).toMatch(/@media \(forced-colors: active\), \(prefers-reduced-transparency: reduce\)[\s\S]*?\.settings-content-surface[\s\S]*?backdrop-filter: none/);
  });

  it("defines shared Windows-first font stacks and scalable typography tokens without conflicting legacy overrides", () => {
    const trayCss = readFileSync("src/tray/tray.css", "utf8");
    const appFontSans = appCss.match(/--font-sans:\s*([^;]+);/)?.[1]?.replace(/\s+/g, " ").trim();
    const trayFontSans = trayCss.match(/--font-sans:\s*([^;]+);/)?.[1]?.replace(/\s+/g, " ").trim();
    expect(appFontSans).toBe(
      '"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei", "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", system-ui, sans-serif',
    );
    expect(trayFontSans).toBe(appFontSans);
    expect(appCss).toContain('--font-mono: "Cascadia Mono", "Cascadia Code", Consolas, ui-monospace, monospace;');
    expect(appCss).toContain("--font-scale: 1;");
    for (const [token, base] of [
      ["--font-caption", "0.75rem"],
      ["--font-small", "0.8125rem"],
      ["--font-ui", "0.875rem"],
      ["--font-message", "0.9375rem"],
      ["--font-section", "1rem"],
      ["--font-dialog-title", "1.25rem"],
      ["--font-title", "1.375rem"],
    ] as const) {
      expect(appCss).toContain(`${token}: calc(${base} * var(--font-scale));`);
    }
    expect(appCss).toContain("font-family: var(--font-sans);");
    expect(trayCss).toContain("font-family: var(--font-sans);");
    expect(drawingCss).toContain("font-family: var(--font-mono);");
    expect(appCss).not.toMatch(/\.model-row\[data-active="true"\]\s*\{/);
    expect(appCss).not.toMatch(/\.appearance-background-preview\s*\{/);

    const confirmationCss = readFileSync("src/ui/ConfirmationDialog.css", "utf8");
    const confirmationTitle = confirmationCss.match(/\.confirmation-dialog h3\s*\{([^}]+)\}/)?.[1];
    expect(confirmationTitle).toContain("font-size: var(--font-dialog-title)");
    expect(confirmationTitle).toContain("font-weight: 500");

    const avatarLibraryCss = readFileSync("src/ui/avatar/AvatarLibrary.css", "utf8");
    const avatarSectionHeading = avatarLibraryCss.match(/\.avatar-library-content \.avatar-library-section-heading\s*\{([^}]+)\}/)?.[1];
    expect(avatarSectionHeading).not.toContain("font-weight: 600");
  });
});
