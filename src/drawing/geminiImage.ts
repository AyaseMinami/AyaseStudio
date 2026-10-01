import type { FetchLike } from "../chat/types";
import { resolveImageGenerationEndpoint } from "../chat/urlResolution";
import type { DrawingImageInput, DrawingParameters, ImageGenerationTransport } from "./types";

import { ImageGenerationError, readBoundedImageResponse } from "./imageResponse";
export { ImageGenerationError } from "./imageResponse";

export const drawingAspectRatios = ["auto", "1:1", "1:4", "4:1", "1:8", "8:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] as const;
export const drawingResolutions = ["auto", "512", "1K", "2K", "4K"] as const;
const maxImageBytes = 32 * 1024 * 1024;
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

export function validateDrawingParameters(parameters: DrawingParameters): asserts parameters is Extract<DrawingParameters, { protocol: "gemini-image" }> {
  if (parameters.protocol !== "gemini-image") throw new ImageGenerationError("绘图协议与参数不匹配。");
  resolveImageGenerationEndpoint(parameters.baseUrl, parameters.modelId);
  if (!parameters.prompt.trim() || parameters.prompt.length > 32_000) throw new ImageGenerationError("提示词不能为空，且最多 32000 个字符。");
  if (!(drawingAspectRatios as readonly string[]).includes(parameters.aspectRatio) || !(drawingResolutions as readonly string[]).includes(parameters.resolution)) {
    throw new ImageGenerationError("绘图参数无效，请重新选择宽高比和分辨率。");
  }
}

export function parseGeminiImages(value: unknown): DrawingImageInput[] {
  if (!record(value)) throw new ImageGenerationError("绘图服务返回了无效响应。");
  if (record(value.promptFeedback) && value.promptFeedback.blockReason && value.promptFeedback.blockReason !== "BLOCK_REASON_UNSPECIFIED") {
    throw new ImageGenerationError("本次生成被服务的安全规则拦截。");
  }
  if (value.error) throw new ImageGenerationError("绘图服务返回了错误。");
  if (!Array.isArray(value.candidates) || value.candidates.length !== 1 || !record(value.candidates[0])) {
    throw new ImageGenerationError("绘图服务未返回有效的单个候选结果。");
  }
  const candidate = value.candidates[0];
  if (candidate.finishReason && candidate.finishReason !== "STOP") throw new ImageGenerationError("绘图结果未完整生成或被服务拦截。");
  if (!record(candidate.content) || !Array.isArray(candidate.content.parts)) throw new ImageGenerationError("绘图服务未返回图片。");
  const images: DrawingImageInput[] = [];
  let totalBytes = 0;
  for (const part of candidate.content.parts) {
    if (!record(part) || part.thought === true) continue;
    const inline = part.inlineData ?? part.inline_data;
    if (inline === undefined) continue;
    if (!record(inline)) throw new ImageGenerationError("绘图服务返回了无效图片字段。");
    const mime = inline.mimeType ?? inline.mime_type, data = inline.data;
    if (typeof mime !== "string" || !["image/png", "image/jpeg", "image/webp"].includes(mime) || typeof data !== "string"
      || !data.length || data.length > Math.ceil(maxImageBytes / 3) * 4 || data.length % 4 !== 0
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new ImageGenerationError("绘图服务返回了无效或过大的图片。");
    const size = data.length / 4 * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
    totalBytes += size;
    if (size > maxImageBytes || totalBytes > 64 * 1024 * 1024 || images.length >= 8) throw new ImageGenerationError("绘图结果超出本地保存限制。");
    images.push({ mime, data });
  }
  if (!images.length) throw new ImageGenerationError("绘图服务未返回图片；可能只返回了文本或拒绝说明。");
  return images;
}

export function createGeminiImageTransport(fetcher: FetchLike): ImageGenerationTransport {
  return { async generate(parameters, apiKey, signal, references = []) {
    validateDrawingParameters(parameters);
    if (!apiKey.trim()) throw new ImageGenerationError("请先在设置中填写绘图连接的 API Key。");
    if (signal.aborted) throw new ImageGenerationError("请求尚未发出，已取消。");
    const endpoint = resolveImageGenerationEndpoint(parameters.baseUrl, parameters.modelId);
    const imageConfig = {
      ...(parameters.aspectRatio !== "auto" ? { aspectRatio: parameters.aspectRatio } : {}),
      ...(parameters.resolution !== "auto" ? { imageSize: parameters.resolution } : {}),
    };
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), 400_000);
    try {
      const response = await fetcher(endpoint, {
        method: "POST", redirect: "error", credentials: "omit", signal: controller.signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey.trim() },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: parameters.prompt.trim() },
          ...references.map(image => ({ inlineData: { mimeType: image.mime, data: image.data } }))] }],
          generationConfig: { candidateCount: 1, responseModalities: ["TEXT", "IMAGE"],
            ...(Object.keys(imageConfig).length ? { imageConfig } : {}) } }),
      });
      if ((response.status >= 300 && response.status < 400) || response.redirected || (response.url && response.url !== endpoint)) {
        await response.body?.cancel().catch(() => undefined);
        throw new ImageGenerationError(`绘图服务重定向已拒绝（HTTP ${response.status}），服务端结果未知。`, "unknown");
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        // Provider text is intentionally not retained; it may echo credentials or private prompts.
        throw new ImageGenerationError(`绘图请求失败（HTTP ${response.status}）。`, response.status >= 500 ? "unknown" : "failed",
          response.status === 429 ? "rate-limited" : response.status >= 500 ? "network-unknown" : "rejected", response.status);
      }
      const text = await readBoundedImageResponse(response, controller.signal);
      let value: unknown;
      try { value = JSON.parse(text); } catch { throw new ImageGenerationError("绘图服务返回的 JSON 无法解析。"); }
      return parseGeminiImages(value);
    } catch (error) {
      if (error instanceof ImageGenerationError) throw error;
      throw new ImageGenerationError("网络中断、请求超时或请求已停止，服务端结果未知。请勿自动重发。", "unknown");
    } finally { clearTimeout(timeout); signal.removeEventListener("abort", abort); }
  } };
}
