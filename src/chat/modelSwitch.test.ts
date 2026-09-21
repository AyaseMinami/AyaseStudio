import { describe, expect, it } from "vitest";
import { defaultSessionConfig, type SessionConfig } from "./sessionConfig";
import { getThinkingSettings, switchThinkingProtocol, withThinkingSettings } from "./thinking";
import { buildProtocolBody } from "./requestMapping";

describe("protocol changes during model selection", () => {
  it("clears unavailable budget while preserving the shared thinking display preference", () => {
    const config = withThinkingSettings(defaultSessionConfig(), "gemini-native", { choice: "budget", budget: "2048", includeSummary: true });
    const chat = switchThinkingProtocol(config, "gemini-native", "openai-chat");
    expect(getThinkingSettings(chat, "gemini-native")).toEqual({ choice: "default", budget: "", includeSummary: true });
    const back = switchThinkingProtocol(chat, "openai-chat", "gemini-native");
    expect(getThinkingSettings(back, "gemini-native")).toEqual({ choice: "default", budget: "", includeSummary: true });
  });

  it("keeps common controls and maps search and thinking only through the target protocol", () => {
    let config: SessionConfig = { ...defaultSessionConfig(), webSearch: true };
    config = withThinkingSettings(config, "gemini-native", { choice: "high", budget: "", includeSummary: true });
    config = withThinkingSettings(config, "openai-responses", { choice: "low", budget: "", includeSummary: true });
    const next = switchThinkingProtocol(config, "gemini-native", "openai-responses");
    expect(getThinkingSettings(next, "openai-responses")?.choice).toBe("low");
    const body = buildProtocolBody("openai-responses", { baseUrl: "https://example.test", apiKey: "synthetic", model: "arbitrary-model", messages: [], config: next });
    expect(body).toMatchObject({ reasoning: { effort: "low", summary: "auto" }, tools: [{ type: "web_search" }] });
    expect(body).not.toHaveProperty("generationConfig");
    expect(switchThinkingProtocol(config, "gemini-native", "gemini-native")).toBe(config);
  });
});
