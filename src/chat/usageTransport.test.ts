import { describe, expect, it, vi } from "vitest";
import { createChatTransport } from "./transport";
import { defaultSessionConfig } from "./sessionConfig";
import { GenerationMeasurement } from "./generationMetrics";
import { readGenerationMetricsData } from "./generationMetricsData";
import { defaultThinking, withThinkingSettings } from "./thinking";
import type { ChatEvent, ChatProtocol, ChatRequest, TokenUsage } from "./types";

const request: ChatRequest = {
  baseUrl: "https://relay.example/v1", apiKey: "synthetic-key", model: "test-model",
  messages: [{ role: "user", content: "Hello" }],
};
const protocols: ChatProtocol[] = ["openai-chat", "openai-responses", "anthropic-native", "gemini-native"];

function sse(records: unknown[]): Response {
  const text = records.map((record) => record === "[DONE]" ? "data: [DONE]\n\n" :
    `${typeof record === "object" && record !== null && "type" in record ? `event: ${record.type}\n` : ""}data: ${JSON.stringify(record)}\n\n`).join("");
  return new Response(text, { headers: { "content-type": "text/event-stream" } });
}
function terminalEvents(events: ChatEvent[]): ChatEvent[] {
  return events.filter((event) => ["completed", "aborted", "failed"].includes(event.type));
}
async function collect(protocol: ChatProtocol, response: Response, config?: ChatRequest["config"]): Promise<ChatEvent[]> {
  const fetch = vi.fn(async () => response);
  const result: ChatEvent[] = [];
  for await (const event of createChatTransport(protocol, { fetch }).stream({ ...request, config })) result.push(event);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(terminalEvents(result)).toHaveLength(1);
  expect(terminalEvents(result)[0]).toBe(result[result.length - 1]);
  return result;
}
const nativeUsage = { input_tokens: 3, cache_read_input_tokens: 6, cache_creation_input_tokens: 1, output_tokens: 5 };
const expectedNative = { uncachedInputTokens: 3, inputTokens: 10, cacheReadTokens: 6, cacheWriteTokens: 1, outputTokens: 5 };

