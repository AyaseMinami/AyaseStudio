import { useEffect, useMemo, useRef } from "react";
import { ChevronRight, Globe } from "lucide-react";

import type { SearchRecord, SearchSource } from "../../chat/nativeSearch";
import { openExternal, safeExternalUrl } from "../../chat/externalLinks";
import "./SearchResults.css";

function searchLabel(search: SearchRecord): string {
  if (search.provider === "exa-mcp" || search.provider === "exa-api") {
    if (search.status === "searching") return `正在搜索 · ${search.provider === "exa-api" ? "Exa API" : "Exa MCP"}`;
    if (search.status === "completed") return `已检索 · ${search.sources.length} 个来源`;
  }
  switch (search.status) {
    case "searching": return "正在搜索";
    case "completed": return "已联网搜索";
    case "not-used": return "本次未返回搜索信息";
    case "failed": return "搜索失败";
    case "cancelled": return "搜索已取消";
    case "pending": return "搜索可用";
  }
}

function SourceLink({ source, index }: { source: SearchSource; index: number }) {
  const url = safeExternalUrl(source.url);
  return <li><button type="button" disabled={!url} onClick={() => url && void openExternal(url)} title={source.url}>
    <span className="search-source-number">{index + 1}</span>{source.title || source.url}
  </button>{source.excerpt && <p className="search-source-excerpt">{source.excerpt}</p>}</li>;
}

function sanitizedSuggestionHtml(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  document.querySelectorAll("script, base, meta[http-equiv='refresh'], iframe, object, embed, form").forEach((element) => element.remove());
  const styles = [...document.querySelectorAll("head style")].map((style) => style.outerHTML).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https:">${styles}</head><body>${document.body.innerHTML}</body></html>`;
}

export function resizeSuggestionFrame(frame: HTMLIFrameElement, document: Document): void {
  frame.style.height = "0px";
  frame.style.height = `${Math.min(320, Math.max(48, document.body.scrollHeight, document.documentElement.scrollHeight))}px`;
}

function GeminiSuggestion({ html }: { html: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const cleanup = useRef<() => void>(() => {});
  const srcDoc = useMemo(() => sanitizedSuggestionHtml(html), [html]);
  useEffect(() => () => cleanup.current(), []);
  const bindFrame = () => {
    cleanup.current();
    const document = frame.current?.contentDocument;
    if (!document) return;
    const open = (event: MouseEvent) => {
      if (event.button > 1) return;
      const anchor = (event.target as Element | null)?.closest("a");
      if (!anchor) return;
      event.preventDefault(); event.stopPropagation();
      const url = safeExternalUrl(anchor.getAttribute("href") ?? "");
      if (url) void openExternal(url);
    };
    const preventSubmit = (event: Event) => event.preventDefault();
    const resize = () => { if (frame.current) resizeSuggestionFrame(frame.current, document); };
    document.addEventListener("click", open, true);
    document.addEventListener("auxclick", open, true);
    document.addEventListener("submit", preventSubmit, true);
    const observer = new ResizeObserver(resize);
    observer.observe(document.body); resize();
    cleanup.current = () => { observer.disconnect(); document.removeEventListener("click", open, true); document.removeEventListener("auxclick", open, true); document.removeEventListener("submit", preventSubmit, true); };
  };
  return <section className="gemini-suggestion" aria-label="搜索建议"><iframe ref={frame} title="Gemini 搜索建议" sandbox="allow-same-origin" srcDoc={srcDoc} onLoad={bindFrame} /></section>;
}

export function SearchResults({ search, showCitationNotice = true }: { search: SearchRecord; showCitationNotice?: boolean }) {
  const sources = search.sources;
  const external = search.provider === "exa-mcp" || search.provider === "exa-api";
  const status = <span className={`search-status search-status-${search.status}`}><Globe size={13} aria-hidden="true" />{searchLabel(search)}</span>;
  return <aside className="search-results" aria-label="搜索结果">
    {sources.length > 0 ? <details className="search-sources"><summary>{status}{!external && <><span aria-hidden="true">·</span><span>{sources.length} 个来源</span></>}<ChevronRight className="search-source-chevron" size={13} aria-hidden="true" /></summary><ol>{sources.map((source, index) => <SourceLink key={source.id} source={source} index={index} />)}</ol></details> : status}
    {search.error && <p className="search-error" role="status">{search.error}</p>}
    {search.warning && <p className="search-warning" role="status">{search.warning}</p>}
    {showCitationNotice && external && search.status === "completed" &&
      !search.citations.some((citation) => citation.sourceIds.some((id) => sources.some((source) => source.id === id))) &&
      <p className="search-citation-notice">已检索资料，正文未提供有效引用</p>}
    {!search.suggestionHtml && search.queries.length > 0 && <p className="search-queries">搜索：{search.queries.join(" · ")}</p>}
    {search.suggestionHtml && <GeminiSuggestion html={search.suggestionHtml} />}
  </aside>;
}
