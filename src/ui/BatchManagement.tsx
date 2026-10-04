import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import "./ConfirmationDialog.css";
import "./BatchManagement.css";

export function BatchManagementBar({ label, total, selected, disabled, deleteDisabled, onSelectAll, onDelete }: {
  label: string; total: number; selected: number; disabled?: boolean; deleteDisabled?: boolean;
  onSelectAll(checked: boolean): void; onDelete(): void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = selected > 0 && selected < total; }, [selected, total]);
  return <div className="batch-management-bar">
    <label><input ref={ref} className="ui-checkbox" type="checkbox" aria-label={`全选${label}`}
      checked={total > 0 && selected === total} disabled={disabled || total === 0} onChange={event => onSelectAll(event.target.checked)} />全选</label>
    <span className="batch-selection-count" role="status">已选 {selected} 项</span>
    <button type="button" className="batch-delete-selected" aria-label={`删除所选${label}`} title="删除所选"
      disabled={disabled || deleteDisabled || selected === 0} onClick={onDelete}><Trash2 size={14} aria-hidden="true" /><span>删除</span></button>
  </div>;
}

export interface BatchDeleteDialogProps {
  title: string;
  names: readonly string[];
  impact: string;
  warning?: string;
  confirmLabel: string;
  busy?: boolean;
  blockedReason?: string;
  failureReason?: string;
  assistantMode?: "move" | "delete";
  onAssistantModeChange?(mode: "move" | "delete"): void;
  onConfirm(): Promise<boolean> | boolean;
  onCancel(): void;
  returnFocus?(): HTMLElement | null;
}

/** One mandatory confirmation. Owners freeze the target scope and perform the atomic mutation. */
export function BatchDeleteDialog({ title, names, impact, warning = "此操作无法撤销。", confirmLabel, busy, blockedReason, failureReason,
  assistantMode, onAssistantModeChange, onConfirm, onCancel, returnFocus }: BatchDeleteDialogProps) {
  const ref = useRef<HTMLDialogElement>(null), cancelRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null | undefined>(undefined), pending = useRef(false);
  const fallbackFocus = useRef(returnFocus); fallbackFocus.current = returnFocus;
  const [submitting, setSubmitting] = useState(false), [error, setError] = useState<string>();
  const id = useId(), locked = busy || submitting;
  useEffect(() => {
    if (opener.current === undefined) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (ref.current && !ref.current.open) ref.current.showModal();
    cancelRef.current?.focus();
    return () => {
      const usable = (element: HTMLElement | null | undefined) => element?.isConnected
        && element !== document.body && element !== document.documentElement
        && !element.closest('[inert], [hidden], [aria-hidden="true"]') && !element.matches(":disabled");
      const previous = opener.current;
      if (usable(previous)) previous!.focus({ preventScroll: true });
      if (!usable(previous) || document.activeElement !== previous) {
        const fallback = fallbackFocus.current?.();
        if (usable(fallback)) fallback!.focus({ preventScroll: true });
      }
    };
  }, []);
  async function submit() {
    if (pending.current || locked || blockedReason) return;
    pending.current = true; setSubmitting(true); setError(undefined);
    try {
      if (!await onConfirm()) setError("操作未完成，请检查删除范围或生成状态后重试。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "删除失败，请重试。"); }
    finally { pending.current = false; setSubmitting(false); }
  }
  const cancel = () => { if (!pending.current) onCancel(); };
  return createPortal(<dialog ref={ref} className="confirmation-dialog batch-delete-dialog" aria-labelledby={`${id}-title`}
    aria-describedby={`${id}-impact ${id}-warning`} onCancel={event => { event.preventDefault(); cancel(); }}
    onKeyDown={event => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); cancel(); } }}
    onClick={event => { if (event.target === event.currentTarget) {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) cancel();
    } }}>
    <h3 id={`${id}-title`}>{title}</h3>
    <p className="batch-delete-names">{names.slice(0, 3).join("、")}{names.length > 3 ? ` 等 ${names.length} 项` : ""}</p>
    {names.length > 3 && <details className="batch-delete-details"><summary>查看全部 {names.length} 项</summary><ul>{names.map((name, index) => <li key={index}>{name}</li>)}</ul></details>}
    {assistantMode && onAssistantModeChange && <fieldset className="batch-delete-treatment" disabled={locked}>
      <legend>对话处理</legend>
      <label><input type="radio" name={`${id}-treatment`} checked={assistantMode === "move"} onChange={() => onAssistantModeChange("move")} />保留对话，移至默认助手</label>
      <label><input type="radio" name={`${id}-treatment`} checked={assistantMode === "delete"} onChange={() => onAssistantModeChange("delete")} />连同对话一起删除</label>
    </fieldset>}
    <p id={`${id}-impact`} className="batch-delete-impact" aria-live="polite">{impact}</p>
    <p id={`${id}-warning`} className="batch-delete-warning">{warning}</p>
    {(blockedReason || error) && <p className="batch-delete-error" role="alert">{blockedReason || failureReason || error}</p>}
    <div className="confirmation-actions">
      <button ref={cancelRef} type="button" className="confirmation-button" disabled={submitting} onClick={cancel}>取消</button>
      <button type="button" className="confirmation-button confirmation-accept" data-danger disabled={locked || !!blockedReason}
        onClick={() => void submit()}>{submitting ? "正在删除…" : confirmLabel}</button>
    </div>
  </dialog>, document.body);
}
