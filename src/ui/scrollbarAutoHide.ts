const idleDelayMs = 700;
const opacityProperty = "--scrollbar-opacity";
// Custom-property animations can restyle descendants even without inheritance.
// Bound discovery work and skip fades on large subtrees rather than slowing scroll.
const maxAnimatedDescendants = 500;

interface ScrollArea {
  hovered: boolean;
  visible: boolean;
  idleTimer?: ReturnType<typeof setTimeout>;
  animation?: Animation;
}

interface PointerPosition { x: number; y: number }

/** Delegated activity listeners cover new content without per-area listeners or React updates. */
export function installScrollbarAutoHide(targetDocument: Document): () => void {
  const view = targetDocument.defaultView;
  const reducedMotion = view?.matchMedia("(prefers-reduced-motion: reduce)");
  const forcedColors = view?.matchMedia("(forced-colors: active)");
  const supportsAnimation = typeof CSS !== "undefined" && "registerProperty" in CSS;
  const active = new Map<Element, ScrollArea>();
  let pointerPosition: PointerPosition | undefined;
  targetDocument.documentElement.setAttribute("data-scrollbar-autohide", "");

  function release(element: Element, state: ScrollArea): void {
    if (state.visible || state.idleTimer !== undefined || state.animation) return;
    element.removeAttribute("data-scrollbar-fade");
    element.removeAttribute("data-scrollbar-visible");
    active.delete(element);
  }

  function area(element: Element): ScrollArea {
    let state = active.get(element);
    if (!state) {
      state = { hovered: nearScrollbar(element), visible: false };
      active.set(element, state);
      element.setAttribute("data-scrollbar-fade", "");
    }
    return state;
  }

  function withinAnimationBudget(element: Element): boolean {
    const descendants = targetDocument.createTreeWalker(element, NodeFilter.SHOW_ELEMENT);
    let count = 0;
    while (count < maxAnimatedDescendants && descendants.nextNode()) count++;
    return count < maxAnimatedDescendants;
  }

  function show(element: Element, state: ScrollArea, visible: boolean): void {
    if (state.visible === visible) return;
    const current = Number.parseFloat(view?.getComputedStyle(element).getPropertyValue(opacityProperty) ?? "");
    const from = Number.isFinite(current) ? current : state.visible ? 1 : 0;
    state.animation?.cancel();
    state.animation = undefined;
    state.visible = visible;
    element.toggleAttribute("data-scrollbar-visible", visible);

    if (supportsAnimation && typeof element.animate === "function" && element.isConnected
      && !reducedMotion?.matches && !forcedColors?.matches && withinAnimationBudget(element)) {
      const animation = element.animate({ [opacityProperty]: [String(from), visible ? "1" : "0"] }, {
        duration: visible ? 150 : 200,
        easing: "ease-out",
      });
      state.animation = animation;
      animation.onfinish = () => {
        if (state.animation !== animation) return;
        state.animation = undefined;
        release(element, state);
      };
    } else {
      release(element, state);
    }
  }

  function nearScrollbar(element: Element): boolean {
    if (!pointerPosition || !element.isConnected) return false;
    const overflowsY = element.scrollHeight > element.clientHeight;
    const overflowsX = element.scrollWidth > element.clientWidth;
    if (!overflowsY && !overflowsX) return false;
    const style = view?.getComputedStyle(element);
    const viewport = element === targetDocument.scrollingElement;
    const scrollsY = overflowsY && (viewport || /^(auto|scroll)$/.test(style?.overflowY ?? ""));
    const scrollsX = overflowsX && (viewport || /^(auto|scroll)$/.test(style?.overflowX ?? ""));
    if (!scrollsY && !scrollsX) return false;
    const bounds = element.getBoundingClientRect();
    const width = viewport ? view?.innerWidth ?? bounds.width : bounds.width;
    const height = viewport ? view?.innerHeight ?? bounds.height : bounds.height;
    const left = viewport ? 0 : bounds.left;
    const top = viewport ? 0 : bounds.top;
    const scaleX = !viewport && element instanceof HTMLElement && element.offsetWidth ? width / element.offsetWidth : 1;
    const scaleY = !viewport && element instanceof HTMLElement && element.offsetHeight ? height / element.offsetHeight : 1;
    const x = (pointerPosition.x - left) / scaleX;
    const y = (pointerPosition.y - top) / scaleY;
    const layoutWidth = width / scaleX;
    const layoutHeight = height / scaleY;
    if (x < 0 || y < 0 || x > layoutWidth || y > layoutHeight) return false;
    const borderLeft = viewport ? 0 : Number.parseFloat(style?.borderLeftWidth ?? "0") || 0;
    const borderRight = viewport ? 0 : Number.parseFloat(style?.borderRightWidth ?? "0") || 0;
    const borderBottom = viewport ? 0 : Number.parseFloat(style?.borderBottomWidth ?? "0") || 0;
    const borderTop = viewport ? 0 : Number.parseFloat(style?.borderTopWidth ?? "0") || 0;
    // Include 6px of adjacent content so a transparent thumb is easy to find.
    const scrollbarSize = Number.parseFloat(style?.getPropertyValue("--scrollbar-size") ?? "") || 12;
    const verticalBand = Math.max(scrollbarSize, layoutWidth - element.clientWidth - borderLeft - borderRight) + 6;
    const horizontalBand = Math.max(scrollbarSize, layoutHeight - element.clientHeight - borderTop - borderBottom) + 6;
    const scrollbarOnLeft = style?.direction === "rtl";
    return (scrollsY && (scrollbarOnLeft ? x <= borderLeft + verticalBand : x >= layoutWidth - borderRight - verticalBand))
      || (scrollsX && y >= layoutHeight - borderBottom - horizontalBand);
  }

  function hoveredAreas(target: EventTarget | null): Set<Element> {
    const found = new Set<Element>();
    for (let element = target instanceof Element ? target : null; element; element = element.parentElement) {
      if (nearScrollbar(element)) found.add(element);
    }
    return found;
  }

  function onPointerBoundary(event: PointerEvent): void {
    if (event.pointerType === "touch") return;
    const target = event.type === "pointerout" ? event.relatedTarget : event.target;
    pointerPosition = target ? { x: event.clientX, y: event.clientY } : undefined;
    const next = hoveredAreas(target);
    for (const [element, state] of active) {
      if (state.hovered && !next.has(element)) {
        state.hovered = false;
        show(element, state, state.idleTimer !== undefined);
      }
    }
    for (const element of next) {
      const state = area(element);
      state.hovered = true;
      show(element, state, true);
    }
  }

  function onScroll(event: Event): void {
    const target = event.target === targetDocument
      ? targetDocument.scrollingElement ?? targetDocument.documentElement
      : event.target;
    if (!(target instanceof Element)) return;

    const state = area(target);
    if (state.idleTimer !== undefined) clearTimeout(state.idleTimer);
    target.setAttribute("data-scrollbar-scrolling", "");
    show(target, state, true);
    state.idleTimer = setTimeout(() => {
      target.removeAttribute("data-scrollbar-scrolling");
      state.idleTimer = undefined;
      state.hovered = nearScrollbar(target);
      show(target, state, state.hovered);
    }, idleDelayMs);
  }

  function onMotionPreference(): void {
    if (!reducedMotion?.matches && !forcedColors?.matches) return;
    for (const [element, state] of active) {
      state.animation?.cancel();
      state.animation = undefined;
      release(element, state);
    }
  }

  targetDocument.addEventListener("scroll", onScroll, { capture: true, passive: true });
  targetDocument.addEventListener("pointerover", onPointerBoundary, { passive: true });
  targetDocument.addEventListener("pointerout", onPointerBoundary, { passive: true });
  targetDocument.addEventListener("pointermove", onPointerBoundary, { passive: true });
  reducedMotion?.addEventListener("change", onMotionPreference);
  forcedColors?.addEventListener("change", onMotionPreference);
  return () => {
    targetDocument.removeEventListener("scroll", onScroll, true);
    targetDocument.removeEventListener("pointerover", onPointerBoundary);
    targetDocument.removeEventListener("pointerout", onPointerBoundary);
    targetDocument.removeEventListener("pointermove", onPointerBoundary);
    reducedMotion?.removeEventListener("change", onMotionPreference);
    forcedColors?.removeEventListener("change", onMotionPreference);
    targetDocument.documentElement.removeAttribute("data-scrollbar-autohide");
    for (const [element, state] of active) {
      if (state.idleTimer !== undefined) clearTimeout(state.idleTimer);
      state.animation?.cancel();
      element.removeAttribute("data-scrollbar-scrolling");
      element.removeAttribute("data-scrollbar-fade");
      element.removeAttribute("data-scrollbar-visible");
    }
    active.clear();
  };
}
