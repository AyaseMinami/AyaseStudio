import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { decodeString } from "micromark-util-decode-string";
import { remarkMathSyntax } from "../chat/markdownMath";
import type { SearchCitation, SearchRecord, SearchSource } from "../chat/nativeSearch";
import { isExternalSearch } from "./mode";

export interface CitationNode {
  type?: string;
  value?: string;
  children?: CitationNode[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
}

const parser = unified().use(remarkParse).use(remarkGfm, { singleTilde: false }).use(remarkMath).use(remarkMathSyntax);
const ignored = new Set(["code", "inlineCode", "math", "inlineMath", "html", "link", "linkReference", "image", "imageReference"]);

function decodedOffset(raw: string, value: string, offset: number, quoteDepth: number): number | undefined {
  const containers = (text: string) => text.replace(/(\r\n?|\n)([^\r\n]*)/g, (_all, newline: string, line: string) => {
    // Only remove prefixes owned by actual blockquote ancestors in this AST.
    for (let depth = 0; depth < quoteDepth; depth++) line = line.replace(/^[ \t]*>[ \t]?/, "");
    return newline + line;
  });
  const normalize = (text: string) => value.includes("\r") ? text : text.replace(/\r\n?/g, "\n");
  const decoded = normalize(decodeString(containers(raw)));
  const boundary = normalize(decodeString(containers(raw.slice(0, offset)))).length;
  let target = 0;
  for (let index = 0; index < boundary; index++) {
    if (decoded[index] === value[target]) target++;
    // Markdown can remove continuation indentation from a text node.
    else if (!/\s/u.test(decoded[index])) return undefined;
  }
  return target;
}

/** Walk parsed text only; offsets always address the unchanged UTF-16 source. */
function visitMarkers(tree: CitationNode, content: string, visit: (node: CitationNode, start: number, end: number, id: string, valueStart: number) => void, quoteDepth = 0) {
  if (ignored.has(tree.type ?? "")) return;
  if (tree.type === "blockquote") quoteDepth++;
  const start = tree.position?.start?.offset;
  const end = tree.position?.end?.offset;
  if (tree.type === "text" && typeof tree.value === "string" && typeof start === "number" && typeof end === "number") {
    const raw = content.slice(start, end);
    for (const match of raw.matchAll(/\[ayase-source:([a-zA-Z0-9_-]{1,80})\]/g)) {
      const valueStart = decodedOffset(raw, tree.value, match.index!, quoteDepth);
      if (valueStart === undefined || tree.value.slice(valueStart, valueStart + match[0].length) !== match[0]) continue;
      let slashes = 0;
      for (let i = match.index! - 1; i >= 0 && raw[i] === "\\"; i--) slashes++;
      if (slashes % 2) continue;
      visit(tree, start + match.index!, start + match.index! + match[0].length, match[1], valueStart);
    }
  }
  for (const child of tree.children ?? []) visitMarkers(child, content, visit, quoteDepth);
}

export function externalCitations(content: string, sources: SearchSource[]): SearchCitation[] {
  const ids = new Set(sources.map(source => source.id));
  const result: SearchCitation[] = [];
  visitMarkers(parser.parse(content), content, (_node, start, end, id) => {
    if (ids.has(id)) result.push({ start, end, sourceIds: [id] });
  });
  return result;
}

export function renderExternalCitations(tree: CitationNode, content: string, sources: SearchSource[], badge: (ids: string[]) => CitationNode): void {
  const ids = new Set(sources.map(source => source.id));
  const edits = new Map<CitationNode, { start: number; end: number; id: string }[]>();
  visitMarkers(tree, content, (node, start, end, id, valueStart) => {
    if (!ids.has(id)) return;
    const items = edits.get(node) ?? [];
    items.push({ start: valueStart, end: valueStart + end - start, id });
    edits.set(node, items);
  });
  const replace = (parent: CitationNode): void => {
    if (!parent.children) return;
    parent.children = parent.children.flatMap(child => {
      replace(child);
      const items = edits.get(child);
      if (!items || typeof child.value !== "string") return child;
      let cursor = 0;
      const nodes: CitationNode[] = [];
      for (const item of items) {
        if (item.start > cursor) nodes.push({ type: "text", value: child.value.slice(cursor, item.start) });
        nodes.push(badge([item.id]));
        cursor = item.end;
      }
      if (cursor < child.value.length) nodes.push({ type: "text", value: child.value.slice(cursor) });
      return nodes;
    });
  };
  replace(tree);
}

export function readableSearchAnswer(content: string, search?: SearchRecord, history = false): string {
  if (!isExternalSearch(search?.provider)) return content;
  let result = content;
  for (const citation of externalCitations(content, search.sources).reverse()) {
    const source = search.sources.find(source => source.id === citation.sourceIds[0])!;
    const number = search.sources.indexOf(source) + 1;
    const replacement = history ? `${source.title} (${source.url})` : `[${number}](${source.url})`;
    result = result.slice(0, citation.start) + replacement + result.slice(citation.end);
  }
  return result;
}
