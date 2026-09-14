export interface ChatHeaderProps {
  isHydrated: boolean;
  isStreaming: boolean;
  protocolLabel: string;
  onClear(): void;
}

export function ChatHeader({
  isHydrated,
  isStreaming,
  protocolLabel,
  onClear,
}: ChatHeaderProps) {
  return (
    <header className="chat-header">
      <div className="chat-header-copy">
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
