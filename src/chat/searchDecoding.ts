import { initialSearch, type SearchRecord, type SearchSource } from "./nativeSearch";

type UnknownRecord = Record<string, unknown>;
const record = (value: unknown): value is UnknownRecord => typeof value === "object" && value !== null && !Array.isArray(value);
const string = (value: unknown): string | undefined => typeof value === "string" && value ? value : undefined;

function byteOffsetToUtf16(text: string, offset: number): number | undefined {
  const bytes = new TextEncoder();
  let index = 0; let used = 0;
  for (const character of text) {
    if (used === offset) return index;
    if (used > offset) return undefined;
    used += bytes.encode(character).length;
    index += character.length;
  }
  return used === offset ? index : undefined;
}

export class SearchDecoder {
  private value?: SearchRecord;
  private emitted = "";

  constructor(private readonly enabled: boolean) { if (enabled) this.value = initialSearch(true); }

  get search(): SearchRecord | undefined { return this.value; }

  private update(next: Partial<SearchRecord>, evidence = true): SearchRecord | undefined {
    if (!this.value) this.value = initialSearch(this.enabled);
    this.value = { ...this.value, ...next, status: this.value.status === "failed" ? "failed" : next.status ?? (evidence && this.value.status !== "completed" ? "searching" : this.value.status) };
    return this.value;
  }

  snapshot(): SearchRecord | undefined {
    if (!this.value || this.value.status === "pending") return undefined;
    const signature = JSON.stringify(this.value);
    if (signature === this.emitted) return undefined;
    this.emitted = signature;
    return this.value;
  }

  complete(): SearchRecord | undefined {
    if (!this.value) return undefined;
    if (this.value.status === "failed") return this.snapshot();
    return this.update({ status: this.value.status === "searching" || this.value.status === "completed" ? "completed" : "not-used" }, false);
  }

  fail(error: string): SearchRecord | undefined { return this.update({ status: "failed", error }, false); }
  activity(): SearchRecord | undefined { return this.update({ status: "searching" }); }
  searched(): SearchRecord | undefined { return this.update({ status: "completed" }); }

  openAI(value: unknown, offset = 0): SearchRecord | undefined {
    if (!record(value)) return undefined;
    if (value.type === "web_search_call") {
      if (value.status === "completed") this.searched(); else this.activity();
    }
    const sources: SearchSource[] = [];
    const annotations = Array.isArray(value.annotations) ? value.annotations : value.annotation ? [value.annotation] : [];
    for (const annotation of annotations) {
      if (!record(annotation)) continue;
      const citation = record(annotation.url_citation) ? annotation.url_citation : annotation;
      const url = string(citation.url);
      if (!url) continue;
      const id = url;
      sources.push({ id, url, title: string(citation.title) ?? url });
      const start = Number(citation.start_index ?? citation.start); const end = Number(citation.end_index ?? citation.end);
      if (Number.isFinite(start) && Number.isFinite(end)) this.addCitations([{ start: offset + start, end: offset + end, sourceIds: [id] }]);
    }
    const action = record(value.action) ? value.action : undefined;
    const actionSources = action && Array.isArray(action.sources) ? action.sources : Array.isArray(value.sources) ? value.sources : [];
    for (const source of actionSources) if (record(source) && string(source.url)) {
      const url = string(source.url)!; sources.push({ id: url, url, title: string(source.title) ?? url });
    }
    const query = string(value.query) ?? string(action?.query);
    if (query) this.addQueries([query]);
    if (sources.length) { this.addSources(sources); this.searched(); }
    return this.search;
  }

  openAIOutput(output: unknown): void {
    let offset = 0;
    for (const item of Array.isArray(output) ? output : []) {
      if (!record(item)) continue;
      this.openAI(item);
      for (const part of Array.isArray(item.content) ? item.content : []) {
        if (!record(part)) continue;
        this.openAI(part, offset);
        if (typeof part.text === "string") offset += part.text.length;
        else if (typeof part.refusal === "string") offset += part.refusal.length;
      }
    }
  }

