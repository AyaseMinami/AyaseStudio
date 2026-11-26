import {
  initialSearch,
  mergeSearchSources,
  normalizeWebUrl,
  type SearchCitation,
  type SearchRecord,
  type SearchSource,
} from "./nativeSearch";

type UnknownRecord = Record<string, unknown>;
const record = (value: unknown): value is UnknownRecord => typeof value === "object" && value !== null && !Array.isArray(value);
const string = (value: unknown): string | undefined => typeof value === "string" && value ? value : undefined;

const DEEPSEEK_KINDS = new Set(["search", "deep_search", "read_link", "image_search", "deep_image_search"]);

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

export function codePointOffsetToUtf16(text: string, codePointOffset: number): number | undefined {
  if (!Number.isInteger(codePointOffset) || codePointOffset < 0) return undefined;
  let index = 0;
  let points = 0;
  for (const character of text) {
    if (points === codePointOffset) return index;
    index += character.length;
    points += 1;
  }
  return points === codePointOffset ? index : undefined;
}

interface RawPartCitation {
  startIndex: number;
  endIndex: number;
  sourceId: string;
  annotationIndex?: number;
}

interface StagedPartCitations {
  outputIndex: number;
  contentIndex: number;
  partText: string;
  offset: number;
  annotations: RawPartCitation[];
}

export interface SearchDecoderOptions {
  deepseekCodePointOffsets?: boolean;
}

export class SearchDecoder {
  private value?: SearchRecord;
  private emitted = "";
  private deepseekObserved: boolean;
  private succeededTools = 0;
  private failedErrors: string[] = [];
  private processedToolKeys = new Set<string>();
  private directCitations: SearchCitation[] = [];
  private stagedParts = new Map<string, StagedPartCitations>();
  private responsesFullTextLength = 0;

  constructor(private readonly enabled: boolean, options: SearchDecoderOptions = {}) {
    this.deepseekObserved = Boolean(options.deepseekCodePointOffsets);
    if (enabled) this.value = initialSearch(true);
  }

  get search(): SearchRecord | undefined { return this.value; }

  private ensureValue(): SearchRecord {
    if (!this.value) this.value = initialSearch(this.enabled);
    return this.value;
  }

  private resolveStatus(nextStatus?: SearchRecord["status"], evidence = true): SearchRecord["status"] {
    const current = this.ensureValue();
    if (this.succeededTools === 0 && this.failedErrors.length > 0) return "failed";
    if (nextStatus) return nextStatus;
    if (this.succeededTools > 0) return "completed";
    if (evidence && current.status !== "completed") return "searching";
    return current.status;
  }

  private update(next: Partial<SearchRecord>, evidence = true): SearchRecord | undefined {
    const current = this.ensureValue();
    const status = this.resolveStatus(next.status, evidence);
    const error = status === "failed"
      ? (next.error ?? current.error ?? this.failedErrors[this.failedErrors.length - 1])
      : undefined;
    this.value = {
      ...current,
      ...next,
      status,
      ...(error !== undefined ? { error } : { error: undefined }),
    };
    if (this.value.error === undefined) delete this.value.error;
    return this.value;
  }

  private recordToolSuccess(key?: string): void {
    if (key) {
      if (this.processedToolKeys.has(`ok:${key}`)) return;
      this.processedToolKeys.add(`ok:${key}`);
    }
    this.succeededTools += 1;
    this.update({ status: "completed", error: undefined }, false);
  }

  private recordToolError(errorCode: string, key?: string): void {
    if (key) {
      if (this.processedToolKeys.has(`err:${key}`)) return;
      this.processedToolKeys.add(`err:${key}`);
    }
    this.failedErrors.push(errorCode);
    if (this.succeededTools > 0) {
      this.update({ status: "completed" }, false);
    } else {
      this.update({ status: "failed", error: errorCode }, false);
    }
  }

  clearCitations(): SearchRecord | undefined {
    this.directCitations = [];
    this.stagedParts.clear();
    if (!this.value) return undefined;
    this.value = { ...this.value, citations: [] };
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
    if (this.succeededTools === 0 && this.failedErrors.length > 0) {
      this.update({ status: "failed", error: this.failedErrors[this.failedErrors.length - 1] }, false);
      return this.snapshot();
    }
    const hasActivity = this.succeededTools > 0
      || this.value.status === "searching"
      || this.value.status === "completed"
      || this.value.sources.length > 0
      || this.value.queries.length > 0;
    return this.update({ status: hasActivity ? "completed" : "not-used" }, false);
  }

