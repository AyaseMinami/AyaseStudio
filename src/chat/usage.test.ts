import { describe, expect, it } from "vitest";
import { mergeTokenUsage, normalizeTokenUsage } from "./usage";
import { readGenerationMetricsData } from "./generationMetricsData";
import type { ChatProtocol } from "./types";

describe("token usage normalization", () => {
  it("prefers standard cached tokens including explicit zero over DeepSeek aliases", () => {
    expect(normalizeTokenUsage("openai-chat", {
      prompt_tokens: 12, completion_tokens: 5, total_tokens: 17,
      prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 2 }, prompt_cache_hit_tokens: 8,
      completion_tokens_details: { reasoning_tokens: 2 },
    })).toEqual({ inputTokens: 12, outputTokens: 5, totalTokens: 17, cacheReadTokens: 0, cacheWriteTokens: 2, reasoningTokens: 2 });
    expect(normalizeTokenUsage("openai-chat", { prompt_cache_hit_tokens: 8 })).toEqual({ cacheReadTokens: 8 });
  });

  it("normalizes Responses detail counts", () => {
    expect(normalizeTokenUsage("openai-responses", {
      input_tokens: 10, output_tokens: 4, total_tokens: 14,
      input_tokens_details: { cached_tokens: 6, cache_write_tokens: 2 },
      output_tokens_details: { reasoning_tokens: 3 },
    })).toEqual({ inputTokens: 10, outputTokens: 4, totalTokens: 14, cacheReadTokens: 6, cacheWriteTokens: 2, reasoningTokens: 3 });
  });

  it("preserves absent Anthropic cache buckets and merges cumulative observations", () => {
    const start = normalizeTokenUsage("anthropic-native", { input_tokens: 3, output_tokens: 0, cache_read_input_tokens: 8 });
    expect(start).toEqual({ uncachedInputTokens: 3, outputTokens: 0, cacheReadTokens: 8 });
    const next = mergeTokenUsage(start, normalizeTokenUsage("anthropic-native", { cache_creation_input_tokens: 2, output_tokens: 5 }));
    expect(next).toEqual({ uncachedInputTokens: 3, inputTokens: 13, outputTokens: 5, cacheReadTokens: 8, cacheWriteTokens: 2 });
    expect(mergeTokenUsage(next, { outputTokens: 7 })).toEqual({ ...next, outputTokens: 7 });
    expect(normalizeTokenUsage("anthropic-native", { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })).toEqual({ uncachedInputTokens: 0, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
  });

  it("counts Gemini output including thoughts without assuming missing thoughts are zero", () => {
    expect(normalizeTokenUsage("gemini-native", { promptTokenCount: 10, candidatesTokenCount: 4, thoughtsTokenCount: 3, totalTokenCount: 17, cachedContentTokenCount: 6 }))
      .toEqual({ inputTokens: 10, outputTokens: 7, reasoningTokens: 3, totalTokens: 17, cacheReadTokens: 6 });
    expect(normalizeTokenUsage("gemini-native", { promptTokenCount: 10, candidatesTokenCount: 4 })).toEqual({ inputTokens: 10 });
    expect(normalizeTokenUsage("gemini-native", { promptTokenCount: 10, candidatesTokenCount: 4, totalTokenCount: 18 }))
      .toEqual({ inputTokens: 10, outputTokens: 8, totalTokens: 18 });
    expect(normalizeTokenUsage("gemini-native", { promptTokenCount: 10, candidatesTokenCount: 4, totalTokenCount: 12 }))
      .toEqual({ inputTokens: 10, totalTokens: 12 });
    expect(normalizeTokenUsage("gemini-native", { candidatesTokenCount: 4, thoughtsTokenCount: 0 })).toEqual({ outputTokens: 4, reasoningTokens: 0 });
  });

  it.each([undefined, null, "bad", [], { prompt_tokens: -1, completion_tokens: 1.1, total_tokens: Number.POSITIVE_INFINITY }])("ignores invalid metadata %j", (value) => {
    expect(normalizeTokenUsage("openai-chat", value)).toBeUndefined();
  });

  it("drops contradictory optional details and guards overflow", () => {
    expect(normalizeTokenUsage("openai-responses", {
      input_tokens: 10, output_tokens: 4, total_tokens: 12,
      input_tokens_details: { cached_tokens: 9, cache_write_tokens: 2 }, output_tokens_details: { reasoning_tokens: 5 },
    })).toEqual({ inputTokens: 10, outputTokens: 4 });
    expect(normalizeTokenUsage("anthropic-native", { input_tokens: Number.MAX_SAFE_INTEGER, cache_read_input_tokens: 1, cache_creation_input_tokens: 0 })).toEqual({ uncachedInputTokens: Number.MAX_SAFE_INTEGER });
    expect(mergeTokenUsage({ inputTokens: 10 }, { inputTokens: undefined, outputTokens: NaN })).toEqual({ inputTokens: 10 });
  });

  it("normalizes impossible combinations into persistable limited observations", () => {
    const cases: Array<{ protocol: ChatProtocol; raw: unknown }> = [
      { protocol: "anthropic-native", raw: { input_tokens: Number.MAX_SAFE_INTEGER, cache_read_input_tokens: 1 } },
      { protocol: "anthropic-native", raw: { cache_read_input_tokens: Number.MAX_SAFE_INTEGER, cache_creation_input_tokens: 1 } },
      { protocol: "anthropic-native", raw: { input_tokens: Number.MAX_SAFE_INTEGER, cache_read_input_tokens: 1, cache_creation_input_tokens: 0 } },
      { protocol: "openai-chat", raw: { prompt_tokens: Number.MAX_SAFE_INTEGER, completion_tokens: 1, total_tokens: Number.MAX_SAFE_INTEGER } },
      { protocol: "openai-responses", raw: { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 1 } },
      { protocol: "openai-chat", raw: { prompt_tokens: 10, total_tokens: 5 } },
      { protocol: "openai-chat", raw: { completion_tokens: 10, total_tokens: 5 } },
      { protocol: "openai-chat", raw: { prompt_tokens_details: { cached_tokens: Number.MAX_SAFE_INTEGER, cache_write_tokens: 1 } } },
    ];
    for (const { protocol, raw } of cases) {
      const usage = normalizeTokenUsage(protocol, raw);
      expect(() => readGenerationMetricsData({ version: 1, protocol, streaming: true, status: "complete", elapsedMs: 0, usageComplete: usage?.outputTokens !== undefined, ...(usage ? { usage } : {}) })).not.toThrow();
    }
    expect(normalizeTokenUsage("openai-chat", { prompt_tokens: Number.MAX_SAFE_INTEGER, completion_tokens: 1 })).toEqual({ inputTokens: Number.MAX_SAFE_INTEGER });
    const merged = mergeTokenUsage({ uncachedInputTokens: Number.MAX_SAFE_INTEGER }, { cacheReadTokens: 1 });
    expect(merged).toEqual({ uncachedInputTokens: Number.MAX_SAFE_INTEGER });
    expect(() => readGenerationMetricsData({ version: 1, protocol: "anthropic-native", streaming: true, status: "complete", elapsedMs: 0, usageComplete: false, usage: merged })).not.toThrow();
  });

  it.each(["openai-chat", "openai-responses", "anthropic-native", "gemini-native"] as ChatProtocol[])("never coerces strings or unsafe counts for %s", (protocol) => {
    const raw = { prompt_tokens: "1", input_tokens: Number.MAX_SAFE_INTEGER + 1, promptTokenCount: NaN, output_tokens: -1, completion_tokens: null, candidatesTokenCount: false };
    expect(normalizeTokenUsage(protocol, raw)).toBeUndefined();
  });
});
