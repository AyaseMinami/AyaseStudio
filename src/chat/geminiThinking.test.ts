import { describe, expect, it } from "vitest";
import { defaultGeminiThinking, geminiThinkingCapability } from "./geminiThinking";
import { buildProtocolBody } from "./requestMapping";
import { defaultSessionConfig, restoreSessionConfig } from "./sessionConfig";
import { createChatTransport } from "./transport";
import type { ChatEvent, ChatRequest } from "./types";
import { planContextBudget } from "./contextBudget";

const request: ChatRequest = { model: "gemini-3.8-flash", baseUrl: "https://synthetic.example", apiKey: "fake",
  messages: [{ role: "user", content: "hello" }], config: defaultSessionConfig() };
describe("Gemini thinking vertical slice", () => {
  it("offers only documented options for exact models and preserves old config", () => {
    expect(geminiThinkingCapability("gemini-3.8-flash")?.choices).toEqual(["default", "low", "medium", "high"]);
    expect(geminiThinkingCapability("gemini-3-flash-preview")?.choices).toContain("minimal");
    expect(geminiThinkingCapability("gemini-2.5-pro")?.choices).not.toContain("off");
    expect(geminiThinkingCapability("gemini-3.8-flash-relay")).toBeUndefined();
    expect(restoreSessionConfig(defaultSessionConfig()).invalidStoredConfig).toBeUndefined();
  });
  it("separates default effort from requesting a summary and omits all fields for unknown models", () => {
    expect(buildProtocolBody("gemini-native", request).generationConfig).toEqual({ thinkingConfig: { includeThoughts: true } });
    expect(buildProtocolBody("gemini-native", { ...request, model: "unknown" }).generationConfig).toBeUndefined();
    expect(buildProtocolBody("gemini-native", { ...request, config: { ...defaultSessionConfig(), geminiThinking: {
      ...defaultGeminiThinking, includeSummary: false,
    } } }).generationConfig).toBeUndefined();
    expect(buildProtocolBody("openai-chat", { ...request, config: { ...defaultSessionConfig(), geminiThinking: {
      ...defaultGeminiThinking, choice: "high",
    } } })).not.toHaveProperty("reasoning_effort");
  });
  it("maps levels and budgets without allowing conflicting custom JSON or unsupported choices", () => {
    const configured = (model: string, choice: "high" | "minimal" | "off" | "budget", budget = "1024") => ({
      ...request, model, config: { ...defaultSessionConfig(), geminiThinking: { ...defaultGeminiThinking, choice, budget } },
    });
    expect(buildProtocolBody("gemini-native", configured(request.model, "high")).generationConfig).toEqual({
      thinkingConfig: { thinkingLevel: "high", includeThoughts: true },
    });
    expect(buildProtocolBody("gemini-native", configured("gemini-2.5-flash", "off")).generationConfig).toEqual({
      thinkingConfig: { thinkingBudget: 0, includeThoughts: true },
    });
    expect(() => buildProtocolBody("gemini-native", configured(request.model, "minimal"))).toThrow("不支持");
    expect(() => buildProtocolBody("gemini-native", configured("gemini-2.5-pro", "off"))).toThrow("不支持");
    expect(() => buildProtocolBody("gemini-native", configured("gemini-2.5-pro", "budget", "127"))).toThrow("128");
    const config = defaultSessionConfig(); config.customJson["gemini-native"] = '{"generationConfig":{"thinkingConfig":{"thinkingLevel":"high"}}}';
    expect(() => buildProtocolBody("gemini-native", { ...request, config })).toThrow();
  });
  it.each([[true, true], [false, true], [true, false], [false, false]])("separates thoughts and respects summary opt-out (stream=%s, summary=%s)", async (stream, includeSummary) => {
    const chunk = { candidates: [{ content: { parts: [
      { text: "summary", thought: true }, { thoughtSignature: "opaque" }, { text: "answer" },
    ] }, finishReason: "STOP" }] };
    const events: ChatEvent[] = [];
    const transport = createChatTransport("gemini-native", { fetch: async () => new Response(
      stream ? `data: ${JSON.stringify(chunk)}\n\n` : JSON.stringify(chunk),
      { headers: { "content-type": stream ? "text/event-stream" : "application/json" } },
    ) });
    for await (const event of transport.stream({ ...request, config: { ...defaultSessionConfig(), stream,
      geminiThinking: { ...defaultGeminiThinking, includeSummary },
    } })) events.push(event);
    expect(events).toMatchObject([
      ...(includeSummary ? [{ type: "thinking-delta", text: "summary" }] : []),
      { type: "text-delta", text: "answer" }, { type: "completed" },
    ]);
  });
  it("does not replay display summaries as conversation history", async () => {
    const plan = await planContextBudget([
      { id: "u", role: "user", content: "question", status: "complete" },
      { id: "a", role: "assistant", content: "answer", thinkingSummary: "private display summary", status: "complete" },
    ], "next", defaultSessionConfig(), "gemini-native", request.model, () => 1);
    expect(JSON.stringify(plan.messages)).not.toContain("summary");
    expect(plan.messages[1]).toEqual({ role: "assistant", content: "answer" });
  });
});
