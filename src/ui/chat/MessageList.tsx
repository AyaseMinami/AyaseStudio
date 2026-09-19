import { useEffect, useRef, useState } from "react";
import { Bot, Copy, GitBranch, Pencil, RefreshCw, Trash2 } from "lucide-react";

import type { StoredChatMessage } from "../../chat/repository";
import { retryUser } from "../../chat/messageOperations";
import { SafeMarkdown } from "../../chat/SafeMarkdown";
import type { RequestAttachment, SentAttachment } from "../../chat/attachments";
import { SentAttachmentPreview } from "./SentAttachmentPreview";
import { ThinkingSummary } from "./ThinkingSummary";
import { SearchResults } from "./SearchResults";

export interface MessageActions {
  edit(id: string, content: string): Promise<boolean>;
  delete(id: string): Promise<boolean>;
  retry(id: string): Promise<void>;
  branch(id: string): Promise<boolean>;
  continue?(id: string): Promise<void>;
}

type Confirmation =
  | { kind: "delete"; message: StoredChatMessage }
  | { kind: "retry"; message: StoredChatMessage; target: StoredChatMessage; removed: number }
  | { kind: "edit"; message: StoredChatMessage; content: string; removed: number };

function actionKey(kind: string, id: string) { return `${kind}:${id}`; }

function MessageActionButton({ label, title, disabled, busy, onClick, children }: {
  label: string; title?: string; disabled?: boolean; busy?: boolean; onClick(): void; children: React.ReactNode;
}) {
  return <button type="button" className="message-action" aria-label={label} title={title ?? label}
    disabled={disabled || busy} onClick={onClick}>{children}<span>{busy ? "处理中…" : label}</span></button>;
}

function ConfirmationDialog({ confirmation, busy, disabled, error, onClose, onConfirm }: {
  confirmation: Confirmation; busy: boolean; disabled: boolean; error?: string; onClose(): void; onConfirm(): void;
}) {
  const content = confirmation.kind === "delete"
    ? <>永久删除这条消息，无法撤销。</>
    : confirmation.kind === "retry"
      ? <>将移除这条提问之后的 {confirmation.removed} 条消息，并重新生成回复。旧回复不会保留。</>
      : <>保存编辑将永久丢弃这条消息之后的 {confirmation.removed} 条消息，无法撤销。</>;
  const confirmLabel = confirmation.kind === "delete" ? "确认删除消息"
    : confirmation.kind === "retry" ? "确认重新生成" : "确认保存编辑";
  const dialog = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => previousFocus.current?.focus();
  }, []);
  const containTab = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    if (event.key !== "Tab") return;
    const fields = [...(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [])];
    if (!fields.length) return;
    const index = fields.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && index <= 0) { event.preventDefault(); fields[fields.length - 1]?.focus(); }
    else if (!event.shiftKey && index === fields.length - 1) { event.preventDefault(); fields[0].focus(); }
  };
  return <div className="message-confirm-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}><section ref={dialog} className="message-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="message-confirm-title"
    onKeyDown={containTab}>
    <h2 id="message-confirm-title">确认操作</h2><p>{content}</p>
    {error && <p role="alert">{error}</p>}
    <div className="message-confirm-actions"><button type="button" onClick={onClose}>取消</button>
      <button type="button" className="settings-button" onClick={onConfirm} disabled={busy || disabled}>{busy ? "处理中…" : confirmLabel}</button></div>
  </section></div>;
}