  fail(error: string): SearchRecord | undefined {
    this.recordToolError(error);
    return this.search;
  }
  activity(): SearchRecord | undefined { return this.update(this.succeededTools > 0 ? { status: "completed" } : { status: "searching" }); }
  searched(): SearchRecord | undefined { return this.update({ status: "completed" }); }

  private registerSources(additions: Array<Omit<SearchSource, "id"> & { id?: string }>): Map<string, string> {
    if (!additions.length) return new Map();
    const current = this.ensureValue();
    const { sources } = mergeSearchSources(current.sources, additions);
    this.update({ sources });
    return new Map(sources.map((source) => [source.url, source.id]));
  }

  private registerSource(url: string, title?: string, excerpt?: string): string | undefined {
    const normalized = normalizeWebUrl(url);
    if (!normalized) return undefined;
    const map = this.registerSources([{ url: normalized, title: title?.trim() || normalized, ...(excerpt ? { excerpt } : {}) }]);
    return map.get(normalized);
  }

  private rebuildCitations(maxLength?: number): void {
    const merged: SearchCitation[] = maxLength !== undefined
      ? this.directCitations.filter((item) => item.start >= 0 && item.start < item.end && item.end <= maxLength)
      : [...this.directCitations];
    const useCodePoints = this.deepseekObserved;
    const parts = [...this.stagedParts.values()].sort(
      (left, right) => left.outputIndex - right.outputIndex || left.contentIndex - right.contentIndex,
    );
    for (const part of parts) {
      for (const raw of part.annotations) {
        let start: number | undefined;
        let end: number | undefined;
        if (useCodePoints) {
          const localStart = codePointOffsetToUtf16(part.partText, raw.startIndex);
          const localEnd = codePointOffsetToUtf16(part.partText, raw.endIndex);
          if (localStart !== undefined && localEnd !== undefined) {
            start = part.offset + localStart;
            end = part.offset + localEnd;
          }
        } else if (
          Number.isInteger(raw.startIndex)
          && Number.isInteger(raw.endIndex)
          && raw.startIndex >= 0
          && raw.startIndex < raw.endIndex
          && raw.endIndex <= part.partText.length
        ) {
          start = part.offset + raw.startIndex;
          end = part.offset + raw.endIndex;
        }
        if (start === undefined || end === undefined) continue;
        const limit = maxLength ?? Math.max(this.responsesFullTextLength, part.offset + part.partText.length);
        if (start < 0 || start >= end || end > limit) continue;
        if (!merged.some((item) => item.start === start && item.end === end && item.sourceIds.join("|") === raw.sourceId)) {
          merged.push({ start, end, sourceIds: [raw.sourceId] });
        }
      }
    }
    this.update({ citations: merged });
  }

  private extractRawUrlCitation(annotation: unknown): RawPartCitation | undefined {
    if (!record(annotation)) return undefined;
    const citation = record(annotation.url_citation) ? annotation.url_citation : annotation;
    const url = normalizeWebUrl(citation.url);
    if (!url) return undefined;
    const sourceId = this.registerSource(url, string(citation.title) ?? url);
    if (!sourceId) return undefined;
    const startIndex = Number(citation.start_index ?? citation.start);
    const endIndex = Number(citation.end_index ?? citation.end);
    if (!Number.isFinite(startIndex) || !Number.isFinite(endIndex)) return undefined;
    const annotationIndex = typeof annotation.annotation_index === "number" ? annotation.annotation_index : undefined;
    return { startIndex, endIndex, sourceId, annotationIndex };
  }

