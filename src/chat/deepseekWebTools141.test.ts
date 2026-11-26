import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { defaultSessionConfig, readSessionConfigData } from "./sessionConfig";
import { buildProtocolBody, parameterCapability, RequestConfigError, validateRequestConfig } from "./requestMapping";
import { codePointOffsetToUtf16, SearchDecoder } from "./searchDecoding";
import { createChatTransport } from "./transport";
import { planContextBudget } from "./contextBudget";
import { mergeSearch, type SearchRecord } from "./nativeSearch";
import {
  buildAnthropicDeepSeekReplay,
  buildResponsesDeepSeekReplay,
  containsDeepSeekToolBlocks,
  readMessageProviderReplay,
} from "./deepseekReplay";
import { createChatRepository, type StoredChatMessage } from "./repository";
import { MessageEdits } from "./messageEdits";
import { AttachmentLifecycle } from "./attachmentLifecycle";
import type { AttachmentStore } from "./attachmentResources";
import type { ChatEvent } from "./types";

function deepseekConfig(tools: { search: boolean; readUrl: boolean } = { search: true, readUrl: true }) {
  return {
    ...defaultSessionConfig(),
    webSearch: true,
    webSearchProvider: "deepseek-server" as const,
    deepseekWebTools: tools,
  };
}

function sseResponse(frames: string[], contentType = "text/event-stream"): Response {
  return new Response(frames.join(""), { headers: { "Content-Type": contentType } });
}