export function MessageList({ messages, onReadAttachment, actions, actionsDisabled = false, actionError }: { messages: StoredChatMessage[];
  onReadAttachment?: (item: SentAttachment) => Promise<RequestAttachment>;
  actions?: MessageActions;
  actionsDisabled?: boolean;
  actionError?: string;
}) {
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<SentAttachment>();
  const [editing, setEditing] = useState<{ id: string; content: string }>();
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [pending, setPending] = useState<string>();
  const pendingRef = useRef<string | undefined>(undefined);
  const [copyFeedback, setCopyFeedback] = useState<Record<string, string>>({});
  const [copyingId, setCopyingId] = useState<string>();

  useEffect(() => { transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => {
    if (preview && !messages.some((message) => message.attachments?.some((item) => item.reference === preview.reference))) setPreview(undefined);
    if (editing && !messages.some((message) => message.id === editing.id)) setEditing(undefined);
  }, [messages, preview, editing]);
  useEffect(() => { setConfirmation(undefined); }, [messages]);

  const run = async (key: string, operation: () => Promise<unknown>) => {
    if (pendingRef.current || actionsDisabled) return;
    pendingRef.current = key; setPending(key);
    try { await operation(); } finally { pendingRef.current = undefined; setPending(undefined); }
  };
  const copy = async (message: StoredChatMessage) => {
    setCopyingId(message.id);
    try {
      await navigator.clipboard.writeText(message.content);
      setCopyFeedback((current) => ({ ...current, [message.id]: "已复制原始消息" }));
    } catch { setCopyFeedback((current) => ({ ...current, [message.id]: "复制失败，请检查剪贴板权限。" })); }
    finally { setCopyingId(undefined); }
  };
  const confirm = () => {
    if (!confirmation || !actions) return;
    const value = confirmation;
    if (value.kind === "retry") {
      setConfirmation(undefined);
      void run(actionKey(value.kind, value.message.id), () => actions.retry(value.target.id));
      return;
    }
    void run(actionKey(value.kind, value.message.id), async () => {
      const changed = value.kind === "delete" ? await actions.delete(value.message.id) : await actions.edit(value.message.id, value.content);
      if (changed) { setConfirmation(undefined); setEditing(undefined); }
    });
  };

  return <div className="message-scroll-region"><div className="message-list">
    {messages.length === 0 ? <div className="empty-state"><div className="empty-state-mark"><Bot size={24} /></div>
      <h2 className="text-lg font-medium">只保留聊天本身</h2><p className="muted-text mt-2 text-sm leading-6">配置一个协议后开始对话。没有 Agent、知识库或插件系统。</p>
    </div> : <div className="space-y-7">{messages.map((message, index) => {
      const isEditing = editing?.id === message.id;
      const retryTarget = retryUser(messages, message.id);
      const retryRemoved = retryTarget ? messages.length - messages.findIndex((item) => item.id === retryTarget.id) - 1 : 0;
      const editRemoved = messages.length - index - 1;
      const disabled = actionsDisabled || !actions;
      const body = <>
          {message.role === "assistant" && <ThinkingSummary message={message} />}
          {isEditing ? <div className="message-editor"><label htmlFor={`message-edit-${message.id}`}>编辑消息</label>
            <textarea id={`message-edit-${message.id}`} value={editing.content} disabled={actionsDisabled || !!pending}
              onChange={(event) => setEditing({ ...editing, content: event.target.value })} />
            <div><button type="button" disabled={!!pending} onClick={() => setEditing(undefined)}>取消</button>
              <button type="button" className="settings-button" disabled={actionsDisabled || !!pending}
                onClick={() => setConfirmation({ kind: "edit", message, content: editing.content, removed: editRemoved })}>保存编辑</button></div>
          </div> : <>{message.role === "assistant" ? (message.content ? <SafeMarkdown search={message.search}>{message.content}</SafeMarkdown>
            : message.status === "streaming" ? <span className="typing-indicator" aria-label="正在生成"><i className="typing-dot" /><i className="typing-dot" /><i className="typing-dot" /></span>
              : <span className="subtle-text">（无文本输出）</span>) : message.content ? <SafeMarkdown>{message.content}</SafeMarkdown> : null}</>}
          {message.role === "assistant" && message.search && <SearchResults search={message.search} />}
          {message.editedAt !== undefined && <p className="message-edited">已编辑</p>}
          {!!message.attachments?.length && <div className="sent-attachment-list">{message.attachments.map((item) => <button type="button" key={item.reference} aria-label={`预览附件 ${item.name}`}
            disabled={!onReadAttachment} onClick={() => setPreview(item)}>{item.name} · {(item.size / 1_000_000).toFixed(2)} MB</button>)}</div>}
          {message.status === "aborted" && <p className="message-status message-status-warning">已停止</p>}
          {message.status === "incomplete" && <p className="message-status message-status-warning">回复未完整；下次请求不会带入这一轮</p>}
          {message.status === "paused" && <p className="message-status message-status-warning">回复已暂停，可以继续生成。</p>}
          {message.status === "paused" && index === messages.length - 1 && message.continuation && actions?.continue &&
            <button type="button" className="settings-button" disabled={actionsDisabled || !!pending}
              onClick={() => void run(actionKey("continue", message.id), () => actions.continue!(message.id))}>继续生成</button>}
          {message.status === "failed" && <p className="message-status message-status-error">生成失败</p>}
      </>;
      const controls = <>
          <div className="message-actions" aria-label="消息操作">
            <MessageActionButton label="复制" busy={copyingId === message.id} onClick={() => void copy(message)}><Copy size={15} /></MessageActionButton>
            <MessageActionButton label="编辑" disabled={disabled || !!pending} busy={pending === actionKey("edit", message.id)} onClick={() => setEditing({ id: message.id, content: message.content })}><Pencil size={15} /></MessageActionButton>
            <MessageActionButton label="删除" disabled={disabled || !!pending} busy={pending === actionKey("delete", message.id)} onClick={() => setConfirmation({ kind: "delete", message })}><Trash2 size={15} /></MessageActionButton>
            <MessageActionButton label="重新生成" disabled={disabled || !!pending || !retryTarget} busy={pending === actionKey("retry", message.id)} title={retryTarget ? "重新生成这轮回复" : "此消息没有可重新生成的用户提问"}
              onClick={() => retryTarget && setConfirmation({ kind: "retry", message, target: retryTarget, removed: retryRemoved })}><RefreshCw size={15} /></MessageActionButton>
            <MessageActionButton label="分支" disabled={disabled || !!pending} busy={pending === actionKey("branch", message.id)} onClick={() => void run(actionKey("branch", message.id), () => actions!.branch(message.id))}><GitBranch size={15} /></MessageActionButton>
          </div>
          {copyFeedback[message.id] && <p className="message-copy-feedback" role="status">{copyFeedback[message.id]}</p>}
      </>;
      return <article key={message.id} className={message.role === "user" ? "message-row message-row-user" : "message-row"}>
        {message.role === "user" ? <div className="user-message-group">
          <div className="user-message markdown">{body}</div>
          {controls}
        </div> : <div className="assistant-message markdown">{body}{controls}</div>}
      </article>;
    })}</div>}
    <div ref={transcriptEndRef} />
  </div>
  {preview && onReadAttachment && <SentAttachmentPreview key={preview.reference} item={preview} read={onReadAttachment} onClose={() => setPreview(undefined)} />}
  {confirmation && <ConfirmationDialog confirmation={confirmation} busy={!!pending} disabled={actionsDisabled} error={actionError} onClose={() => setConfirmation(undefined)} onConfirm={confirm} />}
  </div>;
}
