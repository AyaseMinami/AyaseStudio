import type { GeminiDrawingOptions } from "./types";

export const geminiSafetyThresholds = ["BLOCK_NONE", "BLOCK_ONLY_HIGH", "BLOCK_MEDIUM_AND_ABOVE", "BLOCK_LOW_AND_ABOVE", "OFF"] as const;
export const geminiSafetyCategories = ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT"] as const;

/** Shared strict semantic boundary for local settings, restore and dispatch. */
export function validGeminiDrawingOptions(raw: unknown): raw is GeminiDrawingOptions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const value = raw as Record<string, unknown>;
  return Object.keys(value).every(key => ["temperature", "safetyThreshold", "outputMode"].includes(key))
    && (!("temperature" in value) || typeof value.temperature === "number" && Number.isFinite(value.temperature) && value.temperature >= 0 && value.temperature <= 2)
    && (!("safetyThreshold" in value) || (geminiSafetyThresholds as readonly unknown[]).includes(value.safetyThreshold))
    && (!("outputMode" in value) || value.outputMode === "image" || value.outputMode === "text-image");
}
