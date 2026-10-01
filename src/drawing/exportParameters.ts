import type { DrawingExportParameters, DrawingParameters } from "./types";

/** Match submitted option fields, not provider defaults or arbitrary stored keys. */
export function drawingExportParameters(parameters: DrawingParameters): DrawingExportParameters {
  const common = { prompt: parameters.prompt, model: parameters.modelId, protocol: parameters.protocol };
  return parameters.protocol === "gemini-image"
    ? { ...common, api_type: "gemini",
      ...(parameters.aspectRatio !== "auto" ? { aspect_ratio: parameters.aspectRatio } : {}),
      ...(parameters.gemini?.temperature !== undefined ? { temperature: parameters.gemini.temperature } : {}),
      ...(parameters.gemini?.safetyThreshold !== undefined ? { safety_threshold: parameters.gemini.safetyThreshold } : {}),
      ...(parameters.gemini?.outputMode !== undefined ? { response_modalities: parameters.gemini.outputMode === "image"
        ? ["IMAGE" as const] : ["TEXT" as const, "IMAGE" as const] } : {}),
      ...(parameters.resolution !== "auto" ? { resolution: parameters.resolution } : {}) }
    : { ...common, api_type: "gpt",
      ...(parameters.size !== "auto" ? { size: parameters.size } : {}),
      ...(parameters.quality !== "auto" ? { quality: parameters.quality } : {}) };
}
