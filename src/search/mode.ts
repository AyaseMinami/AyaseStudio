import type { SessionConfig } from "../chat/sessionConfig";
import type { ExternalSearchProvider } from "./settings";

export type SearchMode = "off" | "native" | ExternalSearchProvider;

export function isExternalSearch(provider: unknown): provider is ExternalSearchProvider {
  return provider === "exa-mcp" || provider === "exa-api" || provider === "tavily" || provider === "zhipu";
}

/** Unknown/corrupt choices never activate an external service. */
export function resolveSearchMode(config: Pick<SessionConfig, "webSearch" | "webSearchProvider">): SearchMode {
  if (config.webSearch !== true) return "off";
  if (config.webSearchProvider === undefined || config.webSearchProvider === "native") return "native";
  return isExternalSearch(config.webSearchProvider) ? config.webSearchProvider : "off";
}

export function withSearchMode(config: SessionConfig, mode: SearchMode): SessionConfig {
  return { ...config, webSearch: mode !== "off", webSearchProvider: isExternalSearch(mode) ? mode : "native" };
}
