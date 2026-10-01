import { expect, it } from "vitest";
import { drawingExportParameters } from "./exportParameters";
import type { DrawingParameters } from "./types";

it("exports only actual protocol option fields and excludes every private or unknown field", () => {
  const stored = { prompt: "合成提示词 🌸", modelId: "actual-model", modelName: "private label", protocol: "gemini-image" as const,
    providerId: "private-provider", connectionId: "private-connection", configuredModelId: "local-id", baseUrl: "https://private.test",
    apiKey: "synthetic-secret", machinePath: "C:\\private", futureField: "unknown", references: [], aspectRatio: "1:1", resolution: "auto" };
  expect(drawingExportParameters(stored)).toEqual({ prompt: stored.prompt, model: "actual-model", protocol: "gemini-image", api_type: "gemini", aspect_ratio: "1:1" });
  const openai: DrawingParameters = { ...stored, protocol: "openai-images", size: "auto", quality: "high" };
  expect(drawingExportParameters(openai)).toEqual({ prompt: stored.prompt, model: "actual-model", protocol: "openai-images", api_type: "gpt", quality: "high" });
});
