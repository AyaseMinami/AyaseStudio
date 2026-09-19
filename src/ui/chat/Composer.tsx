import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Paperclip, Send, Square, X } from "lucide-react";
import type { DraftAttachment } from "../../chat/attachments";

export interface ComposerProps {
  thinkingControl?: ReactNode;
  isGeneratingElsewhere?: boolean;
  draft: string;
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

function DraftImageThumbnail({ item }: { item: DraftAttachment }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (typeof URL.createObjectURL !== "function") return;
    const next = URL.createObjectURL(item.file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [item.file]);
  return url ? <img className="composer-thumbnail" alt="" src={url} /> : null;
}

export function Composer({
  thinkingControl,
  isGeneratingElsewhere,
  draft,
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
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
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
            accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.md,.markdown" aria-label="选择附件"
            onChange={(event) => {
              onFiles?.([...(event.target.files ?? [])]);
              event.target.value = "";
            }} />
          <textarea
            className="composer-input"
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={(event) => {
              const images = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
              if (!images.length) return;
              event.preventDefault();
              onFiles?.(images.map((image, index) => new File([image], image.name && image.name.includes(".")
                ? image.name : `粘贴图片-${index + 1}.${image.type === "image/jpeg" ? "jpg" : image.type === "image/webp" ? "webp" : "png"}`)));
            }}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            disabled={(isGenerating && !isGeneratingElsewhere) || !isHydrated}
          />
          {attachmentBusy && <p className="attachment-loading" role="status">正在读取附件，完成后才能发送…</p>}
          {!!draftAttachments.length && <div className="composer-attachments" aria-label="待发送附件">
            {draftAttachments.map((item) => <span className="composer-attachment" key={item.id}>
              {item.mimeType.startsWith("image/") && <DraftImageThumbnail item={item} />}
              <span title={item.name}>{item.name} · {item.mimeType} · {(item.size / 1_000_000).toFixed(2)} MB</span>
              <button className="attachment-remove" type="button" aria-label={`移除附件 ${item.name}`}
                disabled={isGenerating && !isGeneratingElsewhere}
                onClick={() => onRemoveAttachment?.(item.id)}><X size={14} /></button>
            </span>)}
          </div>}
          <div className="composer-toolbar">
            <div className="composer-tools" role="group" aria-label="聊天功能">
            <button className="composer-tool-button" type="button" aria-label="添加附件"
              title="添加附件（选择文件、拖入对话或粘贴图片；点击发送后才请求）"
              disabled={!isHydrated || (isGenerating && !isGeneratingElsewhere)}
              onClick={() => picker.current?.click()}><Paperclip size={17} /></button>
            {thinkingControl}
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
                disabled={(!draft.trim() && !draftAttachments.length) || !isHydrated || attachmentBusy || !!attachmentBlockReason}
                aria-label="发送"
                type="button"
              >
                <Send size={17} />
              </button>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
