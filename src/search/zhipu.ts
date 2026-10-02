import type { FetchLike } from "../chat/types";
import { requestSearchJson, type JsonSearchOptions } from "./jsonSearch";
import { ExaResultError, normalizeExaResults, type ExaSearchResult } from "./results";
import { validateSearchQuery, validateZhipuSettings, type ZhipuSearchSettings } from "./settings";

export function validateZhipuApiSettings(settings: ZhipuSearchSettings): ZhipuSearchSettings {
  const validated = validateZhipuSettings(settings);
  if (!validated.apiKey) throw new ExaResultError("智谱搜索需要 API Key，请先在网络搜索设置中配置。");
  const url = new URL(validated.baseUrl);
  if (url.search || url.hash || validated.baseUrl.includes("?") || validated.baseUrl.includes("#")) {
    throw new ExaResultError("智谱搜索基础地址不能包含查询参数或片段。");
  }
  return validated;
}

export function validateZhipuSearchQuery(text: string): string {
  const query = validateSearchQuery(text);
  if (Array.from(query).length > 70) throw new ExaResultError("智谱搜索问题不能超过 70 个字符，请缩短后重试。");
  return query;
}

export function createZhipuSearchClient(fetch: FetchLike, options: JsonSearchOptions = {}) {
  return {
    async search(settings: ZhipuSearchSettings, text: string, signal?: AbortSignal): Promise<ExaSearchResult> {
      const config = validateZhipuApiSettings(settings);
      const query = validateZhipuSearchQuery(text);
      const endpoint = new URL(config.baseUrl);
      const path = endpoint.pathname.replace(/\/+$/u, "");
      endpoint.pathname = path.endsWith("/api/paas/v4/web_search") ? path
        : path.endsWith("/api/paas/v4") ? `${path}/web_search` : `${path}/api/paas/v4/web_search`;
      const payload = await requestSearchJson(fetch, "智谱", endpoint, config.apiKey, {
        search_engine: config.searchEngine, search_query: query, search_intent: false,
        count: config.searchEngine === "search_pro_sogou" ? 10 : config.numResults, content_size: "medium",
      }, signal, options);
      if ("error" in payload) throw new ExaResultError("智谱返回搜索错误，未发起回答请求。");
      if (!Array.isArray(payload.search_result)) throw new ExaResultError("智谱搜索响应格式无效。");
      const results = payload.search_result.map(raw => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
        const value = raw as Record<string, unknown>;
        return { title: value.title, url: value.link, text: value.content };
      });
      return normalizeExaResults(results, config.numResults, "智谱");
    },
  };
}
