import { describe, expect, it } from "vitest";
import { buildProtocolBody } from "./requestMapping";
import { defaultSessionConfig, restoreSessionConfig } from "./sessionConfig";
import { defaultThinking, getThinkingSettings, thinkingOptions, withThinkingSettings, type ThinkingSettings } from "./thinking";
import { createChatTransport } from "./transport";
import { planContextBudget } from "./contextBudget";
import type { ChatEvent, ChatProtocol, ChatRequest } from "./types";

const base: ChatRequest = { baseUrl: "https://synthetic.example", apiKey: "synthetic-only", model: "gpt-5.2",
  messages: [{ role: "user", content: "hello" }] };
function request(protocol: ChatProtocol, model: string, settings: Partial<ThinkingSettings> = {}, stream = true): ChatRequest {
  return { ...base, model, config: withThinkingSettings({ ...defaultSessionConfig(), stream }, protocol, { ...defaultThinking, ...settings }) };
}
async function decode(protocol: ChatProtocol, payload: unknown, streaming = true, includeSummary = true, model?: string) {
  const req = request(protocol, model ?? (protocol === "anthropic-native" ? "claude-sonnet-4-6" : "gpt-5.2"), { includeSummary }, streaming);
  const fetch = async () => new Response(streaming ? (payload as unknown[]).map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") : JSON.stringify(payload), {
    headers: { "content-type": streaming ? "text/event-stream" : "application/json" },
  });
  const events: ChatEvent[] = [];
  for await (const event of createChatTransport(protocol, { fetch }).stream(req)) events.push(event);
  return events;
}
function text(events: ChatEvent[], type: "thinking-delta" | "text-delta") {
  return events.map((event) => event.type === type ? event.text : "").join("");
}
const reasoning = (summary = "summary") => ({ id: "r", type: "reasoning", summary: [{ type: "summary_text", text: summary }], encrypted_content: "opaque" });
const fullResponse = (summary = "summary") => ({ id: "resp", status: "completed", output: [reasoning(summary),
  { id: "m", type: "message", role: "assistant", content: [{ type: "output_text", text: "answer", annotations: [] }] }], output_text: "answer" });
const delta = (value: string, sequence_number: number) => ({ type: "response.reasoning_summary_text.delta", item_id: "r", summary_index: 0, delta: value, sequence_number });

