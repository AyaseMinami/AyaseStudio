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

  it("normalizes Anthropic output_tokens_details.thinking_tokens and ignores safety_tokens", () => {
    expect(normalizeTokenUsage("anthropic-native", {
      input_tokens: 10, cache_read_input_tokens: 6, cache_creation_input_tokens: 0, output_tokens: 50,
      output_tokens_details: { thinking_tokens: 18, safety_tokens: 4 },
    })).toEqual({
      uncachedInputTokens: 10, inputTokens: 16, cacheReadTokens: 6, cacheWriteTokens: 0, outputTokens: 50, reasoningTokens: 18,
    });
    expect(normalizeTokenUsage("anthropic-native", {
      output_tokens: 50, output_tokens_details: { thinking_tokens: 0 },
    })).toEqual({ outputTokens: 50, reasoningTokens: 0 });
    expect(normalizeTokenUsage("anthropic-native", {
      output_tokens: 0, output_tokens_details: { thinking_tokens: 0 },
    })).toEqual({ outputTokens: 0, reasoningTokens: 0 });
    expect(normalizeTokenUsage("anthropic-native", {
      output_tokens: 18, output_tokens_details: { thinking_tokens: 18 },
    })).toEqual({ outputTokens: 18, reasoningTokens: 18 });
    expect(normalizeTokenUsage("anthropic-native", { output_tokens: 50 })).toEqual({ outputTokens: 50 });
    expect(normalizeTokenUsage("anthropic-native", {
      output_tokens: 50, output_tokens_details: { safety_tokens: 4 },
    })).toEqual({ outputTokens: 50 });
  });

  it("rejects invalid, out-of-range, or unanchored Anthropic thinking_tokens", () => {
    for (const details of [
      { thinking_tokens: -1 },
      { thinking_tokens: 1.5 },
      { thinking_tokens: "5" },
      { thinking_tokens: Number.MAX_SAFE_INTEGER + 1 },
      { thinking_tokens: 51 },
      null,
      "bad",
      [],
      42,
    ]) {
      expect(normalizeTokenUsage("anthropic-native", { output_tokens: 50, output_tokens_details: details }))
        .toEqual({ outputTokens: 50 });
    }
    expect(normalizeTokenUsage("anthropic-native", {
      output_tokens: -1, output_tokens_details: { thinking_tokens: 18 },
    })).toBeUndefined();
    expect(normalizeTokenUsage("anthropic-native", {
      output_tokens: "5", output_tokens_details: { thinking_tokens: 3 },
    })).toBeUndefined();
    expect(normalizeTokenUsage("anthropic-native", {
      output_tokens_details: { thinking_tokens: 18 },
    })).toBeUndefined();
    expect(normalizeTokenUsage("anthropic-native", {
      input_tokens: 12, output_tokens: -1, output_tokens_details: { thinking_tokens: 18 },
    })).toEqual({ uncachedInputTokens: 12 });
    expect(normalizeTokenUsage("anthropic-native", {
      input_tokens: 12, output_tokens_details: { thinking_tokens: 18 },
    })).toEqual({ uncachedInputTokens: 12 });
  });

  it("replaces Anthropic output-level details atomically when replaceOutput is enabled", () => {
    const start = normalizeTokenUsage("anthropic-native", {
      input_tokens: 3, cache_read_input_tokens: 6, cache_creation_input_tokens: 1, output_tokens: 0,
    });
    const firstDelta = mergeTokenUsage(start, normalizeTokenUsage("anthropic-native", {
      output_tokens: 20, output_tokens_details: { thinking_tokens: 5 },
    }), { replaceOutput: true });
    expect(firstDelta).toEqual({
      uncachedInputTokens: 3, inputTokens: 10, cacheReadTokens: 6, cacheWriteTokens: 1, outputTokens: 20, reasoningTokens: 5,
    });

    const cleared = mergeTokenUsage(firstDelta, normalizeTokenUsage("anthropic-native", { output_tokens: 50 }), { replaceOutput: true });
    expect(cleared).toEqual({
      uncachedInputTokens: 3, inputTokens: 10, cacheReadTokens: 6, cacheWriteTokens: 1, outputTokens: 50,
    });
    expect(cleared).not.toHaveProperty("reasoningTokens");

    const zeroed = mergeTokenUsage(firstDelta, normalizeTokenUsage("anthropic-native", {
      output_tokens: 50, output_tokens_details: { thinking_tokens: 0 },
    }), { replaceOutput: true });
    expect(zeroed).toEqual({
      uncachedInputTokens: 3, inputTokens: 10, cacheReadTokens: 6, cacheWriteTokens: 1, outputTokens: 50, reasoningTokens: 0,
    });

    const preserved = mergeTokenUsage(firstDelta, { uncachedInputTokens: 4, outputTokens: NaN, reasoningTokens: 18 }, { replaceOutput: true });
    expect(preserved).toEqual({
      uncachedInputTokens: 4, inputTokens: 11, cacheReadTokens: 6, cacheWriteTokens: 1, outputTokens: 20, reasoningTokens: 5,
    });

    const overflowed = mergeTokenUsage(
      { uncachedInputTokens: Number.MAX_SAFE_INTEGER - 30, inputTokens: Number.MAX_SAFE_INTEGER - 30, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 20, reasoningTokens: 5 },
      { outputTokens: 50, reasoningTokens: 10 },
      { replaceOutput: true },
    );
    expect(overflowed).toEqual({
      uncachedInputTokens: Number.MAX_SAFE_INTEGER - 30, inputTokens: Number.MAX_SAFE_INTEGER - 30, cacheReadTokens: 0, cacheWriteTokens: 0,
    });
    expect(overflowed).not.toHaveProperty("outputTokens");
    expect(overflowed).not.toHaveProperty("reasoningTokens");

    for (const usage of [firstDelta, cleared, zeroed, preserved, overflowed]) {
      expect(() => readGenerationMetricsData({
        version: 1, protocol: "anthropic-native", streaming: true, status: "complete", elapsedMs: 10,
        usageComplete: usage?.outputTokens !== undefined, usage,
      })).not.toThrow();
    }
  });
});
