import type { FetchLike } from "../chat/types";
import { resolveOpenAIImagesEndpoint } from "../chat/urlResolution";
import { ImageGenerationError, readBoundedImageResponse } from "./imageResponse";
import type { DrawingImageInput, DrawingParameters, ImageGenerationTransport } from "./types";

export const openAIImageQualities = ["auto", "low", "medium", "high", "xhigh", "max"] as const;
export const openAIImageSizes = ["auto", "1024x1024", "1536x1024", "1024x1536", "2048x2048", "2048x1152", "3840x2160", "2160x3840"] as const;

export function validateOpenAIImagesParameters(parameters: DrawingParameters): asserts parameters is Extract<DrawingParameters, { protocol: "openai-images" }> {
  if (parameters.protocol !== "openai-images") throw new ImageGenerationError("绘图协议与参数不匹配。");
  resolveOpenAIImagesEndpoint(parameters.baseUrl, parameters.modelId);
  if (["dall-e-2", "dall-e-3"].includes(parameters.modelId.trim())) throw new ImageGenerationError("当前绘图接入支持 GPT Image 与兼容服务，尚未接入 DALL·E 参数契约。");
  if (!parameters.prompt.trim() || parameters.prompt.length > 32_000) throw new ImageGenerationError("提示词不能为空，且最多 32000 个字符。");
  if (!(openAIImageQualities as readonly string[]).includes(parameters.quality)) throw new ImageGenerationError("绘图画质无效，请重新选择。");
  // Aliases/relays need explicit service acceptance; never infer capabilities from names.
  if (parameters.size === "auto") return;
  const match = /^([1-9]\d{0,3})x([1-9]\d{0,3})$/.exec(parameters.size);
  const width = Number(match?.[1]), height = Number(match?.[2]), pixels = width * height;
  if (!match || width % 16 || height % 16 || width > 3840 || height > 3840
    || Math.max(width, height) / Math.min(width, height) > 3 || pixels < 655_360 || pixels > 8_294_400) {
    throw new ImageGenerationError("尺寸须为宽x高：边长为 16 的倍数且不超过 3840，比例在 1:3 至 3:1，总像素 655360–8294400。");
  }
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

export function parseOpenAIImages(value: unknown): DrawingImageInput[] {
  if (!record(value)) throw new ImageGenerationError("绘图服务返回了无效响应。");
  if (value.error) throw new ImageGenerationError("绘图服务返回了错误。");
  if (!Array.isArray(value.data) || !value.data.length) throw new ImageGenerationError("绘图服务未返回图片。");
  if (value.data.length > 8) throw new ImageGenerationError("绘图结果超出本地保存限制。");
  const format = value.output_format ?? "png";
  if (format !== "png" && format !== "jpeg" && format !== "webp") throw new ImageGenerationError("绘图服务返回了不支持的图片格式。");
  let totalBytes = 0;
  return value.data.map(item => {
    if (!record(item)) throw new ImageGenerationError("绘图服务返回了无效图片字段。");
    const data = item.b64_json;
    if (data === undefined && typeof item.url === "string") throw new ImageGenerationError("当前仅支持 Base64 图片，服务返回的 URL 不会自动下载。");
    if (typeof data !== "string" || !data.length || data.length > Math.ceil(32 * 1024 * 1024 / 3) * 4
      || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new ImageGenerationError("绘图服务返回了无效或过大的图片。");
    const size = data.length / 4 * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
    totalBytes += size;
    if (size > 32 * 1024 * 1024 || totalBytes > 64 * 1024 * 1024) throw new ImageGenerationError("绘图结果超出本地保存限制。");
    return { mime: `image/${format}`, data };
  });
}

export function createOpenAIImagesTransport(fetcher: FetchLike): ImageGenerationTransport {
  return { async generate(parameters, apiKey, signal) {
    validateOpenAIImagesParameters(parameters);
    if (!apiKey.trim() || /[\u0000-\u001f\u007f]/.test(apiKey)) throw new ImageGenerationError("请先在设置中填写有效的绘图 API Key。");
    if (signal.aborted) throw new ImageGenerationError("请求尚未发出，已取消。");
    const endpoint = resolveOpenAIImagesEndpoint(parameters.baseUrl, parameters.modelId);
    const controller = new AbortController(), abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, 400_000);
    try {
      const response = await fetcher(endpoint, {
        method: "POST", redirect: "error", credentials: "omit", signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey.trim()}` },
        body: JSON.stringify({ model: parameters.modelId.trim(), prompt: parameters.prompt.trim(), n: 1, output_format: "png",
          ...(parameters.size !== "auto" ? { size: parameters.size } : {}),
          ...(parameters.quality !== "auto" ? { quality: parameters.quality } : {}) }),
      });
      if ((response.status >= 300 && response.status < 400) || response.redirected || (response.url && response.url !== endpoint)) {
        await response.body?.cancel().catch(() => undefined);
        throw new ImageGenerationError(`绘图服务重定向已拒绝（HTTP ${response.status}），服务端结果未知。`, "unknown");
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new ImageGenerationError(`绘图请求失败（HTTP ${response.status}）。`, response.status >= 500 ? "unknown" : "failed");
      }
      const text = await readBoundedImageResponse(response, controller.signal);
      let value: unknown;
      try { value = JSON.parse(text); } catch { throw new ImageGenerationError("绘图服务返回的 JSON 无法解析。"); }
      return parseOpenAIImages(value);
    } catch (error) {
      if (error instanceof ImageGenerationError) throw error;
      throw new ImageGenerationError("网络中断、请求超时或请求已停止，服务端结果未知。请勿自动重发。", "unknown");
    } finally { clearTimeout(timeout); signal.removeEventListener("abort", abort); }
  } };
}
