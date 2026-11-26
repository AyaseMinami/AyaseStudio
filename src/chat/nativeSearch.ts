import type { ChatProtocol } from "./types";
import type { DeepSeekWebToolsSelection, SearchMode } from "../search/mode";

export const MAX_SEARCH_SOURCE_ID_LENGTH = 512;
export const MAX_SEARCH_SOURCE_URL_LENGTH = 32768;
export const MAX_SEARCH_EXCERPT_CODE_POINTS = 1500;
export const MAX_MESSAGE_EXCERPT_CODE_POINTS = 8000;

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
  protocol: "anthropic-native" | "openai-responses";
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

export function normalizeWebUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_SEARCH_SOURCE_URL_LENGTH) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return trimmed;
  } catch {
    return undefined;
  }
}

export function countCodePoints(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

export function truncateCodePoints(text: string, limit: number): string {
  if (limit <= 0) return "";
  let result = "";
  let count = 0;
  for (const ch of text) {
    if (count >= limit) break;
    result += ch;
    count += 1;
  }
  return result;
}

function isPlaceholderTitle(title: string | undefined, url: string): boolean {
  const trimmed = title?.trim() ?? "";
  return !trimmed || trimmed === url.trim();
}

export function nextBoundedSourceId(url: string, usedIds: ReadonlySet<string>, preferredId?: string): string {
  const candidate = preferredId?.trim() || url;
  if (
    candidate.length <= MAX_SEARCH_SOURCE_ID_LENGTH
    && !["__proto__", "prototype", "constructor"].includes(candidate)
    && !usedIds.has(candidate)
  ) {
    return candidate;
  }
  let index = 1;
  while (usedIds.has(`src-${index}`)) index += 1;
  return `src-${index}`;
}

export function mergeSearchSources(
  existingSources: readonly SearchSource[],
  additions: ReadonlyArray<Omit<SearchSource, "id"> & { id?: string }>,
): { sources: SearchSource[]; idMap: Map<string, string> } {
  const sources = existingSources.map((source) => ({ ...source }));
  const byUrl = new Map<string, SearchSource>();
  const usedIds = new Set<string>();
  let totalExcerptPoints = 0;

  for (const source of sources) {
    byUrl.set(source.url, source);
    usedIds.add(source.id);
    if (source.excerpt) totalExcerptPoints += countCodePoints(source.excerpt);
  }

  const idMap = new Map<string, string>();
  const allocateExcerpt = (rawExcerpt: string | undefined): string | undefined => {
    if (!rawExcerpt) return undefined;
    const trimmed = rawExcerpt.trim();
    if (!trimmed) return undefined;
    const remaining = MAX_MESSAGE_EXCERPT_CODE_POINTS - totalExcerptPoints;
    if (remaining <= 0) return undefined;
    const bounded = truncateCodePoints(trimmed, Math.min(MAX_SEARCH_EXCERPT_CODE_POINTS, remaining));
    if (!bounded) return undefined;
    totalExcerptPoints += countCodePoints(bounded);
    return bounded;
  };

  for (const incoming of additions) {
    const url = normalizeWebUrl(incoming.url);
    if (!url) continue;
    const existing = byUrl.get(url);
    if (existing) {
      if (incoming.id) idMap.set(incoming.id, existing.id);
      if (isPlaceholderTitle(existing.title, existing.url) && !isPlaceholderTitle(incoming.title, url)) {
        existing.title = incoming.title.trim();
      }
      if (!existing.excerpt) {
        const excerpt = allocateExcerpt(incoming.excerpt);
        if (excerpt) existing.excerpt = excerpt;
      }
      continue;
    }

    const id = nextBoundedSourceId(url, usedIds, incoming.id);
    usedIds.add(id);
    if (incoming.id) idMap.set(incoming.id, id);
    const title = incoming.title?.trim() || url;
    const excerpt = allocateExcerpt(incoming.excerpt);
    const created: SearchSource = {
      id,
      url,
      title,
      ...(excerpt ? { excerpt } : {}),
    };
    sources.push(created);
    byUrl.set(url, created);
  }

  return { sources, idMap };
}

export function mergeSearch(previous: SearchRecord | undefined, next: SearchRecord, offset: number): SearchRecord {
  if (!previous) return next;
  const { sources, idMap } = mergeSearchSources(previous.sources, next.sources);
  const citations = [...previous.citations];
  for (const citation of next.citations) {
    const remapped = {
      start: citation.start + offset,
      end: citation.end + offset,
      sourceIds: [...new Set(citation.sourceIds.map((id) => idMap.get(id) ?? id))],
    };
    if (!citations.some((item) => item.start === remapped.start && item.end === remapped.end && item.sourceIds.join("|") === remapped.sourceIds.join("|"))) {
      citations.push(remapped);
    }
  }
  return {
    ...next,
    status: next.status === "not-used" && previous.status !== "pending"
      ? previous.status === "searching" ? "completed" : previous.status : next.status,
    error: next.error ?? previous.error,
    sources,
    citations,
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

export function searchRequestBody(
  protocol: ChatProtocol,
  modeOrEnabled: SearchMode | boolean,
  deepseekTools?: DeepSeekWebToolsSelection,
): Record<string, unknown> {
  const mode: SearchMode = typeof modeOrEnabled === "boolean"
    ? (modeOrEnabled ? "native" : "off")
    : modeOrEnabled;
  if (mode === "deepseek-server") {
    const tools = deepseekTools ?? { search: true, readUrl: true };
    if (protocol === "anthropic-native") {
      const entries: Array<{ type: string; name: string }> = [];
      if (tools.search) entries.push({ type: "deepseek_web_search", name: "deepseek_web_search" });
      if (tools.readUrl) entries.push({ type: "deepseek_read_url", name: "deepseek_read_url" });
      return entries.length ? { tools: entries } : {};
    }
    if (protocol === "openai-responses") {
      const entries: Array<{ type: string }> = [];
      if (tools.search) entries.push({ type: "deepseek_web_search" });
      if (tools.readUrl) entries.push({ type: "deepseek_read_url" });
      return entries.length ? { tools: entries } : {};
    }
    return {};
  }
  if (mode !== "native") return {};
  switch (protocol) {
    case "openai-chat": return { web_search_options: {} };
    case "openai-responses": return { tools: [{ type: "web_search" }], tool_choice: "auto", include: ["web_search_call.action.sources"] };
    case "gemini-native": return { tools: [{ googleSearch: {} }] };
    case "anthropic-native": return { tools: [{ type: "web_search_20250305", name: "web_search" }] };
  }
}
