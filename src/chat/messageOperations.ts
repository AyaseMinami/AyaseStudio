import type { StoredChatMessage } from "./repository";

// Legacy transcripts had only positional pairs. Resolve them before any deletion
// so a surviving reply can never silently acquire a different user message.
export function withReplyLinks(messages: StoredChatMessage[]): StoredChatMessage[] {
  let userId: string | null = null;
  return messages.map((message) => {
    if (message.role === "user") userId = message.id;
    if (message.role !== "assistant") return message;
    const linked = message.replyToId === undefined ? { ...message, replyToId: userId } : message;
    userId = null;
    return linked;
  });
}

export function retryUser(messages: StoredChatMessage[], messageId: string): StoredChatMessage | undefined {
  const linked = withReplyLinks(messages);
  const index = linked.findIndex((message) => message.id === messageId);
  const selected = linked[index];
  if (selected?.role === "user") return selected;
  if (selected?.role !== "assistant") return undefined;
  return linked.slice(0, index).find((message) => message.role === "user" && message.id === selected.replyToId);
}

export function copyBranchMessages(messages: StoredChatMessage[]): StoredChatMessage[] {
  const ids = new Map(messages.map((message) => [message.id, crypto.randomUUID()]));
  return withReplyLinks(messages).map((message) => ({
    ...structuredClone(message), id: ids.get(message.id)!,
    ...(message.role === "assistant" ? { replyToId: ids.get(message.replyToId ?? "") ?? null } : {}),
  }));
}