async function collectEvents(stream: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("#141 DeepSeek server web tools: protocol mapping, decoding, replay, and edits", () => {
  it("enforces protocol boundaries, keeps openai-chat native unchanged, and surfaces advisory sampling hints", () => {
    const reqBase = {
      baseUrl: "https://api.deepseek.com",
      apiKey: "synthetic-key",
      model: "deepseek-flash",
      messages: [{ role: "user" as const, content: "latest news" }],
    };

    // openai-chat forbids deepseek-server with zero fallback to web_search_options
    const chatErrs = validateRequestConfig(deepseekConfig(), "openai-chat", "deepseek-flash");
    expect(chatErrs.webSearch).toContain("Chat Completions 不支持 DeepSeek 服务端联网工具");
    expect(() => buildProtocolBody("openai-chat", { ...reqBase, config: deepseekConfig() })).toThrow(RequestConfigError);

    // openai-chat native still emits web_search_options
    const chatNative = buildProtocolBody("openai-chat", {
      ...reqBase,
      config: { ...defaultSessionConfig(), webSearch: true, webSearchProvider: "native" },
    });
    expect(chatNative).toMatchObject({ web_search_options: {} });
    expect(chatNative.tools).toBeUndefined();

    // gemini-native forbids deepseek-server
    const geminiErrs = validateRequestConfig(deepseekConfig(), "gemini-native", "gemini-2.5");
    expect(geminiErrs.webSearch).toContain("仅支持 Responses 与 Anthropic 协议");
    expect(() => buildProtocolBody("gemini-native", { ...reqBase, config: deepseekConfig() })).toThrow(RequestConfigError);

    // Empty tool selection rejected
    const emptyTools = deepseekConfig({ search: false, readUrl: false });
    expect(validateRequestConfig(emptyTools, "anthropic-native", "deepseek-flash").webSearch).toContain("至少保留一项");
    expect(() => buildProtocolBody("openai-responses", { ...reqBase, config: emptyTools })).toThrow(RequestConfigError);

    // Anthropic deepseek-server mapping (both, search-only, readUrl-only)
    const anthBoth = buildProtocolBody("anthropic-native", { ...reqBase, config: deepseekConfig() });
    expect(anthBoth.tools).toEqual([
      { type: "deepseek_web_search", name: "deepseek_web_search" },
      { type: "deepseek_read_url", name: "deepseek_read_url" },
    ]);
    expect(anthBoth.tool_choice).toBeUndefined();
    expect((anthBoth as Record<string, unknown>).safety_check).toBeUndefined();
    expect((anthBoth as Record<string, unknown>).title).toBeUndefined();

    const anthReadOnly = buildProtocolBody("anthropic-native", {
      ...reqBase,
      config: deepseekConfig({ search: false, readUrl: true }),
    });
    expect(anthReadOnly.tools).toEqual([{ type: "deepseek_read_url", name: "deepseek_read_url" }]);

    // Responses deepseek-server mapping (no name, no tool_choice, no include, store: false)
    const respBoth = buildProtocolBody("openai-responses", { ...reqBase, config: deepseekConfig() });
    expect(respBoth.tools).toEqual([
      { type: "deepseek_web_search" },
      { type: "deepseek_read_url" },
    ]);
    expect(respBoth.tool_choice).toBeUndefined();
    expect(respBoth.include).toBeUndefined();
    expect(respBoth.store).toBe(false);

    const respSearchOnly = buildProtocolBody("openai-responses", {
      ...reqBase,
      config: deepseekConfig({ search: true, readUrl: false }),
    });
    expect(respSearchOnly.tools).toEqual([{ type: "deepseek_web_search" }]);

    // Advisory sampling hint does not block existing custom numeric values
    const withCustomTemp = { ...deepseekConfig(), temperature: { mode: "custom" as const, value: "0.7" } };
    expect(parameterCapability("anthropic-native", "deepseek-flash", "temperature", withCustomTemp)).toMatchObject({
      support: "unknown",
      advisory: true,
    });
    expect(validateRequestConfig(withCustomTemp, "anthropic-native", "deepseek-flash")).toEqual({});
    expect(parameterCapability("openai-responses", "deepseek-flash", "topK", withCustomTemp).support).toBe("unsupported");
  });

  it("decodes Anthropic deep search, read_link, whitespace-trimmed citations, partial failures, and error frames", async () => {
    const longSnippet = "中".repeat(1600);
    const sse = [
      ": keep-alive\n\n",
      `event: ping\ndata: ${JSON.stringify({ type: "ping" })}\n\n`,
      `data: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 10 } } })}\n\n`,
      `data: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "Step 1" } })}\n\n`,
      `data: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
      `data: ${JSON.stringify({ type: "content_block_start", index: 1, content_block: {
        type: "server_tool_use", id: "tool_search", name: "deepseek_web_search", kind: "deep_search",
        input: { action: "search", queries: ["query a", "query b"] },
      } })}\n\n`,
      `data: ${JSON.stringify({ type: "content_block_stop", index: 1 })}\n\n`,
      `data: ${JSON.stringify({ type: "content_block_start", index: 2, content_block: {
        type: "web_search_tool_result", tool_use_id: "tool_search",
        content: [{ type: "web_search_result", url: "https://example.test/doc", title: "Real Doc", snippet: longSnippet }],
      } })}\n\n`,
      `data: ${JSON.stringify({ type: "content_block_stop", index: 2 })}\n\n`,
      // Image search with empty queries and a failed open_page fetch must not drown out valid sources
      `data: ${JSON.stringify({ type: "content_block_start", index: 3, content_block: {
        type: "server_tool_use", id: "tool_img", name: "deepseek_web_search", kind: "image_search",
        input: { action: "search", queries: [] },
      } })}\n\n`,
      `data: ${JSON.stringify({ type: "content_block_stop", index: 3 })}\n\n`,
      `data: ${JSON.stringify({ type: "content_block_start", index: 4, content_block: {
        type: "web_fetch_tool_result", tool_use_id: "tool_fail", kind: "deep_search",
        content: { type: "web_fetch_tool_result_error", error_code: "url_not_accessible" },
      } })}\n\n`,
      `data: ${JSON.stringify({ type: "content_block_stop", index: 4 })}\n\n`,
      // Successful signed read_link
      `data: ${JSON.stringify({ type: "content_block_start", index: 5, content_block: {
        type: "server_tool_use", id: "tool_read", name: "deepseek_read_url", kind: "read_link",
        input: { action: "read_link", url: "https://example.test/read" },
      } })}\n\n`,
      `data: ${JSON.stringify({ type: "content_block_stop", index: 5 })}\n\n`,
      `data: ${JSON.stringify({ type: "content_block_start", index: 6, content_block: {
        type: "web_fetch_tool_result", tool_use_id: "tool_read", kind: "read_link", signature: "sig-read-1",
        content: { type: "web_fetch_result", url: "https://example.test/read", content: { title: "Read Page" } },
      } })}\n\n`,
      `data: ${JSON.stringify({ type: "content_block_stop", index: 6 })}\n\n`,
      // Text block ending with trailing newline; citation anchor must stop before trailing whitespace
      `data: ${JSON.stringify({ type: "content_block_start", index: 7, content_block: { type: "text", text: "" } })}\n\n`,
      `data: ${JSON.stringify({ type: "content_block_delta", index: 7, delta: { type: "text_delta", text: "Answer text\n\n" } })}\n\n`,
      `data: ${JSON.stringify({ type: "content_block_delta", index: 7, delta: { type: "citations_delta", citation: {
        type: "web_search_result_location", url: "https://example.test/doc", title: "https://example.test/doc",
      } } })}\n\n`,
      `data: ${JSON.stringify({ type: "content_block_stop", index: 7 })}\n\n`,
      `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 20 } })}\n\n`,
      `data: ${JSON.stringify({ type: "message_stop" })}\n\n`,
    ];

    const transport = createChatTransport("anthropic-native", { fetch: async () => sseResponse(sse) });
    const events: ChatEvent[] = [];
    for await (const event of transport.stream({
      baseUrl: "https://api.deepseek.com/anthropic",
      apiKey: "synthetic",
      model: "deepseek-flash",
      messages: [{ role: "user", content: "read https://example.test/read" }],
      replayScope: "conn|https://api.deepseek.com/anthropic",
      config: { ...deepseekConfig(), thinking: { "anthropic-native": { choice: "budget", budget: "2048", includeSummary: true } } },
    })) {
      events.push(event);
    }

    expect(events.filter((e) => e.type === "text-delta").map((e) => e.text).join("")).toBe("Answer text\n\n");
    const lastSearch = [...events].reverse().find((e) => e.type === "search-update");
    expect(lastSearch && lastSearch.type === "search-update").toBe(true);
    if (lastSearch?.type === "search-update") {
      expect(lastSearch.search.status).toBe("completed");
      expect(lastSearch.search.queries).toEqual(["query a", "query b"]);
      expect(lastSearch.search.sources).toHaveLength(2);
      // Title was NOT overwritten by URL placeholder from citation; snippet capped at 1500 code points
      expect(lastSearch.search.sources[0].title).toBe("Real Doc");
      expect(Array.from(lastSearch.search.sources[0].excerpt ?? "").length).toBe(1500);
      expect(lastSearch.search.sources[1]).toMatchObject({ url: "https://example.test/read", title: "Read Page" });
      // Citation anchored at trimmed end (11) instead of 13
      expect(lastSearch.search.citations).toEqual([{ start: 0, end: 11, sourceIds: [lastSearch.search.sources[0].id] }]);
    }

    // Replay contains ONLY paired signed read_link + citation-stripped text (no thinking, no search, no failed fetch)
    const replayEvent = events.find((e) => e.type === "provider-replay");
    expect(replayEvent?.type).toBe("provider-replay");
    if (replayEvent?.type === "provider-replay") {
      expect(replayEvent.replay.protocol).toBe("anthropic-native");
      expect(replayEvent.replay.content).toEqual([
        { type: "server_tool_use", id: "tool_read", name: "deepseek_read_url", kind: "read_link", input: { action: "read_link", url: "https://example.test/read" } },
        { type: "web_fetch_tool_result", tool_use_id: "tool_read", kind: "read_link", signature: "sig-read-1", content: { type: "web_fetch_result", url: "https://example.test/read", content: { title: "Read Page" } } },
        { type: "text", text: "Answer text\n\n" },
      ]);
      expect(containsDeepSeekToolBlocks(replayEvent.replay.content)).toBe(true);
    }

    // Unnamed JSON error frame with usage emits usage-update then failed
    const unnamedErrorTransport = createChatTransport("anthropic-native", {
      fetch: async () => sseResponse([
        `data: ${JSON.stringify({ error: { message: "rate_limit_exceeded" }, usage: { input_tokens: 5, output_tokens: 1 } })}\n\n`,
      ]),
    });
    const unnamedEvents: ChatEvent[] = [];
    for await (const e of unnamedErrorTransport.stream({
      baseUrl: "https://api.deepseek.com/anthropic", apiKey: "synthetic", model: "deepseek-flash",
      messages: [{ role: "user", content: "hi" }], config: deepseekConfig(),
    })) unnamedEvents.push(e);
    expect(unnamedEvents.map((e) => e.type)).toEqual(["usage-update", "failed"]);

    // Plain-text event: error frame emits provider failure; malformed non-error frame still emits protocol error
    const plainErrTransport = createChatTransport("anthropic-native", {
      fetch: async () => sseResponse(["event: error\ndata: upstream timeout\n\n"]),
    });
    const plainEvents: ChatEvent[] = [];
    for await (const e of plainErrTransport.stream({
      baseUrl: "https://api.deepseek.com/anthropic", apiKey: "synthetic", model: "deepseek-flash",
      messages: [{ role: "user", content: "hi" }], config: deepseekConfig(),
    })) plainEvents.push(e);
    expect(plainEvents[0]).toMatchObject({ type: "failed", error: { kind: "provider" } });

    const malformedTransport = createChatTransport("anthropic-native", {
      fetch: async () => sseResponse(["data: {not-json\n\n"]),
    });
    const malformedEvents: ChatEvent[] = [];
    for await (const e of malformedTransport.stream({
      baseUrl: "https://api.deepseek.com/anthropic", apiKey: "synthetic", model: "deepseek-flash",
      messages: [{ role: "user", content: "hi" }], config: deepseekConfig(),
    })) malformedEvents.push(e);
    expect(malformedEvents[0]).toMatchObject({ type: "failed", error: { kind: "protocol" } });
  });

  it("handles Responses code-point citations with emoji/CJK without duplicates, out-of-order tools, and native UTF-16 isolation", async () => {
    // Text: "Hi🚀👨‍👩‍👧‍👦𠮷!"
    // Code points: H(0) i(1) 🚀(2) 👨(3) ZWJ(4) 👩(5) ZWJ(6) 👧(7) ZWJ(8) 👦(9) 𠮷(10) !(11)
    // UTF-16:      0    1    2..4   4..6   6      7..9   9      10..12 12     13..15 15..17 17..18
    const text = "Hi🚀👨‍👩‍👧‍👦𠮷!";
    expect(codePointOffsetToUtf16(text, 2)).toBe(2);
    expect(codePointOffsetToUtf16(text, 3)).toBe(4);
    expect(codePointOffsetToUtf16(text, 10)).toBe(15);
    expect(codePointOffsetToUtf16(text, 11)).toBe(17);
    expect(codePointOffsetToUtf16(text, 12)).toBe(18);

    const sse = [
      // Parallel tool calls added first, completed out of order
      { type: "response.output_item.added", output_index: 0, item: { type: "web_search_call", id: "ws_1", status: "in_progress", kind: "deep_search" } },
      { type: "response.output_item.added", output_index: 1, item: { type: "web_search_call", id: "ws_2", status: "in_progress", kind: "read_link" } },
      { type: "response.output_item.done", output_index: 1, item: {
        type: "web_search_call", id: "ws_2", status: "completed", kind: "read_link",
        action: { type: "open_page", url: "https://example.test/page" },
        page: { url: "https://example.test/page", title: "Linked Page" },
        signature: "resp-sig-1",
      } },
      { type: "response.output_item.done", output_index: 0, item: {
        type: "web_search_call", id: "ws_1", status: "completed", kind: "deep_search",
        action: { type: "search", queries: ["emoji test"], sources: [{ url: "https://example.test/s1", title: "Emoji Source", snippet: "snippet text" }] },
      } },
      { type: "response.reasoning_text.delta", item_id: "rs_1", content_index: 0, delta: "First step" },
      { type: "response.reasoning_text.done", item_id: "rs_1", content_index: 0, text: "First step" },
      { type: "response.reasoning_text.delta", item_id: "rs_2", content_index: 0, delta: "Second step" },
      { type: "response.reasoning_text.done", item_id: "rs_2", content_index: 0, text: "Second step" },
      { type: "response.output_text.delta", output_index: 2, content_index: 0, delta: text },
      // Streaming annotation arrives with code-point offsets [0, 11] -> UTF-16 [0, 17]
      { type: "response.output_text.annotation.added", output_index: 2, content_index: 0, annotation_index: 0, annotation: {
        type: "url_citation", url: "https://example.test/s1", title: "https://example.test/s1", start_index: 0, end_index: 11,
      } },
      // Terminal response.completed carries authoritative annotations -> whole-part replace, NO duplicates!
      { type: "response.completed", response: {
        status: "completed",
        output: [
          { type: "web_search_call", id: "ws_1", status: "completed", kind: "deep_search", action: { type: "search", queries: ["emoji test"], sources: [{ url: "https://example.test/s1", title: "Emoji Source", snippet: "snippet text" }] } },
          { type: "web_search_call", id: "ws_2", status: "completed", kind: "read_link", action: { type: "open_page", url: "https://example.test/page" }, page: { url: "https://example.test/page", title: "Linked Page" }, signature: "resp-sig-1" },
          { type: "message", role: "assistant", content: [{
            type: "output_text", text,
            annotations: [{ type: "url_citation", url: "https://example.test/s1", title: "https://example.test/s1", start_index: 0, end_index: 11 }],
          }] },
        ],
      } },
    ].map((e) => `data: ${JSON.stringify(e)}\n\n`);

    const transport = createChatTransport("openai-responses", { fetch: async () => sseResponse(sse) });
    const events: ChatEvent[] = [];
    for await (const e of transport.stream({
      baseUrl: "https://api.deepseek.com", apiKey: "synthetic", model: "deepseek-flash",
      messages: [{ role: "user", content: "check" }], replayScope: "conn|https://api.deepseek.com",
      config: { ...deepseekConfig(), thinking: { "openai-responses": { choice: "high", budget: "", includeSummary: true } } },
    })) events.push(e);

    expect(events.filter((e) => e.type === "thinking-delta").map((e) => e.text).join("")).toBe("First step\n\nSecond step");
    const lastSearch = [...events].reverse().find((e) => e.type === "search-update");
    expect(lastSearch?.type).toBe("search-update");
    if (lastSearch?.type === "search-update") {
      expect(lastSearch.search.citations).toHaveLength(1);
      expect(lastSearch.search.citations[0]).toEqual({ start: 0, end: 17, sourceIds: ["https://example.test/s1"] });
      expect(lastSearch.search.sources.find((s) => s.url === "https://example.test/s1")?.title).toBe("Emoji Source");
    }
    const replay = events.find((e) => e.type === "provider-replay");
    expect(replay?.type).toBe("provider-replay");
    if (replay?.type === "provider-replay") {
      expect(replay.replay.protocol).toBe("openai-responses");
      expect(replay.replay.content).toHaveLength(1);
      expect(replay.replay.content[0]).toMatchObject({ type: "web_search_call", kind: "read_link", signature: "resp-sig-1" });
    }

    // Standard OpenAI Responses native keeps UTF-16 offsets untouched
    const nativeDecoder = new SearchDecoder(true);
    nativeDecoder.openAIOutput([{
      type: "message",
      content: [{
        type: "output_text", text: "Hi🚀!",
        annotations: [{ type: "url_citation", url: "https://example.test/native", title: "Native", start_index: 0, end_index: 4 }],
      }],
    }]);
    expect(nativeDecoder.search?.citations).toEqual([{ start: 0, end: 4, sourceIds: ["https://example.test/native"] }]);
  });

  it("distinguishes Responses content_filter refusal from ordinary OpenAI refusal blocks and locks Anthropic refusal", async () => {
    // Non-streaming Responses content_filter with empty output_text -> refusal completed, tools kept, no thinking/replay
    const filterTransport = createChatTransport("openai-responses", {
      fetch: async () => new Response(JSON.stringify({
        status: "incomplete",
        incomplete_details: { reason: "content_filter" },
        output_text: "",
        output: [
          { type: "web_search_call", id: "ws_1", status: "completed", kind: "search", action: { type: "search", queries: ["q"], sources: [{ url: "https://example.test/r", title: "R" }] } },
          { type: "reasoning", id: "rs_1", content: [{ type: "reasoning_text", text: "secret thought" }] },
          { type: "message", role: "assistant", content: [{ type: "refusal", refusal: "Blocked by safety filter" }] },
        ],
      }), { headers: { "Content-Type": "application/json" } }),
    });
    const filterEvents: ChatEvent[] = [];
    for await (const e of filterTransport.stream({
      baseUrl: "https://api.deepseek.com", apiKey: "synthetic", model: "deepseek-flash",
      messages: [{ role: "user", content: "q" }], config: { ...deepseekConfig(), stream: false },
    })) filterEvents.push(e);
    expect(filterEvents.some((e) => e.type === "thinking-delta" || e.type === "text-delta" || e.type === "provider-replay")).toBe(false);
    expect(filterEvents[filterEvents.length - 1]).toMatchObject({
      type: "completed",
      finishReason: "incomplete:content_filter",
      refusal: { reason: "content_filter", explanation: "Blocked by safety filter" },
    });

    // Standard OpenAI non-streaming refusal-only response (status: completed, output_text: "") outputs refusal as normal text
    const normalRefusalTransport = createChatTransport("openai-responses", {
      fetch: async () => new Response(JSON.stringify({
        status: "completed",
        output_text: "",
        output: [{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: "I cannot assist with that." }] }],
      }), { headers: { "Content-Type": "application/json" } }),
    });
    const normalEvents: ChatEvent[] = [];
    for await (const e of normalRefusalTransport.stream({
      baseUrl: "https://api.openai.com", apiKey: "synthetic", model: "gpt-4o",
      messages: [{ role: "user", content: "q" }], config: { ...defaultSessionConfig(), stream: false },
    })) normalEvents.push(e);
    expect(normalEvents.find((e) => e.type === "text-delta")).toEqual({ type: "text-delta", text: "I cannot assist with that." });
    expect(normalEvents[normalEvents.length - 1]).toMatchObject({ type: "completed" });
    expect((normalEvents[normalEvents.length - 1] as { refusal?: unknown }).refusal).toBeUndefined();

    // Anthropic streaming refusal locked then EOF before message_stop -> failed with clearRefusedContent: true
    const eofRefusalTransport = createChatTransport("anthropic-native", {
      fetch: async () => sseResponse([
        `data: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "Draft leak" } })}\n\n`,
        `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "refusal", stop_details: { explanation: "Policy hit" } } })}\n\n`,
      ]),
    });
    const eofEvents: ChatEvent[] = [];
    for await (const e of eofRefusalTransport.stream({
      baseUrl: "https://api.deepseek.com/anthropic", apiKey: "synthetic", model: "deepseek-flash",
      messages: [{ role: "user", content: "q" }], config: deepseekConfig(),
    })) eofEvents.push(e);
    expect(eofEvents[eofEvents.length - 1]).toMatchObject({
      type: "failed",
      clearRefusedContent: true,
      refusal: { reason: "refusal", explanation: "Policy hit" },
    });
  });

  it("allocates bounded source IDs for >512-char URLs, merges progressively without regressions, and caps excerpts at 1500/8000", () => {
    const longUrl = `https://example.test/${"a".repeat(600)}`;
    const decoder = new SearchDecoder(true);
    decoder.anthropic({
      type: "web_search_tool_result",
      tool_use_id: "t1",
      content: [{ type: "web_search_result", url: longUrl, title: "Long Page", snippet: "s".repeat(1600) }],
    }, 0);
    // Later citation with placeholder title must NOT overwrite title or excerpt
    decoder.anthropic({
      type: "text",
      citations: [{ type: "web_search_result_location", url: longUrl, title: longUrl }],
    }, 0, 5, "hello");
    const first = decoder.complete()!;
    expect(first.sources).toHaveLength(1);
    expect(first.sources[0].id.length).toBeLessThanOrEqual(512);
    expect(first.sources[0].url).toBe(longUrl);
    expect(first.sources[0].title).toBe("Long Page");
    expect(Array.from(first.sources[0].excerpt ?? "").length).toBe(1500);
    expect(first.citations).toEqual([{ start: 0, end: 5, sourceIds: [first.sources[0].id] }]);

    // mergeSearch remaps colliding bounded short IDs across turns and enforces 8000 total excerpt budget
    const otherLongUrl = `https://example.test/${"b".repeat(600)}`;
    const prev: SearchRecord = {
      enabled: true, status: "completed", queries: ["q1"], citations: [],
      sources: Array.from({ length: 5 }, (_, i) => ({
        id: i === 0 ? "src-1" : `id-${i}`,
        url: i === 0 ? longUrl : `https://example.test/p${i}`,
        title: `Title ${i}`,
        excerpt: "x".repeat(1500),
      })),
    };
    const next: SearchRecord = {
      enabled: true, status: "completed", queries: ["q2"],
      sources: [
        { id: "src-1", url: otherLongUrl, title: "Other Long", excerpt: "y".repeat(1200) },
      ],
      citations: [{ start: 0, end: 3, sourceIds: ["src-1"] }],
    };
    const merged = mergeSearch(prev, next, 10);
    expect(merged.sources).toHaveLength(6);
    const added = merged.sources[5];
    expect(added.url).toBe(otherLongUrl);
    expect(added.id).not.toBe("src-1");
    expect(merged.citations).toEqual([{ start: 10, end: 13, sourceIds: [added.id] }]);
    const totalPoints = merged.sources.reduce((sum, s) => sum + Array.from(s.excerpt ?? "").length, 0);
    expect(totalPoints).toBe(8000);
  });

  it("shares replay eligibility/expansion across budget and body mapping, and invalidates replay on save-only user edit", async () => {
    // Unsigned or orphan read_link pairs are pruned out
    expect(buildAnthropicDeepSeekReplay([
      { type: "server_tool_use", id: "u1", name: "deepseek_read_url", kind: "read_link", input: { action: "read_link", url: "https://a.test" } },
      { type: "web_fetch_tool_result", tool_use_id: "u1", kind: "read_link", content: { type: "web_fetch_result", url: "https://a.test", content: { title: "No sig" } } },
    ], "scope")).toBeUndefined();

    const respReplay = buildResponsesDeepSeekReplay([
      { type: "web_search_call", id: "ws_search", status: "completed", kind: "search", action: { type: "search" } },
      { type: "web_search_call", id: "ws_unsigned", status: "completed", kind: "read_link" },
      { type: "web_search_call", id: "ws_ok", status: "completed", kind: "read_link", page: { url: "https://a.test", title: "A" }, signature: "sig-ok" },
    ], "conn-1|https://api.deepseek.com")!;
    expect(respReplay).toBeDefined();

    const history: StoredChatMessage[] = [
      { id: "u1", role: "user", content: "read https://a.test", status: "complete" },
      { id: "a1", role: "assistant", replyToId: "u1", content: "Summary of A", status: "complete", providerReplay: respReplay },
    ];
    const counter = (text: string) => text.length;
    // Budget with matching scope & protocol includes expanded Responses replay
    const planResp = await planContextBudget(history, "follow up", defaultSessionConfig(), "openai-responses", "deepseek-flash", counter, [], "conn-1|https://api.deepseek.com");
    expect(planResp.messages[1].providerReplay).toEqual(respReplay);
    const bodyResp = buildProtocolBody("openai-responses", {
      baseUrl: "https://api.deepseek.com", apiKey: "synthetic", model: "deepseek-flash",
      messages: planResp.messages, config: defaultSessionConfig(), replayScope: "conn-1|https://api.deepseek.com",
    });
    expect(bodyResp.input).toEqual([
      { role: "user", content: "read https://a.test" },
      respReplay.content[0],
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "Summary of A" }] },
      { role: "user", content: "follow up" },
    ]);

    // Switching protocol to anthropic-native on same scope isolates and omits Responses replay
    const planAnth = await planContextBudget(history, "follow up", defaultSessionConfig(), "anthropic-native", "deepseek-flash", counter, [], "conn-1|https://api.deepseek.com");
    expect(planAnth.messages[1].providerReplay).toBeUndefined();
    expect(planAnth.inputTokens).toBeLessThan(planResp.inputTokens);

    // Save-only user edit invalidates directly linked visible assistant replay while preserving inactive roundVersions
    const inactivePair: [StoredChatMessage, StoredChatMessage] = [
      { id: "u1-old", role: "user", content: "old url", status: "complete" },
      { id: "a1-old", role: "assistant", replyToId: "u1-old", content: "old summary", status: "complete", providerReplay: respReplay },
    ];
    const transcript: StoredChatMessage[] = [
      { ...history[0], roundVersions: { selected: 1, pairs: [inactivePair, [history[0], history[1]]] } },
      history[1],
    ];
    let savedTranscript = structuredClone(transcript);
    const store: AttachmentStore = {
      save: vi.fn(), read: vi.fn(), verify: vi.fn(), discardUncommitted: vi.fn(async () => {}), cleanup: vi.fn(async () => {}),
    };
    const lifecycle = new AttachmentLifecycle(store, async () => []);
    const edits = new MessageEdits({
      canBegin: () => true,
      read: async () => structuredClone(savedTranscript),
      replace: async (_id, _before, after) => { savedTranscript = structuredClone(after); },
      detach: () => {},
      reload: async () => {},
      outcome: () => {},
    }, lifecycle, store);
    const res = await edits.submit("conv", "u1", "edited without url", undefined);
    expect(res.status).toBe("saved");
    expect(savedTranscript[1].providerReplay).toBeUndefined();
    expect(savedTranscript[0].roundVersions?.pairs[0][1].providerReplay).toEqual(respReplay);

    // Direct repository edit-message also invalidates linked assistant replay
    const repo = createChatRepository(`edit-replay-${crypto.randomUUID()}`);
    await repo.initializeWorkspace(null, []);
    await repo.save({ id: "current", updatedAt: 1, messages: transcript });
    await repo.execute({ type: "edit-message", conversationId: "current", messageId: "u1", content: "repo edited" });
    const loaded = await repo.load("current");
    expect(loaded?.messages[1].providerReplay).toBeUndefined();
    expect(loaded?.messages[0].roundVersions?.pairs[0][1].providerReplay).toEqual(respReplay);

    // Pure read of old SessionConfig without deepseekWebTools keeps field absent
    const parsedLegacy = readSessionConfigData(defaultSessionConfig());
    expect("deepseekWebTools" in parsedLegacy).toBe(false);

    // P2-5: planContextBudget matches buildProtocolBody when replayScope is omitted
    const planNoScope = await planContextBudget(history, "follow up", defaultSessionConfig(), "openai-responses", "deepseek-flash", counter, []);
    expect(planNoScope.messages[1].providerReplay).toBeUndefined();
    expect(planNoScope.inputTokens).toBeLessThan(planResp.inputTokens);
  });

  it("locks Responses content_filter refusal before usage-update abort, clamps terminal citations to streamed length, and clears explicit empty annotations", async () => {
    // P1-1: aborting during usage-update on response.incomplete(content_filter) still signals clearRefusedContent
    const controller = new AbortController();
    const transport = createChatTransport("openai-responses", {
      fetch: vi.fn(async () => sseResponse([
        `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "draft text" })}\n\n`,
        `event: response.incomplete\ndata: ${JSON.stringify({
          type: "response.incomplete",
          response: {
            id: "resp_refuse_abort",
            status: "incomplete",
            incomplete_details: { reason: "content_filter" },
            usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
            output: [{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: "policy block" }] }],
          },
        })}\n\n`,
      ])),
    });
    const events: ChatEvent[] = [];
    for await (const event of transport.stream({
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-secret",
      model: "deepseek-flash",
      messages: [{ role: "user", content: "hi" }],
      config: deepseekConfig(),
      signal: controller.signal,
    })) {
      events.push(event);
      if (event.type === "usage-update") controller.abort();
    }
    const aborted = events.find((event) => event.type === "aborted");
    expect(aborted).toEqual({
      type: "aborted",
      clearRefusedContent: true,
      refusal: { reason: "content_filter", explanation: "policy block" },
    });

    // P1-2: terminal snapshot longer than emitted deltas must not emit out-of-bounds citations
    const clampTransport = createChatTransport("openai-responses", {
      fetch: vi.fn(async () => sseResponse([
        `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "🚀" })}\n\n`,
        `event: response.completed\ndata: ${JSON.stringify({
          type: "response.completed",
          response: {
            id: "resp_clamp",
            status: "completed",
            output: [{
              type: "message",
              role: "assistant",
              content: [{
                type: "output_text",
                text: "🚀A",
                annotations: [{ type: "url_citation", url: "https://clamp.example", title: "Clamp", start_index: 1, end_index: 2 }],
              }],
            }],
          },
        })}\n\n`,
      ])),
    });
    const clampEvents = await collectEvents(clampTransport.stream({
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-secret",
      model: "deepseek-flash",
      messages: [{ role: "user", content: "hi" }],
      config: deepseekConfig(),
    }));
    const clampSearch = [...clampEvents].reverse().find((event) => event.type === "search-update");
    expect(clampSearch?.type === "search-update" ? clampSearch.search.citations : undefined).toEqual([]);

    // P2-1: explicit empty terminal annotations [] clears stale streamed citations
    const clearTransport = createChatTransport("openai-responses", {
      fetch: vi.fn(async () => sseResponse([
        `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "hello" })}\n\n`,
        `event: response.output_text.annotation.added\ndata: ${JSON.stringify({
          type: "response.output_text.annotation.added",
          output_index: 0,
          content_index: 0,
          annotation: { type: "url_citation", url: "https://stale.example", title: "Stale", start_index: 0, end_index: 5 },
        })}\n\n`,
        `event: response.completed\ndata: ${JSON.stringify({
          type: "response.completed",
          response: {
            id: "resp_clear",
            status: "completed",
            output: [{
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "hello", annotations: [] }],
            }],
          },
        })}\n\n`,
      ])),
    });
    const clearEvents = await collectEvents(clearTransport.stream({
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-secret",
      model: "deepseek-flash",
      messages: [{ role: "user", content: "hi" }],
      config: deepseekConfig(),
    }));
    const clearSearch = [...clearEvents].reverse().find((event) => event.type === "search-update");
    expect(clearSearch?.type === "search-update" ? clearSearch.search.citations : undefined).toEqual([]);

    // P1-A (follow-up): buffered Anthropic refusal frame in the same SSE chunk still triggers clearRefusedContent on draft abort
    const bufferedController = new AbortController();
    const bufferedAnth = createChatTransport("anthropic-native", {
      fetch: vi.fn(async () => sseResponse([
        `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`,
        `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "draft" } })}\n\n`,
        `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "refusal", stop_details: { explanation: "blocked" } } })}\n\n`,
      ])),
    });
    const bufferedEvents: ChatEvent[] = [];
    for await (const event of bufferedAnth.stream({
      baseUrl: "https://api.deepseek.com/anthropic",
      apiKey: "sk-secret",
      model: "deepseek-flash",
      messages: [{ role: "user", content: "hi" }],
      config: deepseekConfig(),
      signal: bufferedController.signal,
    })) {
      bufferedEvents.push(event);
      if (event.type === "text-delta") bufferedController.abort();
    }
    expect(bufferedEvents.find((e) => e.type === "aborted")).toEqual({
      type: "aborted",
      clearRefusedContent: true,
      refusal: { reason: "refusal", explanation: "blocked" },
    });

    // P1-B & P2-B (follow-up): preceding reasoning item does not shift citation offsets, part bounds prevent cross-part spillover,
    // and direct relay citations exceeding emitted length are clamped out
    const anchoredTransport = createChatTransport("openai-responses", {
      fetch: vi.fn(async () => sseResponse([
        `event: response.output_item.done\ndata: ${JSON.stringify({
          type: "response.output_item.done",
          output_index: 0,
          item: { type: "custom_relay_item", annotations: [{ url: "https://oob.example", title: "OOB", start_index: 0, end_index: 12 }] },
        })}\n\n`,
        `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", output_index: 1, content_index: 0, delta: "A" })}\n\n`,
        `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", output_index: 1, content_index: 1, delta: "B" })}\n\n`,
        `event: response.completed\ndata: ${JSON.stringify({
          type: "response.completed",
          response: {
            id: "resp_anchor",
            status: "completed",
            output: [
              { type: "reasoning", content: [{ type: "reasoning_text", text: "long reasoning text" }] },
              {
                type: "message",
                role: "assistant",
                content: [
                  {
                    type: "output_text",
                    text: "AX",
                    annotations: [{ type: "url_citation", url: "https://x.example", title: "X", start_index: 1, end_index: 2 }],
                  },
                  {
                    type: "output_text",
                    text: "B",
                    annotations: [{ type: "url_citation", url: "https://b.example", title: "B", start_index: 0, end_index: 1 }],
                  },
                ],
              },
            ],
          },
        })}\n\n`,
      ])),
    });
    const anchoredEvents = await collectEvents(anchoredTransport.stream({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-secret",
      model: "gpt-4.1",
      messages: [{ role: "user", content: "hi" }],
      config: { ...defaultSessionConfig(), webSearch: true, webSearchProvider: "native" },
    }));
    const anchoredSearch = [...anchoredEvents].reverse().find((event) => event.type === "search-update");
    expect(anchoredSearch?.type === "search-update" ? anchoredSearch.search.citations : undefined).toEqual([
      { start: 1, end: 2, sourceIds: ["https://b.example"] },
    ]);

    // P2-A (follow-up): Anthropic non-stream payload with both refusal and error still carries clearRefusedContent
    const anthRefusalError = createChatTransport("anthropic-native", {
      fetch: vi.fn(async () => new Response(JSON.stringify({
        type: "message",
        stop_reason: "refusal",
        stop_details: { explanation: "blocked" },
        content: [{ type: "text", text: "secret" }],
        error: { type: "api_error", message: "boom" },
      }), { headers: { "Content-Type": "application/json" } })),
    });
    const anthErrEvents = await collectEvents(anthRefusalError.stream({
      baseUrl: "https://api.deepseek.com/anthropic",
      apiKey: "sk-secret",
      model: "deepseek-flash",
      messages: [{ role: "user", content: "hi" }],
      config: { ...deepseekConfig(), stream: false },
    }));
    expect(anthErrEvents.find((e) => e.type === "failed")).toMatchObject({
      type: "failed",
      clearRefusedContent: true,
      refusal: { reason: "refusal", explanation: "blocked" },
    });
  });

  it("validates nested continuation providerReplay & assistant role strictly, and downgrades paused assistant on save-only user edit", async () => {
    // P2-2: reject invalid providerReplay in continuation.messages and missing role on openai-responses replay
    expect(() => readMessageProviderReplay({
      id: "a1",
      role: "assistant",
      content: "hi",
      status: "paused",
      continuation: {
        config: defaultSessionConfig(),
        model: "claude",
        baseUrl: "https://api.anthropic.com",
        scope: "s",
        messages: [{
          role: "user",
          content: "bad",
          providerReplay: { protocol: "openai-responses", scope: "s", content: [{ type: "web_search_call", status: "completed", kind: "read_link", signature: "sig" }] },
        }],
      },
    })).toThrow();
    expect(() => readMessageProviderReplay({
      id: "no-role",
      content: "hi",
      providerReplay: { protocol: "openai-responses", scope: "s", content: [{ type: "web_search_call", status: "completed", kind: "read_link", signature: "sig" }] },
    })).toThrow();

    // P2-3b: save-only user edit clears continuation & downgrades paused assistant to incomplete
    const pausedTranscript: StoredChatMessage[] = [
      { id: "u-p", role: "user", content: "original prompt", status: "complete" },
      {
        id: "a-p",
        role: "assistant",
        replyToId: "u-p",
        content: "partial paused",
        status: "paused",
        providerReplay: { protocol: "anthropic-native", scope: "s", content: [{ type: "text", text: "partial paused" }] },
        continuation: {
          config: defaultSessionConfig(),
          model: "claude",
          baseUrl: "https://api.anthropic.com",
          scope: "s",
          messages: [{ role: "user", content: "original prompt" }],
        },
      },
    ];
    let saved = structuredClone(pausedTranscript);
    const store: AttachmentStore = {
      save: vi.fn(), read: vi.fn(), verify: vi.fn(), discardUncommitted: vi.fn(async () => {}), cleanup: vi.fn(async () => {}),
    };
    const edits = new MessageEdits({
      canBegin: () => true,
      read: async () => structuredClone(saved),
      replace: async (_id, _before, after) => { saved = structuredClone(after); },
      detach: () => {},
      reload: async () => {},
      outcome: () => {},
    }, new AttachmentLifecycle(store, async () => []), store);
    const editRes = await edits.submit("conv", "u-p", "edited prompt", undefined);
    expect(editRes.status).toBe("saved");
    expect(saved[1].status).toBe("incomplete");
    expect(saved[1].providerReplay).toBeUndefined();
    expect(saved[1].continuation).toBeUndefined();

    const repo = createChatRepository(`edit-paused-${crypto.randomUUID()}`);
    await repo.initializeWorkspace(null, []);
    await repo.save({ id: "current", updatedAt: 1, messages: pausedTranscript });
    await repo.execute({ type: "edit-message", conversationId: "current", messageId: "u-p", content: "repo edited prompt" });
    const loaded = await repo.load("current");
    expect(loaded?.messages[1].status).toBe("incomplete");
    expect(loaded?.messages[1].providerReplay).toBeUndefined();
    expect(loaded?.messages[1].continuation).toBeUndefined();
  });
});
