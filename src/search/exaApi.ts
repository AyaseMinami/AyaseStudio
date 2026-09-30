import type { FetchLike } from "../chat/types";
import { ExaResultError, normalizeExaResults, type ExaSearchResult } from "./results";
import { validateSearchQuery, validateSearchSettings, type SearchSettings } from "./settings";

class ExaApiError extends ExaResultError {}
function formatError(): ExaApiError { return new ExaApiError("Exa API 响应格式无效。"); }
function cancelled(): DOMException { return new DOMException("搜索已停止。", "AbortError"); }

/** API credentials are required for execution; blank drafts may still be persisted. */
export function validateExaApiSettings(settings: SearchSettings): SearchSettings {
  const validated = validateSearchSettings(settings);
  if (!validated.apiKey) throw new ExaApiError("Exa API 需要 API Key，请先在网络搜索设置中配置。");
  const url = new URL(validated.baseUrl);
  if (url.search || url.hash || validated.baseUrl.includes("?") || validated.baseUrl.includes("#")) {
    throw new ExaApiError("Exa API 基础地址不能包含查询参数或片段。");
  }
  return validated;
}

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

async function readJson(response: Response, signal: AbortSignal, limit: number): Promise<unknown> {
  if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json" || !response.body) throw formatError();
  if (Number(response.headers.get("content-length")) > limit) throw new ExaApiError("Exa API 搜索响应超过大小上限。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await abortable(reader.read(), signal);
      if (done) { text += decoder.decode(); break; }
      bytes += value.byteLength;
      if (bytes > limit) throw new ExaApiError("Exa API 搜索响应超过大小上限。");
      text += decoder.decode(value, { stream: true });
    }
    try { return JSON.parse(text); } catch { throw formatError(); }
  } catch (error) {
    if (signal.aborted) throw cancelled();
    if (error instanceof ExaApiError) throw error;
    throw formatError();
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function createExaApiSearchClient(fetch: FetchLike, options: { timeoutMs?: number; maxResponseBytes?: number } = {}) {
  return {
    async search(settings: SearchSettings, text: string, signal?: AbortSignal): Promise<ExaSearchResult> {
      const config = validateExaApiSettings(settings);
      const query = validateSearchQuery(text);
      if (signal?.aborted) throw cancelled();
      const endpoint = new URL(config.baseUrl);
      endpoint.pathname = `${endpoint.pathname.replace(/\/+$/u, "")}/search`;
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 30_000);
      const onAbort = () => controller.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      let response: Response | undefined;
      try {
        try {
          response = await abortable(fetch(endpoint, {
            method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "x-api-key": config.apiKey },
            body: JSON.stringify({ query, numResults: config.numResults, type: "auto", contents: { text: true } }),
            signal: controller.signal, redirect: "error", credentials: "omit",
          }).then((received) => {
            if (controller.signal.aborted) void received.body?.cancel().catch(() => {});
            return received;
          }), controller.signal);
        } catch {
          if (controller.signal.aborted) throw cancelled();
          throw new ExaApiError("无法连接 Exa API 搜索服务，未重试请求。");
        }
        if (!response) throw formatError();
        if (response.redirected || (response.url && response.url !== endpoint.href)) throw new ExaApiError("Exa API 搜索服务重定向已拒绝。");
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) throw new ExaApiError("Exa API 认证失败，请检查搜索 API Key。");
          if (response.status === 429) throw new ExaApiError("Exa API 搜索已限流，请稍后显式重试。");
          if (response.status >= 500) throw new ExaApiError("Exa API 搜索服务器错误，未重试请求。");
          throw new ExaApiError(`Exa API 搜索请求失败（HTTP ${response.status}）。`);
        }
        const payload = await readJson(response, controller.signal, options.maxResponseBytes ?? 2 * 1024 * 1024);
        if (controller.signal.aborted) throw cancelled();
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw formatError();
        const object = payload as Record<string, unknown>;
        if ("error" in object) throw new ExaApiError("Exa API 返回搜索错误，未发起回答请求。");
        if (!Array.isArray(object.results)) throw formatError();
        return normalizeExaResults(object.results, config.numResults);
      } catch (error) {
        if (timedOut) throw new ExaApiError("Exa API 搜索超过 30 秒时限，已停止。");
        if (controller.signal.aborted) throw cancelled();
        if (error instanceof ExaResultError) throw error;
        throw formatError();
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        void response?.body?.cancel().catch(() => {});
      }
    },
  };
}
