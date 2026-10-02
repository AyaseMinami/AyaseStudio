import { expect, it } from "vitest";
import { drawingExportParameters } from "./exportParameters";
import type { DrawingParameters } from "./types";

it("exports explicit Gemini controls only and excludes them for OpenAI and historical defaults", () => {
  const common = { prompt: "text", modelId: "model", modelName: "model", providerId: "p", connectionId: "c", configuredModelId: "m", baseUrl: "https://example.test" };
  const gemini = { temperature: 0, safetyThreshold: "BLOCK_NONE" as const, outputMode: "image" as const, apiKey: "synthetic" };
  expect(drawingExportParameters({ ...common, protocol: "gemini-image", aspectRatio: "auto", resolution: "auto", gemini }))
    .toEqual({ prompt: "text", model: "model", protocol: "gemini-image", api_type: "gemini", temperature: 0,
      safety_threshold: "BLOCK_NONE", response_modalities: ["IMAGE"] });
  expect(drawingExportParameters({ ...common, protocol: "gemini-image", aspectRatio: "auto", resolution: "auto" }))
    .not.toHaveProperty("temperature");
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
