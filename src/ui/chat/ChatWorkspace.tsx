import { useEffect, useState } from "react";
import type { ContextSummary } from "../../chat/contextBudget";
import type { DraftAttachment, RequestAttachment, SentAttachment } from "../../chat/attachments";
import { attachmentCapabilityFailure, attachmentCapabilityNotice } from "../../chat/attachments";
import type { ChatProtocol } from "../../chat/types";
import type { StoredChatMessage } from "../../chat/repository";
import { ChatHeader } from "./ChatHeader";
import { Composer } from "./Composer";
import type { DraftSelection } from "../../chat/inputHistory";
import { ModelSelector } from "./ModelSelector";
import type { ModelPickerProps } from "./ModelPicker";
import { MessageList, type MessageActions } from "./MessageList";
import { ThinkingToolbarControl } from "./ThinkingControl";
import type { ThinkingSettings } from "../../chat/thinking";
import { Globe } from "lucide-react";
import type { ChatLayout } from "./useChatLayout";
import type { AssistantPreset } from "../../chat/workspace";

export interface ChatWorkspaceProps {
  assistant?: AssistantPreset;
  userAvatarUrl?: string;
  hideHeader?: boolean;
  layout?: ChatLayout;
  onToggleLayout?(): void;
  webSearch?: boolean;
  onWebSearchChange?(enabled: boolean): void;
  thinking?: ThinkingSettings;
  onThinkingChange?(value: ThinkingSettings): void;
  title: string;
  draft: string;
  draftSelection?: DraftSelection;
  onDraftSelectionChange?(selection: DraftSelection): void;
  onBrowseHistory?(direction: -1 | 1, selection: DraftSelection): boolean;
  draftAttachments?: DraftAttachment[];
  attachmentBusy?: boolean;
  contextPlan?: ContextSummary;
  error?: string;
  isHydrated: boolean;
  isGenerating: boolean;
  messages: StoredChatMessage[];
  messageActions?: MessageActions;
  messageActionsDisabled?: boolean;
  messageActionError?: string;
  protocolLabel: string;
  modelLabel?: string;
  modelPicker?: Omit<ModelPickerProps, "onClose">;
  modelId?: string;
  protocol?: ChatProtocol;
  onClear(): void;
  onDraftChange(draft: string): void;
  onFiles?(files: File[]): void;
  onRemoveAttachment?(id: string): void;
  onReadAttachment?: (item: SentAttachment) => Promise<RequestAttachment>;
  onSend(): void;
  onStop(): void;
}

export function ChatWorkspace({
  assistant,
  userAvatarUrl,
  hideHeader = false,
  layout = "narrow",
  onToggleLayout,
  webSearch,
  onWebSearchChange,
  thinking,
  onThinkingChange,
  title,
  draft,
  draftSelection,
  onDraftSelectionChange,
  onBrowseHistory,
  draftAttachments,
  attachmentBusy,
  contextPlan,
  error,
  isHydrated,
  isGenerating,
  messages,
  messageActions,
  messageActionsDisabled,
  messageActionError,
  protocolLabel,
  modelLabel,
  modelPicker,
  modelId,
  protocol,
  onClear,
  onDraftChange,
  onFiles,
  onRemoveAttachment,
  onReadAttachment,
  onSend,
  onStop,
}: ChatWorkspaceProps) {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const preventFileNavigation = (event: DragEvent) => {
      if (event.dataTransfer && (event.dataTransfer.types?.includes("Files") || event.dataTransfer.files.length > 0))
        event.preventDefault();
    };
    window.addEventListener("dragover", preventFileNavigation);
    window.addEventListener("drop", preventFileNavigation);
    return () => {
      window.removeEventListener("dragover", preventFileNavigation);
      window.removeEventListener("drop", preventFileNavigation);
    };
  }, []);
  return (
    <div className={`chat-attachment-surface${dragging ? " chat-attachment-over" : ""}`}
      data-chat-layout={layout}
      onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault(); setDragging(false);
        onFiles?.([...event.dataTransfer.files]);
      }}>
      {!hideHeader && <ChatHeader
        layout={layout}
        onToggleLayout={onToggleLayout}
        title={title}
        isHydrated={isHydrated}
        isGenerating={isGenerating}
        onClear={onClear}
      />}
      {contextPlan && (contextPlan.trimmedTurns > 0 || contextPlan.excludedIncompleteTurns > 0) && (
        <div className="context-budget-notice" role="status">
          最近一次请求保留 {contextPlan.keptTurns} 轮，裁剪 {contextPlan.trimmedTurns} 轮，排除 {contextPlan.excludedIncompleteTurns} 个未完整轮次；
          {contextPlan.inputTokens} Token（估算，{contextPlan.countingLabel}）。原始记录未修改。
        </div>
      )}
      <MessageList assistant={assistant} userAvatarUrl={userAvatarUrl} messages={messages} onReadAttachment={onReadAttachment} actions={messageActions}
        actionsDisabled={messageActionsDisabled} actionError={messageActionError} />
      {draftAttachments && (attachmentCapabilityFailure(protocol ?? "openai-chat", modelId ?? "", draftAttachments) ||
        attachmentCapabilityNotice(modelId ?? "", draftAttachments)) &&
        <p className="attachment-capability-notice" role="status">{
          attachmentCapabilityFailure(protocol ?? "openai-chat", modelId ?? "", draftAttachments) ||
          attachmentCapabilityNotice(modelId ?? "", draftAttachments)}</p>}
      <Composer
        protocol={protocol}
        modelControl={modelPicker
          ? <ModelSelector label={modelLabel ?? "选择模型"} fullLabel={protocolLabel} {...modelPicker} />
          : <span className="composer-model-label">{protocolLabel}</span>}
        searchControl={onWebSearchChange ? <button type="button" className="composer-tool-button"
          aria-label="联网搜索" aria-pressed={webSearch ?? false}
          style={webSearch ? { color: "rgb(var(--color-accent-text))", background: "rgb(var(--color-accent) / 0.1)" } : undefined}
          title={`${webSearch ? "已开启" : "已关闭"}：修改仅影响当前会话下次请求。允许模型按需联网，可能产生额外费用。搜索专用模型可能始终联网。`}
          disabled={!isHydrated} onClick={() => onWebSearchChange(!webSearch)}><Globe size={17} /></button> : undefined}
        thinkingControl={protocol && onThinkingChange ? <ThinkingToolbarControl
          key={`${protocol}-${modelId}`} protocol={protocol} model={modelId ?? ""} value={thinking}
          disabled={!isHydrated} scope="当前会话" hint="当前会话 · 自动保存，下次请求生效" onChange={onThinkingChange} /> : undefined}
        draft={draft}
        draftSelection={draftSelection}
        onDraftSelectionChange={onDraftSelectionChange}
        onBrowseHistory={onBrowseHistory}
        draftAttachments={draftAttachments}
        attachmentBusy={attachmentBusy}
        attachmentBlockReason={draftAttachments ? attachmentCapabilityFailure(protocol ?? "openai-chat", modelId ?? "", draftAttachments) : undefined}
        error={error}
        isHydrated={isHydrated}
        isGenerating={isGenerating}
        onDraftChange={onDraftChange}
        onFiles={onFiles}
        onRemoveAttachment={onRemoveAttachment}
        onSend={onSend}
        onStop={onStop}
      />
      {dragging && <div className="chat-attachment-overlay" role="status">释放文件以加入当前对话草稿，点击发送后才请求</div>}
    </div>
  );
}
