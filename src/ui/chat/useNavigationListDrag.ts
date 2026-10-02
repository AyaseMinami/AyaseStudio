import { useEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";

export type NavigationDragItem = { kind: "assistant"; id: string } | { kind: "conversation"; id: string; assistantId: string };
type Drop = { id: string; placement: "before" | "after" };
type Gesture = {
  item: NavigationDragItem;
  label: string;
  element: HTMLElement;
  list: HTMLElement;
  pointerId: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  active: boolean;
  cancelled: boolean;
  frame?: number;
  removeListeners(): void;
};

/** Gestures remain local to a navigation list; the owner saves metadata on release. */
export function useNavigationListDrag({ disabled, onMove, onStart }: {
  disabled: boolean;
  onMove(item: NavigationDragItem, targetId: string, placement: Drop["placement"]): void;
  onStart(): void;
}) {
  const options = useRef({ disabled, onMove, onStart });
  options.current = { disabled, onMove, onStart };
  const gesture = useRef<Gesture | null>(null);
  const blockClick = useRef(false);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [drag, setDrag] = useState<{ item: NavigationDragItem; drop: Drop | null } | null>(null);
  const [announcement, setAnnouncement] = useState("");

  function stopResources(current: Gesture) {
    if (current.frame !== undefined) cancelAnimationFrame(current.frame);
  }
  function release(current: Gesture) {
    stopResources(current);
    current.removeListeners();
    if (current.element.hasPointerCapture?.(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
    if (gesture.current === current) gesture.current = null;
  }
  function cancel() {
    const current = gesture.current;
    if (!current) return;
    stopResources(current);
    current.cancelled = true;
    setDrag(null);
    if (current.active) setAnnouncement("已取消拖动。");
    // Retain release handling so cancellation cannot become a name-button click.
  }
  function available(current: Gesture) {
    return !options.current.disabled && current.element.isConnected && current.list.isConnected &&
      !current.element.closest('[hidden], [inert], [aria-hidden="true"]') && !document.querySelector('[role="dialog"]');
  }
  function findDrop(current: Gesture): Drop | null {
    const hit = document.elementFromPoint(current.x, current.y);
    if (!hit || !current.list.contains(hit)) return null;
    const row = hit.closest<HTMLElement>("[data-navigation-sort-id]");
    if (!row || row.closest(".chat-navigation-list") !== current.list || row.dataset.navigationSortKind !== current.item.kind ||
      row.closest('[hidden], [inert], [aria-hidden="true"]')) return null;
    if (current.item.kind === "conversation" && row.dataset.navigationSortScope !== current.item.assistantId) return null;
    const id = row.dataset.navigationSortId;
    if (!id || id === current.item.id) return null;
    const bounds = row.getBoundingClientRect();
    return { id, placement: current.y < bounds.top + bounds.height / 2 ? "before" : "after" };
  }
  function updateDrop(current: Gesture) {
    const drop = findDrop(current);
    setDrag((previous) => previous?.item === current.item && previous.drop?.id === drop?.id &&
      previous.drop?.placement === drop?.placement ? previous : { item: current.item, drop });
  }
  function autoScroll(current: Gesture) {
    if (gesture.current !== current || current.cancelled) return;
    if (!available(current)) { cancel(); return; }
    const bounds = current.list.getBoundingClientRect();
    if (current.x >= bounds.left && current.x <= bounds.right && current.y >= bounds.top && current.y <= bounds.bottom) {
      const distance = current.y < bounds.top + 28 ? -8 : current.y > bounds.bottom - 28 ? 8 : 0;
      if (distance) { current.list.scrollTop += distance; updateDrop(current); }
    }
    current.frame = requestAnimationFrame(() => autoScroll(current));
  }
  function activate(current: Gesture) {
    if (gesture.current !== current || current.cancelled) return;
    if (!available(current)) { cancel(); return; }
    current.active = true;
    current.element.setPointerCapture?.(current.pointerId);
    options.current.onStart();
    setAnnouncement(`正在拖动${current.item.kind === "assistant" ? "助手" : "对话"} ${current.label}。`);
    updateDrop(current);
    current.frame = requestAnimationFrame(() => autoScroll(current));
  }
  function begin(event: ReactPointerEvent<HTMLElement>, item: NavigationDragItem, label: string) {
    if (options.current.disabled || event.button !== 0 || !event.isPrimary) return;
    const list = event.currentTarget.closest<HTMLElement>(".chat-navigation-list");
    if (!list || event.currentTarget.closest('[hidden], [inert], [aria-hidden="true"]') || document.querySelector('[role="dialog"]')) return;
    if (gesture.current) release(gesture.current);
    clearTimeout(clickTimer.current);
    blockClick.current = false;
    const current: Gesture = {
      item, label, list, element: event.currentTarget, pointerId: event.pointerId,
      x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY,
      active: false, cancelled: false, removeListeners: () => {},
    };
    gesture.current = current;
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== current.pointerId || current.cancelled) return;
      current.x = pointer.clientX; current.y = pointer.clientY;
      if (!available(current)) { cancel(); return; }
      if (!current.active) {
        if (Math.hypot(current.x - current.startX, current.y - current.startY) < 6) return;
        activate(current);
      }
      if (current.active) { pointer.preventDefault(); updateDrop(current); }
    };
    const end = (pointer: PointerEvent) => {
      if (pointer.pointerId !== current.pointerId) return;
      current.x = pointer.clientX; current.y = pointer.clientY;
      const drop = current.active && !current.cancelled && available(current) ? findDrop(current) : null;
      release(current); setDrag(null);
      if (current.active || current.cancelled) {
        blockClick.current = true;
        clickTimer.current = setTimeout(() => { blockClick.current = false; }, 0);
      }
      if (current.active) {
        if (drop) options.current.onMove(current.item, drop.id, drop.placement);
        else if (!current.cancelled) setAnnouncement("拖动结束，顺序未改变。");
      }
    };
    const pointerCancel = (pointer: PointerEvent) => {
      if (pointer.pointerId !== current.pointerId) return;
      cancel(); release(current);
      blockClick.current = true;
      clickTimer.current = setTimeout(() => { blockClick.current = false; }, 0);
    };
    const key = (keyboard: KeyboardEvent) => {
      if (keyboard.key === "Escape") { keyboard.preventDefault(); keyboard.stopPropagation(); cancel(); }
    };
    const hide = () => { if (document.hidden) cancel(); };
    const nextPress = (pointer: PointerEvent) => {
      if (!pointer.isPrimary) return;
      release(current); setDrag(null);
    };
    window.addEventListener("pointerdown", nextPress, true);
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", pointerCancel);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    document.addEventListener("visibilitychange", hide);
    current.removeListeners = () => {
      window.removeEventListener("pointerdown", nextPress, true);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", pointerCancel);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
      document.removeEventListener("visibilitychange", hide);
    };
  }
  useEffect(() => { if (disabled) cancel(); }, [disabled]);
  useEffect(() => () => {
    if (gesture.current) release(gesture.current);
    clearTimeout(clickTimer.current);
  }, []);
  function suppressClick(event: MouseEvent<HTMLElement>) {
    if ((gesture.current?.active || gesture.current?.cancelled || blockClick.current) && event.detail !== 0) {
      event.preventDefault(); event.stopPropagation();
    }
  }
  return { drag, announcement, begin, cancel, suppressClick };
}
