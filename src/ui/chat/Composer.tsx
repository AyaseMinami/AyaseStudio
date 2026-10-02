import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronsDown, ChevronsUp, FileImage, FileText, MoveHorizontal, Paperclip, Send, Square, X } from "lucide-react";
import { attachmentAccept, materializeDraftAttachment, type DraftAttachment } from "../../chat/attachments";
import type { ChatProtocol } from "../../chat/types";
import { SentAttachmentPreview } from "./SentAttachmentPreview";
import { isTextareaVisualBoundary, type TextareaCaretAffinity } from "./textareaVisualLine";
import type { ChatLayout } from "./useChatLayout";

function DraftImagePreview({ item, opener, onClose }: {
  item: DraftAttachment; opener: HTMLElement; onClose(): void;
}) {
  const previewItem = useMemo(() => ({ name: item.name, mimeType: item.mimeType, size: item.size, reference: item.id }), [item]);
  const read = useCallback(() => materializeDraftAttachment(item), [item]);
  return <SentAttachmentPreview item={previewItem} read={read} returnFocus={opener} onClose={onClose} />;
}

export interface ComposerProps {
  layout?: ChatLayout;
  onToggleLayout?(): void;
  protocol?: ChatProtocol;
  thinkingControl?: ReactNode;
  searchControl?: ReactNode;
  modelControl?: ReactNode;
  generationStats?: ReactNode;
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
  layout = "narrow",
  onToggleLayout,
  protocol,
  thinkingControl,
  searchControl,
  modelControl,
  generationStats,
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
  const footer = useRef<HTMLElement>(null);
  const resizeStart = useRef<{ pointerId: number; y: number; height: number; parentHeight: number; expanded: boolean }>(null);
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
  const [expanded, setExpanded] = useState(false);
  const [expandedHeight, setExpandedHeight] = useState(50);
  const previewItem = preview && draftAttachments.find((item) => item.id === preview.id);
  useEffect(() => { if (preview && !previewItem) setPreview(undefined); }, [preview, previewItem]);
  const canSend = !isGenerating && isHydrated && !attachmentBusy && !attachmentBlockReason &&
    (!!draft.trim() || draftAttachments.length > 0);
  function resizeTo(height: number, parentHeight: number, expandedMode: boolean): void {
    if (parentHeight <= 0) return;
    const max = Math.max(0, parentHeight - 48);
    const min = Math.min(expandedMode ? 192 : 120, max);
    const next = Math.min(max, Math.max(min, height));
    setExpandedHeight(100 * next / parentHeight);
    setExpanded(true);
  }
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    historySelectionPending.current = false;
    if (event.key === "Escape" && expanded && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      setExpanded(false);
      return;
    }
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
    <footer ref={footer} className={`composer-footer${expanded ? " is-expanded" : ""}`}
      style={expanded ? { height: `${expandedHeight}%` } : undefined}>
      <div className="composer-width">
        {error && (
          <div className="error-banner composer-error" role="alert">
            {error}
          </div>
        )}
        <div className="composer-frame">
          <div className="composer-resize-handle" role="separator" tabIndex={0}
            aria-label="调整输入框高度" aria-orientation="horizontal"
            aria-valuemin={expanded ? 0 : 120} aria-valuemax={expanded ? 100 : 10000}
            aria-valuenow={expanded ? Math.round(expandedHeight) : 120}
            aria-valuetext={expanded ? `${Math.round(expandedHeight)}%` : "默认高度"}
            title="拖动输入框上边框或按上下方向键调整高度"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              const parentHeight = footer.current?.parentElement?.getBoundingClientRect().height ?? 0;
              if (!parentHeight) return;
              resizeStart.current = {
                pointerId: event.pointerId, y: event.clientY,
                height: footer.current?.getBoundingClientRect().height ?? parentHeight / 2,
                parentHeight, expanded,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
              event.preventDefault();
            }}
            onPointerMove={(event) => {
              const start = resizeStart.current;
              if (start?.pointerId === event.pointerId && event.clientY !== start.y)
                resizeTo(start.height + start.y - event.clientY, start.parentHeight, start.expanded);
            }}
            onPointerUp={(event) => {
              if (resizeStart.current?.pointerId === event.pointerId) resizeStart.current = null;
            }}
            onPointerCancel={() => { resizeStart.current = null; }}
            onLostPointerCapture={() => { resizeStart.current = null; }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && expanded) {
                event.preventDefault();
                setExpanded(false);
                input.current?.focus();
                return;
              }
              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
              const parentHeight = footer.current?.parentElement?.getBoundingClientRect().height ?? 0;
              const currentHeight = expanded ? parentHeight * expandedHeight / 100
                : footer.current?.getBoundingClientRect().height ?? 0;
              resizeTo(currentHeight + (event.key === "ArrowUp" ? 24 : -24), parentHeight, expanded);
              event.preventDefault();
            }} />
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
            {onToggleLayout && <button className="composer-tool-button composer-layout-button" type="button"
              aria-label={layout === "narrow" ? "切换为宽屏" : "切换为窄屏"}
              title={layout === "narrow" ? "当前窄屏；切换为宽屏" : "当前宽屏；切换为窄屏"}
              aria-pressed={layout === "wide"} onClick={onToggleLayout}>
              <MoveHorizontal size={17} aria-hidden="true" />
            </button>}
            <button className="composer-tool-button" type="button"
              aria-label={expanded ? "收起输入框" : "展开输入框"}
              aria-expanded={expanded}
              title={expanded ? "收起输入框（Esc）" : "展开输入框"}
              onClick={() => {
                if (!expanded) setExpandedHeight(50);
                setExpanded(!expanded);
                input.current?.focus();
              }}>
              {expanded ? <ChevronsDown size={17} aria-hidden="true" /> : <ChevronsUp size={17} aria-hidden="true" />}
            </button>
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
      {generationStats && <div className="composer-width composer-stats-width">{generationStats}</div>}
      {preview && previewItem && <DraftImagePreview key={previewItem.id} item={previewItem} opener={preview.opener}
        onClose={() => setPreview(undefined)} />}
    </footer>
  );
}
