import type { FetchLike } from "../chat/types";
import { validateSearchQuery, validateSearchSettings, type SearchSettings } from "./settings";
import { ExaResultError, normalizeExaResults, type ExaSearchResult } from "./results";

const TOOL = "web_search_advanced_exa";
const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const NO_RESULTS = "No search results found. Please try a different query or adjust your filters.";
type SearchResult = ExaSearchResult;
type ObjectValue = Record<string, unknown>;
class ExaSearchError extends ExaResultError {}

function object(value: unknown): value is ObjectValue {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function protocolError(): Error { return new ExaSearchError("Exa MCP 响应格式无效或协议不兼容。"); }
function cancelled(): DOMException { return new DOMException("搜索已停止。", "AbortError"); }

/** Race even transports/readers that do not settle promptly after abort. Never expose their errors. */
async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void operation.catch(() => {});
    throw cancelled();
  }
  let onAbort: () => void = () => {};
  const stop = new Promise<never>((_, reject) => {
    onAbort = () => reject(cancelled());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try { return await Promise.race([operation, stop]); }
  finally { signal.removeEventListener("abort", onAbort); }
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch { throw protocolError(); }
}

function rpcResult(message: unknown, id: string): { terminal: boolean; result?: unknown } {
  if (!object(message) || message.jsonrpc !== "2.0") throw protocolError();
  if (typeof message.method === "string") {
    // We advertise no client capabilities and never handle server-initiated requests.
    if ("id" in message || "result" in message || "error" in message) throw protocolError();
    return { terminal: false };
  }
  if (message.id !== id || ("result" in message) === ("error" in message)) throw protocolError();
  if ("error" in message) throw new ExaSearchError("Exa MCP 返回协议错误，未重试搜索。");
  return { terminal: true, result: message.result };
}

async function readResult(response: Response, id: string, signal: AbortSignal, limit: number): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json" && contentType !== "text/event-stream") throw protocolError();
  const length = response.headers.get("content-length");
  if (length && Number(length) > limit) throw new ExaSearchError("Exa 搜索响应超过大小上限。");
  if (!response.body) throw protocolError();
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let buffer = "";
  let eventData: string[] = [];
  let terminal: { result: unknown } | undefined;
  const acceptEvent = () => {
    if (!eventData.length) return;
    const event = rpcResult(parseJson(eventData.join("\n")), id);
    eventData = [];
    if (event.terminal) {
      if (terminal) throw protocolError();
      terminal = { result: event.result };
    }
  };
  const acceptLine = (line: string) => {
    if (!line) { acceptEvent(); return; }
    if (line.startsWith("data:")) eventData.push(line.slice(5).replace(/^ /u, ""));
    // SSE comments and transport metadata (event/id/retry) are not RPC messages.
  };
  const lines = (final: boolean) => {
    while (true) {
      const index = buffer.search(/[\r\n]/u);
      if (index < 0 || (!final && buffer[index] === "\r" && index === buffer.length - 1)) break;
      const line = buffer.slice(0, index);
      const width = buffer[index] === "\r" && buffer[index + 1] === "\n" ? 2 : 1;
      buffer = buffer.slice(index + width);
      acceptLine(line);
    }
    if (final) {
      if (buffer) acceptLine(buffer);
      buffer = "";
      acceptEvent();
    }
  };
  try {
    while (true) {
      const { value, done } = await abortable(reader.read(), signal);
      if (done) {
        buffer += decoder.decode();
        if (contentType === "application/json") {
          const result = rpcResult(parseJson(buffer), id);
          if (!result.terminal) throw protocolError();
          return result.result;
        }
        lines(true);
        if (!terminal) throw protocolError();
        return terminal.result;
      }
      bytes += value.byteLength;
      if (bytes > limit) throw new ExaSearchError("Exa 搜索响应超过大小上限。");
      buffer += decoder.decode(value, { stream: true });
      if (contentType === "text/event-stream") {
        lines(false);
        // A terminal event finishes the request; do not wait for an open SSE connection.
        if (terminal) return terminal.result;
      }
    }
  } catch (error) {
    if (signal.aborted) throw cancelled();
    if (error instanceof ExaSearchError) throw error;
    throw protocolError();
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function normalizeToolResult(raw: unknown, count: number): SearchResult {
  if (!object(raw) || (raw.isError !== undefined && typeof raw.isError !== "boolean")) throw protocolError();
  if (raw.isError) throw new ExaSearchError("Exa 搜索工具返回错误，未发起回答请求。");
  // The pinned advanced tool emits exactly one JSON text block, never structuredContent.
  if (!Array.isArray(raw.content) || raw.content.length !== 1) throw protocolError();
  const block: unknown = raw.content[0];
  if (!object(block) || block.type !== "text" || typeof block.text !== "string") throw protocolError();
  if (block.text.trim() === NO_RESULTS) throw new ExaSearchError("Exa 未找到可用搜索资料。");
  const payload = parseJson(block.text);
  if (!object(payload) || !Array.isArray(payload.results)) throw protocolError();
  return normalizeExaResults(payload.results, count);
}

function verifyToolList(raw: unknown, query: string, count: number): void {
  if (!object(raw) || !Array.isArray(raw.tools) || raw.tools.length > 256) throw protocolError();
  const matches = raw.tools.filter((tool: unknown) => object(tool) && tool.name === TOOL);
  if (matches.length !== 1 || !object(matches[0])) throw new ExaSearchError("搜索服务未提供指定的 Exa 高级搜索工具。");
  const schema = matches[0].inputSchema;
  if (!object(schema) || schema.type !== "object" || !object(schema.properties)
    || !Array.isArray(schema.required) || !schema.required.includes("query")
    || schema.required.some((name: unknown) => !["query", "numResults", "textMaxCharacters"].includes(String(name)))) throw protocolError();
  for (const [name, value] of Object.entries({ query, numResults: count, textMaxCharacters: 1500 })) {
    const property = schema.properties[name];
    if (!object(property)) throw protocolError();
    // Exa's coercing Zod inputs can omit type; explicit conflicting types are incompatible.
    if (property.type !== undefined && property.type !== typeof value
      && !(property.type === "integer" && typeof value === "number")) throw protocolError();
    if (Array.isArray(property.enum) && !property.enum.includes(value)) throw protocolError();
    if (property.const !== undefined && property.const !== value) throw protocolError();
    if (typeof value === "number" && ((typeof property.minimum === "number" && value < property.minimum)
      || (typeof property.maximum === "number" && value > property.maximum))) throw protocolError();
    if (typeof value === "string" && ((typeof property.minLength === "number" && Array.from(value).length < property.minLength)
      || (typeof property.maxLength === "number" && Array.from(value).length > property.maxLength))) throw protocolError();
  }
}

export function createExaSearchClient(fetch: FetchLike, options: { timeoutMs?: number; maxResponseBytes?: number } = {}) {
  return {
    async search(settings: SearchSettings, text: string, signal?: AbortSignal): Promise<SearchResult> {
      const config = validateSearchSettings(settings);
      const query = validateSearchQuery(text);
      if (signal?.aborted) throw cancelled();
      const endpoint = new URL(config.baseUrl);
      endpoint.searchParams.set("tools", TOOL);
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 30_000);
      const onAbort = () => controller.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      let version: string | undefined;
      let session: string | undefined;
      let activeId: string | undefined;
      const headers = () => ({
        "Content-Type": "application/json", Accept: "application/json, text/event-stream",
        ...(config.apiKey ? { "x-api-key": config.apiKey } : {}),
        ...(version ? { "MCP-Protocol-Version": version } : {}),
        ...(session ? { "Mcp-Session-Id": session } : {}),
      });
      const post = async (body: ObjectValue): Promise<Response> => {
        let response: Response;
        try {
          response = await abortable(fetch(endpoint, {
            method: "POST", headers: headers(), body: JSON.stringify(body),
            signal: controller.signal, redirect: "error", credentials: "omit",
          }).then((received) => {
            if (controller.signal.aborted) void received.body?.cancel().catch(() => {});
            return received;
          }), controller.signal);
        } catch (error) {
          if (controller.signal.aborted) throw cancelled();
          // Transport errors can contain URLs, headers or credentials.
          void error;
          throw new ExaSearchError("无法连接 Exa 搜索服务，未重试请求。");
        }
        if (response.redirected || (response.url && response.url !== endpoint.href)) {
          void response.body?.cancel().catch(() => {});
          throw new ExaSearchError("Exa 搜索服务重定向已拒绝。");
        }
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          if (response.status === 429) throw new ExaSearchError("Exa 搜索已限流，请稍后显式重试或配置 API Key。");
          if (response.status >= 500) throw new ExaSearchError("Exa 搜索服务器错误，未重试请求。");
          throw new ExaSearchError(`Exa 搜索请求失败（HTTP ${response.status}）。`);
        }
        return response;
      };
      const request = async (method: string, params: ObjectValue): Promise<unknown> => {
        const id = crypto.randomUUID();
        activeId = id;
        const response = await post({ jsonrpc: "2.0", id, method, params });
        if (method === "initialize") {
          const returned = response.headers.get("Mcp-Session-Id");
          if (returned !== null) {
            if (!/^[\x21-\x7e]{1,256}$/u.test(returned)) {
              void response.body?.cancel().catch(() => {});
              throw protocolError();
            }
            session = returned;
          }
        }
        let result: unknown;
        try { result = await readResult(response, id, controller.signal, options.maxResponseBytes ?? 2 * 1024 * 1024); }
        finally { void response.body?.cancel().catch(() => {}); }
        activeId = undefined;
        return result;
      };
      const cleanup = (method: "POST" | "DELETE", body?: ObjectValue) => {
        const stop = new AbortController();
        const cleanupTimer = setTimeout(() => stop.abort(), 1000);
        void abortable(Promise.resolve().then(() => fetch(endpoint, {
          method, headers: headers(), ...(body ? { body: JSON.stringify(body) } : {}),
          signal: stop.signal, redirect: "error", credentials: "omit",
        })), stop.signal).then((response) => { void response.body?.cancel().catch(() => {}); })
          .catch(() => {}).finally(() => clearTimeout(cleanupTimer));
      };
      try {
        const initialized = await request("initialize", {
          protocolVersion: VERSIONS[0], capabilities: {}, clientInfo: { name: "ayase-studio", version: "1" },
        });
        if (!object(initialized) || typeof initialized.protocolVersion !== "string"
          || !VERSIONS.includes(initialized.protocolVersion) || !object(initialized.capabilities)
          || !object(initialized.capabilities.tools) || !object(initialized.serverInfo)
          || typeof initialized.serverInfo.name !== "string" || typeof initialized.serverInfo.version !== "string") throw protocolError();
        version = initialized.protocolVersion;
        const notification = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
        void notification.body?.cancel().catch(() => {});
        if (notification.status !== 202 && notification.status !== 204) throw protocolError();
        verifyToolList(await request("tools/list", {}), query, config.numResults);
        const result = await request("tools/call", { name: TOOL, arguments: { query, numResults: config.numResults, textMaxCharacters: 1500 } });
        if (controller.signal.aborted) throw cancelled();
        return normalizeToolResult(result, config.numResults);
      } catch (error) {
        if (timedOut) throw new ExaSearchError("Exa 搜索超过 30 秒时限，已停止。");
        if (controller.signal.aborted) throw cancelled();
        if (error instanceof ExaResultError) throw error;
        throw protocolError();
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (controller.signal.aborted && activeId && version) cleanup("POST", {
          jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: activeId, reason: "Search stopped" },
        });
        if (session) cleanup("DELETE");
      }
    },
  };
}
