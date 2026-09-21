import { describe, expect, it } from "vitest";
import { defaultGeminiThinking, geminiThinkingBody, geminiThinkingChoices } from "./geminiThinking";
import { buildProtocolBody } from "./requestMapping";
import { defaultSessionConfig, restoreSessionConfig } from "./sessionConfig";
import { createChatTransport } from "./transport";
import type { ChatEvent, ChatRequest } from "./types";
import { planContextBudget } from "./contextBudget";

const request: ChatRequest = { model: "gemini-3.8-flash", baseUrl: "https://synthetic.example", apiKey: "fake",
  messages: [{ role: "user", content: "hello" }], config: defaultSessionConfig() };
describe("Gemini thinking vertical slice", () => {
  it("exports protocol-wide choices and preserves old config", () => {
    expect(geminiThinkingChoices).toEqual(["default", "off", "minimal", "low", "medium", "high", "dynamic", "budget"]);
    expect(restoreSessionConfig(defaultSessionConfig()).invalidStoredConfig).toBeUndefined();
  });
  it("separates default effort from requesting a summary for every model ID", () => {
    expect(buildProtocolBody("gemini-native", request).generationConfig).toBeUndefined();
    expect(buildProtocolBody("gemini-native", { ...request, model: "arbitrary-relay-name" }).generationConfig).toBeUndefined();
    expect(buildProtocolBody("gemini-native", { ...request, config: { ...defaultSessionConfig(), geminiThinking: {
      ...defaultGeminiThinking, includeSummary: true,
    } } }).generationConfig).toEqual({ thinkingConfig: { includeThoughts: true } });
    expect(buildProtocolBody("gemini-native", { ...request, config: { ...defaultSessionConfig(), geminiThinking: {
      ...defaultGeminiThinking, includeSummary: false,
    } } }).generationConfig).toBeUndefined();
    expect(buildProtocolBody("openai-chat", { ...request, config: { ...defaultSessionConfig(), geminiThinking: {
      ...defaultGeminiThinking, choice: "high",
    } } })).not.toHaveProperty("reasoning_effort");
  });
  it("maps all protocol choices and budgets for arbitrary model IDs without allowing custom JSON bypass", () => {
    const configured = (model: string, choice: "high" | "minimal" | "off" | "budget", budget = "1024") => ({
      ...request, model, config: { ...defaultSessionConfig(), geminiThinking: { ...defaultGeminiThinking, choice, budget } },
    });
    expect(buildProtocolBody("gemini-native", configured("gemini-relay-x", "high")).generationConfig).toEqual({
      thinkingConfig: { thinkingLevel: "high" },
    });
    expect(buildProtocolBody("gemini-native", configured("gemini-2.5-flash", "off")).generationConfig).toEqual({
      thinkingConfig: { thinkingBudget: 0 },
    });
    expect(buildProtocolBody("gemini-native", configured("relay", "minimal")).generationConfig).toEqual({ thinkingConfig: { thinkingLevel: "minimal" } });
    expect(buildProtocolBody("gemini-native", configured("relay", "budget", "127")).generationConfig).toEqual({ thinkingConfig: { thinkingBudget: 127 } });
    expect(geminiThinkingBody({ ...defaultGeminiThinking, choice: "dynamic" })).toEqual({ thinkingBudget: -1 });
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
