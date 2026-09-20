import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

interface AssistantActionsProps {
  name: string;
  disabled: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onEdit(): void;
  onMove(direction: -1 | 1): void;
  onDelete?: () => void;
}

export function AssistantActions({ name, disabled, canMoveUp, canMoveDown, onEdit, onMove, onDelete }: AssistantActionsProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  function close() { setOpen(false); }
  function dismiss() { close(); trigger.current?.focus(); }
  function run(action: () => void) { dismiss(); action(); }

  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const popup = menu.current;
    popup.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - popup.offsetWidth - 8))}px`;
    popup.style.top = `${Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - popup.offsetHeight - 8))}px`;
    popup.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!wrapper.current?.contains(event.target as Node)) close();
    }
    function scrolled(event: Event) {
      if (!menu.current?.contains(event.target as Node)) dismiss();
    }
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", dismiss);
    document.addEventListener("scroll", scrolled, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", dismiss);
      document.removeEventListener("scroll", scrolled, true);
    };
  }, [open]);

  return <div ref={wrapper} className="assistant-actions" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
  }}>
    <button ref={trigger} className="assistant-menu-trigger" type="button" disabled={disabled}
      aria-label={`管理助手 ${name}`} title="管理助手" aria-haspopup="menu" aria-expanded={open}
      onClick={() => setOpen(!open)} onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); }
      }}><MoreHorizontal size={16} aria-hidden="true" /></button>
    {open && <div ref={menu} className="assistant-menu" role="menu" aria-label={`${name}的管理菜单`} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismiss(); return; }
      if (event.key === "Tab") { dismiss(); return; }
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const target = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
        : event.key === "ArrowDown" ? (index + 1) % buttons.length
          : event.key === "ArrowUp" ? (index - 1 + buttons.length) % buttons.length : undefined;
      if (target !== undefined) { event.preventDefault(); buttons[target]?.focus(); }
    }}>
      <button type="button" role="menuitem" disabled={disabled} aria-label={`编辑助手 ${name}`} onClick={() => run(onEdit)}><Pencil size={15} />编辑</button>
      <button type="button" role="menuitem" disabled={disabled || !canMoveUp} aria-label={`上移助手 ${name}`} onClick={() => run(() => onMove(-1))}><ArrowUp size={15} />上移</button>
      <button type="button" role="menuitem" disabled={disabled || !canMoveDown} aria-label={`下移助手 ${name}`} onClick={() => run(() => onMove(1))}><ArrowDown size={15} />下移</button>
      <button type="button" role="menuitem" disabled={disabled || !onDelete} aria-label={`删除助手 ${name}`}
        aria-description={!onDelete ? "默认助手不可删除" : undefined}
        onClick={() => { if (onDelete) run(onDelete); }}><Trash2 size={15} />删除</button>
      {!onDelete && <p className="assistant-menu-note" role="none">默认助手不可删除</p>}
    </div>}
  </div>;
}
