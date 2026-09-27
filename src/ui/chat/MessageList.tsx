import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Bot, ChevronLeft, ChevronRight, Copy, GitBranch, LoaderCircle, Pencil, RefreshCw, Trash2 } from "lucide-react";

import type { StoredChatMessage } from "../../chat/repository";
import { retryUser } from "../../chat/messageOperations";
import { SafeMarkdown } from "../../chat/SafeMarkdown";
import type { RequestAttachment, SentAttachment } from "../../chat/attachments";
import { SentAttachmentPreview } from "./SentAttachmentPreview";
import { SentImageAttachment } from "./SentImageAttachment";
import { ThinkingSummary } from "./ThinkingSummary";
import { SearchResults } from "./SearchResults";

export interface MessageActions {
  edit(id: string, content: string): Promise<boolean>;
  editAndSend(id: string, content: string): Promise<boolean>;
  delete(id: string): Promise<boolean>;
  retry(id: string): Promise<void>;
  branch(id: string): Promise<boolean>;
  continue?(id: string): Promise<void>;
  selectVersion?(index: number): Promise<boolean>;
}

type Confirmation = { kind: "delete"; message: StoredChatMessage };

function actionKey(kind: string, id: string) { return `${kind}:${id}`; }

const FOLLOW_BOTTOM_DISTANCE = 48;

function MessageActionButton({ label, title, disabled, busy, onClick, children }: {
  label: string; title?: string; disabled?: boolean; busy?: boolean; onClick(): void; children: React.ReactNode;
}) {
  return <button type="button" className="message-action" aria-label={label} aria-busy={busy || undefined} title={busy ? `${label}：处理中…` : title ?? label}
    disabled={disabled || busy} onClick={onClick}>{busy ? <LoaderCircle size={15} className="spin" aria-hidden="true" /> : children}</button>;
}

function ConfirmationDialog({ busy, disabled, error, onClose, onConfirm }: {
  confirmation: Confirmation; busy: boolean; disabled: boolean; error?: string; onClose(): void; onConfirm(): void;
}) {
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
    <h2 id="message-confirm-title">确认操作</h2><p>永久删除这条消息，无法撤销。</p>
    {error && <p role="alert">{error}</p>}
    <div className="message-confirm-actions"><button type="button" onClick={onClose}>取消</button>
      <button type="button" className="settings-button" onClick={onConfirm} disabled={busy || disabled}>{busy ? "处理中…" : "确认删除消息"}</button></div>
  </section></div>;
}

