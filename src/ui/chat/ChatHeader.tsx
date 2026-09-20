import { ChevronDown, MoveHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ModelPicker, type ModelPickerProps } from "./ModelPicker";
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
  layout?: ChatLayout;
  onToggleLayout?(): void;
  title: string;
  isHydrated: boolean;
  isGenerating: boolean;
  protocolLabel: string;
  modelLabel?: string;
  onClear(): void;
  modelPicker?: Omit<ModelPickerProps, "onClose">;
}

export function ChatHeader({
  layout = "narrow",
  onToggleLayout,
  title,
  isHydrated,
  isGenerating,
  protocolLabel,
  modelLabel = protocolLabel,
  onClear,
  modelPicker,
}: ChatHeaderProps) {
  const [selectingModel, setSelectingModel] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  return (
    <header className="chat-header" aria-label={title}>
      <div className="chat-header-copy">
        {modelPicker ? <button className="chat-model-trigger" type="button" aria-label="切换模型"
          aria-haspopup="dialog" aria-expanded={selectingModel} onClick={() => setSelectingModel(true)} disabled={!isHydrated} title={protocolLabel}>
          <span>{modelLabel}</span><ChevronDown size={14} />
        </button> : <p className="muted-text">{protocolLabel}</p>}
      </div>
      <div className="chat-header-actions">
        {onToggleLayout && <button className="chat-layout-button" type="button"
          aria-label={layout === "narrow" ? "展开聊天内容" : "收窄聊天内容"}
          title={layout === "narrow" ? "展开聊天内容" : "收窄聊天内容"}
          aria-pressed={layout === "wide"} onClick={onToggleLayout}>
          <MoveHorizontal size={16} />
        </button>}
        <button className="clear-button" onClick={() => setConfirmingClear(true)} disabled={isGenerating || !isHydrated} type="button">清空</button>
      </div>
      {selectingModel && modelPicker && <ModelPicker {...modelPicker} onClose={() => setSelectingModel(false)} />}
      {confirmingClear && <ClearConfirmation disabled={isGenerating || !isHydrated} onClose={() => setConfirmingClear(false)} onConfirm={() => {
        setConfirmingClear(false);
        onClear();
      }} />}
    </header>
  );
}
