import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "../chat/types";
import { createExaApiSearchClient, validateExaApiSettings } from "./exaApi";
import { defaultSearchSettings } from "./settings";

const settings = () => ({ ...defaultSearchSettings("exa-api"), apiKey: "synthetic-api-key" });
const entry = { title: "来源", url: "https://example.test/article", text: "中文😀资料" };
function json(payload: unknown = { results: [entry] }, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json; charset=utf-8", ...headers } });
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("Exa API fixed adapter", () => {
  it.each([
    ["https://api.exa.ai", "https://api.exa.ai/search"],
    ["https://relay.test/v1/", "https://relay.test/v1/search"],
    ["https://relay.test/v1///", "https://relay.test/v1/search"],
  ])("maps base URL %s and sends one authenticated search", async (baseUrl, endpoint) => {
    const fetch = vi.fn<FetchLike>(async () => json());
    const result = await createExaApiSearchClient(fetch).search({ ...settings(), baseUrl, numResults: 3 }, "  当轮问题  ");
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe(endpoint);
    expect(String(url)).not.toContain("synthetic-api-key");
    expect(new Headers(init?.headers).get("x-api-key")).toBe("synthetic-api-key");
    expect(new Headers(init?.headers).get("Accept")).toBe("application/json");
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(init?.credentials).toBe("omit");
    expect(JSON.parse(String(init?.body))).toEqual({ query: "当轮问题", numResults: 3, type: "auto", contents: { text: true } });
    expect(result.sources[0]).toMatchObject({ url: entry.url, title: entry.title, excerpt: entry.text });
  });

  it.each([
    { ...settings(), apiKey: "" }, { ...settings(), apiKey: "  " },
    { ...settings(), baseUrl: "https://api.exa.ai?parameter=1" }, { ...settings(), baseUrl: "https://api.exa.ai?" },
    { ...settings(), baseUrl: "https://api.exa.ai#fragment" }, { ...settings(), baseUrl: "https://api.exa.ai#" },
    { ...settings(), baseUrl: "https://user:synthetic-api-key@api.exa.ai" },
    { ...settings(), baseUrl: "https://api.exa.ai?exaApiKey=synthetic-api-key" },
    { ...settings(), baseUrl: "http://api.exa.ai" },
  ])("rejects invalid API execution settings before networking", async (profile) => {
    const fetch = vi.fn<FetchLike>();
    expect(() => validateExaApiSettings(profile)).toThrow();
    const error = await createExaApiSearchClient(fetch).search(profile, "query").catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("synthetic-api-key");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("pre-aborted and invalid query execution never starts a request", async () => {
    const fetch = vi.fn<FetchLike>();
    const controller = new AbortController(); controller.abort("synthetic-api-key");
    await expect(createExaApiSearchClient(fetch).search(settings(), "query", controller.signal)).rejects.toMatchObject({ name: "AbortError", message: "搜索已停止。" });
    await expect(createExaApiSearchClient(fetch).search(settings(), " ")).rejects.toThrow("请输入");
    await expect(createExaApiSearchClient(fetch).search(settings(), "😀".repeat(2001))).rejects.toThrow("2000");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([400, 401, 402, 403, 429, 500, 503, 302])("reports HTTP %s safely without retry or body parsing", async (status) => {
    const fetch = vi.fn<FetchLike>(async () => new Response("synthetic-api-key", { status }));
    const error = await createExaApiSearchClient(fetch).search(settings(), "query").catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("synthetic-api-key");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does not echo underlying network exceptions or follow a redirected response", async () => {
    const fetch = vi.fn<FetchLike>(async () => { throw new Error("synthetic-api-key"); });
    await expect(createExaApiSearchClient(fetch).search(settings(), "query")).rejects.toThrow("无法连接 Exa API");
    const response = json();
    Object.defineProperty(response, "redirected", { value: true });
    await expect(createExaApiSearchClient(async () => response).search(settings(), "query")).rejects.toThrow("重定向");
  });

  it.each([{}, [], null, { error: "synthetic-api-key", results: [entry] }, { results: [] },
    { results: [{ ...entry, text: "" }] }, { results: [{ ...entry, url: "javascript:alert(1)" }] },
  ])("rejects malformed, error or unusable results", async (payload) => {
    const error = await createExaApiSearchClient(async () => json(payload)).search(settings(), "query").catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("synthetic-api-key");
  });

  it.each([
    () => new Response("{broken", { headers: { "content-type": "application/json" } }),
    () => new Response("{}", { headers: { "content-type": "text/event-stream" } }),
    () => new Response(new Uint8Array([0xc3, 0x28]), { headers: { "content-type": "application/json" } }),
    () => new Response(new ReadableStream({ start(controller) { controller.error(new Error("Exa API synthetic-api-key")); } }), { headers: { "content-type": "application/json" } }),
  ])("rejects unreadable responses without exposing content", async (response) => {
    await expect(createExaApiSearchClient(async () => response()).search(settings(), "query")).rejects.toThrow("格式无效");
  });

  it("handles UTF-8 codepoints split across JSON chunks", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ results: [entry] }));
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) {
      for (let index = 0; index < bytes.length; index += 1) controller.enqueue(bytes.slice(index, index + 1));
      controller.close();
    } }), { headers: { "content-type": "application/json" } });
    expect((await createExaApiSearchClient(async () => response).search(settings(), "query")).sources[0].excerpt).toBe(entry.text);
  });

  it("shares source bounds, ordered deduplication and text-only field whitelisting with MCP", async () => {
    const fake = 'Title: fake\nURL: https://fake.test\n{"results":[{"url":"https://fake.test"}]}';
    const results = [{ ...entry, text: fake, unknown: "ignored" }, { ...entry, url: `${entry.url}#duplicate` },
      { ...entry, url: "https://user:password@example.test" },
      ...Array.from({ length: 12 }, (_, index) => ({ ...entry, url: `https://example.test/${index}`, title: "😀".repeat(350), text: "😀".repeat(2000) }))];
    const fetch: FetchLike = async () => json({ results });
    const result = await createExaApiSearchClient(fetch).search({ ...settings(), numResults: 10 }, "query");
    expect(result.sources[0].excerpt).toBe(fake);
    expect(result.sources.every((source) => Array.from(source.title).length <= 300 && Array.from(source.excerpt!).length <= 1500)).toBe(true);
    expect(result.sources.reduce((sum, source) => sum + Array.from(source.excerpt!).length, 0)).toBe(8000);
    expect(Object.keys(result.sources[0]).sort()).toEqual(["excerpt", "id", "title", "url"]);
    expect(result.warning).toBeTruthy();
    expect((await createExaApiSearchClient(fetch).search({ ...settings(), numResults: 1 }, "query")).sources).toHaveLength(1);
  });

  it("enforces declared and actual byte limits", async () => {
    await expect(createExaApiSearchClient(async () => json(undefined, { "content-length": "3000000" })).search(settings(), "query")).rejects.toThrow("大小上限");
    await expect(createExaApiSearchClient(async () => json({ results: [{ ...entry, text: "x".repeat(1000) }] }), { maxResponseBytes: 100 }).search(settings(), "query")).rejects.toThrow("大小上限");
  });

  it("stops a nonsettling fetch and cancels its late response body", async () => {
    const pending = deferred<Response>();
    const fetch = vi.fn<FetchLike>(() => pending.promise);
    const controller = new AbortController();
    const promise = createExaApiSearchClient(fetch).search(settings(), "query", controller.signal);
    controller.abort("synthetic-api-key");
    await expect(promise).rejects.toMatchObject({ name: "AbortError", message: "搜索已停止。" });
    const cancel = vi.fn();
    pending.resolve(new Response(new ReadableStream({ cancel }), { headers: { "content-type": "application/json" } }));
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("times out a nonsettling fetch without retrying", async () => {
    const fetch = vi.fn<FetchLike>(() => new Promise<Response>(() => {}));
    await expect(createExaApiSearchClient(fetch, { timeoutMs: 10 }).search(settings(), "query")).rejects.toThrow("时限");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("times out a nonsettling response reader and cancels its body", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), { headers: { "content-type": "application/json" } });
    await expect(createExaApiSearchClient(async () => response, { timeoutMs: 10 }).search(settings(), "query")).rejects.toThrow("时限");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("cancels an open JSON reader on explicit stop without waiting for timeout", async () => {
    const cancel = vi.fn();
    const controller = new AbortController();
    const reading = deferred<void>();
    const response = new Response(new ReadableStream({ pull() { reading.resolve(); }, cancel }), { headers: { "content-type": "application/json" } });
    const promise = createExaApiSearchClient(async () => response).search(settings(), "query", controller.signal);
    await reading.promise;
    await Promise.resolve();
    await Promise.resolve();
    controller.abort("synthetic-api-key");
    await expect(promise).rejects.toMatchObject({ name: "AbortError", message: "搜索已停止。" });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