export function MessageList({ messages, onReadAttachment, actions, actionsDisabled = false, actionError }: { messages: StoredChatMessage[];
  onReadAttachment?: (item: SentAttachment) => Promise<RequestAttachment>;
  actions?: MessageActions;
  actionsDisabled?: boolean;
  actionError?: string;
}) {
  const scrollRegionRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const previousScrollTopRef = useRef(0);
  const [preview, setPreview] = useState<{ messageId: string; item: SentAttachment; opener: HTMLElement }>();
  const [editing, setEditing] = useState<{ id: string; content: string }>();
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [pending, setPending] = useState<string>();
  const pendingRef = useRef<string | undefined>(undefined);
  const pageFocus = useRef<string | undefined>(undefined);
  const [copyFeedback, setCopyFeedback] = useState<Record<string, string>>({});
  const [copyingId, setCopyingId] = useState<string>();

  useLayoutEffect(() => {
    const region = scrollRegionRef.current!;
    if (messages.length === 0) followingRef.current = true;
    if (followingRef.current) {
      // Position restored history before paint, including after asynchronous loading.
      // Immediate movement also avoids smooth scrolling fighting user input.
      region.scrollTop = region.scrollHeight;
      previousScrollTopRef.current = region.scrollTop;
    }
  }, [messages]);
  useEffect(() => {
    if (preview && !messages.some((message) => message.id === preview.messageId &&
      message.attachments?.some((item) => item.reference === preview.item.reference))) setPreview(undefined);
    if (editing && !messages.some((message) => message.id === editing.id)) setEditing(undefined);
  }, [messages, preview, editing]);
  useEffect(() => { setConfirmation(undefined); }, [messages]);
  useLayoutEffect(() => {
    if (pending || !pageFocus.current) return;
    const pager = scrollRegionRef.current?.querySelector(".message-version-pager");
    const preferred = pager?.querySelector<HTMLButtonElement>(`button[aria-label="${pageFocus.current}"]:not(:disabled)`);
    (preferred ?? pager?.querySelector<HTMLButtonElement>("button:not(:disabled)"))?.focus();
    pageFocus.current = undefined;
  }, [messages, pending]);

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
    void run(actionKey("delete", value.message.id), async () => {
      const changed = await actions.delete(value.message.id);
      if (changed) { setConfirmation(undefined); setEditing(undefined); }
    });
  };

  return <div className="message-scroll-region" ref={scrollRegionRef}
    onWheel={(event) => {
      if (!preview && !confirmation && event.deltaY < 0 && !event.ctrlKey) followingRef.current = false;
    }}
    onScroll={(event) => {
      const region = event.currentTarget;
      const previousTop = previousScrollTopRef.current;
      previousScrollTopRef.current = region.scrollTop;
      if (region.scrollTop < previousTop) followingRef.current = false;
      else if (region.scrollTop > previousTop &&
        region.scrollHeight - region.clientHeight - region.scrollTop <= FOLLOW_BOTTOM_DISTANCE) {
        followingRef.current = true;
      }
    }}><div className="message-list">
    {messages.length === 0 ? <div className="empty-state"><div className="empty-state-mark"><Bot size={24} /></div>
      <h2 className="text-lg font-medium">只保留聊天本身</h2><p className="muted-text mt-2 text-sm leading-6">配置一个协议后开始对话。没有 Agent、知识库或插件系统。</p>
    </div> : <div className="space-y-7">{messages.map((message, index) => {
      const isEditing = editing?.id === message.id;
      const retryTarget = retryUser(messages, message.id);
      const disabled = actionsDisabled || !actions;
      const versions = message.role === "assistant" && index === messages.length - 1 && messages[index - 1]?.role === "user"
        ? messages[index - 1].roundVersions : undefined;
      const versionCount = versions?.pairs.length ?? 0;
      const canPage = !disabled && !pending && !editing && !confirmation && !!actions?.selectVersion;
      const save = () => void run(actionKey("edit", message.id), async () => {
        if (await actions!.edit(message.id, editing!.content)) setEditing(undefined);
      });
      const editAndSend = () => void run(actionKey("edit", message.id), async () => {
        if (await actions!.editAndSend(message.id, editing!.content)) setEditing(undefined);
      });
      const body = <>
          {message.role === "assistant" && <ThinkingSummary message={message} />}
          {isEditing ? <div className="message-editor"><label htmlFor={`message-edit-${message.id}`}>编辑消息</label>
            <textarea id={`message-edit-${message.id}`} value={editing.content} disabled={actionsDisabled || !!pending}
              onChange={(event) => setEditing({ ...editing, content: event.target.value })}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229 || event.repeat || event.altKey) return;
                if (event.key === "Escape" && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
                  event.preventDefault(); event.stopPropagation(); setEditing(undefined);
                } else if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
                  event.preventDefault(); event.stopPropagation(); if (!actionsDisabled && !pending) save();
                } else if (event.key === "Enter" && event.ctrlKey && !event.metaKey && !event.shiftKey && message.role === "user") {
                  event.preventDefault(); event.stopPropagation(); if (!actionsDisabled && !pending) editAndSend();
                }
              }} />
            <p className="message-editor-hint">Enter 仅保存 · Shift+Enter 换行 · Esc 取消。{message.role === "user" && (index >= messages.length - 2
              ? "Ctrl+Enter 保存并发送，保留本轮问答版本。" : "Ctrl+Enter 保存并发送，会移除后续历史并生成新回复。")}</p>
            <div><button type="button" disabled={!!pending} onClick={() => setEditing(undefined)}>取消</button>
              <button type="button" className="settings-button" disabled={actionsDisabled || !!pending}
                onClick={save}>保存</button>
              {message.role === "user" && <button type="button" className="settings-button message-editor-send" disabled={actionsDisabled || !!pending}
                onClick={editAndSend}>保存并发送</button>}</div>
          </div> : <>{message.role === "assistant" ? (message.content ? <SafeMarkdown search={message.search}>{message.content}</SafeMarkdown>
            : message.status === "streaming" ? <span className="typing-indicator" aria-label="正在生成"><i className="typing-dot" /><i className="typing-dot" /><i className="typing-dot" /></span>
              : <span className="subtle-text">（无文本输出）</span>) : message.content ? <SafeMarkdown>{message.content}</SafeMarkdown> : null}</>}
          {message.role === "assistant" && message.search && <SearchResults search={message.search} />}
          {message.editedAt !== undefined && <p className="message-edited">已编辑</p>}
          {!!message.attachments?.length && <>
            {message.attachments.some((item) => item.mimeType.startsWith("image/")) && onReadAttachment &&
              <div className={`sent-image-list ${message.attachments.filter((item) => item.mimeType.startsWith("image/")).length > 1 ? "sent-image-list-multiple" : ""}`}>
                {message.attachments.filter((item) => item.mimeType.startsWith("image/")).map((item) =>
                  <SentImageAttachment key={item.reference} item={item} read={onReadAttachment} scrollRoot={scrollRegionRef}
                    onOpen={(opener) => setPreview({ messageId: message.id, item, opener })} />)}
              </div>}
            {message.attachments.some((item) => !item.mimeType.startsWith("image/") || !onReadAttachment) &&
              <div className="sent-attachment-list">{message.attachments.filter((item) => !item.mimeType.startsWith("image/") || !onReadAttachment).map((item) =>
              <button type="button" key={item.reference} aria-label={`预览附件 ${item.name}`}
                disabled={!onReadAttachment} onClick={(event) => setPreview({ messageId: message.id, item, opener: event.currentTarget })}>
                {item.name} · {(item.size / 1_000_000).toFixed(2)} MB</button>)}</div>}
          </>}
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
              onClick={() => retryTarget && void run(actionKey("retry", message.id), () => actions!.retry(retryTarget.id))}><RefreshCw size={15} /></MessageActionButton>
            <MessageActionButton label="分支" disabled={disabled || !!pending} busy={pending === actionKey("branch", message.id)} onClick={() => void run(actionKey("branch", message.id), () => actions!.branch(message.id))}><GitBranch size={15} /></MessageActionButton>
            {versionCount > 1 && <span className="message-version-pager" aria-label="问答版本">
              <MessageActionButton label="上一版问答" disabled={!canPage || versions!.selected <= 0} busy={pending === actionKey("version", message.id)}
                onClick={() => { pageFocus.current = "上一版问答"; void run(actionKey("version", message.id), () => actions!.selectVersion!(versions!.selected - 1)); }}><ChevronLeft size={15} /></MessageActionButton>
              <span className="message-version-count" aria-live="polite">{versions!.selected + 1}/{versionCount}</span>
              <MessageActionButton label="下一版问答" disabled={!canPage || versions!.selected >= versionCount - 1} busy={pending === actionKey("version", message.id)}
                onClick={() => { pageFocus.current = "下一版问答"; void run(actionKey("version", message.id), () => actions!.selectVersion!(versions!.selected + 1)); }}><ChevronRight size={15} /></MessageActionButton>
            </span>}
          </div>
          {copyFeedback[message.id] && <p className="message-copy-feedback" role="status">{copyFeedback[message.id]}</p>}
      </>;
      return <article key={message.id} className={message.role === "user" ? "message-row message-row-user" : "message-row"}>
        {message.role === "user" ? <div className="user-message-group">
          <div className="user-message markdown">{body}</div>
          {controls}
        </div> : <div className="assistant-message-group">
          <div className="assistant-message markdown">{body}</div>
          {controls}
        </div>}
      </article>;
    })}</div>}
  </div>
  {preview && onReadAttachment && <SentAttachmentPreview item={preview.item} read={onReadAttachment} returnFocus={preview.opener}
    images={messages.find((message) => message.id === preview.messageId)?.attachments?.filter((item) => item.mimeType.startsWith("image/")) ?? []}
    onNavigate={(item) => setPreview({ ...preview, item })} onClose={() => setPreview(undefined)} />}
  {confirmation && <ConfirmationDialog confirmation={confirmation} busy={!!pending} disabled={actionsDisabled} error={actionError} onClose={() => setConfirmation(undefined)} onConfirm={confirm} />}
  </div>;
}
