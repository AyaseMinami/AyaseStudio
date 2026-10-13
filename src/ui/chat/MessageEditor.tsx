import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileImage, FileText, Paperclip, Undo2, X } from "lucide-react";
import { attachmentAccept, materializeDraftAttachment, prepareDraftAttachment, type DraftAttachment, type RequestAttachment, type SentAttachment } from "../../chat/attachments";
import type { StoredChatMessage } from "../../chat/repository";
import type { MessageEditAttachment, MessageEditDraft, MessageEditResult } from "../../chat/messageEditTypes";
import { namePastedImages } from "./attachmentInput";
import { SentAttachmentPreview } from "./SentAttachmentPreview";
import "./MessageEditor.css";

type EditorAttachment = MessageEditAttachment & { key: string; removed?: boolean };
type Preview = { item: EditorAttachment; opener: HTMLElement };

function AddedImagePreview({ item, opener, onClose }: { item: DraftAttachment; opener: HTMLElement; onClose(): void }) {
  const metadata = useMemo(() => ({ name: item.name, mimeType: item.mimeType, size: item.size, reference: item.id }), [item]);
  const read = useCallback(() => materializeDraftAttachment(item), [item]);
  return <SentAttachmentPreview item={metadata} read={read} returnFocus={opener} onClose={onClose} />;
}

export interface MessageEditorProps {
  base: StoredChatMessage;
  latestRound: boolean;
  disabled?: boolean;
  busyOnly?: boolean;
  onReadAttachment?(item: SentAttachment): Promise<RequestAttachment>;
  onSave(content: string, draft: MessageEditDraft, send: boolean): Promise<boolean | MessageEditResult>;
  onCancel(): void;
  onSubmittingChange?(submitting: boolean): void;
}

