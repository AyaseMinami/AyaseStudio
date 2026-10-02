import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "../chat/types";
import { createTavilySearchClient, validateTavilyApiSettings } from "./tavily";
import { createZhipuSearchClient, validateZhipuApiSettings, validateZhipuSearchQuery } from "./zhipu";
import { defaultSearchConfiguration } from "./settings";
import { ExaResultError } from "./results";

const secret = "synthetic-api-key";
const entry = { title: "来源", url: "https://example.test/article", text: "中文😀资料" };
const profiles = () => {
  const config = defaultSearchConfiguration();
  return { tavily: { ...config.tavily, apiKey: secret }, zhipu: { ...config.zhipu, apiKey: secret } };
};
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const providers = [
  {
    name: "Tavily", endpoint: "https://api.tavily.com/search",
    settings: () => profiles().tavily,
    encode: (results: unknown[]) => ({ results }),
    entry: { title: entry.title, url: entry.url, content: entry.text },
    body: { query: "当轮问题", search_depth: "basic", auto_parameters: false, include_answer: false, include_raw_content: false, max_results: 3 },
  },
  {
    name: "智谱", endpoint: "https://open.bigmodel.cn/api/paas/v4/web_search",
    settings: () => profiles().zhipu,
    encode: (results: unknown[]) => ({ search_result: results }),
    entry: { title: entry.title, link: entry.url, content: entry.text },
    body: { search_engine: "search_std", search_query: "当轮问题", search_intent: false, count: 3, content_size: "medium" },
  },
] as const;

