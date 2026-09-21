import { numericValue, type SessionConfig } from "./sessionConfig";
import type { StoredChatMessage } from "./repository";
import type { ChatMessage, ChatProtocol } from "./types";
import type { RequestAttachment } from "./attachments";
import { withReplyLinks } from "./messageOperations";

export class ContextBudgetError extends Error {
  constructor(readonly mandatoryTokens: number, readonly budget: number) {
    super(`必保内容估算需 ${mandatoryTokens} Token，超过本地预算 ${budget}；请增加预算或缩短系统指令/最新消息。`);
    this.name = "ContextBudgetError";
  }
}

export interface ContextPlan {
  messages: ChatMessage[];
  keptTurns: number;
  trimmedTurns: number;
  excludedIncompleteTurns: number;
  inputTokens: number;
  countingLabel: string;
  estimated: true;
}

export type ContextSummary = Omit<ContextPlan, "messages">;
export function summarizeContextPlan(plan: ContextPlan): ContextSummary {
  return { keptTurns: plan.keptTurns, trimmedTurns: plan.trimmedTurns,
    excludedIncompleteTurns: plan.excludedIncompleteTurns, inputTokens: plan.inputTokens,
    countingLabel: plan.countingLabel, estimated: plan.estimated };
}

/** Conservative Base64 estimate before loading any retained historical copies. */
export function estimateInlineRequestBytes(messages: ChatMessage[]): number {
  const encoder = new TextEncoder();
  return 1_000_000 + messages.reduce((bytes, message) => bytes + encoder.encode(message.content).length +
    (message.attachments ?? []).reduce((sum, item) => sum + Math.ceil(item.size / 3) * 4 +
      encoder.encode(item.name).length + 200, 0), 0);
}

type TokenCounter = (text: string) => number;

function openAiEncoding(model: string): "o200k_base" | "cl100k_base" | undefined {
  if (/^(gpt-5(?:$|-)|gpt-4o(?:$|-)|gpt-4\.1(?:$|-)|o1(?:$|-)|o3(?:$|-)|o4-mini(?:$|-))/i.test(model)) {
    return "o200k_base";
  }
  if (/^(gpt-4(?:$|-)|gpt-3\.5(?:$|-))/i.test(model)) return "cl100k_base";
  return undefined;
}

export function tokenCountLabel(
  protocol: ChatProtocol,
  model: string,
): string {
  const encoding = (protocol === "openai-chat" || protocol === "openai-responses")
    ? openAiEncoding(model) : undefined;
  return encoding
    ? `${encoding} 本地分词 + 每条消息估算开销`
    : "未知/非 OpenAI 模型：UTF-8 字节保守估算 + 每条消息估算开销";
}

const tokenizerCache = new Map<string, TokenCounter>();

async function loadTokenCounter(protocol: ChatProtocol, model: string): Promise<TokenCounter> {
  const encoding = (protocol === "openai-chat" || protocol === "openai-responses")
    ? openAiEncoding(model) : undefined;
  if (!encoding) {
    const encoder = new TextEncoder();
    return (text) => encoder.encode(text).length;
  }
  const cached = tokenizerCache.get(encoding);
  if (cached) return cached;
  const [{ Tiktoken }, ranks] = await Promise.all([
    import("js-tiktoken/lite"),
    encoding === "o200k_base"
      ? import("js-tiktoken/ranks/o200k_base")
      : import("js-tiktoken/ranks/cl100k_base"),
  ]);
  const tokenizer = new Tiktoken(ranks.default);
  const counter = (text: string) => tokenizer.encode(text).length;
  tokenizerCache.set(encoding, counter);
  return counter;
}

export async function selectTokenCounter(
  protocol: ChatProtocol,
  model: string,
): Promise<{ count: TokenCounter; label: string }> {
  return { count: await loadTokenCounter(protocol, model), label: tokenCountLabel(protocol, model) };
}

interface Round { user: StoredChatMessage; assistant: StoredChatMessage }

function completeRounds(history: StoredChatMessage[]): { rounds: Round[]; excluded: number } {
  const rounds: Round[] = [];
  let pending: StoredChatMessage | undefined;
  let excluded = 0;
  for (const message of withReplyLinks(history)) {
    if (message.role === "user") {
      if (pending) excluded += 1;
      pending = message.status === "complete" && (message.content.trim() || message.attachments?.length) ? message : undefined;
      if (!pending) excluded += 1;
    } else if (message.role === "assistant") {
      if (pending && message.replyToId === pending.id && message.status === "complete" && message.content.trim()) {
        rounds.push({ user: pending, assistant: message });
      } else if (pending) {
        excluded += 1;
      }
      pending = undefined;
    }
  }
  if (pending) excluded += 1;
  return { rounds, excluded };
}

export async function planContextBudget(
  history: StoredChatMessage[],
  latestUser: string,
  config: SessionConfig,
  protocol: ChatProtocol,
  model: string,
  counterOverride?: TokenCounter,
  latestAttachments: RequestAttachment[] = [],
): Promise<ContextPlan> {
  const selected = counterOverride
    ? { count: counterOverride, label: "测试计数器 + 每条消息估算开销" }
    : await selectTokenCounter(protocol, model);
  const count = selected.count;
  // Media tokenization is provider-dependent; include a local, labelled size estimate.
  const messageTokens = (message: ChatMessage) => count(protocol === "anthropic-native" && message.providerReplay
    ? JSON.stringify(message.providerReplay.content) : message.content) + 8 +
    (message.attachments ?? []).reduce((cost, attachment) => cost + Math.ceil(attachment.size / 4), 0);
  const system: ChatMessage | undefined = config.systemInstruction.trim()
    ? { role: "system", content: config.systemInstruction.trim() } : undefined;
  const latest: ChatMessage = { role: "user", content: latestUser,
    ...(latestAttachments.length ? { attachments: latestAttachments } : {}) };
  const mandatory = (system ? messageTokens(system) : 0) + messageTokens(latest);
  const budget = numericValue(config.contextBudget);
  if (budget !== undefined && mandatory > budget) throw new ContextBudgetError(mandatory, budget);

  const { rounds, excluded } = completeRounds(history);
  let tokens = mandatory;
  const kept: Round[] = [];
  for (let index = rounds.length - 1; index >= 0; index -= 1) {
    const round = rounds[index];
    const cost = messageTokens(round.user) + messageTokens(round.assistant);
    if (budget !== undefined && tokens + cost > budget) break;
    kept.unshift(round);
    tokens += cost;
  }
  return {
    messages: [
      ...kept.flatMap((round) => [
        { role: "user" as const, content: round.user.content,
          ...(round.user.attachments?.length ? { attachments: round.user.attachments } : {}) },
        { role: "assistant" as const, content: round.assistant.content,
          ...(protocol === "anthropic-native" && round.assistant.providerReplay ? { providerReplay: round.assistant.providerReplay } : {}) },
      ]),
      latest,
    ],
    keptTurns: kept.length,
    trimmedTurns: rounds.length - kept.length,
    excludedIncompleteTurns: excluded,
    inputTokens: tokens,
    countingLabel: selected.label,
    estimated: true,
  };
}
