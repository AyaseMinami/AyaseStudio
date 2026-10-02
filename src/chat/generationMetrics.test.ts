import { describe, expect, it } from "vitest";
import { GenerationMeasurement } from "./generationMetrics";

describe("per-invocation generation measurements", () => {
  it("separates nonempty thinking and visible text from status/usage, freezing at completion", () => {
    let now = 100;
    const measurement = new GenerationMeasurement("openai-chat", true, () => now);
    now = 200; measurement.observe({ type: "usage-update", usage: { inputTokens: 100, cacheReadTokens: 80 } });
    measurement.observe({ type: "text-delta", text: " \n" });
    now = 400; measurement.observe({ type: "thinking-delta", text: "Thinking" });
    now = 900; measurement.observe({ type: "text-delta", text: "Answer" });
    now = 1100; measurement.observe({ type: "completed", usage: { outputTokens: 20, reasoningTokens: 15, totalTokens: 120 } });
    now = 2000;
    expect(measurement.snapshot("complete")).toEqual({ version: 1, protocol: "openai-chat", streaming: true,
      status: "complete", elapsedMs: 1000, firstThinkingMs: 300, firstTextMs: 800, usageComplete: true,
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheReadTokens: 80, reasoningTokens: 15 } });
  });

  it("retains observed usage on cancellation and failure without declaring it final", () => {
    for (const terminal of ["aborted", "failed"] as const) {
      let now = 0;
      const measurement = new GenerationMeasurement("anthropic-native", true, () => now);
      now = 100; measurement.observe({ type: "usage-update", usage: { inputTokens: 80, cacheReadTokens: 0 } });
      now = 200; measurement.observe(terminal === "aborted" ? { type: terminal } : { type: terminal,
        error: { kind: "network", message: "Synthetic", retryable: true } });
      now = 1000;
      expect(measurement.snapshot(terminal)).toMatchObject({ elapsedMs: 200, usageComplete: false,
        usage: { inputTokens: 80, cacheReadTokens: 0 } });
      expect(measurement.snapshot(terminal).firstTextMs).toBeUndefined();
    }
  });

  it("cannot measure a nonstream first character and keeps late usage independent of text time", () => {
    let now = 0;
    const batch = new GenerationMeasurement("gemini-native", false, () => now);
    now = 500; batch.observe({ type: "text-delta", text: "Full response" });
    batch.observe({ type: "thinking-delta", text: "Full thinking" });
    now = 700; batch.observe({ type: "completed", usage: { inputTokens: 10, outputTokens: 30 } });
    expect(batch.snapshot("complete")).toMatchObject({ elapsedMs: 700, usageComplete: true });
    expect(batch.snapshot("complete").firstTextMs).toBeUndefined();
    expect(batch.snapshot("complete").firstThinkingMs).toBeUndefined();
    now = 1000;
    const stream = new GenerationMeasurement("openai-chat", true, () => now);
    now = 1100; stream.observe({ type: "text-delta", text: "Text" });
    now = 1500; stream.observe({ type: "usage-update", usage: { outputTokens: 3 } });
    now = 1800; stream.observe({ type: "completed", usage: { outputTokens: 3 } });
    expect(stream.snapshot("complete")).toMatchObject({ elapsedMs: 800, firstTextMs: 100 });
  });

  it("does not invent usage and safely snapshots exception/empty final metadata", () => {
    let now = 0;
    const measurement = new GenerationMeasurement("openai-responses", true, () => now);
    now = 25;
    expect(measurement.snapshot("failed")).toMatchObject({ elapsedMs: 25, usageComplete: false });
    expect(measurement.snapshot("failed").usage).toBeUndefined();
    const empty = new GenerationMeasurement("openai-chat", true, () => now);
    empty.observe({ type: "completed", usage: {} });
    expect(empty.snapshot("complete").usageComplete).toBe(false);
  });

  it("retains earlier output as partial when terminal usage confirms only input", () => {
    const measurement = new GenerationMeasurement("openai-responses", true, () => 100);
    measurement.observe({ type: "usage-update", usage: { inputTokens: 10, outputTokens: 2 } });
    measurement.observe({ type: "completed", usage: { inputTokens: 10 } });
    expect(measurement.snapshot("complete")).toMatchObject({
      usage: { inputTokens: 10, outputTokens: 2 }, usageComplete: false,
    });
  });
});
