import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveOpenAIImagesEndpoint } from "../chat/urlResolution";
import { createGeminiImageTransport, ImageGenerationError } from "./geminiImage";
import { createOpenAIImagesTransport, parseOpenAIImages, validateOpenAIImagesParameters } from "./openaiImages";
import type { DrawingParameters } from "./types";

const parameters: DrawingParameters = {
  prompt: " A synthetic square ", providerId: "p", connectionId: "c", configuredModelId: "m",
  modelId: "gpt-image-1", modelName: "test", protocol: "openai-images",
  baseUrl: "https://example.test", size: "1024x1024", quality: "high",
};
const geminiParameters: DrawingParameters = {
  ...parameters, protocol: "gemini-image", aspectRatio: "16:9", resolution: "2K",
};
const body = { data: [{ b64_json: "AQID" }] };
const signal = () => new AbortController().signal;
const response = (value: unknown = body) => new Response(JSON.stringify(value));
const mib = 1024 * 1024;

function base64Bytes(bytes: number): string {
  const padding = bytes % 3 === 1 ? "==" : bytes % 3 === 2 ? "=" : "";
  return "A".repeat(Math.ceil(bytes / 3) * 4 - padding.length) + padding;
}

async function expectRedactedFailure(pending: Promise<unknown>, outcome: "failed" | "unknown" = "failed") {
  const error: unknown = await pending.then(() => { throw new Error("Expected generation to fail"); }, value => value);
  expect(error).toBeInstanceOf(ImageGenerationError);
  expect(error).toMatchObject({ outcome });
  expect(String(error)).not.toMatch(/synthetic-secret|private prompt|remote-image/);
  return error;
}

afterEach(() => vi.useRealTimers());