describe("protocol thinking requests", () => {
  it("keeps protocol settings isolated and old Gemini configuration intact across restore", () => {
    const gemini = { ...defaultThinking, choice: "high" as const };
    let config = withThinkingSettings(defaultSessionConfig(), "gemini-native", gemini);
    config = withThinkingSettings(config, "openai-responses", { ...defaultThinking, choice: "xhigh" });
    config = withThinkingSettings(config, "anthropic-native", { ...defaultThinking, choice: "budget", budget: "2048" });
    const restored = restoreSessionConfig(JSON.parse(JSON.stringify(config)));
    expect(restored.geminiThinking).toEqual(gemini);
    expect(getThinkingSettings(restored, "openai-chat")).toBeUndefined();
    expect(getThinkingSettings(restored, "openai-responses")?.choice).toBe("xhigh");
    expect(getThinkingSettings(restored, "anthropic-native")?.budget).toBe("2048");
  });
  it.each(["openai-chat", "openai-responses", "anthropic-native"] as const)("%s applies its options to arbitrary relay model IDs", (protocol) => {
    const model = protocol === "anthropic-native" ? "claude-opus-5" : "gpt-5.6-sol";
    const body = buildProtocolBody(protocol, request(protocol, model,
      protocol === "anthropic-native" ? { choice: "adaptive", effort: "high", includeSummary: true } : { choice: "high", includeSummary: true }));
    if (protocol === "openai-chat") expect(body).toMatchObject({ model, reasoning_effort: "high" });
    if (protocol === "openai-responses") expect(body).toMatchObject({ model, reasoning: { effort: "high", summary: "auto" } });
    if (protocol === "anthropic-native") expect(body).toMatchObject({ model, thinking: { type: "adaptive" }, output_config: { effort: "high" } });
  });
  it("maps OpenAI effort and summary independently, preserving local history and store:false", () => {
    expect(buildProtocolBody("openai-chat", request("openai-chat", "gpt-5.2", { choice: "off" }))).toMatchObject({ reasoning_effort: "none" });
    const defaults = buildProtocolBody("openai-chat", request("openai-chat", "gpt-5.2"));
    expect(defaults).not.toHaveProperty("reasoning_effort"); expect(defaults).not.toHaveProperty("reasoning");
    expect(buildProtocolBody("openai-responses", request("openai-responses", "gpt-5.2"))).toMatchObject({ store: false });
    expect(buildProtocolBody("openai-responses", request("openai-responses", "gpt-5.2"))).not.toHaveProperty("reasoning");
    expect(buildProtocolBody("openai-responses", request("openai-responses", "gpt-5.2", { choice: "high", includeSummary: false }))).toMatchObject({ reasoning: { effort: "high" } });
    expect(buildProtocolBody("openai-responses", request("openai-responses", "gpt-5.2", { includeSummary: false }))).not.toHaveProperty("reasoning");
    expect(buildProtocolBody("openai-responses", request("openai-responses", "relay-anything", { choice: "max" }))).toMatchObject({ reasoning: { effort: "max" } });
  });
  it("exposes only protocol wire options, independently of model IDs", () => {
    expect(thinkingOptions("openai-chat").choices).toEqual(["default", "off", "minimal", "low", "medium", "high", "xhigh", "max"]);
    expect(thinkingOptions("openai-responses").choices).toContain("max");
    expect(thinkingOptions("anthropic-native").efforts).toEqual(["default", "low", "medium", "high", "xhigh", "max"]);
  });
  it("forwards valid sampling and thinking combinations unchanged", () => {
    for (const protocol of ["openai-chat", "openai-responses"] as const) {
      const req = request(protocol, "arbitrary-relay-name", { choice: "high" });
      req.config!.temperature = { mode: "custom", value: "0.5" };
      req.config!.topP = { mode: "custom", value: "0.8" };
      req.config!.dualSamplingConfirmed = true;
      const body = buildProtocolBody(protocol, req);
      expect(body).toMatchObject(protocol === "openai-chat"
        ? { reasoning_effort: "high", temperature: 0.5, top_p: 0.8 }
        : { reasoning: { effort: "high" }, temperature: 0.5, top_p: 0.8 });
    }
  });
  it("maps Anthropic default, disabled, manual and adaptive without conflating display", () => {
    expect(buildProtocolBody("anthropic-native", request("anthropic-native", "claude-opus-4-7"))).not.toHaveProperty("thinking");
    expect(buildProtocolBody("anthropic-native", request("anthropic-native", "claude-opus-4-7", { choice: "off" }))).toMatchObject({ thinking: { type: "disabled" } });
    expect(buildProtocolBody("anthropic-native", request("anthropic-native", "claude-opus-5", { choice: "adaptive", effort: "xhigh", includeSummary: true }))).toMatchObject({
      thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: "xhigh" },
    });
    expect(buildProtocolBody("anthropic-native", request("anthropic-native", "claude-opus-4-5", { choice: "budget", budget: "1024", effort: "low", includeSummary: false }))).toMatchObject({
      thinking: { type: "enabled", budget_tokens: 1024, display: "omitted" }, output_config: { effort: "low" },
    });
    expect(buildProtocolBody("anthropic-native", request("anthropic-native", "relay-alias", { choice: "budget", budget: "1" }))).toMatchObject({ thinking: { budget_tokens: 1 } });
  });
  it.each(["", "NaN", "1024.1", "99999999999999999"])("rejects invalid budget integer syntax %s", (budget) => {
    expect(() => buildProtocolBody("anthropic-native", request("anthropic-native", "claude-opus-5", { choice: "budget", budget }))).toThrow("预算");
  });
  it("forwards Anthropic budget/output and sampling combinations for the provider to validate", () => {
    const req = request("anthropic-native", "claude-opus-5", { choice: "budget", budget: "4096" });
    req.config!.temperature = { mode: "custom", value: "2.5" };
    req.config!.topP = { mode: "custom", value: "1.2" };
    req.config!.topK = { mode: "custom", value: "-1" };
    const before = JSON.stringify(req.config);
    expect(buildProtocolBody("anthropic-native", { ...req, maxOutputTokens: 1024 })).toMatchObject({
      model: "claude-opus-5", max_tokens: 1024, temperature: 2.5, top_p: 1.2, top_k: -1,
      thinking: { type: "enabled", budget_tokens: 4096, display: "omitted" },
    });
    expect(JSON.stringify(req.config)).toBe(before);
  });
  it.each(["openai-chat", "openai-responses", "gemini-native", "anthropic-native"] as const)(
    "%s omits thinking and summary fields when no preference has been saved", (protocol) => {
      const body = buildProtocolBody(protocol, { ...base, model: "any-new-model" });
      for (const key of ["reasoning_effort", "reasoning", "thinking", "output_config", "generationConfig"]) {
        expect(body).not.toHaveProperty(key);
      }
    },
  );
  it.each(["openai-chat", "openai-responses", "anthropic-native"] as const)("%s rejects custom JSON thinking bypass", (protocol) => {
    const req = request(protocol, "unknown"); req.config!.customJson[protocol] = '{"thinking":{"type":"adaptive"}}';
    expect(() => buildProtocolBody(protocol, req)).toThrow("不允许");
  });
});