  openAIWebSearchCall(value: unknown, fallbackKey?: string): SearchRecord | undefined {
    if (!record(value) || value.type !== "web_search_call") return undefined;
    if (typeof value.kind === "string" && DEEPSEEK_KINDS.has(value.kind)) {
      this.deepseekObserved = true;
    }
    const callKey = string(value.id) ?? fallbackKey;
    const status = string(value.status);
    if (status === "failed") {
      const errorObj = record(value.error) ? value.error : undefined;
      const code = string(errorObj?.code) ?? string(errorObj?.message) ?? "unavailable";
      this.recordToolError(code, callKey);
    } else if (status === "completed") {
      this.recordToolSuccess(callKey);
    } else {
      this.activity();
    }

    const sources: Array<Omit<SearchSource, "id">> = [];
    const queries: string[] = [];
    const action = record(value.action) ? value.action : undefined;
    if (action) {
      if (Array.isArray(action.queries)) {
        for (const item of action.queries) {
          const text = string(item);
          if (text) queries.push(text);
        }
      }
      const singleQuery = string(action.query);
      if (singleQuery) queries.push(singleQuery);
      if (Array.isArray(action.sources)) {
        for (const source of action.sources) {
          if (!record(source)) continue;
          const url = normalizeWebUrl(source.url);
          if (!url) continue;
          const excerpt = string(source.snippet) ?? string(source.excerpt);
          sources.push({ url, title: string(source.title) ?? url, ...(excerpt ? { excerpt } : {}) });
        }
      }
    }
    const topQuery = string(value.query);
    if (topQuery) queries.push(topQuery);
    if (Array.isArray(value.sources)) {
      for (const source of value.sources) {
        if (!record(source)) continue;
        const url = normalizeWebUrl(source.url);
        if (!url) continue;
        const excerpt = string(source.snippet) ?? string(source.excerpt);
        sources.push({ url, title: string(source.title) ?? url, ...(excerpt ? { excerpt } : {}) });
      }
    }
    if (record(value.page)) {
      const pageUrl = normalizeWebUrl(value.page.url);
      if (pageUrl) {
        sources.push({ url: pageUrl, title: string(value.page.title) ?? pageUrl });
      }
    }
    if (queries.length) this.addQueries(queries);
    if (sources.length) {
      this.registerSources(sources);
      if (status !== "failed") this.searched();
    }
    return this.search;
  }

  openAIAnnotation(
    outputIndex: number,
    contentIndex: number,
    annotation: unknown,
    partText: string,
    offset: number,
    fullTextLength: number,
  ): SearchRecord | undefined {
    const raw = this.extractRawUrlCitation(annotation);
    if (!raw) return this.search;
    const key = `${outputIndex}:${contentIndex}`;
    const staged = this.stagedParts.get(key) ?? {
      outputIndex,
      contentIndex,
      partText,
      offset,
      annotations: [],
    };
    staged.partText = partText;
    staged.offset = offset;
    const duplicate = staged.annotations.some((existing) =>
      (raw.annotationIndex !== undefined && existing.annotationIndex === raw.annotationIndex)
      || (existing.startIndex === raw.startIndex && existing.endIndex === raw.endIndex && existing.sourceId === raw.sourceId));
    if (!duplicate) staged.annotations.push(raw);
    this.stagedParts.set(key, staged);
    this.responsesFullTextLength = Math.max(this.responsesFullTextLength, fullTextLength);
    this.rebuildCitations(this.responsesFullTextLength);
    this.searched();
    return this.search;
  }

  openAI(value: unknown, offset = 0): SearchRecord | undefined {
    if (!record(value)) return undefined;
    if (value.type === "web_search_call") {
      return this.openAIWebSearchCall(value);
    }
    const sources: Array<Omit<SearchSource, "id">> = [];
    let annotationSourceAdded = false;
    const annotations = Array.isArray(value.annotations) ? value.annotations : value.annotation ? [value.annotation] : [];
    for (const annotation of annotations) {
      if (!record(annotation)) continue;
      const citation = record(annotation.url_citation) ? annotation.url_citation : annotation;
      const url = normalizeWebUrl(citation.url);
      if (!url) continue;
      const sourceId = this.registerSource(url, string(citation.title) ?? url);
      if (!sourceId) continue;
      annotationSourceAdded = true;
      const start = Number(citation.start_index ?? citation.start);
      const end = Number(citation.end_index ?? citation.end);
      if (Number.isFinite(start) && Number.isFinite(end)) {
        this.addCitations([{ start: offset + start, end: offset + end, sourceIds: [sourceId] }]);
      }
    }
    const action = record(value.action) ? value.action : undefined;
    const actionSources = action && Array.isArray(action.sources) ? action.sources : Array.isArray(value.sources) ? value.sources : [];
    for (const source of actionSources) {
      if (!record(source)) continue;
      const url = normalizeWebUrl(source.url);
      if (!url) continue;
      const excerpt = string(source.snippet) ?? string(source.excerpt);
      sources.push({ url, title: string(source.title) ?? url, ...(excerpt ? { excerpt } : {}) });
    }
    const query = string(value.query) ?? string(action?.query);
    if (query) this.addQueries([query]);
    if (sources.length) this.registerSources(sources);
    if (annotationSourceAdded || sources.length) this.searched();
    return this.search;
  }

