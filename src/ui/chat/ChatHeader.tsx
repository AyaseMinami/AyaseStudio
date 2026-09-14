import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

export interface ChatHeaderProps {
  isHydrated: boolean;
  isStreaming: boolean;
  protocolLabel: string;
  settingsOpen: boolean;
  onClear(): void;
  onToggleSettings(): void;
}

export function ChatHeader({
  isHydrated,
  isStreaming,
  protocolLabel,
  settingsOpen,
  onClear,
  onToggleSettings,
}: ChatHeaderProps) {
  return (
    <header className="chat-header">
      <button
        className="icon-button"
        onClick={onToggleSettings}
        aria-label={settingsOpen ? "收起设置" : "展开设置"}
        type="button"
      >
        {settingsOpen ? (
          <PanelLeftClose size={19} />
        ) : (
          <PanelLeftOpen size={19} />
        )}
      </button>
      <div className="text-center">
        <p className="text-sm font-medium">新对话</p>
        <p className="muted-text text-xs">{protocolLabel}</p>
      </div>
      <button
        className="clear-button"
        onClick={onClear}
        disabled={isStreaming || !isHydrated}
        type="button"
      >
        清空
      </button>
    </header>
  );
}