describe("readable summary decoding", () => {
  it("reconciles Responses deltas, repeated sequence, done events, output items and final response exactly once", async () => {
    const events = await decode("openai-responses", [delta("sum", 1), delta("sum", 1), delta("mary", 2),
      { type: "response.reasoning_summary_text.done", item_id: "r", summary_index: 0, text: "summary", sequence_number: 3 },
      { type: "response.reasoning_summary_part.done", item_id: "r", summary_index: 0, part: { type: "summary_text", text: "summary" }, sequence_number: 4 },
      { type: "response.output_item.done", item: reasoning(), sequence_number: 5 },
      { type: "response.output_text.delta", delta: "answer", sequence_number: 6 },
      { type: "response.completed", response: fullResponse(), sequence_number: 7 },
    ]);
    expect(text(events, "thinking-delta")).toBe("summary"); expect(text(events, "text-delta")).toBe("answer");
    expect(events[events.length - 1]?.type).toBe("completed");
  });
  it("preserves identical genuine tokens and fills missing final suffixes", async () => {
    const events = await decode("openai-responses", [delta("ha", 1), delta("ha", 2),
      { type: "response.completed", response: fullResponse("haha!"), sequence_number: 3 }]);
    expect(text(events, "thinking-delta")).toBe("haha!");
  });
  it("handles final-only and multiple Responses summary parts without rendering opaque payloads", async () => {
    const response = fullResponse(); response.output[0] = { ...reasoning(), summary: [{ type: "summary_text", text: "first" }, { type: "summary_text", text: "second" }] };
    const events = await decode("openai-responses", [{ type: "response.completed", response }]);
    expect(text(events, "thinking-delta")).toBe("first\n\nsecond");
    expect(JSON.stringify(events)).not.toContain("opaque");
  });
  it.each([true, false])("Responses stream=%s honors summary-off even when upstream returns it", async (streaming) => {
    const events = await decode("openai-responses", streaming ? [delta("hidden", 1), { type: "response.completed", response: fullResponse() }] : fullResponse(), streaming, false);
    expect(text(events, "thinking-delta")).toBe(""); expect(JSON.stringify(events)).not.toContain("summary");
  });
  it("separates non-streaming Responses summary from answer", async () => {
    const events = await decode("openai-responses", fullResponse(), false);
    expect(text(events, "thinking-delta")).toBe("summary"); expect(text(events, "text-delta")).toBe("answer");
  });
  it("retains partial summaries before provider/protocol failures with one terminal", async () => {
    for (const terminal of [{ type: "error", code: "server_error", message: "failed" },
      { type: "response.reasoning_summary_text.done", item_id: "r", summary_index: 0, text: 17 }]) {
      const events = await decode("openai-responses", [delta("partial", 1), terminal]);
      expect(text(events, "thinking-delta")).toBe("partial"); expect(events[events.length - 1]?.type).toBe("failed");
      expect(events.filter((event) => event.type === "failed")).toHaveLength(1);
    }
  });
  it.each(["openai-responses", "anthropic-native"] as const)("%s retains a summary and aborts once before later buffered output", async (protocol) => {
    const controller = new AbortController();
    const events: ChatEvent[] = [];
    const records = protocol === "openai-responses" ? [delta("partial", 1),
      { type: "response.output_text.delta", delta: "should not arrive", sequence_number: 2 },
      { type: "response.completed", response: fullResponse("partial") }] : [
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "partial" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "should not arrive" } },
      { type: "message_delta", delta: { stop_reason: "end_turn" } }, { type: "message_stop" },
    ];
    const fetch = async () => new Response(records.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
    for await (const event of createChatTransport(protocol, { fetch }).stream({ ...request(protocol, "unknown", { includeSummary: true }), signal: controller.signal })) {
      events.push(event);
      if (event.type === "thinking-delta") controller.abort();
    }
    expect(events).toEqual([{ type: "thinking-delta", text: "partial" }, { type: "aborted" }]);
  });
  const anthropicEvents = [
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "first" } },
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "first" } },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: " thought" } },
    { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "opaque" } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "late duplicate" } },
    { type: "content_block_start", index: 1, content_block: { type: "redacted_thinking", data: "opaque" } },
    { type: "content_block_delta", index: 1, delta: { type: "thinking_delta", thinking: "not readable" } },
    { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "answer" } },
    { type: "message_delta", delta: { stop_reason: "end_turn" } }, { type: "message_stop" },
  ];
  const anthropicResponse = { type: "message", content: [{ type: "thinking", thinking: "first thought", signature: "opaque" },
    { type: "redacted_thinking", data: "opaque" }, { type: "text", text: "answer" }], stop_reason: "end_turn" };
  it.each([true, false])("Anthropic stream=%s routes only readable thinking and preserves answer", async (streaming) => {
    const events = await decode("anthropic-native", streaming ? anthropicEvents : anthropicResponse, streaming);
    expect(text(events, "thinking-delta")).toBe("first thought"); expect(text(events, "text-delta")).toBe("answer");
    expect(JSON.stringify(events)).not.toContain("opaque"); expect(events[events.length - 1]?.type).toBe("completed");
  });
  it.each([true, false])("Anthropic stream=%s discards all thinking when display is off", async (streaming) => {
    const events = await decode("anthropic-native", streaming ? anthropicEvents : anthropicResponse, streaming, false);
    expect(text(events, "thinking-delta")).toBe(""); expect(text(events, "text-delta")).toBe("answer");
  });
  it("reads explicit Chat reasoning_content without interpreting literal answer tags", async () => {
    const events = await decode("openai-chat", { choices: [{ message: { content: "<think>literal answer</think>", reasoning_content: "unconfirmed extension" }, finish_reason: "stop" }] }, false);
    expect(text(events, "thinking-delta")).toBe("unconfirmed extension"); expect(text(events, "text-delta")).toBe("<think>literal answer</think>");
  });
  it.each([true, false])("Chat stream=%s reads reasoning separately and honors display preference", async (streaming) => {
    const payload = streaming ? [
      { choices: [{ delta: { reasoning_content: "thought" }, finish_reason: null }] },
      { choices: [{ delta: { content: "answer" }, finish_reason: "stop" }] },
    ] : { choices: [{ message: { reasoning_content: "thought", content: "answer" }, finish_reason: "stop" }] };
    for (const enabled of [true, false]) {
      const events = await decode("openai-chat", payload, streaming, enabled);
      expect(text(events, "thinking-delta")).toBe(enabled ? "thought" : "");
      expect(text(events, "text-delta")).toBe("answer");
      expect(events[events.length - 1]?.type).toBe("completed");
    }
  });
  it.each(["", null])("preserves reasoning-only Chat responses with content=%s stopped by the output limit", async (content) => {
    const events = await decode("openai-chat", { choices: [{ message: { content, reasoning_content: "unfinished thought" }, finish_reason: "length" }] }, false);
    expect(text(events, "thinking-delta")).toBe("unfinished thought");
    expect(events[events.length - 1]).toMatchObject({ type: "completed", finishReason: "length" });
  });
  it("preserves Chat refusal text when content is empty", async () => {
    const events = await decode("openai-chat", { choices: [{ message: { content: "", refusal: "cannot answer" }, finish_reason: "stop" }] }, false);
    expect(text(events, "text-delta")).toBe("cannot answer");
  });
  it.each([true, false])("rejects malformed Chat reasoning when display is enabled, stream=%s", async (streaming) => {
    const payload = streaming ? [{ choices: [{ delta: { reasoning_content: 42 }, finish_reason: "stop" }] }]
      : { choices: [{ message: { content: "answer", reasoning_content: 42 }, finish_reason: "stop" }] };
    const events = await decode("openai-chat", payload, streaming);
    expect(events[events.length - 1]).toMatchObject({ type: "failed", error: { kind: "protocol" } });
  });
  it.each([true, false])("Responses stream=%s reads reasoning_text without duplicate final snapshots", async (streaming) => {
    const item = { id: "r", type: "reasoning", summary: [], content: [{ type: "reasoning_text", text: "thought" }], encrypted_content: "opaque" };
    const response = { ...fullResponse(), output: [item, fullResponse().output[1]] };
    const payload = streaming ? [
      { type: "response.reasoning_text.delta", item_id: "r", content_index: 0, delta: "tho", sequence_number: 1 },
      { type: "response.reasoning_text.delta", item_id: "r", content_index: 0, delta: "tho", sequence_number: 1 },
      { type: "response.reasoning_text.done", item_id: "r", content_index: 0, text: "thought", sequence_number: 2 },
      { type: "response.output_item.done", item, sequence_number: 3 },
      { type: "response.output_text.delta", delta: "answer", sequence_number: 4 },
      { type: "response.completed", response, sequence_number: 5 },
    ] : response;
    for (const enabled of [true, false]) {
      const events = await decode("openai-responses", payload, streaming, enabled);
      expect(text(events, "thinking-delta")).toBe(enabled ? "thought" : "");
      expect(text(events, "text-delta")).toBe("answer");
      expect(JSON.stringify(events)).not.toContain("opaque");
      expect(events[events.length - 1]?.type).toBe("completed");
    }
  });
  it("keeps Responses summary and content indexes independent", async () => {
    const response = fullResponse();
    Object.assign(response.output[0], { content: [{ type: "reasoning_text", text: "thought" }] });
    expect(text(await decode("openai-responses", response, false), "thinking-delta")).toBe("summary\n\nthought");
  });
  it("finishes streamed reasoning before appending a summary first seen in the terminal snapshot", async () => {
    const response = fullResponse();
    Object.assign(response.output[0], { content: [{ type: "reasoning_text", text: "thought" }] });
    const events = await decode("openai-responses", [
      { type: "response.reasoning_text.delta", item_id: "r", content_index: 0, delta: "tho", sequence_number: 1 },
      { type: "response.completed", response, sequence_number: 2 },
    ]);
    expect(text(events, "thinking-delta")).toBe("thought\n\nsummary");
  });
  it("reconciles repeated genuine reasoning tokens with a terminal-only snapshot", async () => {
    const response = fullResponse();
    Object.assign(response.output[0], { summary: [], content: [{ type: "reasoning_text", text: "haha!" }] });
    const events = await decode("openai-responses", [
      { type: "response.reasoning_text.delta", item_id: "r", content_index: 0, delta: "ha", sequence_number: 1 },
      { type: "response.reasoning_text.delta", item_id: "r", content_index: 0, delta: "ha", sequence_number: 2 },
      { type: "response.completed", response, sequence_number: 3 },
    ]);
    expect(text(events, "thinking-delta")).toBe("haha!");
  });
  it("retains reasoning text before malformed final data and produces one failure", async () => {
    const events = await decode("openai-responses", [
      { type: "response.reasoning_text.delta", item_id: "r", content_index: 0, delta: "partial", sequence_number: 1 },
      { type: "response.reasoning_text.done", item_id: "r", content_index: 0, text: 42, sequence_number: 2 },
    ]);
    expect(text(events, "thinking-delta")).toBe("partial");
    expect(events.filter(event => event.type === "failed")).toHaveLength(1);
    expect(events[events.length - 1]).toMatchObject({ type: "failed", error: { kind: "protocol" } });
  });
  it("stops Chat immediately when cancelled during thinking, including a buffered answer", async () => {
    const controller = new AbortController();
    const events: ChatEvent[] = [];
    const fetch = async () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "partial", content: "must not arrive" }, finish_reason: "stop" }] })}\n\n`, { headers: { "content-type": "text/event-stream" } });
    for await (const event of createChatTransport("openai-chat", { fetch }).stream({ ...request("openai-chat", "arbitrary", { includeSummary: true }), signal: controller.signal })) {
      events.push(event);
      if (event.type === "thinking-delta") controller.abort();
    }
    expect(events).toEqual([{ type: "thinking-delta", text: "partial" }, { type: "aborted" }]);
  });
  it.each(["openai-chat", "openai-responses"] as const)("%s stops a buffered non-streaming response after cancellation during thinking", async (protocol) => {
    const controller = new AbortController();
    const events: ChatEvent[] = [];
    const response = protocol === "openai-chat"
      ? { choices: [{ message: { reasoning_content: "partial", content: "must not arrive" }, finish_reason: "stop" }] }
      : { ...fullResponse(), output: [{ ...reasoning("partial"), content: [{ type: "reasoning_text", text: "must not arrive" }] }, fullResponse().output[1]] };
    const fetch = async () => new Response(JSON.stringify(response), { headers: { "content-type": "application/json" } });
    for await (const event of createChatTransport(protocol, { fetch }).stream({ ...request(protocol, "arbitrary", { includeSummary: true }, false), signal: controller.signal })) {
      events.push(event);
      if (event.type === "thinking-delta") controller.abort();
    }
    expect(events).toEqual([{ type: "thinking-delta", text: "partial" }, { type: "aborted" }]);
  });
  it("excludes persisted summaries from all ordinary protocol histories", async () => {
    const plan = await planContextBudget([
      { id: "u", role: "user", content: "hello", status: "complete" },
      { id: "a", role: "assistant", content: "answer", thinkingSummary: "private summary", status: "complete" },
    ], "next", defaultSessionConfig(), "openai-responses", "gpt-5.2", () => 1);
    for (const protocol of ["openai-chat", "openai-responses", "anthropic-native"] as const) {
      expect(JSON.stringify(buildProtocolBody(protocol, { ...base, messages: plan.messages }))).not.toContain("private summary");
    }
  });
});

describe("DeepSeek V4 thinking controls and decoding contracts (#143)", () => {
  it.each([
    ["default", undefined],
    ["off", "none"],
    ["minimal", "minimal"],
    ["low", "low"],
    ["medium", "medium"],
    ["high", "high"],
    ["xhigh", "xhigh"],
    ["max", "max"],
  ] as const)("maps DeepSeek Chat Completions choice=%s without non-standard thinking field", (choice, expectedEffort) => {
    for (const model of ["deepseek-chat", "deepseek-flash", "deepseek-v4-pro"] as const) {
      const body = buildProtocolBody("openai-chat", request("openai-chat", model, { choice }));
      expect(body).not.toHaveProperty("thinking");
      if (expectedEffort === undefined) {
        expect(body).not.toHaveProperty("reasoning_effort");
      } else {
        expect(body).toMatchObject({ model, reasoning_effort: expectedEffort });
      }
    }
  });

  it("decodes DeepSeek Chat Completions stream with reasoning_content and combined final finish_reason + usage chunk", async () => {
    const events = await decode("openai-chat", [
      { choices: [{ index: 0, delta: { reasoning_content: "step 1" }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { content: "final answer" }, finish_reason: null }] },
      {
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 12, completion_tokens: 20, total_tokens: 32,
          prompt_cache_hit_tokens: 8,
          completion_tokens_details: { reasoning_tokens: 11 },
        },
      },
    ], true, true, "deepseek-v4-pro");
    expect(text(events, "thinking-delta")).toBe("step 1");
    expect(text(events, "text-delta")).toBe("final answer");
    const expectedUsage = { inputTokens: 12, outputTokens: 20, totalTokens: 32, cacheReadTokens: 8, reasoningTokens: 11 };
    expect(events).toContainEqual({ type: "usage-update", usage: expectedUsage });
    expect(events[events.length - 1]).toEqual({ type: "completed", finishReason: "stop", usage: expectedUsage });
  });

  it.each([
    ["default", undefined],
    ["off", "none"],
    ["low", "low"],
    ["high", "high"],
    ["max", "max"],
  ] as const)("maps DeepSeek Responses choice=%s with store:false", (choice, expectedEffort) => {
    for (const model of ["deepseek-flash", "deepseek-v4-pro"] as const) {
      const body = buildProtocolBody("openai-responses", request("openai-responses", model, { choice, includeSummary: false }));
      expect(body).toMatchObject({ model, store: false });
      if (expectedEffort === undefined) {
        expect(body).not.toHaveProperty("reasoning");
      } else {
        expect(body).toMatchObject({ reasoning: { effort: expectedEffort } });
      }
      const withSummary = buildProtocolBody("openai-responses", request("openai-responses", model, { choice, includeSummary: true }));
      expect(withSummary).toMatchObject({
        model,
        store: false,
        reasoning: expectedEffort === undefined ? { summary: "auto" } : { effort: expectedEffort, summary: "auto" },
      });
    }
  });

  it("decodes DeepSeek Responses streaming incrementally across reasoning_text.delta, .done, and multiple items", async () => {
    const item1 = { id: "r1", type: "reasoning", summary: [], content: [{ type: "reasoning_text", text: "first chain!" }], encrypted_content: "opaque-1" };
    const item2 = { id: "r2", type: "reasoning", summary: [], content: [{ type: "reasoning_text", text: "second chain" }], encrypted_content: "opaque-2" };
    const response = {
      id: "resp_ds", object: "response", status: "completed",
      output: [item1, item2, { id: "m1", type: "message", role: "assistant", content: [{ type: "output_text", text: "done", annotations: [] }] }],
      usage: { input_tokens: 10, output_tokens: 30, total_tokens: 40, output_tokens_details: { reasoning_tokens: 19 } },
    };
    const expectedUsage = { inputTokens: 10, outputTokens: 30, totalTokens: 40, reasoningTokens: 19 };
    const events = await decode("openai-responses", [
      { type: "response.reasoning_text.delta", item_id: "r1", content_index: 0, delta: "first ", sequence_number: 1 },
      { type: "response.reasoning_text.delta", item_id: "r1", content_index: 0, delta: "chain", sequence_number: 2 },
      // .done supplies the unique suffix "!" before output_item.done / response.completed arrive
      { type: "response.reasoning_text.done", item_id: "r1", content_index: 0, text: "first chain!", sequence_number: 3 },
      { type: "response.reasoning_text.delta", item_id: "r2", content_index: 0, delta: "second ", sequence_number: 4 },
      { type: "response.reasoning_text.done", item_id: "r2", content_index: 0, text: "second chain", sequence_number: 5 },
      { type: "response.output_text.delta", delta: "do", sequence_number: 6 },
      { type: "response.output_item.done", item: item1, sequence_number: 7 },
      { type: "response.output_item.done", item: item2, sequence_number: 8 },
      { type: "response.output_text.delta", delta: "ne", sequence_number: 9 },
      { type: "response.completed", response, sequence_number: 10 },
    ], true, true, "deepseek-v4-pro");
    expect(events).toEqual([
      { type: "thinking-delta", text: "first " },
      { type: "thinking-delta", text: "chain" },
      { type: "thinking-delta", text: "!" },
      { type: "thinking-delta", text: "\n\nsecond " },
      { type: "thinking-delta", text: "chain" },
      { type: "text-delta", text: "do" },
      { type: "text-delta", text: "ne" },
      { type: "usage-update", usage: expectedUsage },
      { type: "completed", usage: expectedUsage },
    ]);
    expect(JSON.stringify(events)).not.toContain("opaque");
  });

  it("decodes DeepSeek non-streaming Responses without top-level output_text including reasoning-only max_output_tokens", async () => {
    const standard = {
      id: "resp_ds_nonstream", object: "response", status: "completed",
      output: [
        { id: "r1", type: "reasoning", summary: [], content: [{ type: "reasoning_text", text: "deep thought" }] },
        { id: "m1", type: "message", role: "assistant", content: [{ type: "output_text", text: "synthesized answer", annotations: [] }] },
      ],
      usage: { input_tokens: 15, output_tokens: 25, total_tokens: 40, output_tokens_details: { reasoning_tokens: 12 } },
    };
    const events = await decode("openai-responses", standard, false, true, "deepseek-v4-pro");
    expect(text(events, "thinking-delta")).toBe("deep thought");
    expect(text(events, "text-delta")).toBe("synthesized answer");
    expect(events[events.length - 1]).toEqual({
      type: "completed",
      usage: { inputTokens: 15, outputTokens: 25, totalTokens: 40, reasoningTokens: 12 },
    });

    const reasoningOnly = {
      id: "resp_ds_truncated", object: "response", status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: [
        { id: "r1", type: "reasoning", summary: [], content: [{ type: "reasoning_text", text: "truncated thought" }] },
      ],
      usage: { input_tokens: 15, output_tokens: 64, total_tokens: 79, output_tokens_details: { reasoning_tokens: 64 } },
    };
    const truncatedEvents = await decode("openai-responses", reasoningOnly, false, true, "deepseek-flash");
    expect(text(truncatedEvents, "thinking-delta")).toBe("truncated thought");
    expect(text(truncatedEvents, "text-delta")).toBe("");
    expect(truncatedEvents[truncatedEvents.length - 1]).toEqual({
      type: "completed", finishReason: "incomplete:max_output_tokens",
      usage: { inputTokens: 15, outputTokens: 64, totalTokens: 79, reasoningTokens: 64 },
    });
  });

  it("maps DeepSeek Anthropic thinking modes and independent effort, and decodes thinking blocks", async () => {
    const omitted = buildProtocolBody("anthropic-native", request("anthropic-native", "deepseek-v4-pro"));
    expect(omitted).not.toHaveProperty("thinking");
    expect(omitted).not.toHaveProperty("output_config");

    for (const effort of ["low", "high", "max"] as const) {
      const defaultWithEffort = buildProtocolBody("anthropic-native", request("anthropic-native", "deepseek-v4-pro", { choice: "default", effort }));
      expect(defaultWithEffort).not.toHaveProperty("thinking");
      expect(defaultWithEffort).toMatchObject({ model: "deepseek-v4-pro", output_config: { effort } });
    }

    expect(buildProtocolBody("anthropic-native", request("anthropic-native", "deepseek-v4-pro", { choice: "off", effort: "high" }))).toMatchObject({
      model: "deepseek-v4-pro", thinking: { type: "disabled" }, output_config: { effort: "high" },
    });
    expect(buildProtocolBody("anthropic-native", request("anthropic-native", "deepseek-v4-pro", { choice: "adaptive", effort: "max", includeSummary: true }))).toMatchObject({
      model: "deepseek-v4-pro", thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: "max" },
    });
    expect(buildProtocolBody("anthropic-native", request("anthropic-native", "deepseek-flash", { choice: "budget", budget: "2048", effort: "low", includeSummary: false }))).toMatchObject({
      model: "deepseek-flash", thinking: { type: "enabled", budget_tokens: 2048, display: "omitted" }, output_config: { effort: "low" },
    });

    const streamEvents = await decode("anthropic-native", [
      { type: "message_start", message: { usage: { input_tokens: 8, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "ds thought" } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "ds answer" } },
      { type: "content_block_stop", index: 1 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 15, output_tokens_details: { thinking_tokens: 9 } } },
      { type: "message_stop" },
    ], true, true, "deepseek-v4-pro");
    expect(text(streamEvents, "thinking-delta")).toBe("ds thought");
    expect(text(streamEvents, "text-delta")).toBe("ds answer");
    expect(streamEvents[streamEvents.length - 1]).toMatchObject({
      type: "completed", finishReason: "end_turn",
      usage: { uncachedInputTokens: 8, inputTokens: 8, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 15, reasoningTokens: 9 },
    });

    const nonStreamEvents = await decode("anthropic-native", {
      type: "message",
      content: [{ type: "thinking", thinking: "ds thought" }, { type: "text", text: "ds answer" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 8, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 15, output_tokens_details: { thinking_tokens: 9 } },
    }, false, true, "deepseek-v4-pro");
    expect(text(nonStreamEvents, "thinking-delta")).toBe("ds thought");
    expect(text(nonStreamEvents, "text-delta")).toBe("ds answer");
    expect(nonStreamEvents[nonStreamEvents.length - 1]).toMatchObject({
      type: "completed", finishReason: "end_turn",
      usage: { uncachedInputTokens: 8, inputTokens: 8, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 15, reasoningTokens: 9 },
    });
  });
});
