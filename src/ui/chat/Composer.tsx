import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { FileImage, FileText, Paperclip, Send, Square, X } from "lucide-react";
import { attachmentAccept, materializeDraftAttachment, type DraftAttachment } from "../../chat/attachments";
import type { ChatProtocol } from "../../chat/types";
import { SentAttachmentPreview } from "./SentAttachmentPreview";
import { isTextareaVisualBoundary, type TextareaCaretAffinity } from "./textareaVisualLine";

function DraftImagePreview({ item, opener, onClose }: {
  item: DraftAttachment; opener: HTMLElement; onClose(): void;
}) {
  const previewItem = useMemo(() => ({ name: item.name, mimeType: item.mimeType, size: item.size, reference: item.id }), [item]);
  const read = useCallback(() => materializeDraftAttachment(item), [item]);
  return <SentAttachmentPreview item={previewItem} read={read} returnFocus={opener} onClose={onClose} />;
}

export interface ComposerProps {
  protocol?: ChatProtocol;
  thinkingControl?: ReactNode;
  searchControl?: ReactNode;
  modelControl?: ReactNode;
  draft: string;
  draftSelection?: { start: number; end: number };
  onDraftSelectionChange?(selection: { start: number; end: number }): void;
  onBrowseHistory?(direction: -1 | 1, selection: { start: number; end: number }): boolean;
  draftAttachments?: DraftAttachment[];
  attachmentBusy?: boolean;
  attachmentBlockReason?: string;
  error?: string;
  isHydrated: boolean;
  isGenerating: boolean;
  onDraftChange(draft: string): void;
  onFiles?(files: File[]): void;
  onRemoveAttachment?(id: string): void;
  onSend(): void;
  onStop(): void;
}