describe("OpenAI Images protocol", () => {
  it.each([301, 302, 307, 308])("classifies unfollowed native HTTP %s as unknown without a redirect request", async status => {
    const fetcher = vi.fn().mockResolvedValue(new Response("synthetic-secret", {status,headers:{location:"https://remote-image.test"}}));
    await expectRedactedFailure(createOpenAIImagesTransport(fetcher).generate(parameters,"test",signal()), "unknown");
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("maps a single PNG generation with trimmed Bearer authentication and no chat/Gemini fields", async () => {
    const fetcher = vi.fn().mockResolvedValue(response());
    const input = { ...parameters, aspectRatio: "16:9", resolution: "4K", temperature: 0.7, stream: true };
    expect(await createOpenAIImagesTransport(fetcher).generate(input, " synthetic-secret ", signal()))
      .toEqual([{ mime: "image/png", data: "AQID" }]);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://example.test/v1/images/generations");
    expect(url).not.toContain("synthetic-secret");
    expect(init).toMatchObject({ method: "POST", redirect: "error", credentials: "omit" });
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer synthetic-secret");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.has("x-goog-api-key")).toBe(false);
    expect(JSON.parse(init.body)).toEqual({
      model: "gpt-image-1", prompt: "A synthetic square", n: 1, output_format: "png", size: "1024x1024", quality: "high",
    });
  });

  it.each([
    ["auto", "auto", {}], ["auto", "low", { quality: "low" }],
    ["1536x1024", "auto", { size: "1536x1024" }],
  ])("omits only automatic options (%s/%s)", async (size, quality, options) => {
    const fetcher = vi.fn().mockResolvedValue(response());
    await createOpenAIImagesTransport(fetcher).generate({ ...parameters, size, quality }, "test", signal());
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      model: "gpt-image-1", prompt: "A synthetic square", n: 1, output_format: "png", ...options,
    });
  });

  it.each(["low", "medium", "high", "xhigh", "max"])("passes quality %s unchanged", async quality => {
    const fetcher = vi.fn().mockResolvedValue(response());
    await createOpenAIImagesTransport(fetcher).generate({ ...parameters, quality }, "test", signal());
    expect(JSON.parse(fetcher.mock.calls[0][1].body).quality).toBe(quality);
  });

  it.each([
    ["https://example.test", "https://example.test/v1/images/generations"],
    [" https://example.test/v1/// ", "https://example.test/v1/images/generations"],
    ["https://example.test/relay", "https://example.test/relay/images/generations"],
    ["https://example.test/relay/v2/", "https://example.test/relay/v2/images/generations"],
  ])("dispatches exactly the shared preview endpoint for %s", async (baseUrl, expected) => {
    const fetcher = vi.fn().mockResolvedValue(response());
    await createOpenAIImagesTransport(fetcher).generate({ ...parameters, baseUrl }, "test", signal());
    expect(resolveOpenAIImagesEndpoint(baseUrl, parameters.modelId)).toBe(expected);
    expect(fetcher.mock.calls[0][0]).toBe(expected);
  });

  it("refuses the other drawing protocol in both adapters before sending", async () => {
    const fetcher = vi.fn().mockResolvedValue(response());
    await expect(createOpenAIImagesTransport(fetcher).generate(geminiParameters, "test", signal())).rejects.toThrow();
    await expect(createGeminiImageTransport(fetcher).generate(parameters, "test", signal())).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["1024x640", "3072x1024", "3840x2160", "auto"])("accepts valid size boundary %s", size => {
    expect(() => validateOpenAIImagesParameters({ ...parameters, size })).not.toThrow();
  });

  it.each([
    { prompt: " " }, { prompt: "A".repeat(32_001) }, { modelId: " " },
    { modelId: "dall-e-2" }, { modelId: "dall-e-3" }, { quality: "ultra" },
    { size: "1025x1024" }, { size: "3856x1920" }, { size: "3072x1008" },
    { size: "800x800" }, { size: "3840x2176" }, { size: "0x1024" },
    { size: "1024X1024" }, { size: "1024x1024junk" },
    { baseUrl: "http://example.test" }, { baseUrl: "https://user:pass@example.test" },
    { baseUrl: "https://example.test?secret=synthetic-secret" }, { baseUrl: "https://example.test#fragment" },
  ])("rejects invalid input before fetch: %j", async overrides => {
    const fetcher = vi.fn();
    await expect(createOpenAIImagesTransport(fetcher).generate({ ...parameters, ...overrides }, "test", signal())).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["", "  ", "test\r\nInjected: value", "test\u0000key"])("rejects unsafe or empty authentication before fetch", async key => {
    const fetcher = vi.fn();
    await expect(createOpenAIImagesTransport(fetcher).generate(parameters, key, signal())).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("accepts configured relay aliases without inferring capabilities from their names", async () => {
    const fetcher = vi.fn().mockResolvedValue(response());
    await createOpenAIImagesTransport(fetcher).generate({ ...parameters, modelId: "relay-image-alias" }, "test", signal());
    expect(JSON.parse(fetcher.mock.calls[0][1].body).model).toBe("relay-image-alias");
  });

  it.each([[undefined, "image/png"], ["png", "image/png"], ["jpeg", "image/jpeg"], ["webp", "image/webp"]])
    ("uses returned output format %s for every retained image", (output_format, mime) => {
      expect(parseOpenAIImages({ output_format, data: [{ b64_json: "AQID" }, { b64_json: "BAUG" }] }))
        .toEqual([{ mime, data: "AQID" }, { mime, data: "BAUG" }]);
    });

  it("retains all eight returned byte images in order", () => {
    const data = Array.from({ length: 8 }, (_, index) => ({ b64_json: btoa(String(index)) }));
    expect(parseOpenAIImages({ data })).toEqual(data.map(item => ({ mime: "image/png", data: item.b64_json })));
  });

  it.each([
    null, [], {}, { data: [] }, { data: "AQID" }, { data: [null] },
    { data: [{ url: "https://remote-image.test/private" }] },
    { data: [{ b64_json: "AQID" }, { url: "https://remote-image.test/private" }] },
    { error: { message: "synthetic-secret private prompt" }, data: [{ b64_json: "AQID" }] },
    { output_format: "gif", data: [{ b64_json: "AQID" }] },
    ...["", "bad!", "AQI", "AQID\n", "data:image/png;base64,AQID", "A===", "AQ==ID=="].map(b64_json => ({ data: [{ b64_json }] })),
  ])("rejects empty, URL-only, error and malformed responses without echoing fields", value => {
    try { parseOpenAIImages(value); throw new Error("Expected parser to fail"); }
    catch (error) {
      expect(error).toBeInstanceOf(ImageGenerationError);
      expect(String(error)).not.toMatch(/synthetic-secret|private prompt|remote-image/);
    }
  });

  it("enforces image-count, individual-byte and aggregate-byte limits", () => {
    expect(() => parseOpenAIImages({ data: Array.from({ length: 9 }, () => ({ b64_json: "AQID" })) })).toThrow(ImageGenerationError);
    const maximum = base64Bytes(32 * mib);
    expect(parseOpenAIImages({ data: [{ b64_json: maximum }, { b64_json: maximum }] })).toHaveLength(2);
    expect(() => parseOpenAIImages({ data: [{ b64_json: base64Bytes(32 * mib + 1) }] })).toThrow(ImageGenerationError);
    expect(() => parseOpenAIImages({ data: [{ b64_json: maximum }, { b64_json: maximum }, { b64_json: "AA==" }] })).toThrow(ImageGenerationError);
  });

  it.each([400, 401, 403, 429, 500, 503])("redacts HTTP %s and never retries or falls back", async status => {
    const cancel = vi.fn();
    const fetcher = vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode("synthetic-secret private prompt")); }, cancel,
    }), { status }));
    const error = await expectRedactedFailure(createOpenAIImagesTransport(fetcher).generate(parameters, "synthetic-secret", signal()), status >= 500 ? "unknown" : "failed");
    expect(String(error)).toContain(String(status));
    expect(fetcher).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("redacts provider error JSON and malformed JSON without retaining response text", async () => {
    for (const result of [response({ error: { message: "synthetic-secret private prompt" } }), new Response("{synthetic-secret private prompt")]) {
      const fetcher = vi.fn().mockResolvedValue(result);
      await expectRedactedFailure(createOpenAIImagesTransport(fetcher).generate(parameters, "synthetic-secret", signal()));
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });

  it("rejects URL-only output without making a second request to download it", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ data: [{ url: "https://remote-image.test/private" }] }));
    await expectRedactedFailure(createOpenAIImagesTransport(fetcher).generate(parameters, "test", signal()));
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects excessive Content-Length without reading or downloading any image", async () => {
    const cancel = vi.fn();
    const fetcher = vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }), { headers: { "content-length": String(90 * mib + 1) } }));
    await expectRedactedFailure(createOpenAIImagesTransport(fetcher).generate(parameters, "test", signal()));
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("bounds streamed bodies even without Content-Length and cancels the reader", async () => {
    let chunks = 0;
    const cancel = vi.fn(), chunk = new Uint8Array(mib).fill(32);
    const fetcher = vi.fn().mockResolvedValue(new Response(new ReadableStream({
      pull(controller) { chunks += 1; controller.enqueue(chunk); }, cancel,
    }, { highWaterMark: 0 })));
    await expectRedactedFailure(createOpenAIImagesTransport(fetcher).generate(parameters, "test", signal()));
    expect(chunks).toBe(91);
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("redacts network and redirect exceptions as unknown without retries", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("synthetic-secret private prompt redirect"));
    await expectRedactedFailure(createOpenAIImagesTransport(fetcher).generate(parameters, "synthetic-secret", signal()), "unknown");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each(["redirected", "different-url"])("rejects a %s response and cancels its body", async kind => {
    const cancel = vi.fn(), result = new Response(new ReadableStream({ cancel }));
    Object.defineProperty(result, kind === "redirected" ? "redirected" : "url", {
      value: kind === "redirected" ? true : "https://remote-image.test/v1/images/generations",
    });
    const fetcher = vi.fn().mockResolvedValue(result);
    await expectRedactedFailure(createOpenAIImagesTransport(fetcher).generate(parameters, "test", signal()), "unknown");
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("sends nothing when cancelled before dispatch", async () => {
    const controller = new AbortController(), fetcher = vi.fn();
    controller.abort();
    await expectRedactedFailure(createOpenAIImagesTransport(fetcher).generate(parameters, "test", controller.signal));
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("cancels a stalled response body after dispatch and reports an unknown outcome", async () => {
    const controller = new AbortController(), cancel = vi.fn();
    const fetcher = vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const pending = createOpenAIImagesTransport(fetcher).generate(parameters, "test", controller.signal);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    controller.abort();
    await expectRedactedFailure(pending, "unknown");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("aborts at 400 seconds with no retry and clears its timeout", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const fetcher = vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const pending = createOpenAIImagesTransport(fetcher).generate(parameters, "test", signal());
    const rejected = expectRedactedFailure(pending, "unknown");
    await vi.advanceTimersByTimeAsync(399_999);
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears its timeout after successful generation", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue(response());
    await createOpenAIImagesTransport(fetcher).generate(parameters, "test", signal());
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(400_000);
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
