import { ChevronDown, MoveHorizontal } from "lucide-react";
import { useState } from "react";
import { ModelPicker, type ModelPickerProps } from "./ModelPicker";
import type { ChatLayout } from "./useChatLayout";

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
        <button className="clear-button" onClick={onClear} disabled={isGenerating || !isHydrated} type="button">清空</button>
      </div>
      {selectingModel && modelPicker && <ModelPicker {...modelPicker} onClose={() => setSelectingModel(false)} />}
    </header>
  );
}
