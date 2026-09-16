import { useEffect, useRef, useState } from "react";
import { Bot } from "lucide-react";

import type { StoredChatMessage } from "../../chat/repository";
import { SafeMarkdown } from "../../chat/SafeMarkdown";
import type { RequestAttachment, SentAttachment } from "../../chat/attachments";
import { SentAttachmentPreview } from "./SentAttachmentPreview";
import { ThinkingSummary } from "./ThinkingSummary";

export function MessageList({ messages, onReadAttachment }: { messages: StoredChatMessage[];
  onReadAttachment?: (item: SentAttachment) => Promise<RequestAttachment> }) {
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<SentAttachment>();

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);
  useEffect(() => {
    if (preview && !messages.some((message) => message.attachments?.some((item) => item.reference === preview.reference))) {
      setPreview(undefined);
    }
  }, [messages, preview]);

  return (
    <div className="message-scroll-region">
      <div className="message-list">
        {messages.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-mark">
              <Bot size={24} />
            </div>
            <h2 className="text-lg font-medium">只保留聊天本身</h2>
            <p className="muted-text mt-2 text-sm leading-6">
              配置一个协议后开始对话。没有 Agent、知识库或插件系统。
            </p>
          </div>
        ) : (
          <div className="space-y-7">
            {messages.map((message) => (
              <article
                key={message.id}
                className={
                  message.role === "user"
                    ? "message-row message-row-user"
                    : "message-row"
                }
              >
                <div
                  className={
                    message.role === "user"
                      ? "user-message"
                      : "assistant-message markdown"
                  }
                >
                  {message.role === "assistant" && <ThinkingSummary message={message} />}
                  {message.role === "assistant" ? (
                    message.content ? (
                      <SafeMarkdown>{message.content}</SafeMarkdown>
                    ) : message.status === "streaming" ? (
                      <span className="typing-indicator" aria-label="正在生成">
                        <i className="typing-dot" />
                        <i className="typing-dot" />
                        <i className="typing-dot" />
                      </span>
                    ) : (
                      <span className="subtle-text">（无文本输出）</span>
                    )
                  ) : message.content ? (
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  ) : null}
                  {!!message.attachments?.length && <div className="sent-attachment-list">
                    {message.attachments.map((item) => <button type="button" key={item.reference}
                      aria-label={`预览附件 ${item.name}`} disabled={!onReadAttachment}
                      onClick={() => setPreview(item)}>{item.name} · {(item.size / 1_000_000).toFixed(2)} MB</button>)}
                  </div>}
                  {message.status === "aborted" && (
                    <p className="message-status message-status-warning">
                      已停止
                    </p>
                  )}
                  {message.status === "incomplete" && (
                    <p className="message-status message-status-warning">
                      回复未完整；下次请求不会带入这一轮
                    </p>
                  )}
                  {message.status === "failed" && (
                    <p className="message-status message-status-error">
                      生成失败
                    </p>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
        <div ref={transcriptEndRef} />
      </div>
      {preview && onReadAttachment && <SentAttachmentPreview key={preview.reference} item={preview}
        read={onReadAttachment} onClose={() => setPreview(undefined)} />}
    </div>
  );
}
