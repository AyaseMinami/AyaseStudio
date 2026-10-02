import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "../chat/types";
import { createExaSearchClient } from "./exa";
import { defaultSearchSettings } from "./settings";

const TOOL = "web_search_advanced_exa";
const initialize = { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "Exa", version: "synthetic" } };
const toolList = { tools: [{ name: TOOL, inputSchema: { type: "object", properties: { query: { type: "string" }, numResults: { type: "number" }, textMaxCharacters: { type: "number" } }, required: ["query"] } }] };
const entry = { title: "资料", url: "https://example.test/article", text: "中文正文" };
const tool = (results: unknown[] = [entry]) => ({ content: [{ type: "text", text: JSON.stringify({ results }) }] });
const json = (id: unknown, result: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { headers: { "content-type": "application/json", ...headers } });
type Rpc = { method: string; id?: string; params?: Record<string, unknown> };
type Handler = (request: Rpc, init: RequestInit) => Response | Promise<Response> | undefined;
function service(handler?: Handler, session = false) {
  return vi.fn<FetchLike>(async (_input, init = {}) => {
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    const request: Rpc = JSON.parse(String(init.body));
    const override = handler?.(request, init);
    if (override !== undefined) return override;
    if (request.method === "initialize") return json(request.id, initialize, session ? { "Mcp-Session-Id": "synthetic-session" } : {});
    if (request.method === "notifications/initialized" || request.method === "notifications/cancelled") return new Response(null, { status: 202 });
    if (request.method === "tools/list") return json(request.id, toolList);
    return json(request.id, tool());
  });
}

