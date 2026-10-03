import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search, X } from "lucide-react";
import type { SelectOption } from "./SelectField";
import "./SelectField.css";
import "./SearchSelectField.css";

export interface SearchSelectOption extends SelectOption { description?: string; group?: string }

/** Searchable long lists. Selection is explicit; query/focus never changes the value. */
export function SearchChoiceDialog({ options, value, label, hint, disabled = false, error, searchLabel, closeLabel, onSelect, onClose }: {
  options: SearchSelectOption[]; value: string; label: string; hint?: string; disabled?: boolean; error?: string; searchLabel?: string; closeLabel?: string;
  onSelect(value: string): boolean | Promise<boolean>; onClose(): void;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef(document.activeElement as HTMLElement | null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [failure, setFailure] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const visible = options.filter(option => [option.label, option.description ?? "", option.group ?? ""].some(text => text.toLocaleLowerCase().includes(needle)));
  const groups = new Map<string, SearchSelectOption[]>();
  for (const option of visible) { const key = option.group ?? ""; groups.set(key, [...(groups.get(key) ?? []), option]); }
  const locked = disabled || saving;
  useEffect(() => {
    mounted.current = true;
    const backdrop = panel.current?.parentElement;
    const siblings = Array.from(backdrop?.parentElement?.children ?? []).filter(element => element !== backdrop && element instanceof HTMLElement) as HTMLElement[];
    const previousInert = siblings.map(element => element.inert);
    siblings.forEach(element => { element.inert = true; });
    panel.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      mounted.current = false;
      siblings.forEach((element, index) => { element.inert = previousInert[index]; });
      if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    };
  }, []);
  async function select(option: SearchSelectOption) {
    if (locked || pending.current || option.disabled || !options.some(item => item.value === option.value && !item.disabled)) return;
    if (option.value === value) { onClose(); return; }
    pending.current = true; setSaving(true); setFailure("");
    try { if (await onSelect(option.value) && mounted.current) onClose(); }
    catch { if (mounted.current) setFailure("选择未能保存，请重试。"); }
    finally { pending.current = false; if (mounted.current) setSaving(false); }
  }
  return createPortal(<div className="model-picker-backdrop"
    onPaste={event => event.stopPropagation()} onDrop={event => { event.preventDefault(); event.stopPropagation(); }}
    onDragOver={event => { event.preventDefault(); event.stopPropagation(); }} onMouseDown={event => {
    event.stopPropagation(); if (event.target === event.currentTarget && !pending.current) onClose();
  }}>
    <div className="model-picker" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panel}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) { event.stopPropagation(); return; }
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!pending.current) onClose(); }
        if (event.key === "Tab") {
          event.stopPropagation();
          const items = panel.current?.querySelectorAll<HTMLElement>("input:not(:disabled), button:not(:disabled)");
          if (!items?.length) return;
          const first = items[0], last = items[items.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
        const rows = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>(".model-picker-option:not(:disabled)") ?? []);
        const index = rows.indexOf(document.activeElement as HTMLButtonElement);
        if (["ArrowDown", "ArrowUp"].includes(event.key) || (index >= 0 && ["Home", "End"].includes(event.key))) {
          event.preventDefault(); event.stopPropagation();
          const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1
            : index < 0 ? (event.key === "ArrowUp" ? rows.length - 1 : 0) : (index + (event.key === "ArrowUp" ? -1 : 1) + rows.length) % rows.length;
          rows[next]?.focus();
        }
      }}>
      <div className="model-picker-heading"><h2 id={titleId}>{label}</h2>
        <button type="button" aria-label={closeLabel ?? `关闭${label}`} disabled={saving} onClick={onClose}><X size={18} /></button></div>
      <label className="model-picker-search"><Search size={18} aria-hidden="true" />
        <input aria-label={searchLabel ?? `搜索${label}`} placeholder="输入名称或分组关键词…" value={query} onChange={event => setQuery(event.target.value)} />
      </label>
      {hint && <p className="muted-text model-picker-hint">{hint}</p>}
      {(error || failure) && <p className="model-picker-error" role="alert">{error || failure}</p>}
      {!error && value && !options.some(option => option.value === value) && <p className="model-picker-error" role="status">当前选项已失效，请重新选择。</p>}
      <div className="model-picker-results">
        {Array.from(groups, ([group, items]) => <section key={group} aria-label={group || undefined}>
          {group && <h3>{group}</h3>}
          {items.map(option => <button type="button" className="model-picker-option" key={option.value} data-value={option.value}
            aria-pressed={option.value === value} disabled={locked || option.disabled} onClick={() => void select(option)}>
            <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
            {option.value === value && <Check size={18} aria-label="当前选择" />}
          </button>)}
        </section>)}
        {!visible.length && <p className="muted-text model-picker-empty">{needle ? "没有匹配的选项。" : "暂无可选项。"}</p>}
      </div>
    </div>
  </div>, opener.current?.closest("dialog") ?? document.body);
}

export function SearchSelectField({ value, options, label, disabled = false, id, className, title, onChange }: {
  value: string; options: SearchSelectOption[]; label: string; disabled?: boolean; id?: string; className?: string; title?: string;
  onChange(value: string): void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = options.find(option => option.value === value);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return <>
    <button ref={trigger} id={id} type="button" className={`select-field${className ? ` ${className}` : ""}`}
      aria-label={label} aria-haspopup="dialog" aria-expanded={open && !disabled} disabled={disabled}
      title={title ?? selected?.label ?? value} onClick={() => { if (!trigger.current?.matches(":disabled")) setOpen(true); }}>
      <span>{selected?.label ?? (value ? "原选项已失效，请重新选择" : "请选择")}</span><ChevronDown size={16} aria-hidden="true" />
    </button>
    {open && !disabled && <SearchChoiceDialog options={options} value={value} label={label}
      onSelect={next => { if (trigger.current?.matches(":disabled")) return false; onChange(next); return true; }}
      onClose={() => setOpen(false)} />}
  </>;
}
