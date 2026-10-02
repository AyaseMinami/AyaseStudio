import type { ChatProtocol, TokenUsage } from "./types";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value : undefined;
}

function sum(...values: Array<number | undefined>): number | undefined {
  if (values.some((value) => value === undefined)) return undefined;
  return count(values.reduce<number>((total, value) => total + value!, 0));
}

function validated(usage: TokenUsage): TokenUsage | undefined {
  const result: TokenUsage = {};
  for (const key of Object.keys(usage) as Array<keyof TokenUsage>) {
    const value = count(usage[key]);
    if (value !== undefined) result[key] = value;
  }
  const knownPrompt = sum(result.uncachedInputTokens ?? 0, result.cacheReadTokens ?? 0, result.cacheWriteTokens ?? 0);
  if (knownPrompt === undefined) {
    delete result.cacheReadTokens;
    delete result.cacheWriteTokens;
  }
  if (result.uncachedInputTokens !== undefined) {
    const input = sum(result.uncachedInputTokens, result.cacheReadTokens, result.cacheWriteTokens);
    if (input !== undefined) result.inputTokens = input;
    else delete result.inputTokens;
  }
  if (result.inputTokens !== undefined) {
    const cached = (result.cacheReadTokens ?? 0) + (result.cacheWriteTokens ?? 0);
    if (!Number.isSafeInteger(cached) || cached > result.inputTokens) {
      delete result.cacheReadTokens;
      delete result.cacheWriteTokens;
    }
  }
  if (result.outputTokens !== undefined && result.reasoningTokens !== undefined && result.reasoningTokens > result.outputTokens) {
    delete result.reasoningTokens;
  }
  // Even independently valid core counts can have an impossible combined total.
  // Keep the prompt observation and omit the output count that cannot fit with it.
  let knownTotal = sum(result.inputTokens ?? 0, result.outputTokens ?? 0);
  if (knownTotal === undefined) {
    delete result.outputTokens;
    knownTotal = result.inputTokens ?? 0;
  }
  if (result.totalTokens !== undefined && knownTotal > result.totalTokens) {
    delete result.totalTokens;
  }
  return Object.keys(result).length ? result : undefined;
}

/** Usage snapshots are cumulative observations, never increments to add together. */
export function mergeTokenUsage(previous: TokenUsage | undefined, next: TokenUsage | undefined): TokenUsage | undefined {
  const supplied: TokenUsage = {};
  for (const key of Object.keys(next ?? {}) as Array<keyof TokenUsage>) {
    const value = count(next?.[key]);
    if (value !== undefined) supplied[key] = value;
  }
  return validated({ ...previous, ...supplied });
}

/** Malformed optional metadata must never make otherwise readable output fail. */
export function normalizeTokenUsage(protocol: ChatProtocol, value: unknown): TokenUsage | undefined {
  const raw = record(value);
  if (protocol === "openai-chat") {
    const inputDetails = record(raw.prompt_tokens_details);
    const outputDetails = record(raw.completion_tokens_details);
    return validated({
      inputTokens: count(raw.prompt_tokens), outputTokens: count(raw.completion_tokens), totalTokens: count(raw.total_tokens),
      cacheReadTokens: count(inputDetails.cached_tokens) ?? count(raw.prompt_cache_hit_tokens),
      cacheWriteTokens: count(inputDetails.cache_write_tokens),
      reasoningTokens: count(outputDetails.reasoning_tokens),
    });
  }
  if (protocol === "openai-responses") {
    const inputDetails = record(raw.input_tokens_details);
    const outputDetails = record(raw.output_tokens_details);
    return validated({
      inputTokens: count(raw.input_tokens), outputTokens: count(raw.output_tokens), totalTokens: count(raw.total_tokens),
      cacheReadTokens: count(inputDetails.cached_tokens), cacheWriteTokens: count(inputDetails.cache_write_tokens),
      reasoningTokens: count(outputDetails.reasoning_tokens),
    });
  }
  if (protocol === "anthropic-native") {
    return validated({
      uncachedInputTokens: count(raw.input_tokens), outputTokens: count(raw.output_tokens),
      cacheReadTokens: count(raw.cache_read_input_tokens), cacheWriteTokens: count(raw.cache_creation_input_tokens),
    });
  }
  const inputTokens = count(raw.promptTokenCount);
  const candidates = count(raw.candidatesTokenCount);
  const reasoningTokens = count(raw.thoughtsTokenCount);
  const totalTokens = count(raw.totalTokenCount);
  let outputTokens = sum(candidates, reasoningTokens);
  if (outputTokens === undefined && totalTokens !== undefined && inputTokens !== undefined) {
    const derived = count(totalTokens - inputTokens);
    if (derived !== undefined && (candidates === undefined || derived >= candidates)) outputTokens = derived;
  }
  return validated({ inputTokens, outputTokens, totalTokens, cacheReadTokens: count(raw.cachedContentTokenCount), reasoningTokens });
}