  openAIOutput(
    output: unknown,
    options: { toolsOnly?: boolean; maxTextLength?: number; streamedParts?: Map<number, Map<number, string>> } = {},
  ): void {
    let offset = 0;
    const items = Array.isArray(output) ? output : [];
    for (let outputIndex = 0; outputIndex < items.length; outputIndex += 1) {
      const item = items[outputIndex];
      if (!record(item)) continue;
      if (item.type === "web_search_call") {
        this.openAIWebSearchCall(item, `output:${outputIndex}`);
        continue;
      }
      if (options.toolsOnly) continue;
      if (item.type !== "message") continue;
      const content = Array.isArray(item.content) ? item.content : [];
      for (let contentIndex = 0; contentIndex < content.length; contentIndex += 1) {
        const part = content[contentIndex];
        if (!record(part)) continue;
        if (part.type !== undefined && part.type !== "output_text" && part.type !== "refusal") continue;
        const streamedText = options.streamedParts?.get(outputIndex)?.get(contentIndex);
        const snapshotText = typeof part.text === "string"
          ? part.text
          : typeof part.refusal === "string" ? part.refusal : "";
        const partText = options.streamedParts ? (streamedText ?? "") : snapshotText;
        const key = `${outputIndex}:${contentIndex}`;
        if (Array.isArray(part.annotations)) {
          const rawAnnotations = part.annotations
            .map((entry) => this.extractRawUrlCitation(entry))
            .filter((entry): entry is RawPartCitation => !!entry);
          if (rawAnnotations.length > 0) {
            this.stagedParts.set(key, {
              outputIndex,
              contentIndex,
              partText,
              offset,
              annotations: rawAnnotations,
            });
            this.searched();
          } else {
            this.stagedParts.delete(key);
          }
        } else {
          const existing = this.stagedParts.get(key);
          if (existing) {
            existing.partText = partText;
            existing.offset = offset;
          }
        }
        offset += partText.length;
      }
    }
    if (!options.toolsOnly && (this.stagedParts.size > 0 || (this.value?.citations.length ?? 0) > 0)) {
      const bound = options.maxTextLength !== undefined
        ? Math.min(offset, options.maxTextLength)
        : offset;
      this.responsesFullTextLength = bound;
      this.rebuildCitations(bound);
    }
  }