describe("transport usage observations", () => {
  it("reads Chat usage-only empty-choice chunks after finish_reason through DONE", async () => {
    const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15, cacheReadTokens: 6, cacheWriteTokens: 1, reasoningTokens: 2 };
    const events = await collect("openai-chat", sse([
      { choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: "stop" }] },
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_tokens_details: { cached_tokens: 6, cache_write_tokens: 1 }, completion_tokens_details: { reasoning_tokens: 2 } } }, "[DONE]",
    ]));
    expect(events).toEqual([{ type: "text-delta", text: "Hi" }, { type: "usage-update", usage }, { type: "completed", finishReason: "stop", usage }]);
  });

  it("reads Gemini final usage-only records after finishReason", async () => {
    const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15, cacheReadTokens: 6, reasoningTokens: 2 };
    const events = await collect("gemini-native", sse([
      { candidates: [{ content: { parts: [{ text: "Hi" }] }, finishReason: "STOP" }] },
      { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, thoughtsTokenCount: 2, totalTokenCount: 15, cachedContentTokenCount: 6 } },
    ]));
    expect(events).toEqual([{ type: "text-delta", text: "Hi" }, { type: "usage-update", usage }, { type: "completed", finishReason: "STOP", usage }]);
  });

  it("merges Anthropic usage_start and cumulative usage_delta without addition", async () => {
    const events = await collect("anthropic-native", sse([
      { type: "message_start", message: { usage: { ...nativeUsage, output_tokens: 0 } } },
      { type: "message_delta", usage: { output_tokens: 2 } },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } },
      { type: "message_stop" }, { type: "message_delta", usage: { output_tokens: 99 } },
    ]));
    expect(events).toEqual([
      { type: "usage-update", usage: { ...expectedNative, outputTokens: 0 } },
      { type: "usage-update", usage: { ...expectedNative, outputTokens: 2 } },
      { type: "usage-update", usage: expectedNative },
      { type: "completed", finishReason: "end_turn", usage: expectedNative },
    ]);
  });

  it.each([undefined, { output_tokens: -1 }, { output_tokens: "5" }])("keeps Anthropic start-only output partial when stop delta has invalid or absent usage %j", async (terminalUsage) => {
    const events = await collect("anthropic-native", sse([
      { type: "message_start", message: { usage: { ...nativeUsage, output_tokens: 0 } } },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: terminalUsage },
      { type: "message_stop" },
    ]));
    expect(events[0]).toEqual({ type: "usage-update", usage: { ...expectedNative, outputTokens: 0 } });
    const final = events[events.length - 1];
    expect(final).toMatchObject({ type: "completed", finishReason: "end_turn", usage: { inputTokens: 10, uncachedInputTokens: 3, cacheReadTokens: 6, cacheWriteTokens: 1 } });
    if (final.type === "completed") expect(final.usage).not.toHaveProperty("outputTokens");
    const measurement = new GenerationMeasurement("anthropic-native", true, () => 0);
    events.forEach(event => measurement.observe(event));
    expect(measurement.snapshot("complete")).toMatchObject({ usage: { ...expectedNative, outputTokens: 0 }, usageComplete: false });
  });

  it("keeps an Anthropic nonterminal output observation partial", async () => {
    const events = await collect("anthropic-native", sse([
      { type: "message_start", message: { usage: { input_tokens: 3, output_tokens: 0 } } },
      { type: "message_delta", usage: { output_tokens: 2 } },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
      { type: "message_stop" },
    ]));
    expect(events[events.length - 1]).toEqual({ type: "completed", finishReason: "end_turn", usage: { uncachedInputTokens: 3 } });
    const measurement = new GenerationMeasurement("anthropic-native", true, () => 0);
    events.forEach(event => measurement.observe(event));
    expect(measurement.snapshot("complete")).toMatchObject({ usage: { uncachedInputTokens: 3, outputTokens: 2 }, usageComplete: false });
  });

  it("treats explicit Anthropic terminal output zero as final", async () => {
    const events = await collect("anthropic-native", sse([
      { type: "message_start", message: { usage: { input_tokens: 3, output_tokens: 0 } } },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 0 } },
      { type: "message_stop" },
    ]));
    expect(events[events.length - 1]).toEqual({ type: "completed", finishReason: "end_turn", usage: { uncachedInputTokens: 3, outputTokens: 0 } });
    const measurement = new GenerationMeasurement("anthropic-native", true, () => 0);
    events.forEach(event => measurement.observe(event));
    expect(measurement.snapshot("complete")).toMatchObject({ usage: { uncachedInputTokens: 3, outputTokens: 0 }, usageComplete: true });
  });

  it.each(["response.completed", "response.incomplete", "response.failed"])("emits Responses final usage before %s and ignores subsequent records", async (type) => {
    const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15, cacheReadTokens: 6, cacheWriteTokens: 1, reasoningTokens: 2 };
    const events = await collect("openai-responses", sse([
      { type: "response.output_text.delta", delta: "partial", output_index: 0, content_index: 0 },
      { type, response: { output: [], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 6, cache_write_tokens: 1 }, output_tokens_details: { reasoning_tokens: 2 } }, error: { code: "server_error", message: "failed" }, incomplete_details: { reason: "max_output_tokens" } } },
      { type: "response.output_text.delta", delta: "late", output_index: 0, content_index: 0 },
    ]));
    expect(events[1]).toEqual({ type: "usage-update", usage });
    if (type === "response.failed") expect(events[events.length - 1]).toMatchObject({ type: "failed" });
    else expect(events[events.length - 1]).toMatchObject({ type: "completed", usage });
    expect(events).toHaveLength(3);
  });

  it.each(["response.completed", "response.incomplete"])("keeps prior Responses observations partial when %s has no usage", async (type) => {
    const events = await collect("openai-responses", sse([
      { type: "response.created", response: { usage: { input_tokens: 10, output_tokens: 0 } } },
      { type, response: { output: [], incomplete_details: { reason: "max_output_tokens" } } },
    ]));
    expect(events[0]).toEqual({ type: "usage-update", usage: { inputTokens: 10, outputTokens: 0 } });
    expect(events[events.length - 1]).toMatchObject({ type: "completed" });
    expect(events[events.length - 1]).not.toHaveProperty("usage");
    const measurement = new GenerationMeasurement("openai-responses", true, () => 0);
    events.forEach(event => measurement.observe(event));
    expect(measurement.snapshot(type === "response.completed" ? "complete" : "incomplete")).toMatchObject({ usage: { inputTokens: 10, outputTokens: 0 }, usageComplete: false });
  });

  it.each(["response.completed", "response.incomplete"])("keeps earlier Responses output partial when %s confirms only input", async (type) => {
    const events = await collect("openai-responses", sse([
      { type: "response.created", response: { usage: { input_tokens: 10, output_tokens: 3 } } },
      { type, response: { output: [], usage: { input_tokens: 10 }, incomplete_details: { reason: "max_output_tokens" } } },
    ]));
    const final = events[events.length - 1];
    expect(final).toMatchObject({ type: "completed", usage: { inputTokens: 10 } });
    if (final.type === "completed") expect(final.usage).not.toHaveProperty("outputTokens");
    const measurement = new GenerationMeasurement("openai-responses", true, () => 0);
    events.forEach(event => measurement.observe(event));
    expect(measurement.snapshot(type === "response.completed" ? "complete" : "incomplete")).toMatchObject({ usage: { inputTokens: 10, outputTokens: 3 }, usageComplete: false });
  });

  const nonStreaming: Record<ChatProtocol, { body: unknown; expected: TokenUsage }> = {
    "openai-chat": { body: { choices: [{ message: { content: "Hi" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_cache_hit_tokens: 6 } }, expected: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cacheReadTokens: 6 } },
    "openai-responses": { body: { status: "completed", output_text: "Hi", output: [{ type: "message", content: [{ type: "output_text", text: "Hi" }] }], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }, expected: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
    "anthropic-native": { body: { type: "message", content: [{ type: "text", text: "Hi" }], stop_reason: "end_turn", usage: nativeUsage }, expected: expectedNative },
    "gemini-native": { body: { candidates: [{ content: { parts: [{ text: "Hi" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 15 } }, expected: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
  };
  it.each(protocols)("normalizes non-stream %s metadata", async (protocol) => {
    const { body, expected } = nonStreaming[protocol];
    const events = await collect(protocol, new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }), { ...defaultSessionConfig(), stream: false });
    expect(events).toContainEqual({ type: "usage-update", usage: expected });
    expect(events[events.length - 1]).toMatchObject({ type: "completed", usage: expected });
  });
  it.each(protocols)("allows %s non-stream answers when usage is missing or invalid", async (protocol) => {
    for (const invalid of [undefined, { prompt_tokens: -1, input_tokens: "10", output_tokens: null, promptTokenCount: 1.5, candidatesTokenCount: -1 }]) {
      const body = { ...nonStreaming[protocol].body as Record<string, unknown>, usage: invalid, usageMetadata: invalid };
      const events = await collect(protocol, new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }), { ...defaultSessionConfig(), stream: false });
      expect(events.some((event) => event.type === "usage-update")).toBe(false);
      expect(events[events.length - 1]).toMatchObject({ type: "completed" });
      expect(events[events.length - 1]).not.toHaveProperty("usage");
    }
  });
  it.each(protocols)("honors cancellation after %s non-stream usage before emitting content", async (protocol) => {
    const controller = new AbortController();
    const fetch = vi.fn(async () => new Response(JSON.stringify(nonStreaming[protocol].body), { headers: { "content-type": "application/json" } }));
    const events: ChatEvent[] = [];
    for await (const event of createChatTransport(protocol, { fetch }).stream({ ...request, signal: controller.signal, config: { ...defaultSessionConfig(), stream: false } })) {
      events.push(event);
      if (event.type === "usage-update") controller.abort();
    }
    expect(events).toEqual([{ type: "usage-update", usage: nonStreaming[protocol].expected }, { type: "aborted" }]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  const observed: Record<ChatProtocol, unknown> = {
    "openai-chat": { choices: [], usage: { prompt_tokens: 0, completion_tokens: 2 } },
    "openai-responses": { type: "response.created", response: { usage: { input_tokens: 0, output_tokens: 2 } } },
    "anthropic-native": { type: "message_start", message: { usage: { input_tokens: 0, output_tokens: 2 } } },
    "gemini-native": { usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 2, thoughtsTokenCount: 0 } },
  };
  it.each(protocols)("retains already observed %s usage on truncated stream failure without retry", async (protocol) => {
    const events = await collect(protocol, sse([observed[protocol]]));
    expect(events[0]).toMatchObject({ type: "usage-update", usage: { outputTokens: 2 } });
    expect(events[events.length - 1]).toMatchObject({ type: "failed" });
  });
  it.each(protocols)("retains already observed %s usage on cancellation without retry", async (protocol) => {
    const controller = new AbortController();
    const fetch = vi.fn(async () => sse([observed[protocol]]));
    const events: ChatEvent[] = [];
    for await (const event of createChatTransport(protocol, { fetch }).stream({ ...request, signal: controller.signal })) {
      events.push(event);
      if (event.type === "usage-update") controller.abort();
    }
    expect(events[0]).toMatchObject({ type: "usage-update", usage: { outputTokens: 2 } });
    expect(events[events.length - 1]).toEqual({ type: "aborted" });
    expect(terminalEvents(events)).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not fail readable Chat output on malformed optional usage", async () => {
    const events = await collect("openai-chat", sse([
      { choices: [{ delta: { content: "Hi" }, finish_reason: "stop" }], usage: { prompt_tokens: "10", completion_tokens: -1, total_tokens: 1.5, prompt_tokens_details: "bad" } }, "[DONE]",
    ]));
    expect(events).toEqual([{ type: "text-delta", text: "Hi" }, { type: "completed", finishReason: "stop" }]);
  });

  it("merges DeepSeek Anthropic streaming thinking_tokens cumulatively without addition and ignores safety_tokens", async () => {
    const events = await collect("anthropic-native", sse([
      { type: "message_start", message: { usage: { input_tokens: 10, cache_read_input_tokens: 6, cache_creation_input_tokens: 0, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "step 1" } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "answer" } },
      { type: "content_block_stop", index: 1 },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: {
          input_tokens: 10, cache_read_input_tokens: 6, cache_creation_input_tokens: 0, output_tokens: 50,
          output_tokens_details: { thinking_tokens: 18, safety_tokens: 4 },
        },
      },
      { type: "message_stop" },
    ]));
    const expected = {
      uncachedInputTokens: 10, inputTokens: 16, cacheReadTokens: 6, cacheWriteTokens: 0, outputTokens: 50, reasoningTokens: 18,
    };
    const updates = events.filter((event) => event.type === "usage-update");
    expect(updates).toEqual([
      { type: "usage-update", usage: { uncachedInputTokens: 10, inputTokens: 16, cacheReadTokens: 6, cacheWriteTokens: 0, outputTokens: 0 } },
      { type: "usage-update", usage: expected },
    ]);
    expect(events[events.length - 1]).toEqual({ type: "completed", finishReason: "end_turn", usage: expected });
    const measurement = new GenerationMeasurement("anthropic-native", true, () => 0);
    events.forEach((event) => measurement.observe(event));
    const snapshot = measurement.snapshot("complete");
    expect(snapshot).toMatchObject({ usage: expected, usageComplete: true });
    expect(() => readGenerationMetricsData(snapshot)).not.toThrow();
  });

  it("prevents stale Anthropic thinking_tokens from leaking across multi-delta streams", async () => {
    const start = { type: "message_start", message: { usage: { ...nativeUsage, output_tokens: 0 } } };
    const early = { type: "message_delta", usage: { output_tokens: 20, output_tokens_details: { thinking_tokens: 5 } } };
    const inputOnly = { uncachedInputTokens: 3, inputTokens: 10, cacheReadTokens: 6, cacheWriteTokens: 1 };

    const run = async (tail: unknown[]) => {
      const events = await collect("anthropic-native", sse([start, early, ...tail, { type: "message_stop" }]));
      const updates = events.filter((event): event is Extract<ChatEvent, { type: "usage-update" }> => event.type === "usage-update").map((event) => event.usage);
      const measurement = new GenerationMeasurement("anthropic-native", true, () => 0);
      events.forEach((event) => measurement.observe(event));
      const snapshot = measurement.snapshot("complete");
      expect(() => readGenerationMetricsData(snapshot)).not.toThrow();
      return { events, updates, final: events[events.length - 1], snapshot };
    };
    const baseUpdates = [{ ...inputOnly, outputTokens: 0 }, { ...inputOnly, outputTokens: 20, reasoningTokens: 5 }];

    const missingDetails = await run([{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 50 } }]);
    expect(missingDetails.updates).toEqual([...baseUpdates, { ...inputOnly, outputTokens: 50 }]);
    expect(missingDetails.final).toEqual({ type: "completed", finishReason: "end_turn", usage: { ...inputOnly, outputTokens: 50 } });
    expect(missingDetails.snapshot).toMatchObject({ usage: { ...inputOnly, outputTokens: 50 }, usageComplete: true });
    expect(missingDetails.snapshot.usage).not.toHaveProperty("reasoningTokens");

    const outOfRange = await run([{
      type: "message_delta", delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 50, output_tokens_details: { thinking_tokens: 99 } },
    }]);
    expect(outOfRange.updates).toEqual([...baseUpdates, { ...inputOnly, outputTokens: 50 }]);
    expect(outOfRange.final).toEqual({ type: "completed", finishReason: "end_turn", usage: { ...inputOnly, outputTokens: 50 } });
    expect(outOfRange.snapshot).toMatchObject({ usage: { ...inputOnly, outputTokens: 50 }, usageComplete: true });
    expect(outOfRange.snapshot.usage).not.toHaveProperty("reasoningTokens");

    const explicitZero = await run([{
      type: "message_delta", delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 50, output_tokens_details: { thinking_tokens: 0 } },
    }]);
    expect(explicitZero.updates).toEqual([...baseUpdates, { ...inputOnly, outputTokens: 50, reasoningTokens: 0 }]);
    expect(explicitZero.final).toEqual({
      type: "completed", finishReason: "end_turn", usage: { ...inputOnly, outputTokens: 50, reasoningTokens: 0 },
    });
    expect(explicitZero.snapshot).toMatchObject({
      usage: { ...inputOnly, outputTokens: 50, reasoningTokens: 0 }, usageComplete: true,
    });

    const noUsage = await run([{ type: "message_delta", delta: { stop_reason: "end_turn" } }]);
    expect(noUsage.updates).toEqual(baseUpdates);
    expect(noUsage.final).toEqual({ type: "completed", finishReason: "end_turn", usage: inputOnly });
    expect(noUsage.snapshot).toMatchObject({
      usage: { ...inputOnly, outputTokens: 20, reasoningTokens: 5 }, usageComplete: false,
    });

    const omittedOutput = await run([{
      type: "message_delta", delta: { stop_reason: "end_turn" },
      usage: { output_tokens_details: { thinking_tokens: 18 } },
    }]);
    expect(omittedOutput.updates).toEqual(baseUpdates);
    expect(omittedOutput.final).toEqual({ type: "completed", finishReason: "end_turn", usage: inputOnly });
    expect(omittedOutput.snapshot).toMatchObject({
      usage: { ...inputOnly, outputTokens: 20, reasoningTokens: 5 }, usageComplete: false,
    });

    const invalidOutput = await run([{
      type: "message_delta", delta: { stop_reason: "end_turn" },
      usage: { input_tokens: 3, output_tokens: -1, output_tokens_details: { thinking_tokens: 18 } },
    }]);
    expect(invalidOutput.updates).toEqual([...baseUpdates, { ...inputOnly, outputTokens: 20, reasoningTokens: 5 }]);
    expect(invalidOutput.final).toEqual({ type: "completed", finishReason: "end_turn", usage: inputOnly });
    expect(invalidOutput.snapshot).toMatchObject({
      usage: { ...inputOnly, outputTokens: 20, reasoningTokens: 5 }, usageComplete: false,
    });

    const postStopDelta = await run([
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 50 } },
      { type: "message_delta", usage: { output_tokens: 60, output_tokens_details: { thinking_tokens: 10 } } },
    ]);
    expect(postStopDelta.updates).toEqual([
      ...baseUpdates,
      { ...inputOnly, outputTokens: 50 },
      { ...inputOnly, outputTokens: 60, reasoningTokens: 10 },
    ]);
    expect(postStopDelta.final).toEqual({ type: "completed", finishReason: "end_turn", usage: { ...inputOnly, outputTokens: 50 } });
    expect(postStopDelta.snapshot).toMatchObject({ usage: { ...inputOnly, outputTokens: 50 }, usageComplete: true });
    expect(postStopDelta.snapshot.usage).not.toHaveProperty("reasoningTokens");
  });

  it("never mixes cross-frame Anthropic reasoningTokens on MAX_SAFE_INTEGER overflow", async () => {
    const nearMax = Number.MAX_SAFE_INTEGER - 30;
    const baseInput = { uncachedInputTokens: nearMax, inputTokens: nearMax, cacheReadTokens: 0, cacheWriteTokens: 0 };

    // Overflow occurring during streaming merge (terminal delta carries output + thinking only)
    const mergeOverflowEvents = await collect("anthropic-native", sse([
      { type: "message_start", message: { usage: { input_tokens: nearMax, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 } } },
      { type: "message_delta", usage: { output_tokens: 20, output_tokens_details: { thinking_tokens: 5 } } },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 50, output_tokens_details: { thinking_tokens: 10 } } },
      { type: "message_stop" },
    ]));
    expect(mergeOverflowEvents.filter((event) => event.type === "usage-update")).toEqual([
      { type: "usage-update", usage: { ...baseInput, outputTokens: 0 } },
      { type: "usage-update", usage: { ...baseInput, outputTokens: 20, reasoningTokens: 5 } },
      { type: "usage-update", usage: baseInput },
    ]);
    expect(mergeOverflowEvents[mergeOverflowEvents.length - 1]).toEqual({
      type: "completed", finishReason: "end_turn", usage: baseInput,
    });
    const mergeOverflowMeasurement = new GenerationMeasurement("anthropic-native", true, () => 0);
    mergeOverflowEvents.forEach((event) => mergeOverflowMeasurement.observe(event));
    const mergeOverflowSnapshot = mergeOverflowMeasurement.snapshot("complete");
    expect(mergeOverflowSnapshot).toMatchObject({
      usage: { ...baseInput, outputTokens: 20, reasoningTokens: 5 }, usageComplete: false,
    });
    expect(() => readGenerationMetricsData(mergeOverflowSnapshot)).not.toThrow();

    // Overflow occurring inside terminal delta carrying both input buckets and output/thinking
    const sameFrameOverflowEvents = await collect("anthropic-native", sse([
      { type: "message_start", message: { usage: { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 } } },
      { type: "message_delta", usage: { output_tokens: 20, output_tokens_details: { thinking_tokens: 5 } } },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: {
          input_tokens: nearMax, cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
          output_tokens: 50, output_tokens_details: { thinking_tokens: 10 },
        },
      },
      { type: "message_stop" },
    ]));
    expect(sameFrameOverflowEvents.filter((event) => event.type === "usage-update")).toEqual([
      { type: "usage-update", usage: { uncachedInputTokens: 100, inputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 } },
      { type: "usage-update", usage: { uncachedInputTokens: 100, inputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 20, reasoningTokens: 5 } },
      { type: "usage-update", usage: { ...baseInput, outputTokens: 20, reasoningTokens: 5 } },
    ]);
    expect(sameFrameOverflowEvents[sameFrameOverflowEvents.length - 1]).toEqual({
      type: "completed", finishReason: "end_turn", usage: baseInput,
    });
    const sameFrameMeasurement = new GenerationMeasurement("anthropic-native", true, () => 0);
    sameFrameOverflowEvents.forEach((event) => sameFrameMeasurement.observe(event));
    const sameFrameSnapshot = sameFrameMeasurement.snapshot("complete");
    expect(sameFrameSnapshot).toMatchObject({
      usage: { ...baseInput, outputTokens: 20, reasoningTokens: 5 }, usageComplete: false,
    });
    expect(() => readGenerationMetricsData(sameFrameSnapshot)).not.toThrow();

    // Continuous streaming overflow across consecutive frames must never leak unanchored reasoningTokens
    const nearMaxHigh = Number.MAX_SAFE_INTEGER - 10;
    const highInput = { uncachedInputTokens: nearMaxHigh, inputTokens: nearMaxHigh, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const consecutiveOverflowEvents = await collect("anthropic-native", sse([
      { type: "message_start", message: { usage: { input_tokens: nearMax, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 20 } } },
      {
        type: "message_delta",
        usage: {
          input_tokens: nearMaxHigh, cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
          output_tokens: 50, output_tokens_details: { thinking_tokens: 7 },
        },
      },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: {
          input_tokens: nearMaxHigh, cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
          output_tokens: 60, output_tokens_details: { thinking_tokens: 10 },
        },
      },
      { type: "message_stop" },
    ]));
    expect(consecutiveOverflowEvents.filter((event) => event.type === "usage-update")).toEqual([
      { type: "usage-update", usage: { ...baseInput, outputTokens: 20 } },
      { type: "usage-update", usage: highInput },
      { type: "usage-update", usage: highInput },
    ]);
    expect(consecutiveOverflowEvents[consecutiveOverflowEvents.length - 1]).toEqual({
      type: "completed", finishReason: "end_turn", usage: highInput,
    });
    const consecutiveMeasurement = new GenerationMeasurement("anthropic-native", true, () => 0);
    consecutiveOverflowEvents.forEach((event) => consecutiveMeasurement.observe(event));
    const consecutiveSnapshot = consecutiveMeasurement.snapshot("complete");
    expect(consecutiveSnapshot).toMatchObject({ usage: highInput, usageComplete: false });
    expect(consecutiveSnapshot.usage).not.toHaveProperty("outputTokens");
    expect(consecutiveSnapshot.usage).not.toHaveProperty("reasoningTokens");
    expect(() => readGenerationMetricsData(consecutiveSnapshot)).not.toThrow();

    // Non-streaming single-frame overflow retains partial reasoningTokens with usageComplete:false
    const nonStreamOverflowEvents = await collect("anthropic-native", new Response(JSON.stringify({
      type: "message", content: [{ type: "text", text: "Hi" }], stop_reason: "end_turn",
      usage: {
        input_tokens: nearMax, cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
        output_tokens: 50, output_tokens_details: { thinking_tokens: 10 },
      },
    }), { headers: { "content-type": "application/json" } }), { ...defaultSessionConfig(), stream: false });
    expect(nonStreamOverflowEvents[nonStreamOverflowEvents.length - 1]).toEqual({
      type: "completed", finishReason: "end_turn", usage: { ...baseInput, reasoningTokens: 10 },
    });
    const nonStreamOverflowMeasurement = new GenerationMeasurement("anthropic-native", false, () => 0);
    nonStreamOverflowEvents.forEach((event) => nonStreamOverflowMeasurement.observe(event));
    const nonStreamOverflowSnapshot = nonStreamOverflowMeasurement.snapshot("complete");
    expect(nonStreamOverflowSnapshot).toMatchObject({
      usage: { ...baseInput, reasoningTokens: 10 }, usageComplete: false,
    });
    expect(() => readGenerationMetricsData(nonStreamOverflowSnapshot)).not.toThrow();

    // Extreme late cache overflow must never leave usageComplete:true without outputTokens
    const cacheOverflowEvents = await collect("anthropic-native", sse([
      { type: "message_start", message: { usage: { input_tokens: 5, cache_read_input_tokens: 1, cache_creation_input_tokens: 0, output_tokens: 0 } } },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: Number.MAX_SAFE_INTEGER - 5 } },
      { type: "message_delta", usage: { cache_read_input_tokens: Number.MAX_SAFE_INTEGER } },
      { type: "message_stop" },
    ]));
    const cacheOverflowMeasurement = new GenerationMeasurement("anthropic-native", true, () => 0);
    cacheOverflowEvents.forEach((event) => cacheOverflowMeasurement.observe(event));
    const cacheOverflowSnapshot = cacheOverflowMeasurement.snapshot("complete");
    expect(cacheOverflowSnapshot.usageComplete).toBe(false);
    expect(() => readGenerationMetricsData(cacheOverflowSnapshot)).not.toThrow();
  });

  it("retains Anthropic thinking_tokens on mid-stream error with usage and on refusal terminals", async () => {
    const errorEvents = await collect("anthropic-native", sse([
      { type: "message_start", message: { usage: { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 } } },
      {
        type: "error",
        error: { type: "overloaded_error", message: "overloaded" },
        usage: { output_tokens: 12, output_tokens_details: { thinking_tokens: 7 } },
      },
    ]));
    expect(errorEvents[errorEvents.length - 1]).toMatchObject({ type: "failed" });
    const errMeasurement = new GenerationMeasurement("anthropic-native", true, () => 0);
    errorEvents.forEach((event) => errMeasurement.observe(event));
    expect(errMeasurement.snapshot("failed")).toMatchObject({
      usage: { uncachedInputTokens: 10, inputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 12, reasoningTokens: 7 },
      usageComplete: false,
    });

    const refusalUsage = {
      input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 20,
      output_tokens_details: { thinking_tokens: 9, safety_tokens: 3 },
    };
    const expectedRefusal = {
      uncachedInputTokens: 10, inputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 20, reasoningTokens: 9,
    };
    const streamRefusal = await collect("anthropic-native", sse([
      { type: "message_start", message: { usage: { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 } } },
      { type: "message_delta", delta: { stop_reason: "refusal", stop_details: { explanation: "blocked" } }, usage: refusalUsage },
      { type: "message_stop" },
    ]));
    expect(streamRefusal[streamRefusal.length - 1]).toMatchObject({
      type: "completed", finishReason: "refusal", usage: expectedRefusal,
    });
    const streamRefusalMeasurement = new GenerationMeasurement("anthropic-native", true, () => 0);
    streamRefusal.forEach((event) => streamRefusalMeasurement.observe(event));
    expect(streamRefusalMeasurement.snapshot("incomplete")).toMatchObject({ usage: expectedRefusal, usageComplete: true });

    const nonStreamRefusal = await collect("anthropic-native", new Response(JSON.stringify({
      type: "message", content: [{ type: "text", text: "blocked" }], stop_reason: "refusal",
      stop_details: { explanation: "blocked" }, usage: refusalUsage,
    }), { headers: { "content-type": "application/json" } }), { ...defaultSessionConfig(), stream: false });
    expect(nonStreamRefusal[nonStreamRefusal.length - 1]).toMatchObject({
      type: "completed", finishReason: "refusal", usage: expectedRefusal,
    });
    const nonStreamRefusalMeasurement = new GenerationMeasurement("anthropic-native", false, () => 0);
    nonStreamRefusal.forEach((event) => nonStreamRefusalMeasurement.observe(event));
    expect(nonStreamRefusalMeasurement.snapshot("incomplete")).toMatchObject({ usage: expectedRefusal, usageComplete: true });
  });

  it("still records Anthropic reasoningTokens when thinking text display is hidden", async () => {
    const hiddenConfig = withThinkingSettings(defaultSessionConfig(), "anthropic-native", {
      ...defaultThinking, choice: "adaptive", effort: "high", includeSummary: false,
    });
    const events = await collect("anthropic-native", sse([
      { type: "message_start", message: { usage: { ...nativeUsage, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "hidden" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: " thought" } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "visible" } },
      { type: "content_block_stop", index: 1 },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 30, output_tokens_details: { thinking_tokens: 14 } },
      },
      { type: "message_stop" },
    ]), hiddenConfig);
    expect(events.some((event) => event.type === "thinking-delta")).toBe(false);
    expect(events[events.length - 1]).toEqual({
      type: "completed", finishReason: "end_turn",
      usage: { ...expectedNative, outputTokens: 30, reasoningTokens: 14 },
    });
    const measurement = new GenerationMeasurement("anthropic-native", true, () => 0);
    events.forEach((event) => measurement.observe(event));
    expect(measurement.snapshot("complete")).toMatchObject({
      usage: { ...expectedNative, outputTokens: 30, reasoningTokens: 14 }, usageComplete: true,
    });
  });

  it("normalizes non-stream Anthropic thinking_tokens for positive, zero, out-of-range, and safety-only payloads", async () => {
    const cases: Array<{ details: Record<string, unknown>; expectedReasoning?: number }> = [
      { details: { thinking_tokens: 4, safety_tokens: 1 }, expectedReasoning: 4 },
      { details: { thinking_tokens: 0 }, expectedReasoning: 0 },
      { details: { thinking_tokens: 9 }, expectedReasoning: undefined },
      { details: { safety_tokens: 2 }, expectedReasoning: undefined },
    ];
    for (const { details, expectedReasoning } of cases) {
      const body = {
        type: "message", content: [{ type: "text", text: "Hi" }], stop_reason: "end_turn",
        usage: { ...nativeUsage, output_tokens_details: details },
      };
      const events = await collect(
        "anthropic-native",
        new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }),
        { ...defaultSessionConfig(), stream: false },
      );
      const expected = expectedReasoning === undefined ? expectedNative : { ...expectedNative, reasoningTokens: expectedReasoning };
      expect(events).toContainEqual({ type: "usage-update", usage: expected });
      expect(events[events.length - 1]).toEqual({ type: "completed", finishReason: "end_turn", usage: expected });
      const measurement = new GenerationMeasurement("anthropic-native", false, () => 0);
      events.forEach((event) => measurement.observe(event));
      const snapshot = measurement.snapshot("complete");
      expect(snapshot).toMatchObject({ usage: expected, usageComplete: true });
      if (expectedReasoning === undefined) expect(snapshot.usage).not.toHaveProperty("reasoningTokens");
      expect(() => readGenerationMetricsData(snapshot)).not.toThrow();
    }
  });
});
