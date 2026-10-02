import type { FetchLike } from "../chat/types";
import { resolveSeedreamImagesEndpoint } from "../chat/urlResolution";
import { ImageGenerationError } from "./imageResponse";
import { imageRecord, requestJSONImages } from "./jsonImages";
import type { DrawingParameters, ImageGenerationTransport, SeedreamDrawingOptions } from "./types";

export const seedreamModelVersions = ["4.0", "4.5", "5.0-lite", "5.0-pro", "5.0-flash"] as const;
export const seedreamSizesByVersion: Record<SeedreamDrawingOptions["modelVersion"], readonly string[]> = {
  "4.0": ["auto", "1K", "2K", "4K"], "4.5": ["auto", "2K", "4K"], "5.0-lite": ["auto", "2K", "3K", "4K"],
  "5.0-pro": ["auto", "1K", "1.5K", "2K"], "5.0-flash": ["auto", "1K", "1.5K", "2K"],
};
export const seedreamOutputFormats = ["auto", "png", "jpeg"] as const;
export const seedreamWatermarks = ["auto", "on", "off"] as const;
export const initialSeedreamDrawingOptions: SeedreamDrawingOptions = { modelVersion: "4.5", size: "auto", outputFormat: "auto", watermark: "auto" };

/** Draft sizes may be incomplete while editing; dispatch validates the selected profile's numeric constraints. */
export function validSeedreamDrawingOptions(value: unknown): value is SeedreamDrawingOptions {
  return imageRecord(value) && Object.keys(value).every(key => ["modelVersion", "size", "outputFormat", "watermark"].includes(key))
    && (seedreamModelVersions as readonly unknown[]).includes(value.modelVersion) && typeof value.size === "string"
    && (seedreamOutputFormats as readonly unknown[]).includes(value.outputFormat)
    && (seedreamWatermarks as readonly unknown[]).includes(value.watermark);
}

export function validateSeedreamImagesParameters(parameters: DrawingParameters): asserts parameters is Extract<DrawingParameters, { protocol: "seedream-images" }> {
  if (parameters.protocol !== "seedream-images") throw new ImageGenerationError("绘图协议与参数不匹配。");
  if (!Object.keys(parameters).every(key => ["prompt", "providerId", "connectionId", "configuredModelId", "modelId", "modelName", "baseUrl", "references", "protocol",
    "modelVersion", "size", "outputFormat", "watermark"].includes(key))) throw new ImageGenerationError("Seedream 绘图参数包含不支持的字段，请重新设置。");
  resolveSeedreamImagesEndpoint(parameters.baseUrl, parameters.modelId);
  if (!parameters.prompt.trim()) throw new ImageGenerationError("提示词不能为空。");
  const { modelVersion, size, outputFormat, watermark } = parameters;
  if (!validSeedreamDrawingOptions({ modelVersion, size, outputFormat, watermark })) throw new ImageGenerationError("Seedream 绘图参数无效，请重新设置。");
  if (!modelVersion.startsWith("5.0") && outputFormat !== "auto") throw new ImageGenerationError("Seedream 自定义输出格式仅支持明确选择的 5.0 版本。");
  if (seedreamSizesByVersion[modelVersion].includes(size)) return;
  const match = /^([1-9]\d*)x([1-9]\d*)$/.exec(size);
  const width = Number(match?.[1]), height = Number(match?.[2]), pixels = width * height;
  const compact = modelVersion === "5.0-pro" || modelVersion === "5.0-flash";
  const minimum = compact || modelVersion === "4.0" ? 921_600 : 3_686_400;
  const maximum = compact ? 4_624_220 : 16_777_216;
  if (!match || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || pixels < minimum || pixels > maximum
    || Math.max(width, height) / Math.min(width, height) > 16) {
    throw new ImageGenerationError(`Seedream 尺寸须为当前版本支持的档位或宽x高，总像素 ${minimum}–${maximum}，比例在 1:16 至 16:1。`);
  }
}

export function createSeedreamImagesTransport(fetcher: FetchLike): ImageGenerationTransport {
  return { async generate(parameters, apiKey, signal, references = []) {
    validateSeedreamImagesParameters(parameters);
    const maxReferences = parameters.modelVersion === "5.0-pro" || parameters.modelVersion === "5.0-flash" ? 10 : 14;
    if (references.length > maxReferences) throw new ImageGenerationError(`当前 Seedream 版本最多支持 ${maxReferences} 张参考图。`);
    const fields: Record<string, unknown> = { model: parameters.modelId.trim(), prompt: parameters.prompt.trim(), response_format: "b64_json",
      ...(["4.0", "4.5", "5.0-lite"].includes(parameters.modelVersion) ? { sequential_image_generation: "disabled" } : {}),
      ...(parameters.size !== "auto" ? { size: parameters.size } : {}),
      ...(parameters.outputFormat !== "auto" ? { output_format: parameters.outputFormat } : {}),
      ...(parameters.watermark !== "auto" ? { watermark: parameters.watermark === "on" } : {}) };
    const images = references.map(image => `data:${image.mime};base64,${image.data}`);
    if (images.length) fields.image = images.length === 1 ? images[0] : images;
    return requestJSONImages(fetcher, resolveSeedreamImagesEndpoint(parameters.baseUrl, parameters.modelId), fields, apiKey, signal);
  } };
}
