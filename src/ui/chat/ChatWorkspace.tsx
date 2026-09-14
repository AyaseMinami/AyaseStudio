import type { StoredChatMessage } from "../../chat/repository";
import { ChatHeader } from "./ChatHeader";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";

export interface ChatWorkspaceProps {
  draft: string;
  error?: string;
  isHydrated: boolean;
  isStreaming: boolean;
  messages: StoredChatMessage[];
  protocolLabel: string;
  onClear(): void;
  onDraftChange(draft: string): void;
  onSend(): void;
  onStop(): void;
}

export function ChatWorkspace({
  draft,
  error,
  isHydrated,
  isStreaming,
  messages,
  protocolLabel,
  onClear,
  onDraftChange,
  onSend,
  onStop,
}: ChatWorkspaceProps) {
  return (
    <>
      <ChatHeader
        isHydrated={isHydrated}
        isStreaming={isStreaming}
        protocolLabel={protocolLabel}
        onClear={onClear}
      />
      <MessageList messages={messages} />
      <Composer
        draft={draft}
        error={error}
        isHydrated={isHydrated}
        isStreaming={isStreaming}
        onDraftChange={onDraftChange}
        onSend={onSend}
        onStop={onStop}
      />
    </>
  );
}
