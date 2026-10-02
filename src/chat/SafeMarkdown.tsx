import { memo, type ComponentPropsWithoutRef, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { remarkMathSyntax } from "./markdownMath";
import { remarkCodeBlocks } from "./markdownCode";
import { CodeBlock } from "./CodeBlock";
import type { ExtraProps } from "react-markdown";
import type { PluggableList } from "unified";

import type { SearchRecord } from "./nativeSearch";
import { renderExternalCitations } from "../search/citations";
import { isExternalSearch } from "../search/mode";
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

function normalizedLineEndings(value: string) {
  return value.replace(/\r\n?/g, "\n");
}

function addCitationBadges(tree: unknown, citations: CitationGroup[], source: string) {
  const transform = (parent: MarkdownNode, handled = new Set<CitationGroup>()) => {
    if (!parent.children) return handled;
    const next: MarkdownNode[] = [];
    for (const child of parent.children) {
      const range = offsets(child);
      const endingHere = range ? citations.filter((citation) => !handled.has(citation)
        && citation.end >= range[0] && citation.end <= range[1]) : [];
      // Ordinary text has identical offsets except that Markdown normalizes
      // CRLF. Decoded entities or escapes use the node boundary below instead
      // of slicing altered text.
      const sourceValue = range ? source.slice(range[0], range[1]) : undefined;
      const normalizedSourceValue = sourceValue && normalizedLineEndings(sourceValue);
      const text = child.value;
      if (child.type === "text" && typeof text === "string" && range && (text === sourceValue || text === normalizedSourceValue) && endingHere.length) {
        let cursor = 0;
        for (const citation of endingHere) {
          const end = text === normalizedSourceValue
            ? normalizedLineEndings(source.slice(range[0], citation.end)).length
            : citation.end - range[0];
          if (end > cursor) next.push({ ...child, value: text.slice(cursor, end) });
          next.push(citationNode(citation.sourceIds)); handled.add(citation); cursor = end;
        }
        if (cursor < text.length) next.push({ ...child, value: text.slice(cursor) });
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

function addSoftLineBreaks(tree: unknown) {
  const transform = (parent: MarkdownNode) => {
    if (!parent.children) return;
    for (const child of parent.children) transform(child);
    parent.children = parent.children.flatMap((child) => {
      if (child.type !== "text" || typeof child.value !== "string") return child;
      const value = normalizedLineEndings(child.value);
      if (!value.includes("\n")) return child;
      const lines = value.split("\n");
      const next: MarkdownNode[] = [];
      for (const [index, line] of lines.entries()) {
        if (line) next.push({ ...child, value: line });
        if (index < lines.length - 1) next.push({ type: "break" });
      }
      return next;
    });
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

function CodePre({ node, children, ...props }: ComponentPropsWithoutRef<"pre"> & ExtraProps) {
  const code = node?.children.find((child) => child.type === "element" && child.tagName === "code");
  if (code?.type === "element" && typeof code.properties["data-code-text"] === "string") {
    return <CodeBlock code={code.properties["data-code-text"]} language={String(code.properties["data-code-language"] ?? "")} />;
  }
  return <pre {...props}>{children}</pre>;
}

function SafeMarkdownContent({ children, search }: { children: string; search?: SearchRecord }): ReactNode {
  const citations = validCitations(search, children);
  const remarkPlugins: PluggableList = [[remarkGfm, { singleTilde: false }], remarkMath, remarkMathSyntax, remarkCodeBlocks,
    ...(isExternalSearch(search?.provider)
      ? [() => (tree: unknown) => renderExternalCitations(tree as MarkdownNode, children, search.sources, citationNode)]
      : citations.length ? [() => (tree: unknown) => addCitationBadges(tree, citations, children)] : []),
    () => (tree: unknown) => addSoftLineBreaks(tree)];
  return <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={[[rehypeKatex, { trust: false, errorColor: "currentColor" }]]} components={{
    a: ExternalLink,
    pre: CodePre,
    span: ({ node: _node, ...props }) => search ? CitationSpan(props, search) : <span {...props} />,
  }}>{children}</ReactMarkdown>;
}

/** Unchanged history skips parsing; changed text or search data still renders. */
export const SafeMarkdown = memo(SafeMarkdownContent);
