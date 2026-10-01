import type { DrawingDiagnostic } from "./types";

export class ImageGenerationError extends Error {
  constructor(message: string, readonly outcome: "failed" | "unknown" = "failed",
    readonly category?: DrawingDiagnostic["category"], readonly httpStatus?: number) { super(message); }
}

const maxBodyBytes = 90 * 1024 * 1024;
const maxImageBytes = 32 * 1024 * 1024;
const maxEncodedImageLength = Math.ceil(maxImageBytes / 3) * 4;
const base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Normalize only the pinned relay's CR/LF and image data-URL wrappers, before native byte validation. */
export function normalizeImageResponseData(raw: unknown, mime: unknown): { data: string; bytes: number } {
  if (typeof mime !== "string" || !["image/png", "image/jpeg", "image/webp"].includes(mime)
    || typeof raw !== "string" || !raw.length || raw.length > maxEncodedImageLength * 2 + 23) {
    throw new ImageGenerationError("绘图服务返回了无效或过大的图片。");
  }
  let encoded = raw;
  if (raw.startsWith("data:")) {
    const wrapper = /^data:(image\/(?:png|jpeg|webp));base64,/.exec(raw);
    if (!wrapper || wrapper[1] !== mime) throw new ImageGenerationError("绘图服务返回了无效或不匹配的图片格式。");
    encoded = raw.slice(wrapper[0].length);
  }
  const data = encoded.replace(/[\r\n]/g, "");
  if (!data.length || data.length > maxEncodedImageLength || data.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new ImageGenerationError("绘图服务返回了无效或过大的图片。");
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  // Zero unused bits are required; forgiving decoders otherwise accept multiple encodings of the same bytes.
  if (padding && (base64Alphabet.indexOf(data[data.length - padding - 1]) & (padding === 2 ? 15 : 3))) {
    throw new ImageGenerationError("绘图服务返回了无效或过大的图片。");
  }
  const bytes = data.length / 4 * 3 - padding;
  if (bytes > maxImageBytes) throw new ImageGenerationError("绘图结果超出本地保存限制。");
  return { data, bytes };
}

export async function readBoundedImageResponse(response: Response, signal: AbortSignal): Promise<string> {
  if (Number(response.headers.get("content-length")) > maxBodyBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new ImageGenerationError("绘图响应过大。");
  }
  if (!response.body) throw new ImageGenerationError("绘图服务返回了空响应。");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let size = 0, text = "";
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      if (signal.aborted) throw new ImageGenerationError("请求已停止，服务端结果未知。", "unknown");
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > maxBodyBytes) throw new ImageGenerationError("绘图响应过大。");
      text += decoder.decode(item.value, { stream: true });
    }
    if (signal.aborted) throw new ImageGenerationError("请求已停止，服务端结果未知。", "unknown");
    return text + decoder.decode();
  } finally { signal.removeEventListener("abort", abort); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
