import type { StoredChatMessage } from "./repository";

export type RoundMessage = Omit<StoredChatMessage, "roundVersions">;
export interface RoundVersions { selected: number; pairs: [RoundMessage, RoundMessage][] }

export function withoutVersions(message: StoredChatMessage): RoundMessage {
  const { roundVersions: _versions, ...value } = message;
  return value;
}

// The visible pair is authoritative. Its saved slot is refreshed before leaving it.
export function latestPair(messages: StoredChatMessage[]): [StoredChatMessage, StoredChatMessage] | undefined {
  const user = messages[messages.length - 2], answer = messages[messages.length - 1];
  if (user?.role !== "user" || answer?.role !== "assistant" || answer.replyToId !== user.id) return;
  return [user, answer];
}

export function appendRoundVersion(messages: StoredChatMessage[], user: StoredChatMessage, answer: StoredChatMessage): StoredChatMessage {
  const previous = latestPair(messages);
  if (!previous || previous[0].id !== user.id) return withoutVersions(user);
  const versions = previous[0].roundVersions;
  const pairs = versions ? [...versions.pairs] : [];
  pairs[versions?.selected ?? 0] = previous.map(withoutVersions) as [RoundMessage, RoundMessage];
  pairs.push([withoutVersions(user), withoutVersions(answer)]);
  return { ...withoutVersions(user), roundVersions: { selected: pairs.length - 1, pairs } };
}

export function selectRoundVersion(messages: StoredChatMessage[], index: number): StoredChatMessage[] {
  const pair = latestPair(messages), versions = pair?.[0].roundVersions;
  if (!pair || !versions || !Number.isInteger(index) || !versions.pairs[index]) throw new Error("问答版本不存在。");
  if (pair[1].status === "streaming") throw new Error("请先停止生成，再切换问答版本。");
  const pairs = [...versions.pairs];
  pairs[versions.selected] = pair.map(withoutVersions) as [RoundMessage, RoundMessage];
  const [user, answer] = pairs[index];
  return [...messages.slice(0, -2), { ...user, roundVersions: { selected: index, pairs } }, answer];
}

export function retainedRoundMessages(message: StoredChatMessage): StoredChatMessage[] {
  return [message, ...(message.roundVersions?.pairs.flatMap((pair, index) =>
    index === message.roundVersions!.selected ? [] : pair) ?? [])];
}
