import type { SessionConfig } from "./sessionConfig";

export const DEFAULT_ASSISTANT_ID = "default";

export interface AssistantPreset {
  id: string;
  name: string;
  icon: string;
  sortOrder: number;
  defaultModelId: string | null;
  defaultConfig: SessionConfig;
}

export interface Conversation {
  id: string;
  assistantId: string;
  title: string;
  titleNaming?: { sourceMessageId: string; source: string; status: "pending" | "finished" } | "manual";
  createdAt: number;
  updatedAt: number;
  // Legacy input only; initialization converts it to settings and removes it.
  overrides?: import("./conversationConfig").ConversationOverrides;
  settings?: import("./conversationConfig").ConversationConfig;
  // Historical record only, never used as the active override layer.
  creationConfig?: { modelId: string | null; config: SessionConfig };
}

export interface WorkspaceSelection {
  id: "selection";
  activeAssistantId: string;
  lastSelected: Record<string, string | null>;
}

export interface WorkspaceSnapshot {
  assistants: AssistantPreset[];
  conversations: Conversation[];
  selection: WorkspaceSelection;
}

export type AssistantInput = Pick<AssistantPreset, "name" | "icon" | "defaultModelId" | "defaultConfig">;

// Commands express complete atomic user actions, including navigation repair.
export type WorkspaceCommand =
  | { type: "create-assistant"; id: string; input: AssistantInput }
  | { type: "edit-assistant"; id: string; input: AssistantInput }
  | { type: "move-assistant"; id: string; direction: -1 | 1 }
  | { type: "delete-assistant"; id: string; mode: "move" | "delete" }
  | { type: "create-conversation"; id: string; assistantId: string }
  | { type: "rename-conversation"; id: string; title: string }
  | { type: "start-conversation-title"; id: string; messageId: string }
  | { type: "finish-conversation-title"; id: string; messageId: string; title?: string }
  | { type: "configure-conversation"; id: string; settings: import("./conversationConfig").ConversationConfig; title?: string }
  | { type: "edit-message"; conversationId: string; messageId: string; content: string }
  | { type: "delete-message"; conversationId: string; messageId: string }
  | { type: "fork-conversation"; id: string; conversationId: string; messageId: string;
      creationConfig: NonNullable<Conversation["creationConfig"]> }
  | { type: "delete-conversation"; id: string }
  | { type: "select"; assistantId: string; conversationId?: string | null }
  | { type: "select-model"; assistantId: string; modelId: string | null }
  | { type: "repair-models"; validModelIds: string[] };

export function selectedConversation(workspace: WorkspaceSnapshot): Conversation | undefined {
  const assistantId = workspace.selection.activeAssistantId;
  return workspace.conversations.find((item) =>
    item.id === workspace.selection.lastSelected[assistantId] && item.assistantId === assistantId,
  );
}

export function orderedConversations(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}
