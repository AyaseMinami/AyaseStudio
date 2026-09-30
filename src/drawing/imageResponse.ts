export class ImageGenerationError extends Error {
  constructor(message: string, readonly outcome: "failed" | "unknown" = "failed") { super(message); }
}

const maxBodyBytes = 90 * 1024 * 1024;

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
