export interface ChatHeaderProps {
  title: string;
  isHydrated: boolean;
  isGenerating: boolean;
  protocolLabel: string;
  onClear(): void;
}

export function ChatHeader({
  title,
  isHydrated,
  isGenerating,
  protocolLabel,
  onClear,
}: ChatHeaderProps) {
  return (
    <header className="chat-header">
      <div className="chat-header-copy">
        <p className="text-sm font-medium">{title}</p>
        <p className="muted-text text-xs">{protocolLabel}</p>
      </div>
      <div className="chat-header-actions">
        <button className="clear-button" onClick={onClear} disabled={isGenerating || !isHydrated} type="button">清空</button>
      </div>
    </header>
  );
}
