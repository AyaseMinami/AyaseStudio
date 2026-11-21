import { useEffect, useMemo, useRef } from "react";
import { ChevronRight, Globe } from "lucide-react";

import type { SearchRecord, SearchSource } from "../../chat/nativeSearch";
import { openExternal, safeExternalUrl } from "../../chat/externalLinks";
import "./SearchResults.css";
import { bindDefaultContextMenuPolicy } from "../ActionMenu";
import { isExternalSearch } from "../../search/mode";
import { searchProviderNames } from "../../search/settings";

function searchLabel(search: SearchRecord): string {
  if (isExternalSearch(search.provider)) {
    if (search.status === "searching") return `正在搜索 · ${searchProviderNames[search.provider]}`;
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

const SUGGESTION_LAYOUT_STYLE = `<style>
html, body { margin: 0; padding: 0; background: transparent; overflow-x: hidden; }
body { padding: 2px; box-sizing: border-box; }
.container { max-width: 100%; box-sizing: border-box; }
.carousel { min-width: 0; margin-right: 0 !important; padding: 4px 16px 4px 4px; scroll-padding-inline: 32px; }
.carousel :is(a, button, .chip):focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
.carousel[data-fade-start="false"][data-fade-end="true"] { -webkit-mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 28px), transparent 100%); mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 28px), transparent 100%); }
.carousel[data-fade-start="true"][data-fade-end="true"] { -webkit-mask-image: linear-gradient(to right, transparent 0, #000 24px, #000 calc(100% - 28px), transparent 100%); mask-image: linear-gradient(to right, transparent 0, #000 24px, #000 calc(100% - 28px), transparent 100%); }
.carousel[data-fade-start="true"][data-fade-end="false"] { -webkit-mask-image: linear-gradient(to right, transparent 0, #000 24px, #000 100%); mask-image: linear-gradient(to right, transparent 0, #000 24px, #000 100%); }
.carousel:focus-within { -webkit-mask-image: none !important; mask-image: none !important; }
@media (prefers-color-scheme: dark) { .carousel :is(a, button, .chip):focus-visible { outline-color: #93c5fd; } }
@media (forced-colors: active) { .carousel { -webkit-mask-image: none !important; mask-image: none !important; } .carousel :is(a, button, .chip):focus-visible { outline-color: Highlight; } }
</style>`;

function sanitizedSuggestionHtml(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  document.querySelectorAll("script, base, meta[http-equiv='refresh'], iframe, object, embed, form").forEach((element) => element.remove());
  const styles = [...document.querySelectorAll("head style")].map((style) => style.outerHTML).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https:">${styles}${SUGGESTION_LAYOUT_STYLE}</head><body>${document.body.innerHTML}</body></html>`;
}

export function resizeSuggestionFrame(frame: HTMLIFrameElement, document: Document): void {
  frame.style.height = "0px";
  const bodyRectHeight = document.body?.getBoundingClientRect?.().height ?? 0;
  const rootRectHeight = document.documentElement?.getBoundingClientRect?.().height ?? 0;
  const height = Math.max(
    document.body?.scrollHeight ?? 0,
    document.documentElement?.scrollHeight ?? 0,
    bodyRectHeight,
    rootRectHeight,
  );
  frame.style.height = `${Math.min(320, Math.max(48, Math.ceil(height)))}px`;
}

export function updateSuggestionCarouselFade(document: Document): void {
  document.querySelectorAll<HTMLElement>(".carousel").forEach((carousel) => {
    const overflows = carousel.scrollWidth > carousel.clientWidth + 1;
    carousel.dataset.fadeStart = overflows && carousel.scrollLeft > 2 ? "true" : "false";
    carousel.dataset.fadeEnd = overflows && carousel.scrollLeft + carousel.clientWidth < carousel.scrollWidth - 2 ? "true" : "false";
  });
}

export function ensureSuggestionFocusVisible(carousel: HTMLElement, target: Element | null): void {
  const item = target?.closest?.("a, button, [tabindex]") ?? target;
  if (!item || !carousel.contains(item) || carousel.clientWidth <= 0) return;
  const carouselRect = carousel.getBoundingClientRect?.();
  const itemRect = item.getBoundingClientRect?.();
  if (!carouselRect || !itemRect || itemRect.width <= 0) return;
  const clearance = 12;
  const maxScroll = Math.max(0, carousel.scrollWidth - carousel.clientWidth);
  const itemLeft = itemRect.left - carouselRect.left + carousel.scrollLeft;
  const itemRight = itemRect.right - carouselRect.left + carousel.scrollLeft;
  let nextScroll = carousel.scrollLeft;
  if (itemRect.width + clearance * 2 > carousel.clientWidth) {
    nextScroll = Math.max(0, Math.min(maxScroll, itemLeft - clearance));
  } else if (itemRight + clearance > carousel.scrollLeft + carousel.clientWidth) {
    nextScroll = Math.max(0, Math.min(maxScroll, itemRight + clearance - carousel.clientWidth));
  } else if (itemLeft - clearance < carousel.scrollLeft) {
    nextScroll = Math.max(0, Math.min(maxScroll, itemLeft - clearance));
  }
  if (Math.abs(nextScroll - carousel.scrollLeft) > 0.5) {
    carousel.scrollLeft = nextScroll > carousel.scrollLeft ? Math.ceil(nextScroll) : Math.floor(nextScroll);
  }
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
    const syncFade = () => updateSuggestionCarouselFade(document);
    const resize = () => { if (frame.current) resizeSuggestionFrame(frame.current, document); syncFade(); };
    let pendingFrame: number | undefined;
    const cancelPendingFrame = () => {
      if (pendingFrame !== undefined) { cancelAnimationFrame(pendingFrame); pendingFrame = undefined; }
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Element | null;
      const carousel = target?.closest<HTMLElement>(".carousel");
      if (!carousel) return;
      ensureSuggestionFocusVisible(carousel, target);
      syncFade();
      cancelPendingFrame();
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = undefined;
        ensureSuggestionFocusVisible(carousel, document.activeElement);
        syncFade();
      });
    };
    document.addEventListener("click", open, true);
    document.addEventListener("auxclick", open, true);
    document.addEventListener("submit", preventSubmit, true);
    document.addEventListener("focusin", onFocusIn, true);
    const carousels = [...document.querySelectorAll<HTMLElement>(".carousel")];
    carousels.forEach((carousel) => carousel.addEventListener("scroll", syncFade, { passive: true }));
    const unbindContextMenu = bindDefaultContextMenuPolicy(document);
    const observer = new ResizeObserver(resize);
    observer.observe(document.body); resize();
    cleanup.current = () => { cancelPendingFrame(); observer.disconnect(); carousels.forEach((carousel) => carousel.removeEventListener("scroll", syncFade)); unbindContextMenu(); document.removeEventListener("click", open, true); document.removeEventListener("auxclick", open, true); document.removeEventListener("submit", preventSubmit, true); document.removeEventListener("focusin", onFocusIn, true); };
  };
  return <section className="gemini-suggestion" aria-label="搜索建议"><iframe ref={frame} title="Gemini 搜索建议" sandbox="allow-same-origin" srcDoc={srcDoc} onLoad={bindFrame} /></section>;
}

export function SearchResults({ search, showCitationNotice = true }: { search: SearchRecord; showCitationNotice?: boolean }) {
  const sources = search.sources;
  const external = isExternalSearch(search.provider);
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
