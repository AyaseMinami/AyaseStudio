import type { ComponentPropsWithoutRef, MouseEvent, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { SearchRecord } from "./nativeSearch";
import { openExternal, safeExternalUrl } from "./externalLinks";

type MarkdownNode = {
  type?: string;
  value?: string;
  children?: MarkdownNode[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
  data?: { hName?: string; hProperties?: Record<string, string> };
};

interface CitationGroup {
  start: number;
  end: number;
  sourceIds: string[];
}

function validCitations(search: SearchRecord | undefined, content: string): CitationGroup[] {
  if (!search) return [];
  const sources = new Set(search.sources.map((source) => source.id));
  const citations = search.citations.filter((citation) => Number.isInteger(citation.start) && Number.isInteger(citation.end)
    && citation.start >= 0 && citation.start < citation.end && citation.end <= content.length
    && citation.sourceIds.some((id) => sources.has(id)))
    .sort((left, right) => left.end - right.end || left.start - right.start);
  const groups: CitationGroup[] = [];
  for (const citation of citations) {
    const previous = groups[groups.length - 1];
    if (previous && previous.end === citation.end) {
      previous.start = Math.min(previous.start, citation.start);
      previous.sourceIds.push(...citation.sourceIds.filter((id) => !previous.sourceIds.includes(id)));
    } else groups.push({ ...citation, sourceIds: [...citation.sourceIds] });
  }
  return groups;
}

function citationNode(sourceIds: string[]): MarkdownNode {
  return { type: "searchCitation", data: { hName: "span", hProperties: {
    "data-search-citation": JSON.stringify(sourceIds),
  } } };
}

function offsets(node: MarkdownNode): [number, number] | undefined {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  return typeof start === "number" && typeof end === "number" ? [start, end] : undefined;
}

function addCitationBadges(tree: unknown, citations: CitationGroup[], source: string) {
  const transform = (parent: MarkdownNode, handled = new Set<CitationGroup>()) => {
    if (!parent.children) return handled;
    const next: MarkdownNode[] = [];
    for (const child of parent.children) {
      const range = offsets(child);
      const endingHere = range ? citations.filter((citation) => !handled.has(citation)
        && citation.end >= range[0] && citation.end <= range[1]) : [];
      // Ordinary text has identical source/value offsets. Decoded entities or
      // escapes use the node boundary below instead of slicing altered text.
      if (child.type === "text" && range && child.value === source.slice(range[0], range[1]) && endingHere.length) {
        let cursor = 0;
        for (const citation of endingHere) {
          const end = citation.end - range[0];
          if (end > cursor) next.push({ ...child, value: child.value.slice(cursor, end) });
          next.push(citationNode(citation.sourceIds)); handled.add(citation); cursor = end;
        }
        if (cursor < child.value.length) next.push({ ...child, value: child.value.slice(cursor) });
        continue;
      }
      if (child.type !== "text" && child.type !== "link") transform(child, handled);
      next.push(child);
      const nested = endingHere.filter((citation) => !handled.has(citation));
      for (const citation of child.type === "text" || child.type === "link" ? endingHere : nested) {
        next.push(citationNode(citation.sourceIds));
        handled.add(citation);
      }
    }
    parent.children = next;
    return handled;
  };
  transform(tree as MarkdownNode);
}

function CitationSpan({ node: _node, ...props }: ComponentPropsWithoutRef<"span"> & { node?: unknown; "data-search-citation"?: string }, search: SearchRecord) {
  const value = props["data-search-citation"];
  if (typeof value !== "string") return <span {...props} />;
  let sourceIds: string[] = [];
  try { sourceIds = JSON.parse(value); } catch { return <span {...props} />; }
  const sources = Array.isArray(sourceIds) ? sourceIds.map((id) => search.sources.find((source) => source.id === id)).filter((source) => source !== undefined) : [];
  return <>{sources.map((source) => {
    const url = safeExternalUrl(source.url);
    const number = search.sources.indexOf(source) + 1;
    return <button key={source.id} type="button" className="citation-badge" title={`${source.title}\n${source.url}`}
      aria-label={`打开来源 ${number}: ${source.title}`} disabled={!url} onClick={() => url && void openExternal(url)}>[{number}]</button>;
  })}</>;
}

function ExternalLink({ node: _node, href, children, ...props }: ComponentPropsWithoutRef<"a"> & { node?: unknown }) {
  const url = safeExternalUrl(href ?? "");
  if (!url) return <span>{children}</span>;
  const open = (event: MouseEvent<HTMLAnchorElement>) => { if (event.button > 1) return; event.preventDefault(); void openExternal(url); };
  return <a {...props} href={url} onClick={open} onAuxClick={open}>{children}</a>;
}

export function SafeMarkdown({ children, search }: { children: string; search?: SearchRecord }): ReactNode {
  const citations = validCitations(search, children);
  const remarkPlugins = citations.length ? [remarkGfm, () => (tree: unknown) => addCitationBadges(tree, citations, children)] : [remarkGfm];
  return <ReactMarkdown remarkPlugins={remarkPlugins} components={{
    a: ExternalLink,
    span: (props) => search ? CitationSpan(props, search) : <span {...props} />,
  }}>{children}</ReactMarkdown>;
}
