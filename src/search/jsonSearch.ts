import type { FetchLike } from "../chat/types";
import { ExaResultError } from "./results";

export type JsonSearchOptions = { timeoutMs?: number; maxResponseBytes?: number };
type ProviderName = "Tavily" | "智谱";
class JsonSearchError extends ExaResultError {}

function cancelled(): DOMException { return new DOMException("搜索已停止。", "AbortError"); }
function error(provider: ProviderName, message: string): JsonSearchError { return new JsonSearchError(`${provider} ${message}`); }
function formatError(provider: ProviderName): ExaResultError { return error(provider, "搜索响应格式无效。"); }

async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void operation.catch(() => {}); throw cancelled(); }
  let onAbort = () => {};
  const stop = new Promise<never>((_, reject) => {
    onAbort = () => reject(cancelled());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try { return await Promise.race([operation, stop]); }
  finally { signal.removeEventListener("abort", onAbort); }
}

async function readJson(response: Response, signal: AbortSignal, limit: number, provider: ProviderName): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  const [mediaType, ...parameters] = contentType.split(";");
  const charset = parameters.map(parameter => parameter.trim()).find(parameter => /^charset\s*=/iu.test(parameter));
  if (mediaType.trim().toLowerCase() !== "application/json" || !response.body
    || (charset && !/^charset\s*=\s*(?:"utf-8"|utf-8|utf8|"utf8")\s*$/iu.test(charset))) throw formatError(provider);
  if (Number(response.headers.get("content-length")) > limit) throw error(provider, "搜索响应超过大小上限。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await abortable(reader.read(), signal);
      if (done) { text += decoder.decode(); break; }
      bytes += value.byteLength;
      if (bytes > limit) throw error(provider, "搜索响应超过大小上限。");
      text += decoder.decode(value, { stream: true });
    }
    try { return JSON.parse(text); } catch { throw formatError(provider); }
  } catch (caught) {
    if (signal.aborted) throw cancelled();
    if (caught instanceof JsonSearchError) throw caught;
    throw formatError(provider);
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Fixed REST searches share deadlines and bounded decoding; no request is retried. */
export async function requestSearchJson(fetch: FetchLike, provider: ProviderName, endpoint: URL, apiKey: string,
  body: Record<string, unknown>, signal?: AbortSignal, options: JsonSearchOptions = {}): Promise<Record<string, unknown>> {
  if (signal?.aborted) throw cancelled();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 30_000);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  let response: Response | undefined;
  try {
    try {
      response = await abortable(fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body), signal: controller.signal, redirect: "error", credentials: "omit",
      }).then(received => {
        if (controller.signal.aborted) void received.body?.cancel().catch(() => {});
        return received;
      }), controller.signal);
    } catch {
      if (controller.signal.aborted) throw cancelled();
      throw error(provider, "搜索服务无法连接，未重试请求。");
    }
    if (!response) throw formatError(provider);
    if (response.redirected || (response.status >= 300 && response.status < 400)
      || (response.url && response.url !== endpoint.href)) throw error(provider, "搜索服务重定向已拒绝。");
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw error(provider, "搜索认证失败，请检查搜索 API Key。");
      if (response.status === 429) throw error(provider, "搜索已限流，请稍后显式重试。");
      if (response.status >= 500) throw error(provider, "搜索服务器错误，未重试请求。");
      throw error(provider, `搜索请求失败（HTTP ${response.status}）。`);
    }
    const payload = await readJson(response, controller.signal, options.maxResponseBytes ?? 2 * 1024 * 1024, provider);
    if (controller.signal.aborted) throw cancelled();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw formatError(provider);
    return payload as Record<string, unknown>;
  } catch (caught) {
    if (timedOut) throw error(provider, "搜索超过时限，已停止。");
    if (controller.signal.aborted) throw cancelled();
    if (caught instanceof JsonSearchError) throw caught;
    throw formatError(provider);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    void response?.body?.cancel().catch(() => {});
  }
}