// Each provider retains its specific settings type while sharing lifecycle assertions.
for (const provider of providers) {
  const search = (fetch: FetchLike, options = {}, overrides = {}, query = "query", signal?: AbortSignal) => {
    const settings = { ...provider.settings(), ...overrides };
    return provider.name === "Tavily"
      ? createTavilySearchClient(fetch, options).search({ ...profiles().tavily, ...settings }, query, signal)
      : createZhipuSearchClient(fetch, options).search({ ...profiles().zhipu, ...settings }, query, signal);
  };
  const json = (payload: unknown = provider.encode([provider.entry]), headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(payload), { headers: { "content-type": "application/json; charset=utf-8", ...headers } });

  describe(`${provider.name} fixed REST adapter`, () => {
    it("sends one authenticated request even for a disabled settings-test draft", async () => {
      const fetch = vi.fn<FetchLike>(async () => json());
      const result = await search(fetch, {}, { numResults: 3, enabled: false }, "  当轮问题  ");
      expect(fetch).toHaveBeenCalledOnce();
      const [url, init] = fetch.mock.calls[0];
      expect(String(url)).toBe(provider.endpoint);
      expect(String(url)).not.toContain(secret);
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${secret}`);
      expect(new Headers(init?.headers).get("Accept")).toBe("application/json");
      expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
      expect(init).toMatchObject({ method: "POST", redirect: "error", credentials: "omit" });
      expect(JSON.parse(String(init?.body))).toEqual(provider.body);
      expect(result.sources[0]).toMatchObject({ title: entry.title, url: entry.url, excerpt: entry.text });
    });

    it.each(["", "  "])("requires a nonblank execution key %s", async apiKey => {
      const fetch = vi.fn<FetchLike>();
      await expect(search(fetch, {}, { apiKey })).rejects.toThrow("API Key");
      expect(fetch).not.toHaveBeenCalled();
    });

    it.each(["?parameter=1", "?", "#fragment", "#"])("rejects endpoint suffix %s before networking", async suffix => {
      const fetch = vi.fn<FetchLike>();
      const baseUrl = `${provider.settings().baseUrl}${suffix}`;
      await expect(search(fetch, {}, { baseUrl })).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
    });

    it.each(["http://example.test", `https://user:${secret}@example.test`, `https://example.test?key=${secret}`])("rejects unsafe addresses", async baseUrl => {
      const fetch = vi.fn<FetchLike>();
      const caught = await search(fetch, {}, { baseUrl }).catch((error: Error) => error);
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).not.toContain(secret);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("rejects blank and oversized queries and pre-aborted calls", async () => {
      const fetch = vi.fn<FetchLike>();
      const controller = new AbortController(); controller.abort(secret);
      await expect(search(fetch, {}, {}, "query", controller.signal)).rejects.toMatchObject({ name: "AbortError", message: "搜索已停止。" });
      await expect(search(fetch, {}, {}, " ")).rejects.toThrow("请输入");
      await expect(search(fetch, {}, {}, "😀".repeat(2001))).rejects.toThrow("2000");
      expect(fetch).not.toHaveBeenCalled();
    });

    it.each([400, 401, 403, 429, 500, 503])("redacts HTTP %s and never retries", async status => {
      const cancel = vi.fn();
      const fetch = vi.fn<FetchLike>(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(secret)); }, cancel }), { status }));
      const caught = await search(fetch).catch((error: Error) => error);
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).not.toContain(secret);
      expect(fetch).toHaveBeenCalledOnce();
      expect(cancel).toHaveBeenCalledOnce();
    });

    it.each([301, 302, 307, 308])("rejects HTTP %s redirects", async status => {
      await expect(search(async () => new Response(secret, { status }))).rejects.toThrow("重定向");
    });

    it.each(["redirected", "url"])("rejects unexpected response %s", async field => {
      const response = json();
      Object.defineProperty(response, field, { value: field === "redirected" ? true : `https://other.test/${secret}` });
      const caught = await search(async () => response).catch((error: Error) => error);
      expect((caught as Error).message).toContain("重定向");
      expect((caught as Error).message).not.toContain(secret);
    });

    it("redacts raw network exceptions and never retries", async () => {
      const fetch = vi.fn<FetchLike>(async () => { throw new Error(`${secret} private query https://private.test`); });
      const caught = await search(fetch).catch((error: Error) => error);
      expect((caught as Error).message).toContain("无法连接");
      expect((caught as Error).message).not.toMatch(/synthetic|private/u);
      expect(fetch).toHaveBeenCalledOnce();
    });

    it.each([{}, [], null, { error: { code: secret }, ...provider.encode([provider.entry]) }, provider.encode([]),
      provider.encode([{ ...provider.entry, content: "" }]), provider.encode([{ ...provider.entry, title: "" }]),
    ])("rejects malformed, provider-declared or empty results", async payload => {
      const caught = await search(async () => json(payload)).catch((error: Error) => error);
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).not.toContain(secret);
    });

    it.each([
      () => new Response("{broken", { headers: { "content-type": "application/json" } }),
      () => new Response("{}", { headers: { "content-type": "text/event-stream" } }),
      () => new Response("{}", { headers: { "content-type": "application/json; charset=latin1" } }),
      () => new Response(new Uint8Array([0xc3, 0x28]), { headers: { "content-type": "application/json" } }),
      () => new Response(new ReadableStream({ start(controller) { controller.error(new Error(secret)); } }), { headers: { "content-type": "application/json" } }),
      () => new Response(new ReadableStream({ start(controller) { controller.error(new ExaResultError(secret)); } }), { headers: { "content-type": "application/json" } }),
    ])("rejects unreadable responses with fixed error copy", async response => {
      await expect(search(async () => response())).rejects.toThrow("格式无效");
    });

    it("decodes split UTF-8 chunks", async () => {
      const bytes = new TextEncoder().encode(JSON.stringify(provider.encode([provider.entry])));
      const response = new Response(new ReadableStream<Uint8Array>({ start(controller) {
        for (let index = 0; index < bytes.length; index++) controller.enqueue(bytes.slice(index, index + 1));
        controller.close();
      } }), { headers: { "content-type": "application/json" } });
      expect((await search(async () => response)).sources[0].excerpt).toBe(entry.text);
    });

    it("filters malformed, duplicate and unsafe results and enforces shared source bounds", async () => {
      const urlField = provider.name === "Tavily" ? "url" : "link";
      const results = [provider.entry, null, [], { ...provider.entry, [urlField]: `${entry.url}#duplicate` },
        { ...provider.entry, [urlField]: "javascript:alert(1)" }, { ...provider.entry, [urlField]: "https://user:password@example.test" },
        ...Array.from({ length: 12 }, (_, index) => ({ ...provider.entry, [urlField]: `https://example.test/${index}`, title: "😀".repeat(350), content: "😀".repeat(2000), ignored: secret }))];
      const fetch: FetchLike = async () => json(provider.encode(results));
      const result = await search(fetch, {}, { numResults: 10 });
      expect(result.sources[0].excerpt).toBe(entry.text);
      expect(result.sources.every(source => Array.from(source.title).length <= 300 && Array.from(source.excerpt!).length <= 1500)).toBe(true);
      expect(result.sources.reduce((sum, source) => sum + Array.from(source.excerpt!).length, 0)).toBe(8000);
      expect(Object.keys(result.sources[0]).sort()).toEqual(["excerpt", "id", "title", "url"]);
      expect(result.warning).toBeTruthy();
      expect((await search(fetch, {}, { numResults: 1 })).sources).toHaveLength(1);
    });

    it("enforces declared and actual response limits", async () => {
      await expect(search(async () => json(undefined, { "content-length": "3000000" }))).rejects.toThrow("大小上限");
      await expect(search(async () => json(), { maxResponseBytes: 50 })).rejects.toThrow("大小上限");
    });

    it("cancels ignored fetch and its late response body", async () => {
      const pending = deferred<Response>();
      const fetch = vi.fn<FetchLike>(() => pending.promise);
      const controller = new AbortController();
      const promise = search(fetch, {}, {}, "query", controller.signal);
      controller.abort(secret);
      await expect(promise).rejects.toMatchObject({ name: "AbortError", message: "搜索已停止。" });
      const cancel = vi.fn();
      pending.resolve(new Response(new ReadableStream({ cancel }), { headers: { "content-type": "application/json" } }));
      await Promise.resolve();
      expect(cancel).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledOnce();
    });

    it("cancels open body readers promptly", async () => {
      const reading = deferred<void>();
      const cancel = vi.fn();
      const controller = new AbortController();
      const response = new Response(new ReadableStream({ pull() { reading.resolve(); }, cancel }), { headers: { "content-type": "application/json" } });
      const promise = search(async () => response, {}, {}, "query", controller.signal);
      await reading.promise;
      await Promise.resolve(); await Promise.resolve();
      controller.abort(secret);
      await expect(promise).rejects.toMatchObject({ name: "AbortError", message: "搜索已停止。" });
      expect(cancel).toHaveBeenCalledOnce();
    });

    it("ignores late body reads even if both read and cancel ignore abort", async () => {
      const reading = deferred<void>();
      const chunk = deferred<ReadableStreamReadResult<Uint8Array>>();
      const cancel = vi.fn(() => new Promise<void>(() => {}));
      const releaseLock = vi.fn();
      const response = json();
      Object.defineProperty(response, "body", { value: { getReader: () => ({
        read: () => { reading.resolve(); return chunk.promise; }, cancel, releaseLock,
      }), cancel } });
      const controller = new AbortController();
      const promise = search(async () => response, {}, {}, "query", controller.signal);
      await reading.promise;
      controller.abort(secret);
      await expect(promise).rejects.toMatchObject({ name: "AbortError", message: "搜索已停止。" });
      expect(releaseLock).toHaveBeenCalledOnce();
      chunk.resolve({ value: new TextEncoder().encode(JSON.stringify(provider.encode([provider.entry]))), done: false });
      await Promise.resolve();
      expect(releaseLock).toHaveBeenCalledOnce();
    });

    it("times out ignored fetch and cancels the late response", async () => {
      const pending = deferred<Response>();
      const fetch = vi.fn<FetchLike>(() => pending.promise);
      await expect(search(fetch, { timeoutMs: 10 })).rejects.toThrow("时限");
      const cancel = vi.fn();
      pending.resolve(new Response(new ReadableStream({ cancel }), { headers: { "content-type": "application/json" } }));
      await Promise.resolve();
      expect(cancel).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledOnce();
    });

    it("times out and cancels stalled response reading", async () => {
      const cancel = vi.fn();
      const response = new Response(new ReadableStream({ cancel }), { headers: { "content-type": "application/json" } });
      await expect(search(async () => response, { timeoutMs: 10 })).rejects.toThrow("时限");
      expect(cancel).toHaveBeenCalledOnce();
    });
  });
}

