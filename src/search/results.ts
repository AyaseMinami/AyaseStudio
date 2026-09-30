import type { SearchSource } from "../chat/nativeSearch";

export type ExaSearchResult = { sources: SearchSource[]; warning?: string };
/** Only fixed messages created locally may be displayed by a search caller. */
export class ExaResultError extends Error {}

export function normalizeExaResults(results: unknown[], count: number): ExaSearchResult {
  if (!results.length) throw new ExaResultError("Exa 未找到可用搜索资料。");
  const sources: SearchSource[] = [];
  const seen = new Set<string>();
  const prefix = crypto.randomUUID();
  let remaining = 8000;
  let limited = false;
  for (const raw of results) {
    const candidate = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined;
    if (!candidate || typeof candidate.title !== "string" || !candidate.title.trim()
      || typeof candidate.url !== "string" || candidate.url.length > 2048
      || typeof candidate.text !== "string" || !candidate.text.trim()) { limited = true; continue; }
    let url: URL;
    try { url = new URL(candidate.url); } catch { limited = true; continue; }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) { limited = true; continue; }
    url.hash = "";
    if (url.href.length > 2048) { limited = true; continue; }
    if (seen.has(url.href)) { limited = true; continue; }
    if (sources.length >= count || remaining <= 0) { limited = true; continue; }
    const text = Array.from(candidate.text.trim());
    const title = Array.from(candidate.title.trim());
    const excerpt = text.slice(0, Math.min(1500, remaining)).join("");
    if (text.length > Array.from(excerpt).length || title.length > 300) limited = true;
    remaining -= Array.from(excerpt).length;
    seen.add(url.href);
    sources.push({ id: `${prefix}-${sources.length + 1}`, title: title.slice(0, 300).join(""), url: url.href, excerpt });
  }
  if (!sources.length) throw new ExaResultError("Exa 未返回包含正文的有效搜索资料。");
  return { sources, ...(limited ? { warning: "部分搜索资料无效、重复或超过上限，已限制采用范围。" } : {}) };
}
