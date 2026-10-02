import type { FetchLike } from "../chat/types";
import { resolveGrokImagesEndpoint } from "../chat/urlResolution";
import { ImageGenerationError } from "./imageResponse";
import { imageRecord, requestJSONImages } from "./jsonImages";
import type { DrawingParameters, GrokDrawingOptions, ImageGenerationTransport } from "./types";

export const grokModelVersions = ["legacy", "2.0"] as const;
export const grokAspectRatios = ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "2:1", "1:2", "19.5:9", "9:19.5", "20:9", "9:20", "21:9", "5:2"] as const;
export const grokResolutions = ["auto", "1k", "2k"] as const;
export const grokQualities = ["auto", "low", "medium"] as const;
export const initialGrokDrawingOptions: GrokDrawingOptions = { modelVersion: "legacy", aspectRatio: "auto", resolution: "auto", quality: "auto" };

export function validGrokDrawingOptions(value: unknown): value is GrokDrawingOptions {
  return imageRecord(value) && Object.keys(value).every(key => ["modelVersion", "aspectRatio", "resolution", "quality"].includes(key))
    && (grokModelVersions as readonly unknown[]).includes(value.modelVersion)
    && (grokAspectRatios as readonly unknown[]).includes(value.aspectRatio)
    && (grokResolutions as readonly unknown[]).includes(value.resolution)
    && (grokQualities as readonly unknown[]).includes(value.quality);
}

export function validateGrokImagesParameters(parameters: DrawingParameters): asserts parameters is Extract<DrawingParameters, { protocol: "grok-images" }> {
  if (parameters.protocol !== "grok-images") throw new ImageGenerationError("绘图协议与参数不匹配。");
  if (!Object.keys(parameters).every(key => ["prompt", "providerId", "connectionId", "configuredModelId", "modelId", "modelName", "baseUrl", "references", "protocol",
    "modelVersion", "aspectRatio", "resolution", "quality"].includes(key))) throw new ImageGenerationError("Grok 绘图参数包含不支持的字段，请重新设置。");
  resolveGrokImagesEndpoint(parameters.baseUrl, parameters.modelId);
  if (!parameters.prompt.trim()) throw new ImageGenerationError("提示词不能为空。");
  const { modelVersion, aspectRatio, resolution, quality } = parameters;
  if (!validGrokDrawingOptions({ modelVersion, aspectRatio, resolution, quality })) throw new ImageGenerationError("Grok 绘图参数无效，请重新设置。");
  if (modelVersion !== "2.0" && quality !== "auto") throw new ImageGenerationError("Grok 画质参数仅支持明确选择的 2.0 版本。");
  if (modelVersion !== "2.0" && ["21:9", "5:2"].includes(aspectRatio)) throw new ImageGenerationError("Grok 21:9 和 5:2 比例仅支持明确选择的 2.0 版本。");
}

export function createGrokImagesTransport(fetcher: FetchLike): ImageGenerationTransport {
  return { async generate(parameters, apiKey, signal, references = []) {
    validateGrokImagesParameters(parameters);
    if (references.length > 5) throw new ImageGenerationError("Grok 单次编辑最多支持 5 张参考图。");
    const fields: Record<string, unknown> = { model: parameters.modelId.trim(), prompt: parameters.prompt.trim(), n: 1, response_format: "b64_json",
      ...(parameters.aspectRatio !== "auto" ? { aspect_ratio: parameters.aspectRatio } : {}),
      ...(parameters.resolution !== "auto" ? { resolution: parameters.resolution } : {}),
      ...(parameters.quality !== "auto" ? { quality: parameters.quality } : {}) };
    const images = references.map(image => ({ url: `data:${image.mime};base64,${image.data}`, type: "image_url" }));
    if (images.length === 1) fields.image = images[0];
    else if (images.length > 1) fields.images = images;
    return requestJSONImages(fetcher, resolveGrokImagesEndpoint(parameters.baseUrl, parameters.modelId, references.length ? "edits" : "generations"), fields, apiKey, signal);
  } };
}
