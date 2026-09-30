export interface SearchSettings {
  version: 1;
  baseUrl: string;
  apiKey: string;
  numResults: number;
}

export type ExternalSearchProvider = "exa-mcp" | "exa-api";
export interface SearchConfiguration {
  version: 2;
  exaMcp: SearchSettings;
  exaApi: SearchSettings;
}

export const SEARCH_SETTINGS_KEY = "ayase-studio.search.v1";

type SettingsStorage = Pick<Storage, "getItem" | "setItem">;

export function defaultSearchSettings(provider: ExternalSearchProvider = "exa-mcp"): SearchSettings {
  return { version: 1, baseUrl: provider === "exa-api" ? "https://api.exa.ai" : "https://mcp.exa.ai/mcp", apiKey: "", numResults: 5 };
}

export function defaultSearchConfiguration(): SearchConfiguration {
  return { version: 2, exaMcp: defaultSearchSettings(), exaApi: defaultSearchSettings("exa-api") };
}

export function validateSearchConfiguration(raw: unknown): SearchConfiguration {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("网络搜索配置格式无效。");
  const value = raw as Record<string, unknown>;
  // Legacy single-service data remains MCP; reading never activates API or writes storage.
  if (value.version === 1) return { ...defaultSearchConfiguration(), exaMcp: validateSearchSettings(value) };
  if (value.version !== 2 || Object.keys(value).some(key => !["version", "exaMcp", "exaApi"].includes(key))) {
    throw new Error("网络搜索配置版本或字段不受支持。");
  }
  return { version: 2, exaMcp: validateSearchSettings(value.exaMcp), exaApi: validateSearchSettings(value.exaApi) };
}

export function searchSettingsFor(config: SearchConfiguration, provider: ExternalSearchProvider): SearchSettings {
  return provider === "exa-api" ? config.exaApi : config.exaMcp;
}

export function validateSearchSettings(raw: unknown): SearchSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("网络搜索配置格式无效。");
  const value = raw as Record<string, unknown>;
  if (value.version !== 1) throw new Error("网络搜索配置版本不受支持。");
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

export function loadSearchSettings(storage?: SettingsStorage, provider: ExternalSearchProvider = "exa-mcp"): SearchSettings {
  return searchSettingsFor(loadSearchConfiguration(storage), provider);
}

export function saveSearchConfiguration(config: SearchConfiguration, storage?: SettingsStorage): SearchConfiguration {
  const validated = validateSearchConfiguration(config);
  try { (storage ?? localStorage).setItem(SEARCH_SETTINGS_KEY, JSON.stringify(validated)); }
  catch { throw new Error("无法保存网络搜索配置，请重试。"); }
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
  if (!query) throw new Error("请输入搜索问题，或关闭 Exa 搜索。");
  if (Array.from(query).length > 2000) throw new Error("搜索问题不能超过 2000 个字符，请缩短后重试。");
  return query;
}
