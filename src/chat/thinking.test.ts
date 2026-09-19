import { describe, expect, it } from "vitest";
import { buildProtocolBody, validateRequestConfig } from "./requestMapping";
import { defaultSessionConfig, restoreSessionConfig } from "./sessionConfig";
import { defaultThinking, getThinkingSettings, thinkingCapability, withThinkingSettings, type ThinkingSettings } from "./thinking";
import { createChatTransport } from "./transport";
import { planContextBudget } from "./contextBudget";
import type { ChatEvent, ChatProtocol, ChatRequest } from "./types";

const base: ChatRequest = { baseUrl: "https://synthetic.example", apiKey: "synthetic-only", model: "gpt-5.2",
  messages: [{ role: "user", content: "hello" }] };
function request(protocol: ChatProtocol, model: string, settings: Partial<ThinkingSettings> = {}, stream = true): ChatRequest {
  return { ...base, model, config: withThinkingSettings({ ...defaultSessionConfig(), stream }, protocol, { ...defaultThinking, ...settings }) };
}
async function decode(protocol: ChatProtocol, payload: unknown, streaming = true, includeSummary = true) {
  const req = request(protocol, protocol === "anthropic-native" ? "claude-sonnet-4-6" : "gpt-5.2", { includeSummary }, streaming);
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
  it.each(["openai-chat", "openai-responses", "anthropic-native"] as const)("%s leaves unknown aliases alone", (protocol) => {
    const req = request(protocol, "relay-renamed-model");
    const body = buildProtocolBody(protocol, req);
    for (const key of ["reasoning_effort", "reasoning", "thinking", "output_config"]) expect(body).not.toHaveProperty(key);
    expect(() => buildProtocolBody(protocol, request(protocol, "gpt-5.2-relay", { choice: "high" }))).toThrow("不支持");
  });
  it("maps OpenAI effort and summary independently, preserving local history and store:false", () => {
    expect(buildProtocolBody("openai-chat", request("openai-chat", "gpt-5.2", { choice: "off" }))).toMatchObject({ reasoning_effort: "none" });
    const defaults = buildProtocolBody("openai-chat", request("openai-chat", "gpt-5.2"));
    expect(defaults).not.toHaveProperty("reasoning_effort"); expect(defaults).not.toHaveProperty("reasoning");
    expect(buildProtocolBody("openai-responses", request("openai-responses", "gpt-5.2"))).toMatchObject({ reasoning: { summary: "auto" }, store: false });
    expect(buildProtocolBody("openai-responses", request("openai-responses", "gpt-5.2", { choice: "high", includeSummary: false }))).toMatchObject({ reasoning: { effort: "high" } });
    expect(buildProtocolBody("openai-responses", request("openai-responses", "gpt-5.2", { includeSummary: false }))).not.toHaveProperty("reasoning");
    expect(buildProtocolBody("openai-responses", request("openai-responses", "o1"))).not.toHaveProperty("reasoning");
  });
  it("uses exact per-model effort lists, never infers off or future variants", () => {
    expect(thinkingCapability("openai-chat", "gpt-5")?.choices).toEqual(["default", "minimal", "low", "medium", "high"]);
    expect(thinkingCapability("openai-responses", "gpt-5.1")?.choices).not.toContain("xhigh");
    expect(thinkingCapability("openai-responses", "gpt-6-astra")?.choices).toContain("max");
    expect(thinkingCapability("openai-responses", "gpt-6-astra")?.choices).not.toContain("off");
    expect(thinkingCapability("openai-chat", "gpt-5.2-chat-latest")).toBeUndefined();
    for (const [model, choice] of [["gpt-5", "off"], ["o3", "minimal"], ["gpt-5.1", "xhigh"], ["gpt-6-astra", "off"]] as const) {
      expect(() => buildProtocolBody("openai-chat", request("openai-chat", model, { choice }))).toThrow("不支持");
    }
  });
  it("allows documented explicit-none sampling without allowing sampling on active reasoning", () => {
    const req = request("openai-responses", "gpt-5.2", { choice: "off" });
    req.config!.temperature = { mode: "custom", value: "0.5" };
    expect(buildProtocolBody("openai-responses", req)).toMatchObject({ temperature: 0.5, reasoning: { effort: "none" } });
    req.config = withThinkingSettings(req.config!, "openai-responses", { ...defaultThinking, choice: "high" });
    expect(() => buildProtocolBody("openai-responses", req)).toThrow("采样");
  });
  it.each(["gpt-5.4", "gpt-5.4-2026-03-05"])("allows %s explicit-none sampling on both OpenAI protocols", (model) => {
    for (const protocol of ["openai-chat", "openai-responses"] as const) {
      for (const field of ["temperature", "topP"] as const) {
        const req = request(protocol, model, { choice: "off" });
        req.config![field] = { mode: "custom", value: "0.5" };
        const body = buildProtocolBody(protocol, req);
        expect(body[field === "topP" ? "top_p" : field]).toBe(0.5);
        expect(protocol === "openai-chat" ? body.reasoning_effort : (body.reasoning as { effort: string }).effort).toBe("none");
        req.config = withThinkingSettings(req.config!, protocol, { ...defaultThinking, choice: "low" });
        expect(() => buildProtocolBody(protocol, req)).toThrow("采样");
      }
    }
  });
  it("maps Anthropic default, disabled, manual and adaptive without conflating display", () => {
    expect(buildProtocolBody("anthropic-native", request("anthropic-native", "claude-opus-4-7"))).not.toHaveProperty("thinking");
    expect(buildProtocolBody("anthropic-native", request("anthropic-native", "claude-opus-4-7", { choice: "off" }))).toMatchObject({ thinking: { type: "disabled" } });
    expect(buildProtocolBody("anthropic-native", request("anthropic-native", "claude-opus-4-7", { choice: "adaptive", effort: "xhigh" }))).toMatchObject({
      thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: "xhigh" },
    });
    expect(buildProtocolBody("anthropic-native", request("anthropic-native", "claude-opus-4-5", { choice: "budget", budget: "1024", effort: "low", includeSummary: false }))).toMatchObject({
      thinking: { type: "enabled", budget_tokens: 1024, display: "omitted" }, output_config: { effort: "low" },
    });
    expect(() => buildProtocolBody("anthropic-native", request("anthropic-native", "claude-opus-4-7", { choice: "budget" }))).toThrow("不支持");
    expect(() => buildProtocolBody("anthropic-native", request("anthropic-native", "claude-sonnet-4-5", { choice: "adaptive" }))).toThrow("不支持");
    expect(() => buildProtocolBody("anthropic-native", request("anthropic-native", "claude-sonnet-4-5", { effort: "high" }))).toThrow("不支持");
  });
  it.each(["", "NaN", "1023", "1024.1", "4096", "99999999999999999"])("rejects invalid/manual budget %s against effective max", (budget) => {
    expect(() => buildProtocolBody("anthropic-native", request("anthropic-native", "claude-sonnet-4-6", { choice: "budget", budget }))).toThrow("预算");
  });
  it("checks request-level output override and sampling conflicts without rewriting settings", () => {
    const req = request("anthropic-native", "claude-sonnet-4-6", { choice: "budget", budget: "2048" });
    expect(() => buildProtocolBody("anthropic-native", { ...req, maxOutputTokens: 2048 })).toThrow("预算");
    req.config!.temperature = { mode: "custom", value: "0.9" };
    req.config!.topP = { mode: "custom", value: "0.9" };
    req.config!.topK = { mode: "custom", value: "1" };
    const before = JSON.stringify(req);
    expect(validateRequestConfig(req.config!, "anthropic-native", req.model)).toMatchObject({ temperature: expect.any(String), topP: expect.any(String), topK: expect.any(String) });
    expect(JSON.stringify(req)).toBe(before);
  });
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
    for await (const event of createChatTransport(protocol, { fetch }).stream({ ...request(protocol, "unknown"), signal: controller.signal })) {
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
  it("does not infer Chat compatible reasoning_content or turn literal answer tags into reasoning", async () => {
    const events = await decode("openai-chat", { choices: [{ message: { content: "<think>literal answer</think>", reasoning_content: "unconfirmed extension" }, finish_reason: "stop" }] }, false);
    expect(text(events, "thinking-delta")).toBe(""); expect(text(events, "text-delta")).toBe("<think>literal answer</think>");
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
