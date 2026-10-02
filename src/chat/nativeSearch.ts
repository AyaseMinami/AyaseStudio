import type { ChatProtocol } from "./types";

export interface SearchSource {
  id: string;
  url: string;
  title: string;
  excerpt?: string;
}

export interface SearchCitation {
  /** UTF-16 offsets in the unchanged answer text; end is exclusive. */
  start: number;
  end: number;
  sourceIds: string[];
}

export interface SearchRecord {
  provider?: import("../search/settings").ExternalSearchProvider;
  warning?: string;
  enabled: boolean;
  status: "pending" | "searching" | "completed" | "not-used" | "failed" | "cancelled";
  sources: SearchSource[];
  citations: SearchCitation[];
  queries: string[];
  suggestionHtml?: string;
  error?: string;
}

export interface ProviderReplay {
  protocol: "anthropic-native";
  /** Connection identity is local metadata, never a provider request field. */
  scope: string;
  content: Record<string, unknown>[];
  responses?: Record<string, unknown>[][];
}

export interface SearchContinuation {
  config: import("./sessionConfig").SessionConfig;
  model: string;
  baseUrl: string;
  scope: string;
  messages: import("./types").ChatMessage[];
}

export function mergeSearch(previous: SearchRecord | undefined, next: SearchRecord, offset: number): SearchRecord {
  if (!previous) return next;
  return { ...next,
    status: next.status === "not-used" && previous.status !== "pending"
      ? previous.status === "searching" ? "completed" : previous.status : next.status,
    error: next.error ?? previous.error,
    sources: [...new Map([...previous.sources, ...next.sources].map((source) => [source.id, source])).values()],
    citations: [...previous.citations, ...next.citations.map((citation) => ({ ...citation, start: citation.start + offset, end: citation.end + offset }))],
    queries: [...new Set([...previous.queries, ...next.queries])],
    suggestionHtml: next.suggestionHtml ?? previous.suggestionHtml,
  };
}

export function initialSearch(enabled: boolean): SearchRecord {
  return { enabled, status: "pending", sources: [], citations: [], queries: [] };
}

export function finishSearch(search: SearchRecord | undefined, outcome: "completed" | "failed" | "aborted"): SearchRecord | undefined {
  if (!search || search.status === "completed" || search.status === "failed") return search;
  return { ...search, status: outcome === "aborted" ? "cancelled" : outcome === "failed" ? "failed" : "not-used" };
}

export function searchRequestBody(protocol: ChatProtocol, enabled: boolean): Record<string, unknown> {
  if (!enabled) return {};
  switch (protocol) {
    case "openai-chat": return { web_search_options: {} };
    case "openai-responses": return { tools: [{ type: "web_search" }], tool_choice: "auto", include: ["web_search_call.action.sources"] };
    case "gemini-native": return { tools: [{ googleSearch: {} }] };
    case "anthropic-native": return { tools: [{ type: "web_search_20250305", name: "web_search" }] };
  }
}
