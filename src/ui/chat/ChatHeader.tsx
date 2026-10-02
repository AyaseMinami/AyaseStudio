import { MoveHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { WindowControls } from "../window/WindowControls";
import type { ChatLayout } from "./useChatLayout";

function ClearConfirmation({ disabled, onClose, onConfirm }: {
  disabled: boolean; onClose(): void; onConfirm(): void;
}) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => previous?.focus({ preventScroll: true });
  }, []);
  return <div className="message-confirm-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }} onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
    if (event.key !== "Tab") return;
    const buttons = [...dialog.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const first = buttons[0]; const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }}>
    <section ref={dialog} className="message-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="clear-chat-title" aria-describedby="clear-chat-description">
      <h2 id="clear-chat-title">清空当前对话？</h2>
      <p id="clear-chat-description">将删除当前对话中的全部消息，无法撤销。对话设置和其他对话不受影响。</p>
      <div className="message-confirm-actions">
        <button className="settings-button" type="button" onClick={onClose}>取消</button>
        <button className="settings-button" type="button" disabled={disabled} onClick={onConfirm}>确认清空</button>
      </div>
    </section>
  </div>;
}

export interface ChatHeaderProps {
  conversationId?: string;
  layout?: ChatLayout;
  onToggleLayout?(): void;
  title: string;
  isHydrated: boolean;
  isWorkspaceBusy?: boolean;
  isGenerating: boolean;
  onClear(): void;
}

export function ChatHeader({
  conversationId,
  layout = "narrow",
  onToggleLayout,
  title,
  isHydrated,
  isWorkspaceBusy = false,
  isGenerating,
  onClear,
}: ChatHeaderProps) {
  const [clearRequest, setClearRequest] = useState<{ conversationId?: string }>();
  const confirmingClear = !!clearRequest && clearRequest.conversationId === conversationId;
  // Identity, rather than title, owns destructive confirmation; the titlebar stays mounted.
  useEffect(() => { setClearRequest(undefined); }, [conversationId]);
  return (
    <header className="chat-header" aria-label={title} data-tauri-drag-region>
      <div className="chat-header-actions">
        {onToggleLayout && <button className="chat-layout-button" type="button"
          aria-label={layout === "narrow" ? "切换为宽屏" : "切换为窄屏"}
          title={layout === "narrow" ? "当前窄屏；切换为宽屏" : "当前宽屏；切换为窄屏"}
          aria-pressed={layout === "wide"} onClick={onToggleLayout}>
          <MoveHorizontal size={16} aria-hidden="true" />
        </button>}
        <button className="clear-button" onClick={() => setClearRequest({ conversationId })} disabled={isGenerating || !isHydrated} data-busy-only={isWorkspaceBusy && !isHydrated && !isGenerating} type="button">清空</button>
        <WindowControls />
      </div>
      {confirmingClear && <ClearConfirmation disabled={isGenerating || !isHydrated} onClose={() => setClearRequest(undefined)} onConfirm={() => {
        setClearRequest(undefined);
        onClear();
      }} />}
    </header>
  );
}
