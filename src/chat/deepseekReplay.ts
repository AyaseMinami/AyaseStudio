import { backupFields, dataCheck, dataRecord } from "../storage/dataContract";
import { dataPolicies } from "../storage/dataPolicies";
import type { ProviderReplay } from "./nativeSearch";
import type { StoredChatMessage } from "./repository";
import type { ChatMessage, ChatProtocol } from "./types";

const DEEPSEEK_TOOL_NAMES = new Set(["deepseek_web_search", "deepseek_read_url"]);
const DEEPSEEK_KINDS = new Set(["search", "deep_search", "read_link", "image_search", "deep_image_search"]);

function isSafeRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).every((key) => !["__proto__", "constructor", "prototype"].includes(key));
}

export function isValidResponsesReadLinkItem(item: unknown): item is Record<string, unknown> {
  if (!isSafeRecord(item)) return false;
  if (item.type !== "web_search_call" || item.status !== "completed" || item.kind !== "read_link") return false;
  if (typeof item.signature !== "string" || !item.signature.trim()) return false;
  if (item.id !== undefined && (typeof item.id !== "string" || !item.id.trim())) return false;
  if (item.action !== undefined && !isSafeRecord(item.action)) return false;
  if (item.page !== undefined && !isSafeRecord(item.page)) return false;
  return true;
}

export function assertValidProviderReplay(raw: unknown, role?: unknown): asserts raw is ProviderReplay {
  dataRecord(raw);
  const allowed = backupFields(dataPolicies.replay);
  dataCheck(Object.keys(raw).every((key) => allowed.includes(key)));
  dataCheck(raw.protocol === "anthropic-native" || raw.protocol === "openai-responses");
  dataCheck(typeof raw.scope === "string");
  dataCheck(Array.isArray(raw.content));
  raw.content.forEach(dataRecord);
  if (raw.protocol === "openai-responses") {
    dataCheck(role === "assistant");
    dataCheck(raw.responses === undefined);
    dataCheck(raw.content.length > 0 && raw.content.every(isValidResponsesReadLinkItem));
  } else if (raw.responses !== undefined) {
    dataCheck(Array.isArray(raw.responses));
    raw.responses.forEach((response) => {
      dataCheck(Array.isArray(response));
      response.forEach(dataRecord);
    });
  }
}

/** Validate providerReplay across a message, continuation history, and roundVersions while preserving unrelated fields. */
export function readMessageProviderReplay<T>(raw: T): T {
  const value = structuredClone(raw);
  function visit(message: unknown): void {
    if (message === null || typeof message !== "object" || Array.isArray(message)) return;
    const record = message as Record<string, unknown>;
    if ("providerReplay" in record && record.providerReplay !== undefined) {
      assertValidProviderReplay(record.providerReplay, record.role);
    }
    const continuation = record.continuation;
    if (continuation && typeof continuation === "object" && !Array.isArray(continuation)
      && "messages" in continuation && Array.isArray((continuation as Record<string, unknown>).messages)) {
      ((continuation as Record<string, unknown>).messages as unknown[]).forEach(visit);
    }
    const versions = record.roundVersions;
    if (versions && typeof versions === "object" && "pairs" in versions && Array.isArray(versions.pairs)) {
      for (const pair of versions.pairs) if (Array.isArray(pair)) pair.forEach(visit);
    }
  }
  visit(value);
  return value;
}

export function readMessagesProviderReplay(raw: StoredChatMessage[]): StoredChatMessage[] {
  return raw.map(readMessageProviderReplay);
}

/** Shared eligibility gate used by both context budgeting and protocol request mapping. */
export function eligibleProviderReplay(
  message: Pick<ChatMessage, "role" | "providerReplay">,
  protocol: ChatProtocol,
  replayScope?: string,
): ProviderReplay | undefined {
  if (message.role !== "assistant") return undefined;
  const replay = message.providerReplay;
  if (!replay || replay.protocol !== protocol) return undefined;
  if (!replayScope || replay.scope !== replayScope) return undefined;
  return replay;
}

export function expandAnthropicReplay(replay: ProviderReplay): Record<string, unknown>[][] {
  return replay.responses ?? [replay.content];
}

export function expandResponsesReplay(
  message: Pick<ChatMessage, "content">,
  replay: ProviderReplay,
): Record<string, unknown>[] {
  return [
    ...replay.content.map((item) => structuredClone(item)),
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: message.content }],
    },
  ];
}

export function containsDeepSeekToolBlocks(blocks: unknown): boolean {
  if (!Array.isArray(blocks)) return false;
  return blocks.some((block) => {
    if (!isSafeRecord(block)) return false;
    if (typeof block.name === "string" && DEEPSEEK_TOOL_NAMES.has(block.name)) return true;
    if ("kind" in block && block.kind !== undefined) return true;
    return false;
  });
}

