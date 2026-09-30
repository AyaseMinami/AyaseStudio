import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./ActionMenu.css";

const OPEN_ACTION_MENU = "ayase:open-action-menu";

export function isEditableContextTarget(target: EventTarget | null): boolean {
  // Same-origin sandboxed frame elements belong to another JS realm.
  if (!target || !("nodeType" in target) || target.nodeType !== 1) return false;
  const element = target as Element;
  if (element.closest("input, textarea")) return true;
  const editable = element.closest("[contenteditable]");
  return !!editable && editable.getAttribute("contenteditable") !== "false";
}

export function isContextMenuKey(event: KeyboardEvent): boolean {
  return !event.nativeEvent.isComposing && !event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey &&
    (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey));
}

/** Bind separately to each document: frame events do not bubble to the parent. */
export function bindDefaultContextMenuPolicy(targetDocument: Document): () => void {
  const suppress = (event: MouseEvent) => {
    if (!isEditableContextTarget(event.target)) event.preventDefault();
  };
  targetDocument.addEventListener("contextmenu", suppress, true);
  return () => targetDocument.removeEventListener("contextmenu", suppress, true);
}

/** Preserve native editing menus; suppress the default WebView menu elsewhere. */
export function useDefaultContextMenuPolicy() {
  useEffect(() => bindDefaultContextMenuPolicy(document), []);
}

export interface ActionMenuState<T> {
  target: T;
  left: number;
  top: number;
  opener: HTMLElement;
}

/** Owners keep their target IDs locally and derive actions from current data. */
export function useActionMenu<T>() {
  const owner = useId();
  const [state, setState] = useState<ActionMenuState<T>>();
  const current = useRef(state);
  const close = useCallback((restoreFocus = false) => {
    const previous = current.current;
    current.current = undefined;
    setState(undefined);
    if (restoreFocus && previous?.opener.isConnected && !previous.opener.closest('[inert], [hidden], [aria-hidden="true"]') &&
      !previous.opener.matches(":disabled")) previous.opener.focus({ preventScroll: true });
  }, []);
  const open = (target: T, opener: HTMLElement, point?: { x: number; y: number }) => {
    document.dispatchEvent(new CustomEvent(OPEN_ACTION_MENU, { detail: owner }));
    const bounds = opener.getBoundingClientRect();
    const next = { target, opener, left: point?.x ?? bounds.left, top: point?.y ?? bounds.bottom + 4 };
    current.current = next;
    setState(next);
  };
  useEffect(() => {
    const another = (event: Event) => { if ((event as CustomEvent<string>).detail !== owner) close(); };
    document.addEventListener(OPEN_ACTION_MENU, another);
    return () => document.removeEventListener(OPEN_ACTION_MENU, another);
  }, [owner, close]);
  return { state, open, close };
}

export interface ActionMenuItem {
  id: string;
  label: string;
  accessibleLabel?: string;
  icon?: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
  description?: string;
  onSelect(): void;
}

export function ActionMenu<T>({ state, label, items = [], note, children, role = "menu", onClose }: {
  state: ActionMenuState<T>;
  label: string;
  items?: ActionMenuItem[];
  note?: string;
  children?: ReactNode;
  role?: "menu" | "dialog";
  onClose(restoreFocus?: boolean): void;
}) {
  const popup = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = popup.current!;
    element.style.left = `${Math.max(8, Math.min(state.left, window.innerWidth - element.offsetWidth - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(state.top, window.innerHeight - element.offsetHeight - 8))}px`;
    (element.querySelector<HTMLElement>("input:not(:disabled), button:not(:disabled)") ?? element).focus({ preventScroll: true });
  }, [state, role]);
  useLayoutEffect(() => {
    const focused = document.activeElement;
    if (focused instanceof HTMLButtonElement && focused.disabled && popup.current?.contains(focused)) {
      (popup.current.querySelector<HTMLElement>("button:not(:disabled)") ?? popup.current).focus({ preventScroll: true });
    }
  });
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!popup.current?.contains(event.target as Node) && !state.opener.contains(event.target as Node)) onClose();
    };
    const scrolled = (event: Event) => { if (!popup.current?.contains(event.target as Node)) onClose(true); };
    const resized = () => onClose(true);
    const blurred = () => onClose();
    document.addEventListener("pointerdown", outside);
    document.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", resized);
    window.addEventListener("blur", blurred);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("resize", resized);
      window.removeEventListener("blur", blurred);
    };
  }, [state, onClose]);
  return createPortal(<div ref={popup} className="action-menu" role={role} aria-label={label} tabIndex={-1}
    onBlur={(event) => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) onClose(); }}
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(true); return; }
      if (role !== "menu") return;
      if (event.key === "Tab") { onClose(true); return; }
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      if (!buttons.length) return;
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const target = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
        : event.key === "ArrowDown" ? (index + 1) % buttons.length
          : event.key === "ArrowUp" ? (index - 1 + buttons.length) % buttons.length : undefined;
      if (target !== undefined) { event.preventDefault(); buttons[target]?.focus(); }
    }}>
    {items.map((item) => <button key={item.id} type="button" role="menuitem" disabled={item.disabled}
      aria-label={item.accessibleLabel} aria-description={item.description} title={item.description}
      className={`${item.danger ? "action-menu-danger" : ""} ${item.separatorBefore ? "action-menu-separated" : ""}`}
      onClick={() => { if (!item.disabled) { onClose(true); item.onSelect(); } }}>{item.icon}{item.label}</button>)}
    {note && <p className="action-menu-note" role="none">{note}</p>}
    {children}
  </div>, document.body);
}
