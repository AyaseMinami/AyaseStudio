import { describe, expect, it } from "vitest";
import { SearchDecoder } from "./searchDecoding";
import { createChatTransport } from "./transport";
import { defaultSessionConfig } from "./sessionConfig";
import { buildProtocolBody } from "./requestMapping";

describe("native search decoding", () => {
  it("maps all four native toggles without a model whitelist", () => {
    const fields = {
      "openai-chat": { web_search_options: {} },
      "openai-responses": { tools: [{ type: "web_search" }], include: ["web_search_call.action.sources"], store: false },
      "gemini-native": { tools: [{ googleSearch: {} }] },
      "anthropic-native": { tools: [{ type: "web_search_20250305", name: "web_search" }] },
    };
    for (const protocol of Object.keys(fields) as Array<keyof typeof fields>) {
      const request = { baseUrl: "https://example.test", apiKey: "synthetic", model: "unknown-model", messages: [{ role: "user" as const, content: "hi" }], config: { ...defaultSessionConfig(), webSearch: true } };
      expect(buildProtocolBody(protocol, request)).toMatchObject(fields[protocol]);
      const off = buildProtocolBody(protocol, { ...request, config: { ...request.config, webSearch: false } });
      expect(off.tools).toBeUndefined(); expect(off.web_search_options).toBeUndefined();
    }
  });

  it("shows non-stream Chat annotations even when a search-only model returns them with the toggle off", async () => {
    const transport = createChatTransport("openai-chat", { fetch: async () => new Response(JSON.stringify({
      id: "test", object: "chat.completion", choices: [{ index: 0, finish_reason: "stop", message: {
        role: "assistant", content: "answer", annotations: [{ type: "url_citation", url_citation: { url: "https://example.test", title: "Example", start_index: 0, end_index: 6 } }],
      } }],
    }), { headers: { "Content-Type": "application/json" } }) });
    const events = [] as import("./types").ChatEvent[];
    for await (const event of transport.stream({ baseUrl: "https://example.test", apiKey: "synthetic", model: "search", messages: [{ role: "user", content: "hi" }], config: { ...defaultSessionConfig(), stream: false } })) events.push(event);
    expect(events.find((event) => event.type === "search-update")).toMatchObject({ search: { enabled: false, status: "completed", citations: [{ start: 0, end: 6 }] } });
  });

  it("maps Responses URL annotations and deduplicates final snapshots", () => {
    const decoder = new SearchDecoder(true);
    decoder.openAI({ annotations: [{ type: "url_citation", url: "https://example.test/a", title: "A", start_index: 1, end_index: 3 }] });
    expect(decoder.snapshot()).toMatchObject({ status: "completed", sources: [{ id: "https://example.test/a" }], citations: [{ start: 1, end: 3, sourceIds: ["https://example.test/a"] }] });
    expect(decoder.snapshot()).toBeUndefined();
    decoder.complete();
    expect(decoder.search).toMatchObject({ status: "completed" });
  });

  it("converts Gemini grounding byte offsets to UTF-16 and excludes thought text from the caller text", () => {
    const decoder = new SearchDecoder(true);
    decoder.gemini({
      groundingChunks: [{ web: { uri: "https://example.test/g", title: "G" } }],
      groundingSupports: [{ segment: { startIndex: 1, endIndex: 4 }, groundingChunkIndices: [0] }],
      webSearchQueries: ["cats"], searchEntryPoint: { renderedContent: "<b>cats</b>" },
    }, [{ text: "A猫B", offset: 0 }]);
    expect(decoder.snapshot()).toMatchObject({
      sources: [{ id: "https://example.test/g" }], queries: ["cats"], suggestionHtml: "<b>cats</b>",
      citations: [{ start: 1, end: 2, sourceIds: ["https://example.test/g"] }],
    });
  });

  it("keeps Anthropic citation offsets anchored to its text block and marks tool result errors", () => {
    const decoder = new SearchDecoder(true);
    decoder.anthropic({ type: "text", citations: [{ url: "https://example.test/c", start_char_offset: 2, end_char_offset: 4 }] }, 10);
    decoder.anthropic({ type: "web_search_tool_result_error", error_code: "unavailable" }, 14);
    expect(decoder.snapshot()).toMatchObject({ status: "failed", error: "unavailable", citations: [{ start: 12, end: 14, sourceIds: ["https://example.test/c"] }] });
  });

  it("maps Anthropic web_search_result_location to its owning text block and retains a failed status", () => {
    const decoder = new SearchDecoder(true);
    decoder.anthropic({ type: "web_search_tool_result_error", error: { error_code: "too_many_requests" } }, 0);
    decoder.anthropic({ type: "text", citations: [{ type: "web_search_result_location", url: "https://example.test/location", title: "Location" }] }, 4, 10);
    expect(decoder.snapshot()).toMatchObject({ status: "failed", error: "too_many_requests", citations: [{ start: 4, end: 10, sourceIds: ["https://example.test/location"] }] });
  });

  it("uses Gemini partIndex and the source indexes from the metadata snapshot", () => {
    const decoder = new SearchDecoder(true);
    decoder.gemini({
      groundingChunks: [{}, { web: { uri: "https://example.test/second", title: "Second" } }],
      groundingSupports: [{ segment: { partIndex: 1, endIndex: 3 }, groundingChunkIndices: [1] }],
    }, [{ text: "first", offset: 0 }, { text: "猫", offset: 5 }]);
    expect(decoder.snapshot()).toMatchObject({ citations: [{ start: 5, end: 6, sourceIds: ["https://example.test/second"] }] });
  });

  it("anchors late Gemini stream grounding after thought chunks without treating chunk indexes as Part IDs", async () => {
    const sse = [
      { candidates: [{ content: { parts: [{ text: "thinking", thought: true }] } }] },
      { candidates: [{ content: { parts: [{ text: "猫咪" }] } }] },
      { candidates: [{ finishReason: "STOP", groundingMetadata: { groundingChunks: [{ web: { uri: "https://example.test/cat" } }], groundingSupports: [{ segment: { partIndex: 1, text: "猫咪", endIndex: 6 }, groundingChunkIndices: [0] }] } }] },
    ].map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("");
    let sentBody: Record<string, unknown> | undefined;
    let sentUrl = "";
    const transport = createChatTransport("gemini-native", { fetch: async (url, init) => {
      sentUrl = String(url);
      sentBody = JSON.parse(String(init?.body));
      return new Response(sse);
    } });
    const events = [] as import("./types").ChatEvent[];
    for await (const event of transport.stream({ baseUrl: "https://example.test", apiKey: "synthetic", model: "gemini-3.8-flash", messages: [{ role: "user", content: "hi" }], config: { ...defaultSessionConfig(), webSearch: true } })) events.push(event);
    expect(sentUrl).toBe("https://example.test/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse");
    expect(sentBody?.tools).toEqual([{ googleSearch: {} }]);
    expect(events.filter((event) => event.type === "text-delta").map((event) => event.text).join("")).toBe("猫咪");
    expect(events.find((event) => event.type === "search-update")).toMatchObject({ search: { citations: [{ start: 0, end: 2 }] } });
  });

  it("retains Responses citations from the terminal incomplete snapshot", async () => {
    const sse = [
      { type: "response.output_text.delta", output_index: 1, content_index: 0, delta: "answer" },
      { type: "response.incomplete", response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [
        { type: "web_search_call", status: "completed", action: { type: "search", query: "test" } },
        { type: "message", content: [{ type: "output_text", text: "answer", annotations: [{ type: "url_citation", url: "https://example.test", title: "Example", start_index: 0, end_index: 6 }] }] },
      ] } },
    ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
    const transport = createChatTransport("openai-responses", { fetch: async () => new Response(sse, { headers: { "Content-Type": "text/event-stream" } }) });
    const events = [] as import("./types").ChatEvent[];
    for await (const event of transport.stream({ baseUrl: "https://example.test", apiKey: "synthetic", model: "test", messages: [{ role: "user", content: "hi" }], config: { ...defaultSessionConfig(), webSearch: true } })) events.push(event);
    expect(events.find((event) => event.type === "search-update")).toMatchObject({ search: { status: "completed", citations: [{ start: 0, end: 6 }] } });
    expect(events[events.length - 1]).toMatchObject({ type: "completed", finishReason: "incomplete:max_output_tokens" });
  });

  it("preserves real Anthropic stream blocks while attaching citations_delta and pause_turn replay", async () => {
    const sse = [
      { type: "message_start", message: { usage: { input_tokens: 1 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "Hello" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " world" } },
      { type: "content_block_delta", index: 0, delta: { type: "citations_delta", citation: { type: "web_search_result_location", url: "https://example.test/live", title: "Live" } } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "!" } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "server_tool_use", id: "tool_1", name: "web_search", input: {} } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{\"query\":\"news\"}" } },
      { type: "content_block_stop", index: 1 },
      { type: "content_block_start", index: 2, content_block: { type: "thinking", thinking: "reason" } },
      { type: "content_block_delta", index: 2, delta: { type: "signature_delta", signature: "signed" } },
      { type: "content_block_stop", index: 2 },
      { type: "message_delta", delta: { stop_reason: "pause_turn" } }, { type: "message_stop" },
    ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
    const transport = createChatTransport("anthropic-native", { fetch: async () => new Response(sse) });
    const events = [] as import("./types").ChatEvent[];
    for await (const event of transport.stream({ baseUrl: "https://example.test", apiKey: "synthetic", model: "claude", messages: [{ role: "user", content: "hi" }], replayScope: "scope", config: { ...defaultSessionConfig(), webSearch: true, stream: true } })) events.push(event);
    const updates = events.filter((event) => event.type === "search-update");
    expect(updates[updates.length - 1]).toMatchObject({ search: { citations: [{ start: 0, end: 12 }], queries: ["news"] } });
    expect(updates[updates.length - 1].search.citations).toHaveLength(1);
    expect(events.find((event) => event.type === "provider-replay")).toMatchObject({ replay: { scope: "scope", content: [{ text: "Hello world!" }, { input: { query: "news" } }, { signature: "signed" }] } });
  });
});
