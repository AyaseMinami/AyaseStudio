import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import "./SelectField.css";

export interface SelectOption { value: string; label: string; disabled?: boolean }

/** Fixed listboxes may live outside a filtered surface; ownership still belongs to its trigger. */
export function containsSelectFieldTarget(container: Element | null, target: EventTarget | null): boolean {
  if (!(target instanceof Node) || !container) return false;
  if (container.contains(target)) return true;
  const list = (target instanceof Element ? target : target.parentElement)?.closest('.select-field-popup');
  return Boolean(list?.id && Array.from(container.querySelectorAll('[role="combobox"][aria-controls]'))
    .some(trigger => trigger.getAttribute("aria-controls") === list.id));
}

/** Short, single-choice lists. Focus stays on the trigger inside its owning dialog. */
export function SelectField({ value, options, label, disabled = false, title, id: fieldId, className, onChange }: {
  value: string; options: SelectOption[]; label: string; disabled?: boolean; title?: string; id?: string; className?: string;
  onChange(value: string): void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(value);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 280 });
  const enabled = options.filter(option => !option.disabled);
  const selected = options.find(option => option.value === value);
  const activeIndex = options.findIndex(option => option.value === active && !option.disabled);
  const shown = open && !disabled;
  const search = useRef({ text: "", time: 0 });

  function show() {
    if (disabled || trigger.current?.matches(":disabled") || !enabled.length) return;
    setActive(enabled.some(option => option.value === value) ? value : enabled[0].value);
    search.current = { text: "", time: 0 };
    setOpen(true);
  }
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useLayoutEffect(() => {
    if (!shown) return;
    if (!enabled.some(option => option.value === active)) setActive(enabled[0]?.value ?? "");
    const bounds = trigger.current!.getBoundingClientRect();
    const below = window.innerHeight - bounds.bottom - 14;
    const above = bounds.top - 14;
    // Let short labels determine a comfortable width before clamping to the viewport.
    if (popup.current) popup.current.style.width = "max-content";
    // Reserve space for a checkmark and a possible vertical scrollbar too.
    const naturalWidth = popup.current ? popup.current.offsetWidth + 32 : 0;
    const width = Math.min(Math.max(bounds.width, 180, naturalWidth), Math.max(0, window.innerWidth - 16));
    // Measure wrapped labels at their final width before deciding which side fits.
    if (popup.current) popup.current.style.width = `${width}px`;
    const wanted = Math.min(280, popup.current?.scrollHeight || options.length * 38 + 12);
    const up = below < wanted && above > below;
    const maxHeight = Math.max(0, Math.min(280, up ? above : below));
    const height = Math.min(popup.current?.scrollHeight || wanted, maxHeight);
    setPosition({ left: Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8)),
      top: up ? Math.max(8, bounds.top - height - 6) : bounds.bottom + 6, width, maxHeight });
  }, [shown, options, active]);
  useEffect(() => {
    if (!shown) return;
    popup.current?.querySelector<HTMLElement>(`[data-active="true"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [shown, active]);
  useEffect(() => {
    if (!shown) return;
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) setOpen(false);
    };
    const close = () => setOpen(false);
    const scroll = (event: Event) => { if (!popup.current?.contains(event.target as Node)) close(); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [shown]);
  function choose(option: SelectOption) {
    if (disabled || trigger.current?.matches(":disabled") || option.disabled) return;
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
    if (option.value !== value) onChange(option.value);
  }
  return <>
    <button ref={trigger} id={fieldId} type="button" className={`select-field${className ? ` ${className}` : ""}`} role="combobox" aria-label={label}
      aria-haspopup="listbox" aria-expanded={shown} aria-controls={shown ? id : undefined}
      aria-activedescendant={shown && activeIndex >= 0 ? `${id}-${activeIndex}` : undefined}
      disabled={disabled} title={title ?? selected?.label ?? value} onBlur={() => setOpen(false)}
      onClick={() => shown ? setOpen(false) : show()}
      onKeyDown={event => {
        if (disabled || trigger.current?.matches(":disabled")) return;
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) { event.stopPropagation(); return; }
        if (event.key === "Escape" && shown) { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
        if (event.key === "Tab") { setOpen(false); return; }
        if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          if (!shown) { show(); return; }
          if (event.key === "Enter" || event.key === " ") {
            const option = enabled.find(item => item.value === active); if (option) choose(option); return;
          }
          if (!enabled.length) return;
          const index = enabled.findIndex(item => item.value === active);
          const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length;
          setActive(enabled[next].value);
        } else if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
          event.preventDefault();
          if (!shown) show();
          const now = Date.now();
          const text = (now - search.current.time < 700 ? search.current.text : "") + event.key.toLocaleLowerCase();
          search.current = { text, time: now };
          const match = enabled.find(item => item.label.toLocaleLowerCase().startsWith(text));
          if (match) setActive(match.value);
        }
      }}><span>{selected?.label ?? value}</span><ChevronDown size={16} aria-hidden="true" /></button>
    {shown && createPortal(<div ref={popup} id={id} role="listbox" aria-label={label} className="select-field-popup"
      style={position} onMouseDown={event => event.preventDefault()}>
      {options.map((option, index) => <div key={option.value} id={`${id}-${index}`} role="option"
        aria-selected={option.value === value} aria-disabled={option.disabled || undefined} data-active={option.value === active && !option.disabled}
        className="select-field-option" onPointerMove={() => { if (!option.disabled) setActive(option.value); }}
        onClick={() => choose(option)}><span>{option.label}</span>{option.value === value && <Check size={16} aria-hidden="true" />}</div>)}
    </div>, trigger.current?.closest('dialog') ?? document.body)}
  </>;
}
