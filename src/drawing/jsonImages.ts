import type { FetchLike } from "../chat/types";
import { ImageGenerationError, normalizeVerifiedImageResponseData, readBoundedImageResponse } from "./imageResponse";
import type { DrawingImageInput } from "./types";

export function imageRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatMime(format: unknown): string | undefined {
  if (format === undefined) return undefined;
  if (format !== "png" && format !== "jpeg" && format !== "webp") throw new ImageGenerationError("绘图服务返回了不支持的图片格式。");
  return `image/${format}`;
}

/** Shared byte-response contract for Grok and Seedream, without downloading URL results. */
export function parseJSONImages(value: unknown): DrawingImageInput[] {
  if (!imageRecord(value)) throw new ImageGenerationError("绘图服务返回了无效响应。");
  if (value.error) throw new ImageGenerationError("绘图服务返回了错误。");
  const items = Array.isArray(value.data) ? value.data : imageRecord(value.data) ? [value.data] : [];
  if (!items.length) throw new ImageGenerationError("绘图服务未返回图片。");
  if (items.length > 8) throw new ImageGenerationError("绘图结果超出本地保存限制。");
  const topMime = formatMime(value.output_format);
  let totalBytes = 0;
  return items.map(item => {
    if (!imageRecord(item)) throw new ImageGenerationError("绘图服务返回了无效图片字段。");
    if (item.error) throw new ImageGenerationError("绘图服务返回了图片错误。");
    if (item.b64_json === undefined && typeof item.url === "string") {
      throw new ImageGenerationError("当前仅支持 Base64 图片，服务返回的 URL 不会自动下载。");
    }
    const itemMime = formatMime(item.output_format);
    if (topMime && itemMime && topMime !== itemMime) throw new ImageGenerationError("绘图服务返回了不匹配的图片格式。");
    const normalized = normalizeVerifiedImageResponseData(item.b64_json, itemMime ?? topMime);
    totalBytes += normalized.bytes;
    if (totalBytes > 64 * 1024 * 1024) throw new ImageGenerationError("绘图结果超出本地保存限制。");
    return { mime: normalized.mime, data: normalized.data };
  });
}

/** One non-stream JSON dispatch, using the existing drawing timeout and uncertain-outcome rules. */
export async function requestJSONImages(fetcher: FetchLike, endpoint: string, fields: Record<string, unknown>, apiKey: string, signal: AbortSignal): Promise<DrawingImageInput[]> {
  if (!apiKey.trim() || /[\u0000-\u001f\u007f]/.test(apiKey)) throw new ImageGenerationError("请先在设置中填写有效的绘图 API Key。");
  if (signal.aborted) throw new ImageGenerationError("请求尚未发出，已取消。");
  const controller = new AbortController(), abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 400_000);
  try {
    const response = await fetcher(endpoint, {
      method: "POST", redirect: "error", credentials: "omit", signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey.trim()}` }, body: JSON.stringify(fields),
    });
    if (response.status >= 300 && response.status < 400 || response.redirected || response.url && response.url !== endpoint) {
      await response.body?.cancel().catch(() => undefined);
      throw new ImageGenerationError(`绘图服务重定向已拒绝（HTTP ${response.status}），服务端结果未知。`, "unknown");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ImageGenerationError(`绘图请求失败（HTTP ${response.status}）。`, response.status >= 500 ? "unknown" : "failed",
        response.status === 429 ? "rate-limited" : response.status >= 500 ? "network-unknown" : "rejected", response.status);
    }
    const text = await readBoundedImageResponse(response, controller.signal);
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new ImageGenerationError("绘图服务返回的 JSON 无法解析。"); }
    return parseJSONImages(value);
  } catch (error) {
    if (error instanceof ImageGenerationError) throw error;
    throw new ImageGenerationError("网络中断、请求超时或请求已停止，服务端结果未知。请勿自动重发。", "unknown");
  } finally { clearTimeout(timeout); signal.removeEventListener("abort", abort); }
}
