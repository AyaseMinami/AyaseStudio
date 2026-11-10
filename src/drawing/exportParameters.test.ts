import { expect, it } from "vitest";
import { drawingExportParameters } from "./exportParameters";
import type { DrawingParameters } from "./types";

it.each(["svg", "gif"] as const)("exports only matching explicit OpenAI %s metadata", outputFormat => {
  const parameters: DrawingParameters = { prompt: "text", modelId: "relay-alias", modelName: "label", providerId: "p", connectionId: "c",
    configuredModelId: "m", baseUrl: "https://example.test", protocol: "openai-images", size: "auto", quality: "auto", outputFormat,
    svgModel: "author", frameCount: 9, frameDurationMs: 200 };
  expect(drawingExportParameters(parameters)).toEqual({ prompt: "text", model: "relay-alias", protocol: "openai-images", api_type: "gpt", output_format: outputFormat,
    ...(outputFormat === "svg" ? { svg_model: "author" } : { frame_count: 9, frame_duration_ms: 200 }) });
});

it("exports explicit Gemini controls only and excludes them for OpenAI and historical defaults", () => {
  const common = { prompt: "text", modelId: "model", modelName: "model", providerId: "p", connectionId: "c", configuredModelId: "m", baseUrl: "https://example.test" };
  const gemini = { temperature: 0, safetyThreshold: "BLOCK_NONE" as const, outputMode: "image" as const, thinkingLevel: "high" as const, apiKey: "synthetic" };
  expect(drawingExportParameters({ ...common, protocol: "gemini-image", aspectRatio: "auto", resolution: "auto", gemini }))
    .toEqual({ prompt: "text", model: "model", protocol: "gemini-image", api_type: "gemini", temperature: 0,
      safety_threshold: "BLOCK_NONE", response_modalities: ["IMAGE"], thinking_level: "high" });
  expect(drawingExportParameters({ ...common, protocol: "gemini-image", aspectRatio: "auto", resolution: "auto" }))
    .not.toHaveProperty("temperature");
  expect(drawingExportParameters({ ...common, protocol: "gemini-image", aspectRatio: "auto", resolution: "auto" }))
    .not.toHaveProperty("thinking_level");
  const openai = { ...common, protocol: "openai-images" as const, size: "auto", quality: "auto", gemini };
  expect(drawingExportParameters(openai)).toEqual({ prompt: "text", model: "model", protocol: "openai-images", api_type: "gpt" });
});

it("exports only actual protocol option fields and excludes every private or unknown field", () => {
  const stored = { prompt: "合成提示词 🌸", modelId: "actual-model", modelName: "private label", protocol: "gemini-image" as const,
    providerId: "private-provider", connectionId: "private-connection", configuredModelId: "local-id", baseUrl: "https://private.test",
    apiKey: "synthetic-secret", machinePath: "C:\\private", futureField: "unknown", references: [], aspectRatio: "1:1", resolution: "auto" };
  expect(drawingExportParameters(stored)).toEqual({ prompt: stored.prompt, model: "actual-model", protocol: "gemini-image", api_type: "gemini", aspect_ratio: "1:1" });
  const openai: DrawingParameters = { ...stored, protocol: "openai-images", size: "auto", quality: "high" };
  expect(drawingExportParameters(openai)).toEqual({ prompt: stored.prompt, model: "actual-model", protocol: "openai-images", api_type: "gpt", quality: "high" });
});