export function Composer({
  protocol,
  thinkingControl,
  searchControl,
  modelControl,
  draft,
  draftSelection,
  onDraftSelectionChange,
  onBrowseHistory,
  draftAttachments = [],
  attachmentBusy,
  attachmentBlockReason,
  error,
  isHydrated,
  isGenerating,
  onDraftChange,
  onFiles,
  onRemoveAttachment,
  onSend,
  onStop,
}: ComposerProps) {
  const picker = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const historySelectionPending = useRef(false);
  const caretAffinity = useRef<TextareaCaretAffinity | undefined>(undefined);
  useLayoutEffect(() => {
    if (input.current && draftSelection && (input.current.selectionStart !== draftSelection.start ||
      input.current.selectionEnd !== draftSelection.end)) {
      input.current.setSelectionRange(draftSelection.start, draftSelection.end);
    }
  }, [draft, draftSelection]);
  useLayoutEffect(() => { historySelectionPending.current = false; });
  const pasteSequence = useRef({ stamp: "", count: 0 });
  const [preview, setPreview] = useState<{ id: string; opener: HTMLElement }>();
  const previewItem = preview && draftAttachments.find((item) => item.id === preview.id);
  useEffect(() => { if (preview && !previewItem) setPreview(undefined); }, [preview, previewItem]);
  const canSend = !isGenerating && isHydrated && !attachmentBusy && !attachmentBlockReason &&
    (!!draft.trim() || draftAttachments.length > 0);
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    historySelectionPending.current = false;
    if (event.nativeEvent.isComposing || event.keyCode === 229 || event.repeat || event.altKey) return;
    if ((event.key === "ArrowUp" || event.key === "ArrowDown") && isHydrated &&
      !event.shiftKey && !event.ctrlKey && !event.metaKey && onBrowseHistory) {
      const textarea = event.currentTarget;
      const direction = event.key === "ArrowUp" ? -1 : 1;
      if (textarea.selectionStart === textarea.selectionEnd &&
        isTextareaVisualBoundary(textarea, direction, caretAffinity.current) && onBrowseHistory(direction, {
        start: textarea.selectionStart, end: textarea.selectionEnd,
      })) {
        // React can emit onSelect for the old value during this same key dispatch.
        historySelectionPending.current = true;
        event.preventDefault();
      }
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.metaKey) {
      event.preventDefault();
      if (canSend) onSend();
    }
  }

  return (
    <footer className="composer-footer">
      <div className="composer-width">
        {error && (
          <div className="error-banner composer-error" role="alert">
            {error}
          </div>
        )}
        <div className="composer-frame">
          <input ref={picker} type="file" multiple hidden
            accept={attachmentAccept()} aria-label="选择附件"
            onChange={(event) => {
              onFiles?.([...(event.target.files ?? [])]);
              event.target.value = "";
            }} />
          {!!draftAttachments.length && <div className="composer-attachments" aria-label="待发送附件">
            {draftAttachments.map((item) => <span className="composer-attachment" key={item.id}
              title={`${item.name} · ${item.mimeType} · ${(item.size / 1_000_000).toFixed(2)} MB`}>
              {item.mimeType.startsWith("image/") ? <button type="button" className="composer-attachment-open"
                aria-label={`预览待发送图片 ${item.name}`} disabled={!isHydrated}
                onClick={(event) => setPreview({ id: item.id, opener: event.currentTarget })}>
                <FileImage size={14} aria-hidden="true" /><span className="composer-attachment-name">{item.name}</span>
              </button> : <><FileText size={14} aria-hidden="true" /><span className="composer-attachment-name">{item.name}</span></>}
              <button className="attachment-remove" type="button" aria-label={`移除附件 ${item.name}`}
                disabled={!isHydrated}
                onClick={() => onRemoveAttachment?.(item.id)}><X size={13} /></button>
            </span>)}
          </div>}
          <textarea
            ref={input}
            className="composer-input"
            value={draft}
            onChange={(event) => {
              historySelectionPending.current = false;
              caretAffinity.current = (event.nativeEvent as InputEvent).inputType?.startsWith("insert") ? "upstream" : undefined;
              onDraftChange(event.target.value);
              onDraftSelectionChange?.({
                start: event.target.selectionStart, end: event.target.selectionEnd,
              });
            }}
            onKeyDown={handleKeyDown}
            onKeyUp={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === "End" || event.key === "ArrowRight") caretAffinity.current = "upstream";
              else if (event.key === "Home" || event.key === "ArrowLeft") caretAffinity.current = "downstream";
              else if (event.key === "ArrowUp" || event.key === "ArrowDown") caretAffinity.current = undefined;
            }}
            onPointerDown={() => { historySelectionPending.current = false; caretAffinity.current = undefined; }}
            onFocus={() => { historySelectionPending.current = false; caretAffinity.current = undefined; }}
            onSelect={(event) => {
              if (!historySelectionPending.current) onDraftSelectionChange?.({
                start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd,
              });
            }}
            onPaste={(event) => {
              const images = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
              if (!images.length) return;
              event.preventDefault();
              const now = new Date();
              const pad = (value: number) => String(value).padStart(2, "0");
              const stamp = `${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
              if (pasteSequence.current.stamp !== stamp) pasteSequence.current = { stamp, count: 0 };
              const names = new Set([...draftAttachments.map((item) => item.name), ...images.map((image) => image.name)]);
              onFiles?.(images.map((image) => {
                if (image.name.trim() && !/^image(?:\.[a-z0-9]+)?$/i.test(image.name)) return image;
                const extension = image.type === "image/jpeg" ? "jpg" : image.type === "image/webp" ? "webp" : "png";
                let name: string;
                do {
                  const count = ++pasteSequence.current.count;
                  name = `粘贴图片-${stamp}${count > 1 ? `-${count}` : ""}.${extension}`;
                } while (names.has(name));
                names.add(name);
                return new File([image], name, { type: image.type, lastModified: image.lastModified });
              }));
            }}
            placeholder={`输入消息，Enter / Ctrl+Enter 发送，Shift+Enter 换行${onBrowseHistory ? "；首行 ↑ / 末行 ↓ 浏览历史" : ""}`}
            title={onBrowseHistory ? "首行按 ↑ 浏览历史输入，末行按 ↓ 返回较新输入或草稿" : undefined}
            disabled={!isHydrated}
          />
          {attachmentBusy && <p className="attachment-loading" role="status">正在读取附件，完成后才能发送…</p>}
          <div className="composer-toolbar">
            <div className="composer-tools" role="group" aria-label="聊天功能">
            <button className="composer-tool-button" type="button" aria-label="添加附件"
              title={`添加图片、PDF、文本/代码${protocol === "openai-responses" ? "、Office 原文件" : "（Office 需 Responses）"}；点击发送后才请求`}
              disabled={!isHydrated}
              onClick={() => picker.current?.click()}><Paperclip size={17} /></button>
            {thinkingControl}
            {searchControl}
            {modelControl}
            </div>
            {isGenerating ? (
              <button
                className="send-button"
                onClick={onStop}
                aria-label="停止生成"
                type="button"
              >
                <Square size={15} fill="currentColor" />
              </button>
            ) : (
              <button
                className="send-button"
                onClick={onSend}
                disabled={!canSend}
                aria-label="发送"
                type="button"
              >
                <Send size={17} />
              </button>
            )}
          </div>
        </div>
      </div>
      {preview && previewItem && <DraftImagePreview key={previewItem.id} item={previewItem} opener={preview.opener}
        onClose={() => setPreview(undefined)} />}
    </footer>
  );
}
