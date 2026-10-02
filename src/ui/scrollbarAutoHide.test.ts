// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installScrollbarAutoHide } from "./scrollbarAutoHide";

let dispose: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  dispose = installScrollbarAutoHide(document);
});
afterEach(() => {
  dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function animatableArea() {
  dispose();
  vi.stubGlobal("CSS", { registerProperty: vi.fn() });
  const reduce = new EventTarget();
  const contrast = new EventTarget();
  Object.defineProperty(reduce, "matches", { value: false, writable: true });
  Object.defineProperty(contrast, "matches", { value: false, writable: true });
  vi.spyOn(window, "matchMedia").mockImplementation((query) =>
    (query.includes("reduced-motion") ? reduce : contrast) as MediaQueryList);
  dispose = installScrollbarAutoHide(document);
  const element = area();
  element.style.overflowY = "auto";
  Object.defineProperty(element, "scrollHeight", { value: 500 });
  Object.defineProperty(element, "clientHeight", { value: 100 });
  Object.defineProperty(element, "clientWidth", { value: 348 });
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 360, 100));
  const animations: Array<{ cancel: ReturnType<typeof vi.fn>; onfinish: (() => void) | null }> = [];
  const animate = vi.fn(() => {
    const animation = { cancel: vi.fn(), onfinish: null as (() => void) | null };
    animations.push(animation);
    return animation;
  });
  Object.defineProperty(element, "animate", { value: animate });
  return { element, animate, animations, reduce, contrast };
}

function pointer(element: Element, type: "pointerover" | "pointerout", relatedTarget: Element | null = null): void {
  element.dispatchEvent(new PointerEvent(type, { bubbles: true, relatedTarget, pointerType: "mouse", clientX: 350, clientY: 50 }));
}

it("fades hover in and out without restarting when crossing descendants", () => {
  const { element, animate, animations } = animatableArea();
  element.style.setProperty("--scrollbar-opacity", "0");
  pointer(element, "pointerover");
  expect(animate).toHaveBeenLastCalledWith({ "--scrollbar-opacity": ["0", "1"] }, { duration: 150, easing: "ease-out" });
  const child = area(element);
  pointer(element, "pointerout", child);
  pointer(child, "pointerover", element);
  expect(animate).toHaveBeenCalledTimes(1);
  animations[0].onfinish?.();
  element.style.setProperty("--scrollbar-opacity", "1");
  pointer(element, "pointerout");
  expect(animate).toHaveBeenLastCalledWith({ "--scrollbar-opacity": ["1", "0"] }, { duration: 200, easing: "ease-out" });
  expect(element.hasAttribute("data-scrollbar-fade")).toBe(true);
  animations[1].onfinish?.();
  expect(element.hasAttribute("data-scrollbar-fade")).toBe(false);
});

it("reverses from the current alpha and ignores an interrupted animation's finish", () => {
  const { element, animate, animations } = animatableArea();
  pointer(element, "pointerover");
  element.style.setProperty("--scrollbar-opacity", "0.4");
  pointer(element, "pointerout");
  expect(animations[0].cancel).toHaveBeenCalledOnce();
  animations[0].onfinish?.();
  expect(element.hasAttribute("data-scrollbar-fade")).toBe(true);
  element.style.setProperty("--scrollbar-opacity", "0.2");
  pointer(element, "pointerover");
  expect(animations[1].cancel).toHaveBeenCalledOnce();
  expect(animate).toHaveBeenLastCalledWith({ "--scrollbar-opacity": ["0.2", "1"] }, { duration: 150, easing: "ease-out" });
});

it("keeps scroll visibility through mouse leave and starts fading only after idle", () => {
  const { element, animate, animations } = animatableArea();
  pointer(element, "pointerover");
  animations[0].onfinish?.();
  scroll(element);
  pointer(element, "pointerout");
  vi.advanceTimersByTime(699);
  expect(animate).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1);
  expect(animate).toHaveBeenCalledTimes(2);
  expect(element.hasAttribute("data-scrollbar-visible")).toBe(false);
});

