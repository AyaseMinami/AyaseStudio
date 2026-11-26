import type { FetchLike } from "../chat/types";
import { requestSearchJson, type JsonSearchOptions } from "./jsonSearch";
import { ExaResultError, normalizeExaResults, type ExaSearchResult } from "./results";
import { trimSearchQuery, validateDeepSeekSettings, type DeepSeekSearchSettings } from "./settings";

export function validateDeepSeekApiSettings(settings: DeepSeekSearchSettings): DeepSeekSearchSettings {
  const validated = validateDeepSeekSettings(settings);
  if (!validated.apiKey) throw new ExaResultError("DeepSeek 搜索需要 API Key，请先在网络搜索设置中配置。");
  const url = new URL(validated.baseUrl);
  if (url.search || url.hash || validated.baseUrl.includes("?") || validated.baseUrl.includes("#")) {
    throw new ExaResultError("DeepSeek 搜索基础地址不能包含查询参数或片段。");
  }
  return validated;
}

export function validateDeepSeekSearchQuery(text: string): string {
  const query = trimSearchQuery(text);
  if (!query) throw new ExaResultError("请输入搜索问题，或关闭外部搜索。");
  if (Array.from(query).length > 128) throw new ExaResultError("DeepSeek 搜索问题不能超过 128 个字符，请缩短后重试。");
  return query;
}

export function createDeepSeekSearchClient(fetch: FetchLike, options: JsonSearchOptions = {}) {
  return {
    async search(settings: DeepSeekSearchSettings, text: string, signal?: AbortSignal): Promise<ExaSearchResult> {
      const config = validateDeepSeekApiSettings(settings);
      const query = validateDeepSeekSearchQuery(text);
      const endpoint = new URL(config.baseUrl);
      const path = endpoint.pathname.replace(/\/+$/u, "");
      endpoint.pathname = path.endsWith("/v1/tools/search") ? path
        : path.endsWith("/v1/tools") ? `${path}/search`
        : path.endsWith("/v1") ? `${path}/tools/search`
        : `${path}/v1/tools/search`;
      const payload = await requestSearchJson(fetch, "DeepSeek", endpoint, config.apiKey, {
        query, count: config.numResults, need_content: false,
      }, signal, options);
      if ("error" in payload || "detail" in payload) throw new ExaResultError("DeepSeek 返回搜索错误，未发起回答请求。");
      if (!Array.isArray(payload.results)) throw new ExaResultError("DeepSeek 搜索响应格式无效。");
      const results = payload.results.map(raw => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
        const value = raw as Record<string, unknown>;
        const summary = typeof value.summary === "string" && value.summary.trim() ? value.summary : undefined;
        const snippet = typeof value.snippet === "string" && value.snippet.trim() ? value.snippet : undefined;
        return { title: value.title, url: value.url, text: summary ?? snippet ?? "" };
      });
      return normalizeExaResults(results, config.numResults, "DeepSeek");
    },
  };
}