  gemini(metadata: unknown, parts: Array<{ text: string; offset: number }>, streamedAnswer?: string): SearchRecord | undefined {
    if (!record(metadata)) return undefined;
    const chunks = Array.isArray(metadata.groundingChunks) ? metadata.groundingChunks : [];
    const sourceIdsByIndex: Array<string | undefined> = [];
    for (const chunk of chunks) {
      const web = record(chunk) && record(chunk.web) ? chunk.web : undefined;
      const url = normalizeWebUrl(web?.uri);
      if (url) sourceIdsByIndex.push(this.registerSource(url, string(web?.title) ?? url));
      else sourceIdsByIndex.push(undefined);
    }
    const validSources = sourceIdsByIndex.filter((id): id is string => !!id);
    this.addQueries(Array.isArray(metadata.webSearchQueries) ? metadata.webSearchQueries.filter((item): item is string => typeof item === "string") : []);
    const entry = record(metadata.searchEntryPoint) ? metadata.searchEntryPoint : undefined;
    const suggestionHtml = string(entry?.renderedContent); if (suggestionHtml) this.update({ suggestionHtml });
    const citations: SearchCitation[] = [];
    for (const support of Array.isArray(metadata.groundingSupports) ? metadata.groundingSupports : []) {
      if (!record(support) || !record(support.segment)) continue;
      const partIndex = Number(support.segment.partIndex ?? 0); const part = parts[Number.isInteger(partIndex) ? partIndex : 0];
      const indices = Array.isArray(support.groundingChunkIndices) ? support.groundingChunkIndices : [];
      const sourceIds = indices.map(Number).filter(Number.isInteger).map((index) => sourceIdsByIndex[index]).filter((id): id is string => !!id);
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
    if (validSources.length || this.value?.queries.length || suggestionHtml) this.searched();
    return this.search;
  }

  anthropic(
    block: unknown,
    textOffset: number,
    textEnd = textOffset,
    blockText?: string,
    blockKey?: string,
  ): SearchRecord | undefined {
    if (!record(block)) return undefined;
    if (block.type === "server_tool_use") {
      const name = string(block.name);
      if (name === "web_search") {
        this.activity();
        const query = record(block.input) ? string(block.input.query) : undefined;
        if (query) this.addQueries([query]);
      } else if (name === "deepseek_web_search") {
        this.activity();
        if (record(block.input)) {
          const queries: string[] = [];
          if (Array.isArray(block.input.queries)) {
            for (const item of block.input.queries) {
              const text = string(item);
              if (text) queries.push(text);
            }
          }
          const single = string(block.input.query);
          if (single) queries.push(single);
          if (queries.length) this.addQueries(queries);
        }
      } else if (name === "deepseek_read_url") {
        this.activity();
      }
      return this.search;
    }

    if (block.type === "web_search_tool_result") {
      const resultKey = blockKey ?? string(block.tool_use_id);
      if (Array.isArray(block.content)) {
        let sawError = false;
        let sawResult = false;
        const additions: Array<Omit<SearchSource, "id">> = [];
        for (const item of block.content) {
          if (!record(item)) continue;
          if (item.type === "web_search_tool_result_error" || string(item.error_code)) {
            sawError = true;
            const code = string(item.error_code)
              ?? (record(item.error) ? string(item.error.error_code) ?? string(item.error.code) : undefined)
              ?? "unavailable";
            this.recordToolError(code, resultKey);
            continue;
          }
          const url = normalizeWebUrl(item.url);
          if (url) {
            sawResult = true;
            const excerpt = string(item.snippet) ?? string(item.excerpt);
            additions.push({ url, title: string(item.title) ?? url, ...(excerpt ? { excerpt } : {}) });
          }
        }
        if (additions.length) this.registerSources(additions);
        if (sawResult || !sawError) {
          this.recordToolSuccess(resultKey);
        }
      } else if (record(block.content)) {
        const code = string(block.content.error_code) ?? string(block.content.code);
        if (code) this.recordToolError(code, resultKey);
      } else {
        const code = string(block.error_code) ?? (record(block.error) ? string(block.error.error_code) ?? string(block.error.code) : undefined);
        if (code) this.recordToolError(code, resultKey);
      }
      return this.search;
    }

    if (block.type === "web_search_tool_result_error") {
      const code = string(block.error_code)
        ?? (record(block.error) ? string(block.error.error_code) ?? string(block.error.code) : undefined)
        ?? (record(block.content) ? string(block.content.error_code) ?? string(block.content.code) : undefined)
        ?? "unavailable";
      this.recordToolError(code, blockKey ?? string(block.tool_use_id));
      return this.search;
    }

    if (block.type === "web_fetch_tool_result") {
      const resultKey = blockKey ?? string(block.tool_use_id);
      if (record(block.content)) {
        if (block.content.type === "web_fetch_result") {
          const url = normalizeWebUrl(block.content.url);
          const inner = record(block.content.content) ? block.content.content : undefined;
          const title = string(inner?.title) ?? string(block.content.title);
          if (url) this.registerSource(url, title ?? url);
          this.recordToolSuccess(resultKey);
        } else if (block.content.type === "web_fetch_tool_result_error" || string(block.content.error_code)) {
          const code = string(block.content.error_code) ?? string(block.content.code) ?? "unavailable";
          this.recordToolError(code, resultKey);
        }
      }
      return this.search;
    }

    const url = normalizeWebUrl(block.url);
    if (url) {
      const excerpt = string(block.snippet) ?? string(block.excerpt);
      this.registerSource(url, string(block.title) ?? url, excerpt);
    }

    const citations = Array.isArray(block.citations) ? block.citations : [];
    for (const citation of citations) {
      if (!record(citation)) continue;
      const citationUrl = normalizeWebUrl(citation.url);
      if (!citationUrl) continue;
      const sourceId = this.registerSource(citationUrl, string(citation.title) ?? citationUrl);
      if (!sourceId) continue;
      const start = Number(citation.start_char_offset);
      const end = Number(citation.end_char_offset);
      if (Number.isFinite(start) && Number.isFinite(end)) {
        this.addCitations([{ start: textOffset + start, end: textOffset + end, sourceIds: [sourceId] }]);
      } else if (citation.type === "web_search_result_location") {
        let anchorEnd = textEnd;
        if (typeof blockText === "string") {
          const trimmedEnd = textOffset + blockText.trimEnd().length;
          anchorEnd = trimmedEnd > textOffset ? trimmedEnd : textEnd;
        }
        this.addCitations([{ start: textOffset, end: anchorEnd, sourceIds: [sourceId] }]);
      }
    }
    return this.search;
  }

  private addQueries(additions: string[]) {
    const queries = [...new Set([...(this.value?.queries ?? []), ...additions])];
    if (queries.length) this.update({ queries });
  }

  private addCitations(additions: SearchCitation[]) {
    if (!additions.length) return;
    for (const citation of additions) {
      if (!this.directCitations.some((item) => item.start === citation.start && item.end === citation.end && item.sourceIds.join("|") === citation.sourceIds.join("|"))) {
        this.directCitations.push(citation);
      }
    }
    this.rebuildCitations();
  }
}
