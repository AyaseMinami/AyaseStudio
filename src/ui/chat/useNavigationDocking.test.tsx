// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shouldDockNavigation, useNavigationDocking } from "./useNavigationDocking";
import type { ConversationNavigationSnapshot } from "./useConversationNavigation";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mounted: Array<{ root: ReturnType<typeof createRoot>; host: HTMLElement }> = [];
afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("navigation available space", () => {
  it("uses the real workspace and current navigation occupancy instead of viewport breakpoints", () => {
    expect(shouldDockNavigation(948, 316)).toBe(true);
    expect(shouldDockNavigation(948, 508)).toBe(false);
    expect(shouldDockNavigation(700, 72)).toBe(true);
    expect(shouldDockNavigation(1100, 600)).toBe(false);
    expect(shouldDockNavigation(400, 0)).toBe(true);
  });
  it("preserves 560px and requires 16px extra only when returning from coverage", () => {
    expect(shouldDockNavigation(876, 316)).toBe(true);
    expect(shouldDockNavigation(875.5, 316, true)).toBe(false);
    expect(shouldDockNavigation(876, 316, false)).toBe(false);
    expect(shouldDockNavigation(891.5, 316, false)).toBe(false);
    expect(shouldDockNavigation(892, 316, false)).toBe(true);
  });
  it("reacts to container resize, CSS occupancy and navigation state, with observer cleanup", async () => {
    let available = 948;
    let occupied = 316;
    const observers: Array<{ callback: () => void; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
    vi.stubGlobal("ResizeObserver", class {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(readonly callback: () => void) { observers.push(this); }
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return { width: this.className === "navigation-space-probe" ? occupied : available } as DOMRect;
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    mounted.push({ root, host });
    function Harness({ snapshot }: { snapshot: ConversationNavigationSnapshot }) {
      const { bodyRef, docked } = useNavigationDocking(snapshot);
      return <div ref={bodyRef} data-docked={docked}><span className="navigation-space-probe" /></div>;
    }
    const snapshot = { open: true, assistantExpanded: false, conversationsOpen: true };
    const render = async (next = snapshot) => {
      await act(async () => root.render(<StrictMode><Harness snapshot={next} /></StrictMode>));
    };
    const docked = () => host.firstElementChild?.getAttribute("data-docked");
    const resize = async () => { await act(async () => observers[observers.length - 1].callback()); };
    await render();
    expect(docked()).toBe("true");
    expect(observers[observers.length - 1].observe.mock.calls.map(([element]) => element)).toEqual([
      host.firstElementChild, host.querySelector(".navigation-space-probe"),
    ]);
    occupied = 508;
    await render({ ...snapshot, assistantExpanded: true });
    expect(docked()).toBe("false");
    occupied = 316;
    await render();
    expect(docked()).toBe("true");
    available = 875;
    await resize();
    expect(docked()).toBe("false");
    available = 880;
    await resize();
    expect(docked()).toBe("false");
    available = 892;
    await resize();
    expect(docked()).toBe("true");
    available = 0; // A temporarily hidden workspace must not erase the previous decision.
    await resize();
    expect(docked()).toBe("true");
    available = 400;
    occupied = 0;
    await render({ ...snapshot, open: false });
    expect(docked()).toBe("true");
    await act(async () => root.unmount());
    expect(observers.every(observer => observer.disconnect.mock.calls.length === 1)).toBe(true);
    occupied = 508;
    await resize(); // Late callbacks after cleanup do nothing.
    mounted.splice(mounted.findIndex(entry => entry.root === root), 1);
    host.remove();
  });
  it("supports resize events when ResizeObserver is unavailable", async () => {
    vi.stubGlobal("ResizeObserver", undefined);
    let available = 948;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return { width: this.className === "navigation-space-probe" ? 316 : available } as DOMRect;
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    mounted.push({ root, host });
    function Harness() {
      const { bodyRef, docked } = useNavigationDocking({ open: true, assistantExpanded: false, conversationsOpen: true });
      return <div ref={bodyRef} data-docked={docked}><span className="navigation-space-probe" /></div>;
    }
    await act(async () => root.render(<Harness />));
    expect(host.firstElementChild?.getAttribute("data-docked")).toBe("true");
    available = 800;
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(host.firstElementChild?.getAttribute("data-docked")).toBe("false");
  });
});