describe("provider-specific contracts", () => {
  it("execution validators preserve provider fields", () => {
    expect(validateTavilyApiSettings(profiles().tavily)).toEqual({ ...profiles().tavily, baseUrl: "https://api.tavily.com/" });
    expect(validateZhipuApiSettings(profiles().zhipu)).toEqual({ ...profiles().zhipu, baseUrl: "https://open.bigmodel.cn/" });
  });
  it.each([
    ["https://api.tavily.com/", "https://api.tavily.com/search"],
    ["https://relay.test/v1///", "https://relay.test/v1/search"],
    ["https://relay.test/v1/search/", "https://relay.test/v1/search"],
  ])("resolves Tavily %s", async (baseUrl, endpoint) => {
    const fetch = vi.fn<FetchLike>(async () => new Response(JSON.stringify({ results: [providers[0].entry] }), { headers: { "content-type": "application/json" } }));
    await createTavilySearchClient(fetch).search({ ...profiles().tavily, baseUrl, searchDepth: "advanced" }, "query");
    expect(String(fetch.mock.calls[0][0])).toBe(endpoint);
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).search_depth).toBe("advanced");
  });

  it.each([
    ["https://open.bigmodel.cn/", "https://open.bigmodel.cn/api/paas/v4/web_search"],
    ["https://relay.test/v1///", "https://relay.test/v1/api/paas/v4/web_search"],
    ["https://relay.test/api/paas/v4/", "https://relay.test/api/paas/v4/web_search"],
    ["https://relay.test/api/paas/v4/web_search/", "https://relay.test/api/paas/v4/web_search"],
  ])("resolves Zhipu %s", async (baseUrl, endpoint) => {
    const fetch = vi.fn<FetchLike>(async () => new Response(JSON.stringify({ search_result: [providers[1].entry] }), { headers: { "content-type": "application/json" } }));
    await createZhipuSearchClient(fetch).search({ ...profiles().zhipu, baseUrl }, "query");
    expect(String(fetch.mock.calls[0][0])).toBe(endpoint);
  });

  it("rejects Tavily detail.error even with apparently valid results", async () => {
    const fetch: FetchLike = async () => new Response(JSON.stringify({ results: [providers[0].entry], detail: { error: secret } }), { headers: { "content-type": "application/json" } });
    await expect(createTavilySearchClient(fetch).search(profiles().tavily, "query")).rejects.toThrow("返回搜索错误");
  });

  it("enforces Zhipu query codepoints before networking without truncation", async () => {
    expect(validateZhipuSearchQuery(`  ${"😀".repeat(70)}  `)).toBe("😀".repeat(70));
    const fetch = vi.fn<FetchLike>();
    await expect(createZhipuSearchClient(fetch).search(profiles().zhipu, "😀".repeat(71))).rejects.toThrow("70");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["search_std", "search_pro", "search_pro_quark", "search_pro_sogou"] as const)("sends explicit Zhipu engine %s and applies local result count", async searchEngine => {
    const results = Array.from({ length: 10 }, (_, index) => ({ ...providers[1].entry, link: `https://example.test/${index}` }));
    const fetch = vi.fn<FetchLike>(async () => new Response(JSON.stringify({ search_result: results }), { headers: { "content-type": "application/json" } }));
    const result = await createZhipuSearchClient(fetch).search({ ...profiles().zhipu, searchEngine, numResults: 3 }, "query");
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ search_engine: searchEngine, search_query: "query", search_intent: false,
      count: searchEngine === "search_pro_sogou" ? 10 : 3, content_size: "medium" });
    expect(result.sources).toHaveLength(3);
  });
});