export function MessageEditor({ base, latestRound, disabled = false, busyOnly = false, onReadAttachment, onSave, onCancel, onSubmittingChange }: MessageEditorProps) {
  const [content, setContent] = useState(base.content);
  const [items, setItems] = useState<EditorAttachment[]>(() => (base.attachments ?? []).map((attachment, index) => ({ kind: "retained", attachment, key: `retained-${index}` })));
  const [errors, setErrors] = useState<string[]>([]);
  const [reading, setReading] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const session = useRef({ active: true, token: Symbol(), submitted: false, pending: 0, sequence: 0, next: 0,
    batches: new Map<number, { items: EditorAttachment[]; errors: string[] }>() });
  const pickerToken = useRef<symbol | undefined>(undefined);
  const pasteSequence = useRef({ stamp: "", count: 0 });
  const isUser = base.role === "user";
  const locked = disabled || submitting || recoveryRequired;
  useEffect(() => {
    const current = session.current;
    current.active = true;
    input.current?.focus({ preventScroll: true });
    return () => { current.active = false; current.token = Symbol(); };
  }, []);

  function cancel() {
    if (session.current.submitted) return;
    session.current.active = false;
    session.current.token = Symbol();
    onCancel();
  }
  function addFiles(files: File[]) {
    if (!files.length || !session.current.active) return;
    if (!isUser) { setErrors(["仅用户消息支持附件编辑"]); return; }
    if (locked || session.current.submitted) { setErrors(["提交期间不能添加附件。"]); return; }
    const current = session.current;
    const token = current.token;
    const sequence = current.sequence++;
    current.pending++;
    setReading(current.pending);
    void Promise.all(files.map(async (file, index) => {
      try { return { item: { kind: "added", attachment: await prepareDraftAttachment(file), key: `added-${sequence}-${index}` } as EditorAttachment }; }
      catch (error) { return { error: `${file.name}：${error instanceof Error ? error.message : "附件读取失败。"}` }; }
    })).then((results) => {
      if (!current.active || current.token !== token) return;
      current.batches.set(sequence, { items: results.flatMap((result) => result.item ? [result.item] : []), errors: results.flatMap((result) => result.error ? [result.error] : []) });
      const additions: EditorAttachment[] = [];
      const failures: string[] = [];
      while (current.batches.has(current.next)) {
        const batch = current.batches.get(current.next)!;
        current.batches.delete(current.next++);
        additions.push(...batch.items); failures.push(...batch.errors);
      }
      setItems((value) => [...value, ...additions]);
      if (failures.length) setErrors((value) => [...value, ...failures]);
      setReading(--current.pending);
    });
  }
  async function save(send: boolean) {
    const current = session.current;
    if (!current.active || current.submitted || current.pending || locked || (send && !isUser)) return;
    const attachments = items.filter((item) => !item.removed).map((item): MessageEditAttachment => ({ kind: item.kind, attachment: item.attachment } as MessageEditAttachment));
    if (!content.trim() && !attachments.length) {
      setErrors(["消息正文和附件不能同时为空。"]);
      input.current?.focus({ preventScroll: true });
      return;
    }
    current.submitted = true;
    setSubmitting(true); setErrors([]); onSubmittingChange?.(true);
    try {
      const result = await onSave(content, { base, ...(isUser ? { attachments } : {}) }, send);
      if (!current.active) return;
      if (result === true || (typeof result !== "boolean" && (result.status === "saved" || result.status === "savedNeedsReload"))) {
        current.active = false;
        onCancel();
      } else if (typeof result !== "boolean") {
        setErrors([result.error ?? "消息未保存。", ...(result.warning ? [result.warning] : [])]);
        if (result.status === "recoveryRequired") setRecoveryRequired(true);
      }
    } catch (error) {
      if (current.active) setErrors([error instanceof Error ? error.message : "消息保存失败。"]);
    } finally {
      current.submitted = false;
      if (current.active) setSubmitting(false);
      onSubmittingChange?.(false);
    }
  }
  return <><div ref={root} className={`message-editor message-attachment-editor${dragOver ? " message-editor-drag-over" : ""}`} aria-busy={submitting || reading > 0}
    onDragOver={(event) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault(); event.stopPropagation(); setDragOver(true);
    }} onDragLeave={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false);
    }} onDrop={(event) => {
      if (!event.dataTransfer.files.length && !event.dataTransfer.types.includes("Files")) return;
      event.preventDefault(); event.stopPropagation(); setDragOver(false); addFiles([...event.dataTransfer.files]);
    }} onPaste={(event) => {
      const files = [...event.clipboardData.files];
      if (!files.length) return;
      event.stopPropagation();
      if (!isUser) { event.preventDefault(); setErrors(["仅用户消息支持附件编辑"]); return; }
      const images = files.filter((file) => file.type.startsWith("image/"));
      if (!images.length) return;
      event.preventDefault();
      addFiles(namePastedImages(images, items.map((item) => item.attachment.name), pasteSequence.current));
    }} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229 || event.repeat || event.altKey) return;
      if (event.key === "Escape" && !event.ctrlKey && !event.metaKey && !event.shiftKey && !preview) {
        event.preventDefault(); event.stopPropagation(); cancel();
      }
    }}>
    <label htmlFor={`message-edit-${base.id}`}>编辑消息</label>
    <textarea ref={input} className="composer-input" rows={2} id={`message-edit-${base.id}`} value={content} disabled={locked} data-busy-only={busyOnly && !submitting && !recoveryRequired}
      onChange={(event) => setContent(event.target.value)} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229 || event.repeat || event.altKey) return;
        if (event.key === "Enter" && !event.shiftKey && !event.metaKey && (!event.ctrlKey || isUser)) {
          event.preventDefault(); event.stopPropagation(); void save(event.ctrlKey);
        }
      }} />
    {isUser && <>
      <input ref={picker} type="file" multiple hidden accept={attachmentAccept()} aria-label="选择消息附件" disabled={locked}
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])]; event.currentTarget.value = "";
          if (pickerToken.current === session.current.token) addFiles(files);
        }} />
      <div className="composer-attachments message-editor-attachments" aria-label="编辑消息附件">
        {items.map((item) => <div className={`composer-attachment message-editor-attachment${item.removed ? " is-removed" : ""}`} key={item.key}
          title={`${item.attachment.name} · ${item.attachment.mimeType} · ${(item.attachment.size / 1_000_000).toFixed(2)} MB`}>
            <button type="button" className="composer-attachment-open message-editor-attachment-preview" disabled={item.kind === "retained" ? !onReadAttachment : !item.attachment.mimeType.startsWith("image/")}
              aria-label={`预览${item.kind === "added" ? "新增" : ""}附件 ${item.attachment.name}`} onClick={(event) => setPreview({ item, opener: event.currentTarget })}>
              {item.attachment.mimeType.startsWith("image/") ? <FileImage size={14} aria-hidden="true" /> : <FileText size={14} aria-hidden="true" />}
              <span className="composer-attachment-name">{item.attachment.name}</span>
            </button>
          {item.removed && <span className="message-editor-removal-status">待移除</span>}
          <button type="button" className="attachment-remove" disabled={locked} title={item.removed ? "撤销移除" : "移除附件"} aria-label={`${item.removed ? "撤销移除" : "移除附件"} ${item.attachment.name}`} onClick={() => setItems((value) =>
            item.kind === "added" ? value.filter((entry) => entry.key !== item.key) : value.map((entry) => entry.key === item.key ? { ...entry, removed: !entry.removed } : entry))}>
            {item.removed ? <Undo2 size={13} aria-hidden="true" /> : <X size={13} aria-hidden="true" />}
          </button>
        </div>)}
      </div>
    </>}
    {dragOver && <p role="status">{isUser ? (locked ? "提交期间不能添加附件。" : "松开以添加到这条消息") : "仅用户消息支持附件编辑"}</p>}
    {reading > 0 && <p className="message-editor-hint" role="status">正在读取附件，完成后才能保存…</p>}
    {errors.length > 0 && <ul className="message-editor-errors" role="alert">{errors.map((error, index) => <li key={index}>{error}</li>)}</ul>}
    <p className="message-editor-hint">Enter 仅保存 · Shift+Enter 换行 · Esc 取消。{isUser && (latestRound ? "Ctrl+Enter 保存并发送，保留本轮问答版本。" : "Ctrl+Enter 保存并发送，会移除后续历史并生成新回复。")}</p>
    <div className="message-editor-toolbar">
      {isUser && <button type="button" className="composer-tool-button message-editor-add" aria-label="添加附件" title="添加附件" disabled={locked} onClick={() => { pickerToken.current = session.current.token; picker.current?.click(); }}>
        <Paperclip size={18} aria-hidden="true" />
      </button>}
      <div className="message-editor-actions"><button type="button" disabled={submitting} onClick={cancel}>取消</button>
        <button type="button" className="settings-button" disabled={locked || reading > 0} data-busy-only={busyOnly && !submitting && !reading && !recoveryRequired} onClick={() => void save(false)}>{submitting ? "保存中…" : "保存"}</button>
        {isUser && <button type="button" className="settings-button message-editor-send" disabled={locked || reading > 0} data-busy-only={busyOnly && !submitting && !reading && !recoveryRequired} onClick={() => void save(true)}>保存并发送</button>}
      </div>
    </div>
  </div>
    {preview?.item.kind === "added" && <AddedImagePreview item={preview.item.attachment} opener={preview.opener} onClose={() => setPreview(undefined)} />}
    {preview?.item.kind === "retained" && onReadAttachment && <SentAttachmentPreview item={preview.item.attachment} read={onReadAttachment} returnFocus={preview.opener}
      images={items.flatMap((item) => item.kind === "retained" && item.attachment.mimeType.startsWith("image/") ? [item.attachment] : [])}
      onNavigate={(attachment) => { const item = items.find((entry) => entry.kind === "retained" && entry.attachment.reference === attachment.reference); if (item) setPreview({ ...preview, item }); }} onClose={() => setPreview(undefined)} />}
  </>;
}
