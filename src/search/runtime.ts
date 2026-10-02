import type { SearchProfile, ExternalSearchProvider } from "./settings";
import type { FetchLike } from "../chat/types";
import { createExaSearchClient } from "./exa";
import { createExaApiSearchClient, validateExaApiSettings } from "./exaApi";
import { createTavilySearchClient, validateTavilyApiSettings } from "./tavily";
import { createZhipuSearchClient, validateZhipuApiSettings } from "./zhipu";

export async function searchExa(settings: SearchProfile, query: string, signal?: AbortSignal, provider: ExternalSearchProvider = "exa-mcp") {
  if (provider === "exa-api") validateExaApiSettings(settings);
  else if (provider === "tavily") validateTavilyApiSettings(settings as import("./settings").TavilySearchSettings);
  else if (provider === "zhipu") validateZhipuApiSettings(settings as import("./settings").ZhipuSearchSettings);
  else if (provider !== "exa-mcp") throw new Error("网络搜索服务不受支持。");
  const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http").catch(() => {
    throw new Error("无法加载网络搜索组件，请重试。");
  });
  const fetch: FetchLike = (input, init) => tauriFetch(input, { ...init, maxRedirections: 0 });
  if (provider === "tavily") return createTavilySearchClient(fetch).search(settings as import("./settings").TavilySearchSettings, query, signal);
  if (provider === "zhipu") return createZhipuSearchClient(fetch).search(settings as import("./settings").ZhipuSearchSettings, query, signal);
  return (provider === "exa-api" ? createExaApiSearchClient(fetch) : createExaSearchClient(fetch)).search(settings, query, signal);
}
