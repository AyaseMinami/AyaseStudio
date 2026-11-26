import type { SessionConfig } from "../chat/sessionConfig";
import type { ChatProtocol } from "../chat/types";
import type { ExternalSearchProvider } from "./settings";

export type DeepSeekWebToolsSelection = {
  search: boolean;
  readUrl: boolean;
};

export type SearchMode = "off" | "native" | "deepseek-server" | ExternalSearchProvider;

export function isExternalSearch(provider: unknown): provider is ExternalSearchProvider {
  return provider === "exa-mcp" || provider === "exa-api" || provider === "tavily" || provider === "zhipu" || provider === "deepseek";
}

export function isDeepSeekServerSearch(provider: unknown): provider is "deepseek-server" {
  return provider === "deepseek-server";
}

export function defaultDeepSeekWebTools(): DeepSeekWebToolsSelection {
  return { search: true, readUrl: true };
}

export function isValidDeepSeekWebTools(value: unknown): value is DeepSeekWebToolsSelection {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 2 || !keys.every((key) => key === "search" || key === "readUrl")) return false;
  return typeof record.search === "boolean" && typeof record.readUrl === "boolean" && (record.search || record.readUrl);
}

/** Pure read helper: absent deepseekWebTools defaults to both enabled without writing back. */
export function resolveDeepSeekWebTools(
  config: Pick<SessionConfig, "deepseekWebTools">,
): DeepSeekWebToolsSelection {
  if (config.deepseekWebTools === undefined) return defaultDeepSeekWebTools();
  return { search: config.deepseekWebTools.search, readUrl: config.deepseekWebTools.readUrl };
}

export function supportsDeepSeekServerSearch(protocol: ChatProtocol | undefined): boolean {
  return protocol === "anthropic-native" || protocol === "openai-responses";
}

/** Unknown/corrupt choices never activate an external or server search service. */
export function resolveSearchMode(config: Pick<SessionConfig, "webSearch" | "webSearchProvider">): SearchMode {
  if (config.webSearch !== true) return "off";
  if (config.webSearchProvider === undefined || config.webSearchProvider === "native") return "native";
  if (config.webSearchProvider === "deepseek-server") return "deepseek-server";
  return isExternalSearch(config.webSearchProvider) ? config.webSearchProvider : "off";
}

export function withSearchMode(config: SessionConfig, mode: SearchMode): SessionConfig {
  if (mode === "deepseek-server") {
    return {
      ...config,
      webSearch: true,
      webSearchProvider: "deepseek-server",
      deepseekWebTools: config.deepseekWebTools ? { ...config.deepseekWebTools } : defaultDeepSeekWebTools(),
    };
  }
  return { ...config, webSearch: mode !== "off", webSearchProvider: isExternalSearch(mode) ? mode : "native" };
}

export function withDeepSeekWebTools(
  config: SessionConfig,
  tools: DeepSeekWebToolsSelection,
): SessionConfig {
  return {
    ...config,
    deepseekWebTools: { search: tools.search, readUrl: tools.readUrl },
  };
}

/**
 * Shared transport-config freezing across normal send, retry, and edit-and-send:
 * external search modes disable transport-level webSearch, while native and
 * deepseek-server preserve their exact provider mode and tool selection.
 */
export function freezeTransportSearchConfig(config: SessionConfig, searchMode: SearchMode): SessionConfig {
  const frozen = structuredClone(config);
  if (searchMode === "native") {
    frozen.webSearch = true;
    frozen.webSearchProvider = "native";
  } else if (searchMode === "deepseek-server") {
    frozen.webSearch = true;
    frozen.webSearchProvider = "deepseek-server";
    if (config.deepseekWebTools) frozen.deepseekWebTools = { ...config.deepseekWebTools };
  } else {
    frozen.webSearch = false;
  }
  return frozen;
}
