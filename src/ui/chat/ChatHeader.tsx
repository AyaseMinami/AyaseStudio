import { Maximize2, Minimize2 } from "lucide-react";
import type { ChatLayout } from "./useChatLayout";

export interface ChatHeaderProps {
  layout?: ChatLayout;
  onToggleLayout?(): void;
  title: string;
  isHydrated: boolean;
  isGenerating: boolean;
  protocolLabel: string;
  onClear(): void;
}

export function ChatHeader({
  layout = "narrow",
  onToggleLayout,
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
        {onToggleLayout && <button className="chat-layout-button" type="button"
          aria-label={layout === "narrow" ? "展开聊天内容" : "收窄聊天内容"}
          title={layout === "narrow" ? "展开聊天内容" : "收窄聊天内容"}
          aria-pressed={layout === "wide"} onClick={onToggleLayout}>
          {layout === "narrow" ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
        </button>}
        <button className="clear-button" onClick={onClear} disabled={isGenerating || !isHydrated} type="button">清空</button>
      </div>
    </header>
  );
}