  gemini(metadata: unknown, parts: Array<{ text: string; offset: number }>, streamedAnswer?: string): SearchRecord | undefined {
    if (!record(metadata)) return undefined;
    const chunks = Array.isArray(metadata.groundingChunks) ? metadata.groundingChunks : [];
    const sourceByIndex: Array<SearchSource | undefined> = [];
    for (const chunk of chunks) {
      const web = record(chunk) && record(chunk.web) ? chunk.web : undefined;
      const url = string(web?.uri); if (url) sourceByIndex.push({ id: url, url, title: string(web?.title) ?? url }); else sourceByIndex.push(undefined);
    }
    const sources = sourceByIndex.filter((source): source is SearchSource => !!source);
    if (sources.length) this.addSources(sources);
    this.addQueries(Array.isArray(metadata.webSearchQueries) ? metadata.webSearchQueries.filter((item): item is string => typeof item === "string") : []);
    const entry = record(metadata.searchEntryPoint) ? metadata.searchEntryPoint : undefined;
    const suggestionHtml = string(entry?.renderedContent); if (suggestionHtml) this.update({ suggestionHtml });
    const citations = [] as Array<{ start: number; end: number; sourceIds: string[] }>;
    for (const support of Array.isArray(metadata.groundingSupports) ? metadata.groundingSupports : []) {
      if (!record(support) || !record(support.segment)) continue;
      const partIndex = Number(support.segment.partIndex ?? 0); const part = parts[Number.isInteger(partIndex) ? partIndex : 0];
      const indices = Array.isArray(support.groundingChunkIndices) ? support.groundingChunkIndices : [];
      const sourceIds = indices.map(Number).filter(Number.isInteger).map((index) => sourceByIndex[index]?.id).filter((id): id is string => !!id);
      if (!sourceIds.length) continue;
      const segmentText = string(support.segment.text);
      // Stream chunks do not expose a stable global Part ID. Segment.text is
      // answer text (not a source excerpt); a unique exact match is an anchor.
      if (streamedAnswer !== undefined && segmentText) {
        const start = streamedAnswer.indexOf(segmentText);
        if (start >= 0 && streamedAnswer.indexOf(segmentText, start + 1) < 0) {
          citations.push({ start, end: start + segmentText.length, sourceIds });
        }
        continue;
      }
      if (!part) continue;
      const start = byteOffsetToUtf16(part.text, Number(support.segment.startIndex ?? 0));
      const end = byteOffsetToUtf16(part.text, Number(support.segment.endIndex ?? new TextEncoder().encode(part.text).length));
      if (start !== undefined && end !== undefined && end > start) citations.push({ start: part.offset + start, end: part.offset + end, sourceIds });
    }
    this.addCitations(citations);
    if (sources.length || this.value?.queries.length || suggestionHtml) this.searched();
    return this.search;
  }

  anthropic(block: unknown, textOffset: number, textEnd = textOffset): SearchRecord | undefined {
    if (!record(block)) return undefined;
    const query = record(block.input) ? string(block.input.query) : undefined;
    if (block.type === "server_tool_use" && string(block.name) === "web_search") {
      this.activity();
      if (query) this.addQueries([query]);
    }
    if (block.type === "web_search_tool_result" || block.type === "web_search_tool_result_error") {
      this.searched();
      const errorCode = string(block.error_code) ?? (record(block.error) ? string(block.error.error_code) ?? string(block.error.code) : undefined)
        ?? (record(block.content) ? string(block.content.error_code) ?? string(block.content.code) : undefined);
      if (errorCode) this.fail(errorCode);
      if (Array.isArray(block.content)) for (const item of block.content) if (record(item)) this.anthropic(item, textOffset, textEnd);
    }
    const url = string(block.url); if (url) this.addSources([{ id: url, url, title: string(block.title) ?? url }]);
    const citations = Array.isArray(block.citations) ? block.citations : [];
    for (const citation of citations) if (record(citation) && string(citation.url)) {
      const url = string(citation.url)!; const id = url;
      this.addSources([{ id, url, title: string(citation.title) ?? url }]);
      const start = Number(citation.start_char_offset); const end = Number(citation.end_char_offset);
      if (Number.isFinite(start) && Number.isFinite(end)) this.addCitations([{ start: textOffset + start, end: textOffset + end, sourceIds: [id] }]);
      else if (citation.type === "web_search_result_location") this.addCitations([{ start: textOffset, end: textEnd, sourceIds: [id] }]);
    }
    return this.search;
  }

  private addSources(additions: SearchSource[]) {
    const existing = new Map(this.value?.sources.map((source) => [source.id, source]));
    additions.forEach((source) => existing?.set(source.id, source));
    this.update({ sources: [...(existing?.values() ?? [])] });
  }
  private addQueries(additions: string[]) {
    const queries = [...new Set([...(this.value?.queries ?? []), ...additions])];
    if (queries.length) this.update({ queries });
  }
  private addCitations(additions: Array<{ start: number; end: number; sourceIds: string[] }>) {
    if (!additions.length) return;
    const citations = [...(this.value?.citations ?? [])];
    for (const citation of additions) if (!citations.some((item) => item.start === citation.start && item.end === citation.end && item.sourceIds.join("|") === citation.sourceIds.join("|"))) citations.push(citation);
    this.update({ citations });
  }
}
