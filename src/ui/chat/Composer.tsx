import type { KeyboardEvent } from "react";
import { Send, Square } from "lucide-react";

export interface ComposerProps {
  draft: string;
  error?: string;
  isHydrated: boolean;
  isStreaming: boolean;
  onDraftChange(draft: string): void;
  onSend(): void;
  onStop(): void;
}

export function Composer({
  draft,
  error,
  isHydrated,
  isStreaming,
  onDraftChange,
  onSend,
  onStop,
}: ComposerProps) {
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
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        <div className="composer-frame">
          <textarea
            className="composer-input"
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            disabled={isStreaming || !isHydrated}
          />
          <div className="flex justify-end px-1 pb-1">
            {isStreaming ? (
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
                disabled={!draft.trim() || !isHydrated}
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