it.each(["reduce", "contrast"] as const)("settles in-flight fades and skips animation when %s becomes active", (preference) => {
  const fixture = animatableArea();
  pointer(fixture.element, "pointerover");
  pointer(fixture.element, "pointerout");
  Object.defineProperty(fixture[preference], "matches", { value: true });
  fixture[preference].dispatchEvent(new Event("change"));
  expect(fixture.animations[1].cancel).toHaveBeenCalledOnce();
  expect(fixture.element.hasAttribute("data-scrollbar-fade")).toBe(false);
  pointer(fixture.element, "pointerover");
  expect(fixture.animate).toHaveBeenCalledTimes(2);
  expect(fixture.element.hasAttribute("data-scrollbar-visible")).toBe(true);
});

it("disposal cancels animation and removes all transient markers and pointer listeners", () => {
  const { element, animate, animations } = animatableArea();
  scroll(element);
  dispose();
  expect(animations[0].cancel).toHaveBeenCalledOnce();
  expect(element.hasAttribute("data-scrollbar-scrolling")).toBe(false);
  expect(element.hasAttribute("data-scrollbar-fade")).toBe(false);
  expect(element.hasAttribute("data-scrollbar-visible")).toBe(false);
  pointer(element, "pointerover");
  expect(animate).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("skips costly fades for large subtrees while retaining scroll visibility and idle hiding", () => {
  const { element, animate } = animatableArea();
  const nested = area(element);
  nested.append(...Array.from({ length: 500 }, () => document.createElement("span")));
  scroll(element);
  expect(element.hasAttribute("data-scrollbar-visible")).toBe(true);
  expect(animate).not.toHaveBeenCalled();
  vi.advanceTimersByTime(700);
  expect(element.hasAttribute("data-scrollbar-fade")).toBe(false);
});

it("reevaluates animation cost when new content mounts during activity", () => {
  const { element, animate, animations } = animatableArea();
  scroll(element);
  animations[0].onfinish?.();
  element.append(...Array.from({ length: 500 }, () => document.createElement("span")));
  vi.advanceTimersByTime(700);
  expect(animate).toHaveBeenCalledOnce();
  expect(element.hasAttribute("data-scrollbar-fade")).toBe(false);
});

it("hides after scroll idle while the pointer stays over message content", () => {
  const { element, animations } = animatableArea();
  vi.spyOn(element, "matches").mockImplementation(selector => selector === ":hover");
  element.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse", clientX: 150, clientY: 50 }));
  scroll(element);
  vi.advanceTimersByTime(700);
  expect(element.hasAttribute("data-scrollbar-visible")).toBe(false);
  animations[animations.length - 1]?.onfinish?.();
  expect(element.hasAttribute("data-scrollbar-fade")).toBe(false);
});

function move(element: Element, x: number, y: number, pointerType = "mouse"): void {
  element.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType, clientX: x, clientY: y }));
}

it("reveals only near the scrollbar and fades when moving back into content without leaving the container", () => {
  const { element, animate, animations } = animatableArea();
  vi.spyOn(element, "matches").mockImplementation(selector => selector === ":hover");
  move(element, 150, 50);
  expect(animate).not.toHaveBeenCalled();
  move(element, 350, 50);
  expect(element.hasAttribute("data-scrollbar-visible")).toBe(true);
  animations[0].onfinish?.();
  move(element, 150, 50);
  expect(element.hasAttribute("data-scrollbar-visible")).toBe(false);
  animations[1].onfinish?.();
  expect(element.hasAttribute("data-scrollbar-fade")).toBe(false);
});

it("keeps scrollbar proximity visible after scroll idle until the pointer moves away", () => {
  const { element } = animatableArea();
  move(element, 350, 50);
  scroll(element);
  vi.advanceTimersByTime(700);
  expect(element.hasAttribute("data-scrollbar-visible")).toBe(true);
  move(element, 150, 50);
  expect(element.hasAttribute("data-scrollbar-visible")).toBe(false);
});

it("discovers horizontal and left RTL scrollbar edges without activating content", () => {
  const { element } = animatableArea();
  element.style.direction = "rtl";
  element.style.overflowX = "auto";
  Object.defineProperty(element, "scrollWidth", { value: 600 });
  move(element, 8, 50);
  expect(element.hasAttribute("data-scrollbar-visible")).toBe(true);
  move(element, 150, 95);
  expect(element.hasAttribute("data-scrollbar-visible")).toBe(true);
  move(element, 350, 50);
  expect(element.hasAttribute("data-scrollbar-visible")).toBe(false);
});

