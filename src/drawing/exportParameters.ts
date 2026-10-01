import type { DrawingExportParameters, DrawingParameters } from "./types";

/** Match submitted option fields, not provider defaults or arbitrary stored keys. */
export function drawingExportParameters(parameters: DrawingParameters): DrawingExportParameters {
  const common = { prompt: parameters.prompt, model: parameters.modelId, protocol: parameters.protocol };
  return parameters.protocol === "gemini-image"
    ? { ...common, api_type: "gemini",
      ...(parameters.aspectRatio !== "auto" ? { aspect_ratio: parameters.aspectRatio } : {}),
      ...(parameters.resolution !== "auto" ? { resolution: parameters.resolution } : {}) }
    : { ...common, api_type: "gpt",
      ...(parameters.size !== "auto" ? { size: parameters.size } : {}),
      ...(parameters.quality !== "auto" ? { quality: parameters.quality } : {}) };
}
