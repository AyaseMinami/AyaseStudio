export interface SearchSettings {
  version: 1;
  baseUrl: string;
  apiKey: string;
  numResults: number;
}

export type ExternalSearchProvider = "exa-mcp" | "exa-api" | "tavily" | "zhipu";
export interface TavilySearchSettings extends SearchSettings { enabled: boolean; searchDepth: "basic" | "advanced" }
export type ZhipuSearchEngine = "search_std" | "search_pro" | "search_pro_sogou" | "search_pro_quark";
export interface ZhipuSearchSettings extends SearchSettings { enabled: boolean; searchEngine: ZhipuSearchEngine }
export type SearchProfile = SearchSettings | TavilySearchSettings | ZhipuSearchSettings;
export interface SearchConfiguration {
  version: 3;
  exaMcp: SearchSettings;
  exaApi: SearchSettings;
  tavily: TavilySearchSettings;
  zhipu: ZhipuSearchSettings;
}

export const SEARCH_SETTINGS_KEY = "ayase-studio.search.v1";
export const SEARCH_SETTINGS_CHANGED = "ayase-search-settings-changed";
export const searchProfileKeys = { "exa-api": "exaApi", "exa-mcp": "exaMcp", tavily: "tavily", zhipu: "zhipu" } as const;
export const searchProviderNames: Record<ExternalSearchProvider, string> = { "exa-api": "Exa API", "exa-mcp": "Exa MCP", tavily: "Tavily", zhipu: "智谱" };

type SettingsStorage = Pick<Storage, "getItem" | "setItem">;

export function defaultSearchSettings(provider: "exa-mcp" | "exa-api" = "exa-mcp"): SearchSettings {
  return { version: 1, baseUrl: provider === "exa-api" ? "https://api.exa.ai" : "https://mcp.exa.ai/mcp", apiKey: "", numResults: 5 };
}

export function defaultSearchConfiguration(): SearchConfiguration {
  return { version: 3, exaMcp: defaultSearchSettings(), exaApi: defaultSearchSettings("exa-api"),
    tavily: { version: 1, baseUrl: "https://api.tavily.com", apiKey: "", numResults: 5, enabled: false, searchDepth: "basic" },
    zhipu: { version: 1, baseUrl: "https://open.bigmodel.cn", apiKey: "", numResults: 5, enabled: false, searchEngine: "search_std" } };
}

export function validateSearchConfiguration(raw: unknown): SearchConfiguration {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("网络搜索配置格式无效。");
  const value = migrateData(raw, searchDataMigration);
  if (value.version !== 3 || Object.keys(value).some(key => !backupFields(dataPolicies.search, true).includes(key))) {
    throw new Error("网络搜索配置版本或字段不受支持。");
  }
  return { version: 3, exaMcp: validateSearchSettings(value.exaMcp), exaApi: validateSearchSettings(value.exaApi),
    tavily: validateTavilySettings(value.tavily), zhipu: validateZhipuSettings(value.zhipu) };
}

export const searchDataMigration: DataMigration = {
  version: 3, oldestVersion: 1,
  migrations: {
    1: value => ({ version: 2, exaMcp: validateSearchSettings(value), exaApi: defaultSearchSettings("exa-api") }),
    2: value => {
      if (Object.keys(value).some(key => !["version", "exaMcp", "exaApi"].includes(key))) throw new Error("网络搜索配置字段不受支持。");
      return { ...defaultSearchConfiguration(), exaMcp: validateSearchSettings(value.exaMcp), exaApi: validateSearchSettings(value.exaApi) };
    },
  },
};

export function searchSettingsFor(config: SearchConfiguration, provider: ExternalSearchProvider): SearchProfile {
  return config[searchProfileKeys[provider]];
}

function validateAdditionalSettings(raw: unknown, policy: typeof dataPolicies.tavilyProfile | typeof dataPolicies.zhipuProfile) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("网络搜索配置格式无效。");
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some(key => !backupFields(policy, true).includes(key))) throw new Error("网络搜索配置字段不受支持。");
  if (typeof value.enabled !== "boolean") throw new Error("搜索服务启用设置无效。");
  const base = validateSearchSettings({ version: value.version, baseUrl: value.baseUrl, apiKey: value.apiKey, numResults: value.numResults });
  const url = new URL(base.baseUrl);
  if (url.search || base.baseUrl.includes("?") || base.baseUrl.includes("#")) throw new Error("搜索服务基础地址不能包含查询参数或片段。");
  return { value, base, enabled: value.enabled };
}

export function validateTavilySettings(raw: unknown): TavilySearchSettings {
  const { value, base, enabled } = validateAdditionalSettings(raw, dataPolicies.tavilyProfile);
  if (value.searchDepth !== "basic" && value.searchDepth !== "advanced") throw new Error("Tavily 搜索深度不受支持。");
  return { ...base, enabled, searchDepth: value.searchDepth };
}

