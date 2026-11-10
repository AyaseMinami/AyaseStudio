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
});
