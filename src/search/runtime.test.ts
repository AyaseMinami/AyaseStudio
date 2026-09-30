import { beforeEach, expect, it, vi } from "vitest";
import { defaultSearchSettings } from "./settings";
const native = vi.hoisted(() => ({ fetch: vi.fn(), imports: 0 }));
const nativeFetch = native.fetch;
vi.mock("@tauri-apps/plugin-http", () => { native.imports += 1; return { fetch: native.fetch }; });
import { searchExa } from "./runtime";
beforeEach(() => { nativeFetch.mockReset(); });

it("rejects unconfigured Exa API before loading or calling native networking", async () => {
  expect(native.imports).toBe(0);
  await expect(searchExa(defaultSearchSettings("exa-api"), "query", undefined, "exa-api")).rejects.toThrow("需要 API Key");
  expect(native.imports).toBe(0);
  expect(nativeFetch).not.toHaveBeenCalled();
});

it("routes the shared search client through native HTTP with all redirects disabled", async () => {
  nativeFetch.mockImplementation(async (_input, init) => {
    const request = JSON.parse(init.body);
    if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
    const result = request.method === "initialize"
      ? { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "Exa", version: "synthetic" } }
      : request.method === "tools/list"
        ? { tools: [{ name: "web_search_advanced_exa", inputSchema: { type: "object", properties: { query: { type: "string" }, numResults: { type: "number" }, textMaxCharacters: { type: "number" } }, required: ["query"] } }] }
        : { content: [{ type: "text", text: JSON.stringify({ results: [{ title: "Test", url: "https://example.test", text: "Synthetic excerpt" }] }) }] };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), { headers: { "content-type": "application/json" } });
  });
  expect((await searchExa(defaultSearchSettings(), "query")).sources).toHaveLength(1);
  expect(nativeFetch).toHaveBeenCalledTimes(4);
  expect(nativeFetch.mock.calls.every(([, init]) => init.maxRedirections === 0 && init.redirect === "error")).toBe(true);
});

it("dispatches Exa API explicitly with one REST call and the same native redirect guard", async () => {
  nativeFetch.mockResolvedValue(new Response(JSON.stringify({ results: [{ title: "API", url: "https://example.test", text: "Synthetic excerpt" }] }), { headers: { "content-type": "application/json" } }));
  expect((await searchExa({ ...defaultSearchSettings("exa-api"), apiKey: "synthetic-api-key" }, "query", undefined, "exa-api")).sources).toHaveLength(1);
  expect(nativeFetch).toHaveBeenCalledOnce();
  const [url, init] = nativeFetch.mock.calls[0];
  expect(String(url)).toBe("https://api.exa.ai/search");
  expect(init.maxRedirections).toBe(0);
  expect(init.redirect).toBe("error");
  expect(JSON.parse(init.body)).toEqual({ query: "query", numResults: 5, type: "auto", contents: { text: true } });
});

