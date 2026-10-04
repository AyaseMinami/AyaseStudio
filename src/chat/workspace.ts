import type { SessionConfig } from "./sessionConfig";
import type { UserAvatar } from "../avatar/repository";

export const DEFAULT_ASSISTANT_ID = "default";

export interface AssistantPreset {
  id: string;
  name: string;
  icon: string;
  avatar?: UserAvatar;
  defaultAvatar?: string;
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
  // Present after manual ordering; message activity never changes this rank.
  sortOrder?: number;
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

export type AssistantInput = Pick<AssistantPreset, "name" | "icon" | "avatar" | "defaultAvatar" | "defaultModelId" | "defaultConfig">;

// Commands express complete atomic user actions, including navigation repair.
export type WorkspaceCommand =
  | { type: "create-assistant"; id: string; input: AssistantInput }
  | { type: "edit-assistant"; id: string; input: AssistantInput }
  | { type: "move-assistant"; id: string; direction: -1 | 1 }
  | { type: "reorder-assistant"; id: string; targetId: string; placement: "before" | "after" }
  | { type: "move-conversation"; id: string; direction: -1 | 1 }
  | { type: "reorder-conversation"; id: string; targetId: string; placement: "before" | "after" }
  | { type: "delete-assistant"; id: string; mode: "move" | "delete" }
  | { type: "delete-assistants"; ids: string[]; mode: "move" | "delete"; expected: string }
  | { type: "create-conversation"; id: string; assistantId: string }
  | { type: "rename-conversation"; id: string; title: string }
  | { type: "start-conversation-title"; id: string; messageId: string }
  | { type: "finish-conversation-title"; id: string; messageId: string; title?: string }
  | { type: "configure-conversation"; id: string; settings: import("./conversationConfig").ConversationConfig; title?: string }
  | { type: "edit-message"; conversationId: string; messageId: string; content: string }
  | { type: "select-round-version"; conversationId: string; index: number }
  | { type: "delete-message"; conversationId: string; messageId: string }
  | { type: "fork-conversation"; id: string; conversationId: string; messageId: string;
      creationConfig: NonNullable<Conversation["creationConfig"]> }
  | { type: "delete-conversation"; id: string }
  | { type: "delete-conversations"; ids: string[]; assistantId: string; expected: string }
  | { type: "select"; assistantId: string; conversationId?: string | null }
  | { type: "select-model"; assistantId: string; modelId: string | null }
  | { type: "repair-models"; validModelIds: string[] };

export function selectedConversation(workspace: WorkspaceSnapshot): Conversation | undefined {
  const assistantId = workspace.selection.activeAssistantId;
  return workspace.conversations.find((item) =>
    item.id === workspace.selection.lastSelected[assistantId] && item.assistantId === assistantId,
  );
}

/** Freeze ownership and displayed identities, independent of transcript activity timestamps. Runtime only. */
export function workspaceDeletionFingerprint(snapshot: WorkspaceSnapshot, kind: "assistants" | "conversations", ids: readonly string[]): string {
  const selected = new Set(ids);
  const assistants = kind === "assistants" ? snapshot.assistants.filter(item => selected.has(item.id)) : [];
  const conversations = snapshot.conversations.filter(item => kind === "assistants" ? selected.has(item.assistantId) : selected.has(item.id));
  return JSON.stringify({ assistants: [...assistants].sort((a, b) => a.id.localeCompare(b.id)).map(({ id, name }) => ({ id, name })),
    conversations: [...conversations].sort((a, b) => a.id.localeCompare(b.id)).map(({ id, assistantId, title, createdAt }) => ({ id, assistantId, title, createdAt })) });
}

export function orderedConversations(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => {
    const aRanked = Number.isFinite(a.sortOrder), bRanked = Number.isFinite(b.sortOrder);
    // Legacy/imported records stay in recency order, ahead of manually ranked records.
    if (aRanked !== bRanked) return aRanked ? 1 : -1;
    return (aRanked ? a.sortOrder! - b.sortOrder! : 0) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);
  });
}

/** Return a new order only for a real move; no-ops must not freeze recency order. */
export function placeItem<T extends { id: string }>(items: T[], id: string, targetId: string, placement: "before" | "after"): T[] | undefined {
  const source = items.find(item => item.id === id);
  if (!source || id === targetId || !items.some(item => item.id === targetId)) return;
  const next = items.filter(item => item.id !== id);
  const index = next.findIndex(item => item.id === targetId) + (placement === "after" ? 1 : 0);
  next.splice(index, 0, source);
  return next.some((item, i) => item.id !== items[i].id) ? next : undefined;
}