it("does not pin an ancestor scrollbar when hovering a nested scrollbar", () => {
  const { element } = animatableArea();
  const parent = area();
  parent.append(element);
  parent.style.overflowY = "auto";
  Object.defineProperty(parent, "scrollHeight", { value: 900 });
  Object.defineProperty(parent, "clientHeight", { value: 200 });
  Object.defineProperty(parent, "clientWidth", { value: 588 });
  vi.spyOn(parent, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 600, 200));
  move(element, 350, 50);
  expect(element.hasAttribute("data-scrollbar-visible")).toBe(true);
  expect(parent.hasAttribute("data-scrollbar-visible")).toBe(false);
});

it("ignores touch hover and pointer movement after disposal", () => {
  const { element, animate } = animatableArea();
  move(element, 350, 50, "touch");
  expect(animate).not.toHaveBeenCalled();
  dispose();
  move(element, 350, 50);
  expect(animate).not.toHaveBeenCalled();
});

function area(parent: Element = document.body): HTMLDivElement {
  const element = document.createElement("div");
  parent.append(element);
  return element;
}
function scroll(element: Element | Document): void {
  element.dispatchEvent(new Event("scroll", { bubbles: false }));
}

it("enables hiding and captures non-bubbling scroll events from newly added content", () => {
  expect(document.documentElement.hasAttribute("data-scrollbar-autohide")).toBe(true);
  const element = area();
  expect(element.hasAttribute("data-scrollbar-scrolling")).toBe(false);
  scroll(element);
  expect(element.hasAttribute("data-scrollbar-scrolling")).toBe(true);
  vi.advanceTimersByTime(699);
  expect(element.hasAttribute("data-scrollbar-scrolling")).toBe(true);
  vi.advanceTimersByTime(1);
  expect(element.hasAttribute("data-scrollbar-scrolling")).toBe(false);
});

it("keeps continuous scrolling visible until 700ms after the last scroll event", () => {
  const element = area();
  scroll(element);
  vi.advanceTimersByTime(600);
  scroll(element);
  vi.advanceTimersByTime(600);
  expect(element.hasAttribute("data-scrollbar-scrolling")).toBe(true);
  vi.advanceTimersByTime(100);
  expect(element.hasAttribute("data-scrollbar-scrolling")).toBe(false);
});

it("tracks nested and sibling scroll areas independently without activating ancestors", () => {
  const parent = area();
  const inner = area(parent);
  const sibling = area();
  scroll(inner);
  expect(parent.hasAttribute("data-scrollbar-scrolling")).toBe(false);
  expect(sibling.hasAttribute("data-scrollbar-scrolling")).toBe(false);
  vi.advanceTimersByTime(300);
  scroll(sibling);
  vi.advanceTimersByTime(400);
  expect(inner.hasAttribute("data-scrollbar-scrolling")).toBe(false);
  expect(sibling.hasAttribute("data-scrollbar-scrolling")).toBe(true);
  vi.advanceTimersByTime(300);
  expect(sibling.hasAttribute("data-scrollbar-scrolling")).toBe(false);
});

it("maps viewport scroll events onto the document scrolling element", () => {
  const element = document.scrollingElement ?? document.documentElement;
  scroll(document);
  expect(element.hasAttribute("data-scrollbar-scrolling")).toBe(true);
  vi.advanceTimersByTime(700);
  expect(element.hasAttribute("data-scrollbar-scrolling")).toBe(false);
});

it("cleans detached targets, pending timers and the listener on disposal", () => {
  const detached = area();
  const connected = area();
  scroll(detached);
  detached.remove();
  vi.advanceTimersByTime(700);
  expect(detached.hasAttribute("data-scrollbar-scrolling")).toBe(false);
  scroll(connected);
  dispose();
  expect(document.documentElement.hasAttribute("data-scrollbar-autohide")).toBe(false);
  expect(connected.hasAttribute("data-scrollbar-scrolling")).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  scroll(connected);
  expect(connected.hasAttribute("data-scrollbar-scrolling")).toBe(false);
});
