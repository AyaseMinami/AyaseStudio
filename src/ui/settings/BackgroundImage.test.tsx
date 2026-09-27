// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { BackgroundImage } from "./BackgroundImage";

it("keeps a fixed preview crop at 16:9 while the real background follows the window", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let loaded: (() => void) | undefined;
  vi.stubGlobal("Image", class {
    naturalWidth = 1600;
    naturalHeight = 1200;
    set onload(callback: (() => void) | null) { loaded = callback ?? undefined; }
    onerror = null;
    src = "";
  });
  vi.stubGlobal("innerWidth", 800);
  vi.stubGlobal("innerHeight", 800);
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<BackgroundImage url="synthetic.png" focus={null} fit="cover" aspectRatio={16 / 9} />));
    await act(async () => loaded?.());
    const fixed = host.querySelector("svg")!.getAttribute("viewBox");
    const parts = fixed!.split(" ").map(Number);
    expect(parts[2] / parts[3]).toBeCloseTo(16 / 9);
    vi.stubGlobal("innerWidth", 400);
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(host.querySelector("svg")!.getAttribute("viewBox")).toBe(fixed);
    await act(async () => root.render(<BackgroundImage url="synthetic.png" focus={null} fit="cover" />));
    const actual = host.querySelector("svg")!.getAttribute("viewBox")!.split(" ").map(Number);
    expect(actual[2] / actual[3]).toBeCloseTo(0.5);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
