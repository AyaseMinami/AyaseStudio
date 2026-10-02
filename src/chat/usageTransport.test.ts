import { describe, expect, it, vi } from "vitest";
import { createChatTransport } from "./transport";
import { defaultSessionConfig } from "./sessionConfig";
import { GenerationMeasurement } from "./generationMetrics";
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
});
