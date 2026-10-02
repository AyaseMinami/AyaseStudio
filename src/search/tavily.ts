import type { FetchLike } from "../chat/types";
import { requestSearchJson, type JsonSearchOptions } from "./jsonSearch";
import { ExaResultError, normalizeExaResults, type ExaSearchResult } from "./results";
import { validateSearchQuery, validateTavilySettings, type TavilySearchSettings } from "./settings";

export function validateTavilyApiSettings(settings: TavilySearchSettings): TavilySearchSettings {
  const validated = validateTavilySettings(settings);
  if (!validated.apiKey) throw new ExaResultError("Tavily 搜索需要 API Key，请先在网络搜索设置中配置。");
  const url = new URL(validated.baseUrl);
  if (url.search || url.hash || validated.baseUrl.includes("?") || validated.baseUrl.includes("#")) {
    throw new ExaResultError("Tavily 搜索基础地址不能包含查询参数或片段。");
  }
  return validated;
}

export function createTavilySearchClient(fetch: FetchLike, options: JsonSearchOptions = {}) {
  return {
    async search(settings: TavilySearchSettings, text: string, signal?: AbortSignal): Promise<ExaSearchResult> {
      const config = validateTavilyApiSettings(settings);
      const query = validateSearchQuery(text);
      const endpoint = new URL(config.baseUrl);
      const path = endpoint.pathname.replace(/\/+$/u, "");
      endpoint.pathname = path.endsWith("/search") ? path : `${path}/search`;
      const payload = await requestSearchJson(fetch, "Tavily", endpoint, config.apiKey, {
        query, search_depth: config.searchDepth, auto_parameters: false,
        include_answer: false, include_raw_content: false, max_results: config.numResults,
      }, signal, options);
      if ("error" in payload || "detail" in payload) throw new ExaResultError("Tavily 返回搜索错误，未发起回答请求。");
      if (!Array.isArray(payload.results)) throw new ExaResultError("Tavily 搜索响应格式无效。");
      const results = payload.results.map(raw => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
        const value = raw as Record<string, unknown>;
        return { title: value.title, url: value.url, text: value.content };
      });
      return normalizeExaResults(results, config.numResults, "Tavily");
    },
  };
}
