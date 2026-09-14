import { useEffect, useRef } from "react";
import { Bot } from "lucide-react";

import type { StoredChatMessage } from "../../chat/repository";
import { SafeMarkdown } from "../../chat/SafeMarkdown";

export function MessageList({ messages }: { messages: StoredChatMessage[] }) {
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
                  ) : (
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  )}
                  {message.status === "aborted" && (
                    <p className="message-status message-status-warning">
                      已停止
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
    </div>
  );
}