export function validateZhipuSettings(raw: unknown): ZhipuSearchSettings {
  const { value, base, enabled } = validateAdditionalSettings(raw, dataPolicies.zhipuProfile);
  if (!["search_std", "search_pro", "search_pro_sogou", "search_pro_quark"].includes(value.searchEngine as string)) throw new Error("智谱搜索引擎不受支持。");
  return { ...base, enabled, searchEngine: value.searchEngine as ZhipuSearchEngine };
}

export function assertSearchEnabled(provider: ExternalSearchProvider, settings: SearchProfile): void {
  if ((provider === "tavily" || provider === "zhipu") && (!("enabled" in settings) || !settings.enabled)) {
    throw new Error(`${searchProviderNames[provider]} 搜索已关闭，请在网络搜索设置中启用并保存，或重新选择搜索方式。`);
  }
}

export function validateSearchSettings(raw: unknown): SearchSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("网络搜索配置格式无效。");
  const value = raw as Record<string, unknown>;
  if (value.version !== 1) throw new Error("网络搜索配置版本不受支持。");
  if (Object.keys(value).some(key => !backupFields(dataPolicies.searchProfile, true).includes(key))) {
    throw new Error("网络搜索配置字段不受支持。");
  }
  if (typeof value.baseUrl !== "string" || value.baseUrl.length > 2048) throw new Error("搜索服务地址无效。");
  if (typeof value.apiKey !== "string" || value.apiKey.length > 4096 || /[\u0000-\u001f\u007f]/u.test(value.apiKey)) {
    throw new Error("搜索 API Key 格式无效。");
  }
  const apiKey = value.apiKey.trim();
  let url: URL;
  try { url = new URL(value.baseUrl.trim()); } catch { throw new Error("搜索服务地址无效。"); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.hash) {
    throw new Error("搜索服务地址须为 HTTPS，且不能包含凭据或片段。");
  }
  let credentials = false;
  url.searchParams.forEach((parameter, name) => {
    const normalized = name.replace(/[^a-z]/gi, "").toLowerCase();
    if (/(key|token|secret|password|credential|authorization|auth)/u.test(normalized)
      || (apiKey && parameter.includes(apiKey))) credentials = true;
  });
  if (credentials) throw new Error("搜索凭据不能放在服务地址中，请使用独立的 API Key 字段。");
  if (typeof value.numResults !== "number" || !Number.isInteger(value.numResults) || value.numResults < 1 || value.numResults > 10) {
    throw new Error("搜索结果数量须为 1 至 10 的整数。");
  }
  return { version: 1, baseUrl: url.href, apiKey, numResults: value.numResults };
}

export function loadSearchConfiguration(storage?: SettingsStorage): SearchConfiguration {
  let encoded: string | null;
  try { encoded = (storage ?? localStorage).getItem(SEARCH_SETTINGS_KEY); }
  catch { throw new Error("无法读取网络搜索配置。"); }
  if (encoded === null) return defaultSearchConfiguration();
  let value: unknown;
  try { value = JSON.parse(encoded); } catch { throw new Error("网络搜索配置已损坏，请重新保存。"); }
  return validateSearchConfiguration(value);
}

export function loadSearchSettings(storage?: SettingsStorage, provider: ExternalSearchProvider = "exa-mcp"): SearchProfile {
  return searchSettingsFor(loadSearchConfiguration(storage), provider);
}

export function saveSearchConfiguration(config: SearchConfiguration, storage?: SettingsStorage): SearchConfiguration {
  const validated = validateSearchConfiguration(config);
  try { (storage ?? localStorage).setItem(SEARCH_SETTINGS_KEY, JSON.stringify(validated)); }
  catch { throw new Error("无法保存网络搜索配置，请重试。"); }
  if (!storage && typeof window !== "undefined") window.dispatchEvent(new Event(SEARCH_SETTINGS_CHANGED));
  return validated;
}

export function saveSearchSettings(settings: SearchSettings, storage?: SettingsStorage): SearchSettings {
  const validated = validateSearchSettings(settings);
  try {
    const config = loadSearchConfiguration(storage);
    saveSearchConfiguration({ ...config, exaMcp: validated }, storage);
  }
  catch { throw new Error("无法保存网络搜索配置，请重试。"); }
  return validated;
}

export function validateSearchQuery(text: string): string {
  const query = text.trim();
  if (!query) throw new Error("请输入搜索问题，或关闭外部搜索。");
  if (Array.from(query).length > 2000) throw new Error("搜索问题不能超过 2000 个字符，请缩短后重试。");
  return query;
}
import { backupFields, migrateData, type DataMigration } from "../storage/dataContract";
import { dataPolicies } from "../storage/dataPolicies";