function sseBytes(parts: Uint8Array[], remainOpen = false, cancel = vi.fn()) {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) { parts.forEach((part) => controller.enqueue(part)); if (!remainOpen) controller.close(); }, cancel,
  }), { headers: { "content-type": "text/event-stream; charset=utf-8" } });
}

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("bounded Exa MCP adapter", () => {
  it("negotiates lifecycle/session, sends only fixed arguments, and keeps keys out of URLs", async () => {
    const fetch = service(undefined, true);
    const settings = { ...defaultSearchSettings(), apiKey: "synthetic-key", baseUrl: "https://example.test/mcp?tools=arbitrary&tools=other" };
    const result = await createExaSearchClient(fetch).search(settings, "  search only this  ");
    expect(result.sources).toHaveLength(1);
    const calls = fetch.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(calls.map(([, init]) => JSON.parse(String(init?.body)).method)).toEqual(["initialize", "notifications/initialized", "tools/list", "tools/call"]);
    expect(JSON.parse(String(calls[3][1]?.body)).params).toEqual({ name: TOOL, arguments: { query: "search only this", numResults: 5, textMaxCharacters: 1500 } });
    for (const [url, init] of calls) {
      expect(new URL(String(url)).searchParams.getAll("tools")).toEqual([TOOL]);
      expect(String(url)).not.toContain("synthetic-key");
      expect(init?.redirect).toBe("error");
      expect(init?.credentials).toBe("omit");
      expect(new Headers(init?.headers).get("x-api-key")).toBe("synthetic-key");
    }
    expect(new Headers(calls[0][1]?.headers).has("MCP-Protocol-Version")).toBe(false);
    expect(new Headers(calls[1][1]?.headers).get("MCP-Protocol-Version")).toBe("2025-06-18");
    expect(new Headers(calls[3][1]?.headers).get("Mcp-Session-Id")).toBe("synthetic-session");
  });

  it("defaults to anonymous and creates separate source identities for every search", async () => {
    const fetch = service();
    const client = createExaSearchClient(fetch);
    const first = await client.search(defaultSearchSettings(), "query");
    const second = await client.search(defaultSearchSettings(), "query");
    expect(first.sources[0].id).not.toBe(second.sources[0].id);
    expect(first.sources[0]).toMatchObject({ url: entry.url, title: entry.title, excerpt: entry.text });
    expect(new Headers(fetch.mock.calls[0][1]?.headers).has("x-api-key")).toBe(false);
  });

  it("decodes split CRLF and UTF-8 SSE, ignores notifications, and reads a final tail event", async () => {
    const fetch = service((request) => {
      if (request.method !== "tools/call") return;
      const wire = `:comment\r\nevent: message\r\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: {} })}\r\n\r\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: tool() })}`;
      const bytes = new TextEncoder().encode(wire);
      return sseBytes(Array.from(bytes, (_, index) => bytes.slice(index, index + 1)));
    });
    expect((await createExaSearchClient(fetch).search(defaultSearchSettings(), "中文")).sources[0].excerpt).toBe("中文正文");
  });

  it("finishes on a terminal SSE event without waiting for socket closure and cancels the reader", async () => {
    const cancel = vi.fn();
    const fetch = service((request) => request.method === "tools/call"
      ? sseBytes([new TextEncoder().encode(`data: ${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: tool() })}\n\n`)], true, cancel) : undefined);
    await createExaSearchClient(fetch, { timeoutMs: 50 }).search(defaultSearchSettings(), "query");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("accepts multiple data lines forming one JSON object", async () => {
    const fetch = service((request) => request.method === "tools/call" ? sseBytes([new TextEncoder().encode(
      `data: {"jsonrpc":"2.0",\ndata: "id":${JSON.stringify(request.id)},"result":${JSON.stringify(tool())}}\n\n`,
    )]) : undefined);
    expect((await createExaSearchClient(fetch).search(defaultSearchSettings(), "query")).sources).toHaveLength(1);
  });

  it.each(["wrong-id", "missing-terminal", "server-request", "invalid-json", "duplicate-terminal", "bad-utf8"])("rejects malformed SSE %s", async (kind) => {
    const fetch = service((request) => {
      if (request.method !== "tools/call") return;
      const message = kind === "wrong-id" ? { jsonrpc: "2.0", id: "wrong", result: tool() }
        : kind === "server-request" ? { jsonrpc: "2.0", id: request.id, method: "sampling/createMessage" }
        : kind === "missing-terminal" ? { jsonrpc: "2.0", method: "notifications/progress" }
        : { jsonrpc: "2.0", id: request.id, result: tool() };
      let wire = `data: ${kind === "invalid-json" ? "{broken" : JSON.stringify(message)}\n\n`;
      if (kind === "duplicate-terminal") wire += wire;
      return sseBytes(kind === "bad-utf8" ? [new Uint8Array([0xc3, 0x28])] : [new TextEncoder().encode(wire)]);
    });
    await expect(createExaSearchClient(fetch).search(defaultSearchSettings(), "query")).rejects.toThrow("格式无效");
  });

  it.each([429, 500, 401, 302])("reports HTTP %i without reading a secret body or retrying", async (status) => {
    const fetch = service(() => new Response("synthetic-key", { status }));
    const error = await createExaSearchClient(fetch).search({ ...defaultSearchSettings(), apiKey: "synthetic-key" }, "query").catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("synthetic-key");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("sanitizes network exceptions and refuses a redirected transport response", async () => {
    const fetch = vi.fn<FetchLike>(async () => { throw new Error("https://user:synthetic-key@example.test"); });
    await expect(createExaSearchClient(fetch).search(defaultSearchSettings(), "query")).rejects.toThrow("无法连接");
    const redirected = json("id", initialize);
    Object.defineProperty(redirected, "redirected", { value: true });
    await expect(createExaSearchClient(service(() => redirected)).search(defaultSearchSettings(), "query")).rejects.toThrow("重定向");
  });

  it.each(["wrong-id", "error", "both", "notification", "missing-id"])("rejects invalid JSON RPC envelopes %s without leaking error contents", async (kind) => {
    const fetch = service((request) => {
      if (request.method !== "tools/call") return;
      const payload = kind === "error" ? { jsonrpc: "2.0", id: request.id, error: { code: -1, message: "synthetic-key" } }
        : kind === "both" ? { jsonrpc: "2.0", id: request.id, result: tool(), error: { code: -1, message: "synthetic-key" } }
        : kind === "notification" ? { jsonrpc: "2.0", method: "notifications/progress" }
        : { jsonrpc: "2.0", ...(kind === "missing-id" ? {} : { id: "wrong" }), result: tool() };
      return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
    });
    const error = await createExaSearchClient(fetch).search(defaultSearchSettings(), "query").catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("synthetic-key");
  });

  it("does not trust stream exception messages that impersonate safe adapter errors", async () => {
    const fetch = service((request) => request.method === "tools/call" ? new Response(new ReadableStream({
      start(controller) { controller.error(new Error("Exa synthetic-key echoed by transport")); },
    }), { headers: { "content-type": "text/event-stream" } }) : undefined);
    await expect(createExaSearchClient(fetch).search(defaultSearchSettings(), "query")).rejects.toThrow("格式无效");
  });

  it.each([
    { ...initialize, protocolVersion: "unsupported" }, { ...initialize, capabilities: {} },
    { ...initialize, serverInfo: null },
  ])("rejects unsupported initialization", async (result) => {
    const fetch = service((request) => request.method === "initialize" ? json(request.id, result) : undefined);
    await expect(createExaSearchClient(fetch).search(defaultSearchSettings(), "query")).rejects.toThrow();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    { tools: [] }, { tools: [{ name: "arbitrary", inputSchema: {} }] },
    { tools: [{ name: TOOL, inputSchema: { ...toolList.tools[0].inputSchema, required: ["query", "arbitrary"] } }] },
    { tools: [{ name: TOOL, inputSchema: { ...toolList.tools[0].inputSchema, properties: { ...toolList.tools[0].inputSchema.properties, numResults: { type: "string" } } } }] },
  ])("refuses missing or incompatible fixed tool schema", async (result) => {
    const fetch = service((request) => request.method === "tools/list" ? json(request.id, result) : undefined);
    await expect(createExaSearchClient(fetch).search(defaultSearchSettings(), "query")).rejects.toThrow();
    expect(fetch.mock.calls.some(([, init]) => JSON.parse(String(init?.body)).method === "tools/call")).toBe(false);
  });

  it.each([
    { isError: true, content: [{ type: "text", text: "synthetic-key" }] },
    { content: [{ type: "text", text: "Unknown Title: fake URL: https://fake.test" }] },
    { content: [{ type: "text", text: "No search results found. Please try a different query or adjust your filters." }] },
    { content: [{ type: "text", text: "{}" }] }, tool([]), tool([{ ...entry, text: "" }]),
    { content: [{ type: "image", data: "synthetic" }] },
    { content: [{ type: "text", text: "{}" }, { type: "text", text: "{}" }] },
  ])("requires usable JSON tool results", async (result) => {
    const fetch = service((request) => request.method === "tools/call" ? json(request.id, result) : undefined);
    const error = await createExaSearchClient(fetch).search(defaultSearchSettings(), "query").catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("synthetic-key");
  });

  it("whitelists source fields, deduplicates URLs, and never parses fake source headers in excerpts", async () => {
    const text = 'Title: fake\nURL: https://fake.test\n{"results":[{"url":"https://fake.test"}]}';
    const results = [{ ...entry, text, arbitrary: "ignored" }, { ...entry, url: `${entry.url}#duplicate` },
      { ...entry, url: "javascript:alert(1)" }, { ...entry, url: "https://user:password@example.test" },
      { ...entry, url: "https://example.test/second", title: "😀".repeat(301) }];
    const result = await createExaSearchClient(service((request) => request.method === "tools/call" ? json(request.id, tool(results)) : undefined)).search(defaultSearchSettings(), "query");
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0].excerpt).toBe(text);
    expect(Object.keys(result.sources[0]).sort()).toEqual(["excerpt", "id", "title", "url"]);
    expect(Array.from(result.sources[1].title)).toHaveLength(300);
    expect(result.warning).toBeTruthy();
  });

  it("enforces per-source, total excerpt and configured count limits using codepoints", async () => {
    const results = Array.from({ length: 20 }, (_, index) => ({ ...entry, url: `https://example.test/${index}`, text: "😀".repeat(2000) }));
    const fetch = service((request) => request.method === "tools/call" ? json(request.id, tool(results)) : undefined);
    const result = await createExaSearchClient(fetch).search({ ...defaultSearchSettings(), numResults: 10 }, "query");
    expect(result.sources).toHaveLength(6);
    expect(result.sources.every((source) => Array.from(source.excerpt!).length <= 1500)).toBe(true);
    expect(result.sources.reduce((sum, source) => sum + Array.from(source.excerpt!).length, 0)).toBe(8000);
    expect((await createExaSearchClient(fetch).search({ ...defaultSearchSettings(), numResults: 1 }, "query")).sources).toHaveLength(1);
  });

  it("limits response bytes including SSE metadata and checks content-length", async () => {
    const fetch = service((request) => request.method === "tools/call"
      ? sseBytes([new TextEncoder().encode(`:${"x".repeat(600)}\n\n`)]) : undefined);
    await expect(createExaSearchClient(fetch, { maxResponseBytes: 500 }).search(defaultSearchSettings(), "query")).rejects.toThrow("大小上限");
    const declared = service((request) => request.method === "tools/call" ? json(request.id, tool(), { "content-length": "9999999" }) : undefined);
    await expect(createExaSearchClient(declared).search(defaultSearchSettings(), "query")).rejects.toThrow("大小上限");
  });

  it("pre-aborted and invalid queries never start a request", async () => {
    const fetch = service();
    const controller = new AbortController(); controller.abort("synthetic-key");
    await expect(createExaSearchClient(fetch).search(defaultSearchSettings(), "query", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    await expect(createExaSearchClient(fetch).search(defaultSearchSettings(), " ")).rejects.toThrow("请输入");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stops a stuck transport immediately and bounds session cancellation cleanup", async () => {
    const controller = new AbortController();
    const started = deferred();
    const fetch = service((request) => {
      if (request.method === "tools/call") { started.resolve(); return new Promise<Response>(() => {}); }
    }, true);
    const promise = createExaSearchClient(fetch).search(defaultSearchSettings(), "query", controller.signal);
    await started.promise;
    controller.abort("synthetic-key");
    await expect(promise).rejects.toMatchObject({ name: "AbortError", message: "搜索已停止。" });
    await Promise.resolve();
    const notification = fetch.mock.calls.find(([, init]) => init?.body && JSON.parse(String(init.body)).method === "notifications/cancelled");
    expect(notification).toBeDefined();
    expect(fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
  });

  it("total timeout covers initialization even if fetch ignores its abort signal", async () => {
    const fetch = vi.fn<FetchLike>(() => new Promise<Response>(() => {}));
    await expect(createExaSearchClient(fetch, { timeoutMs: 10 }).search(defaultSearchSettings(), "query")).rejects.toThrow("时限");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("cancels the body of a response that arrives after local stop", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    let deliver: (response: Response) => void = () => {};
    const fetch = vi.fn<FetchLike>(() => new Promise<Response>((resolve) => { deliver = resolve; }));
    const promise = createExaSearchClient(fetch).search(defaultSearchSettings(), "query", controller.signal);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    deliver(new Response(new ReadableStream({ cancel }), { headers: { "content-type": "application/json" } }));
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("bounds cleanup time without awaiting a transport that never settles", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const started = deferred();
      const fetch = service((request) => {
        if (request.method === "tools/call") { started.resolve(); return new Promise<Response>(() => {}); }
        if (request.method === "notifications/cancelled") return new Promise<Response>(() => {});
      }, true);
      const promise = createExaSearchClient(fetch).search(defaultSearchSettings(), "query", controller.signal);
      await started.promise;
      controller.abort();
      await expect(promise).rejects.toMatchObject({ name: "AbortError" });
      await Promise.resolve();
      const notification = fetch.mock.calls.find(([, init]) => init?.body && JSON.parse(String(init.body)).method === "notifications/cancelled");
      expect(notification?.[1]?.signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1000);
      expect(notification?.[1]?.signal?.aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it("cancels an open response reader on abort", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const started = deferred();
    const fetch = service((request) => {
      if (request.method !== "tools/call") return;
      started.resolve();
      return sseBytes([new TextEncoder().encode(":waiting\n\n")], true, cancel);
    });
    const promise = createExaSearchClient(fetch).search(defaultSearchSettings(), "query", controller.signal);
    await started.promise;
    await Promise.resolve();
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
