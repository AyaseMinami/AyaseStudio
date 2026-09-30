// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { BackgroundImage } from "./BackgroundImage";

it.each(["cover", "contain"] as const)("keeps %s framing fixed while blur changes and scales blur with layout width", async (fit) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let loaded: (() => void) | undefined;
  let resize: (() => void) | undefined;
  const disconnect = vi.fn();
  vi.stubGlobal("Image", class {
    naturalWidth = 1600; naturalHeight = 1200;
    set onload(callback: (() => void) | null) { loaded = callback ?? undefined; }
    onerror = null; src = "";
  });
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {} disconnect = disconnect;
  });
  const host = document.createElement("div");
  const root = createRoot(host);
  const focus = { x: .3, y: .7, zoom: 1.5 };
  try {
    await act(async () => root.render(<BackgroundImage url="synthetic.png" focus={focus} fit={fit} aspectRatio={16 / 9} />));
    await act(async () => loaded?.());
    const svg = host.querySelector("svg")!;
    let layoutWidth = 800;
    Object.defineProperty(svg, "clientWidth", { get: () => layoutWidth });
    const viewBox = svg.getAttribute("viewBox")!;
    const imageBounds = ["x", "y", "width", "height"].map(key => svg.querySelector("image")!.getAttribute(key));
    const cropWidth = Number(viewBox.split(" ")[2]);
    for (const blur of [16, 32, 0]) {
      await act(async () => root.render(<BackgroundImage url="synthetic.png" focus={focus} fit={fit} aspectRatio={16 / 9} blur={blur} />));
      expect(svg.getAttribute("viewBox")).toBe(viewBox);
      expect(["x", "y", "width", "height"].map(key => svg.querySelector("image")!.getAttribute(key))).toEqual(imageBounds);
      if (blur) {
        expect(Number(svg.querySelector("feGaussianBlur")!.getAttribute("stdDeviation"))).toBeCloseTo(blur * cropWidth / layoutWidth);
        expect(svg.querySelector("feGaussianBlur")!.getAttribute("edgeMode")).toBe("duplicate");
        expect(svg.querySelector("clipPath rect")!.getAttribute("width")).toBe("1600");
        expect(svg.querySelectorAll("image")).toHaveLength(9);
        layoutWidth = 400;
        await act(async () => resize?.());
        expect(Number(svg.querySelector("feGaussianBlur")!.getAttribute("stdDeviation"))).toBeCloseTo(blur * cropWidth / layoutWidth);
      } else {
        expect(svg.querySelector("filter")).toBeNull();
        expect(svg.querySelector("image")!.hasAttribute("filter")).toBe(false);
      }
    }
    expect(disconnect).toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

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