export function hasResponsesDeepSeekExtension(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasResponsesDeepSeekExtension);
  if (!isSafeRecord(value)) return false;
  if (value.type === "web_search_call" && typeof value.kind === "string" && DEEPSEEK_KINDS.has(value.kind)) {
    return true;
  }
  return false;
}

/**
 * Anthropic DeepSeek server-mode replay pruning:
 * keeps only paired read_link server_tool_use + signed successful web_fetch_tool_result blocks,
 * plus answer text blocks stripped of citations (joining across omitted thinking/search blocks with \n\n).
 */
export function buildAnthropicDeepSeekReplay(
  blocks: Record<string, unknown>[],
  scope: string,
): ProviderReplay | undefined {
  const validFetchIds = new Set<string>();
  for (const block of blocks) {
    if (
      block.type === "web_fetch_tool_result"
      && block.kind === "read_link"
      && typeof block.tool_use_id === "string"
      && block.tool_use_id.trim().length > 0
      && typeof block.signature === "string"
      && block.signature.trim().length > 0
      && isSafeRecord(block.content)
      && block.content.type === "web_fetch_result"
    ) {
      validFetchIds.add(block.tool_use_id);
    }
  }
  if (validFetchIds.size === 0) return undefined;

  const pairedIds = new Set<string>();
  for (const block of blocks) {
    if (
      block.type === "server_tool_use"
      && typeof block.id === "string"
      && validFetchIds.has(block.id)
      && (block.name === "deepseek_read_url" || block.kind === "read_link")
    ) {
      pairedIds.add(block.id);
    }
  }
  if (pairedIds.size === 0) return undefined;

  const pruned: Record<string, unknown>[] = [];
  let omittedSinceLastText = false;
  const seenUseIds = new Set<string>();
  const seenFetchIds = new Set<string>();

  for (const block of blocks) {
    if (
      block.type === "server_tool_use"
      && typeof block.id === "string"
      && pairedIds.has(block.id)
      && (block.name === "deepseek_read_url" || block.kind === "read_link")
      && !seenUseIds.has(block.id)
    ) {
      seenUseIds.add(block.id);
      const kept: Record<string, unknown> = {
        type: "server_tool_use",
        id: block.id,
        name: block.name,
        input: structuredClone(block.input ?? {}),
      };
      if (block.caller !== undefined) kept.caller = structuredClone(block.caller);
      if (block.kind !== undefined) kept.kind = block.kind;
      pruned.push(kept);
      omittedSinceLastText = false;
      continue;
    }

    if (
      block.type === "web_fetch_tool_result"
      && block.kind === "read_link"
      && typeof block.tool_use_id === "string"
      && pairedIds.has(block.tool_use_id)
      && typeof block.signature === "string"
      && block.signature.trim().length > 0
      && isSafeRecord(block.content)
      && block.content.type === "web_fetch_result"
      && !seenFetchIds.has(block.tool_use_id)
    ) {
      seenFetchIds.add(block.tool_use_id);
      pruned.push({
        type: "web_fetch_tool_result",
        tool_use_id: block.tool_use_id,
        kind: block.kind,
        signature: block.signature,
        content: structuredClone(block.content),
      });
      omittedSinceLastText = false;
      continue;
    }

    if (block.type === "text" && typeof block.text === "string") {
      if (!block.text) continue;
      const last = pruned[pruned.length - 1];
      if (last && last.type === "text" && typeof last.text === "string") {
        last.text = `${last.text}${omittedSinceLastText ? "\n\n" : ""}${block.text}`;
      } else {
        pruned.push({ type: "text", text: block.text });
      }
      omittedSinceLastText = false;
      continue;
    }

    const last = pruned[pruned.length - 1];
    if (last && last.type === "text") omittedSinceLastText = true;
  }

  return {
    protocol: "anthropic-native",
    scope,
    content: pruned,
  };
}

/**
 * OpenAI Responses DeepSeek server-mode replay pruning:
 * keeps only completed, signed read_link web_search_call items.
 */
export function buildResponsesDeepSeekReplay(
  output: unknown,
  scope: string,
): ProviderReplay | undefined {
  if (!Array.isArray(output)) return undefined;
  const items: Record<string, unknown>[] = [];
  for (const raw of output) {
    if (!isValidResponsesReadLinkItem(raw)) continue;
    const normalized: Record<string, unknown> = {
      type: "web_search_call",
      ...(raw.id !== undefined ? { id: raw.id } : {}),
      status: "completed",
      kind: "read_link",
      ...(raw.action !== undefined ? { action: structuredClone(raw.action) } : {}),
      ...(raw.page !== undefined ? { page: structuredClone(raw.page) } : {}),
      signature: raw.signature,
    };
    items.push(normalized);
  }
  if (items.length === 0) return undefined;
  return {
    protocol: "openai-responses",
    scope,
    content: items,
  };
}
