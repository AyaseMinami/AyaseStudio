import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DrawingPresetInput, DrawingPromptPreset } from "../../drawing/presets";

type PresetDialog = {
  kind: "save-as" | "update" | "edit" | "delete";
  targetId?: string;
  name: string;
  content: string;
  opener: HTMLButtonElement;
};

function PresetEditor({ initial, disabled, targetExists, onClose, onSave }: {
  initial: PresetDialog;
  disabled: boolean;
  targetExists: boolean;
  onClose(): void;
  onSave(input: DrawingPresetInput): Promise<boolean>;
}) {
  const [name, setName] = useState(initial.name);
  const [content, setContent] = useState(initial.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const dialog = useRef<HTMLFormElement>(null);
  const titleId = useId();
  const deleting = initial.kind === "delete";
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>(deleting ? ".drawing-preset-cancel" : "input")?.focus();
    const opener = initial.opener;
    return () => { if (opener.isConnected) opener.focus({ preventScroll: true }); };
  }, [initial.opener, deleting]);
  useLayoutEffect(() => {
    if (saving) dialog.current?.focus({ preventScroll: true });
  }, [saving]);
  async function save() {
    if (pending.current || disabled || !targetExists || (!deleting && (!name.trim() || !content.trim()))) return;
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      if (await onSave({ name: name.trim(), content })) onClose();
      else setError(deleting ? "删除失败，请重试。" : "保存失败，已保留填写内容，请重试。");
    } catch {
      setError(deleting ? "删除失败，请重试。" : "保存失败，已保留填写内容，请重试。");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  const close = () => { if (!pending.current) onClose(); };
  const title = deleting ? "删除提示词预设" : initial.kind === "update" ? "更新提示词预设"
    : initial.kind === "edit" ? "编辑提示词预设" : initial.kind === "save-as" ? "另存提示词预设" : "新建提示词预设";
  return createPortal(<div className="drawing-reference-backdrop drawing-preset-backdrop"
    onMouseDown={event => { if (event.target === event.currentTarget) close(); }}
    onPaste={event => event.stopPropagation()} onDrop={event => { event.preventDefault(); event.stopPropagation(); }}
    onDragOver={event => { event.preventDefault(); event.stopPropagation(); }}>
    <form ref={dialog} tabIndex={-1} className="drawing-preset-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}
      onSubmit={event => { event.preventDefault(); void save(); }} onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
        if (event.key !== "Tab") return;
        const fields = [...(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled)") ?? [])];
        if (!fields.length) { event.preventDefault(); dialog.current?.focus({ preventScroll: true }); return; }
        const index = fields.indexOf(document.activeElement as HTMLElement);
        if (event.shiftKey && index <= 0) { event.preventDefault(); fields[fields.length - 1]?.focus(); }
        else if (!event.shiftKey && (index < 0 || index === fields.length - 1)) { event.preventDefault(); fields[0]?.focus(); }
      }}>
      <div className="drawing-section-heading"><h2 id={titleId}>{title}</h2>
        <button type="button" className="drawing-button" aria-label="关闭预设弹窗" disabled={saving} onClick={close}>关闭</button>
      </div>
      {deleting ? <p>删除“{initial.name}”？当前提示词草稿和历史任务会保留。</p> : <>
        <label className="drawing-field"><span className="drawing-label">预设名称</span>
          <input value={name} disabled={saving} onChange={event => setName(event.target.value)} autoComplete="off" />
        </label>
        <label className="drawing-field"><span className="drawing-label">预设内容</span>
          <textarea value={content} disabled={saving} onChange={event => setContent(event.target.value)} />
        </label>
        <p className="drawing-muted">只保存名称和提示词文字，模型、参数和参考图保持独立。</p>
      </>}
      {!targetExists && <p className="drawing-error" role="alert">原预设已删除，请关闭后重新选择。</p>}
      {error && <p className="drawing-error" role="alert">{error}</p>}
      <div className="drawing-actions">
        <button type="button" className="drawing-button drawing-preset-cancel" disabled={saving} onClick={close}>取消</button>
        <button type="submit" className="drawing-button" disabled={disabled || saving || !targetExists || (!deleting && (!name.trim() || !content.trim()))}>
          {saving ? "正在处理…" : deleting ? "确认删除预设" : "保存预设"}
        </button>
      </div>
    </form>
  </div>, document.body);
}

export function DrawingPresets({ presets, prompt, disabled = false, onApply, onCreate, onUpdate, onDelete, onDialogChange }: {
  presets: DrawingPromptPreset[];
  prompt: string;
  disabled?: boolean;
  onApply(id: string): void;
  onCreate(input: DrawingPresetInput): Promise<boolean>;
  onUpdate(id: string, input: DrawingPresetInput): Promise<boolean>;
  onDelete(id: string): Promise<boolean>;
  onDialogChange?(open: boolean): void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [dialog, setDialog] = useState<PresetDialog | null>(null);
  const selected = presets.find(preset => preset.id === selectedId);
  const selectId = useId();
  const dialogOpen = Boolean(dialog);
  useEffect(() => {
    return () => onDialogChange?.(false);
  }, [onDialogChange]);
  function close() {
    setDialog(null);
    onDialogChange?.(false);
  }
  function open(kind: PresetDialog["kind"], opener: HTMLButtonElement) {
    if (disabled || dialog || (kind !== "save-as" && !selected)) return;
    setDialog({ kind, opener, targetId: kind === "save-as" ? undefined : selected?.id,
      name: kind === "save-as" ? (selected ? `${selected.name} 副本` : "") : selected!.name,
      content: kind === "edit" || kind === "delete" ? selected!.content : prompt });
    onDialogChange?.(true);
  }
  return <section className="drawing-presets" aria-label="提示词预设">
    <div className="drawing-field drawing-preset-controls" inert={dialogOpen}>
      <label className="drawing-label" htmlFor={selectId}>提示词预设</label>
      <select id={selectId} value={selected?.id ?? ""} disabled={disabled} onChange={event => {
        const id = event.target.value;
        setSelectedId(id);
        if (presets.some(preset => preset.id === id)) onApply(id);
      }}>
        <option value="">选择预设，直接载入提示词</option>
        {presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
      </select>
      <div className="drawing-actions">
        {([
          ["update", "更新预设"], ["save-as", "另存预设"], ["edit", "编辑预设"], ["delete", "删除预设"],
        ] as const).map(([kind, label]) => <button key={kind} type="button" className="drawing-button"
          disabled={disabled || (kind !== "save-as" && !selected)} onClick={event => open(kind, event.currentTarget)}>{label}</button>)}
      </div>
    </div>
    {dialog && <PresetEditor initial={dialog} disabled={disabled}
      targetExists={!dialog.targetId || presets.some(preset => preset.id === dialog.targetId)} onClose={close}
      onSave={input => dialog.kind === "delete" ? onDelete(dialog.targetId!)
        : dialog.kind === "update" || dialog.kind === "edit" ? onUpdate(dialog.targetId!, input) : onCreate(input)} />}
  </section>;
}
