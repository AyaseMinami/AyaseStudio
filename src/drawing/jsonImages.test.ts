import { afterEach, describe, expect, it, vi } from "vitest";
import { createGrokImagesTransport, initialGrokDrawingOptions } from "./grokImages";
import { ImageGenerationError, normalizeVerifiedImageResponseData } from "./imageResponse";
import { parseJSONImages } from "./jsonImages";
import { createSeedreamImagesTransport, initialSeedreamDrawingOptions } from "./seedreamImages";
import type { DrawingParameters } from "./types";

const png = btoa(String.fromCharCode(137, 80, 78, 71, 13, 10, 26, 10));
const jpeg = btoa(String.fromCharCode(255, 216, 255));
const webp = btoa("RIFF0000WEBP");
const base = { prompt: "private prompt", providerId: "p", connectionId: "c", configuredModelId: "m", modelId: "alias", modelName: "test", baseUrl: "https://example.test" };
const adapters = [
  { name: "Grok", create: createGrokImagesTransport, parameters: { ...base, protocol: "grok-images", ...initialGrokDrawingOptions } as DrawingParameters },
  { name: "Seedream", create: createSeedreamImagesTransport, parameters: { ...base, protocol: "seedream-images", ...initialSeedreamDrawingOptions } as DrawingParameters },
];
const signal = () => new AbortController().signal;
const response = () => new Response(JSON.stringify({ data: [{ b64_json: png }] }));
const mib = 1024 * 1024;

async function redacted(pending: Promise<unknown>, outcome: "failed" | "unknown" = "failed") {
  const error: unknown = await pending.then(() => { throw new Error("Expected failure"); }, value => value);
  expect(error).toBeInstanceOf(ImageGenerationError);
  expect(error).toMatchObject({ outcome });
  expect(String(error)).not.toMatch(/synthetic-secret|private prompt|remote-image/);
  return error;
}

afterEach(() => vi.useRealTimers());

describe("verified JSON image responses", () => {
  it("infers each byte MIME in order and normalizes bounded CR/LF/data URI wrappers", () => {
    expect(parseJSONImages({ data: [{ b64_json: png }, { b64_json: `data:image/jpeg;base64,${jpeg}\r\n` }, { b64_json: webp }] }))
      .toEqual([{ mime: "image/png", data: png }, { mime: "image/jpeg", data: jpeg }, { mime: "image/webp", data: webp }]);
    expect(parseJSONImages({ output_format: "png", data: { output_format: "png", b64_json: png } })).toEqual([{ mime: "image/png", data: png }]);
  });
  it.each([["png", png], ["jpeg", jpeg], ["webp", webp]])("accepts %s item declarations only when bytes agree", (output_format, b64_json) => {
    expect(parseJSONImages({ data: [{ output_format, b64_json }] })[0].mime).toBe(`image/${output_format}`);
  });
  it.each([null, [], {}, { data: [] }, { data: [null] }, { data: [{ url: "https://remote-image.test" }] },
    { error: { message: "synthetic-secret private prompt" } }, { data: [{ error: { message: "synthetic-secret" }, b64_json: png }] },
    { output_format: "gif", data: [{ b64_json: png }] }, { data: [{ output_format: "jpeg", b64_json: png }] },
    { output_format: "jpeg", data: [{ output_format: "png", b64_json: png }] }, { data: [{ b64_json: `data:image/jpeg;base64,${png}` }] },
    ...["AQID", "bad!", "AB==", "AAF=", "AQ ID", "AQI", "", "data:image/gif;base64,AQID"].map(b64_json => ({ data: [{ b64_json }] }))])
    ("rejects invalid responses without leaking provider data: %j", value => {
      try { parseJSONImages(value); throw new Error("Expected failure"); }
      catch (error) { expect(error).toBeInstanceOf(ImageGenerationError); expect(String(error)).not.toMatch(/synthetic-secret|private prompt|remote-image/); }
    });
  it("checks the entire PNG/WebP signature and rejects wrong MIME declarations", () => {
    for (const data of [btoa("RIFF0000NOTP"), btoa(String.fromCharCode(137, 80, 78, 71, 0, 0, 0, 0)), btoa("RIFF")]) {
      expect(() => normalizeVerifiedImageResponseData(data)).toThrow();
    }
    expect(() => normalizeVerifiedImageResponseData(jpeg, "image/png")).toThrow();
  });
  it("keeps eight outputs and enforces individual/aggregate byte limits", () => {
    expect(parseJSONImages({ data: Array.from({ length: 8 }, () => ({ b64_json: png })) })).toHaveLength(8);
    expect(() => parseJSONImages({ data: Array.from({ length: 9 }, () => ({ b64_json: png })) })).toThrow();
    // A twelve-byte signature prefix is divisible by three, so concatenation preserves canonical Base64.
    const prefix = btoa(String.fromCharCode(137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0));
    const make = (bytes: number) => prefix + "A".repeat(Math.floor((bytes - 12) / 3) * 4)
      + ((bytes - 12) % 3 === 1 ? "AA==" : (bytes - 12) % 3 === 2 ? "AAA=" : "");
    const maximum = make(32 * mib);
    expect(parseJSONImages({ data: [{ b64_json: maximum }, { b64_json: maximum }] })).toHaveLength(2);
    expect(() => parseJSONImages({ data: [{ b64_json: make(32 * mib + 1) }] })).toThrow();
    expect(() => parseJSONImages({ data: [{ b64_json: maximum }, { b64_json: maximum }, { b64_json: png }] })).toThrow();
  });
});

describe.each(adapters)("$name dispatch safety", ({ create, parameters }) => {
  it.each(["", " ", "test\r\nInjected:value", "test\u0000key"])("rejects invalid key before dispatch", async key => {
    const fetch = vi.fn();
    await redacted(create(fetch).generate(parameters, key, signal()));
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects other protocols before dispatch", async () => {
    const fetch = vi.fn();
    await redacted(create(fetch).generate({ ...base, protocol: "openai-images", size: "auto", quality: "auto" }, "test", signal()));
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([301, 302, 307, 308, 400, 401, 403, 429, 500, 503])("redacts HTTP %s, cancels its body and never retries", async status => {
    const cancel = vi.fn();
    const fetch = vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("synthetic-secret private prompt")); }, cancel }), { status }));
    const error = await redacted(create(fetch).generate(parameters, "synthetic-secret", signal()), status >= 500 || status >= 300 && status < 400 ? "unknown" : "failed");
    if (status >= 400) expect(error).toMatchObject({ httpStatus: status, category: status === 429 ? "rate-limited" : status >= 500 ? "network-unknown" : "rejected" });
    expect(fetch).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledOnce();
  });
  it.each(["redirected", "different-url"])("rejects %s response as unknown", async kind => {
    const cancel = vi.fn(), result = new Response(new ReadableStream({ cancel }));
    Object.defineProperty(result, kind === "redirected" ? "redirected" : "url", { value: kind === "redirected" ? true : "https://remote-image.test" });
    const fetch = vi.fn().mockResolvedValue(result);
    await redacted(create(fetch).generate(parameters, "test", signal()), "unknown");
    expect(fetch).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledOnce();
  });
  it("never retries network errors or downloads URL-only outputs", async () => {
    const failed = vi.fn().mockRejectedValue(new Error("synthetic-secret private prompt"));
    await redacted(create(failed).generate(parameters, "test", signal()), "unknown"); expect(failed).toHaveBeenCalledOnce();
    const url = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ url: "https://remote-image.test" }] })));
    await redacted(create(url).generate(parameters, "test", signal())); expect(url).toHaveBeenCalledOnce();
  });
  it("redacts malformed JSON and provider error JSON", async () => {
    for (const result of [new Response("{synthetic-secret private prompt"), new Response(JSON.stringify({ error: { message: "synthetic-secret private prompt" } }))]) {
      const fetch = vi.fn().mockResolvedValue(result);
      await redacted(create(fetch).generate(parameters, "test", signal())); expect(fetch).toHaveBeenCalledOnce();
    }
  });
  it("rejects excessive content length before reading", async () => {
    const cancel = vi.fn(), fetch = vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }), { headers: { "content-length": String(90 * mib + 1) } }));
    await redacted(create(fetch).generate(parameters, "test", signal()));
    expect(cancel).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledOnce();
  });
  it("bounds streams without content length", async () => {
    const cancel = vi.fn(), chunk = new Uint8Array(mib).fill(32); let chunks = 0;
    const fetch = vi.fn().mockResolvedValue(new Response(new ReadableStream({ pull(controller) { chunks++; controller.enqueue(chunk); }, cancel }, { highWaterMark: 0 })));
    await redacted(create(fetch).generate(parameters, "test", signal()));
    expect(chunks).toBe(91); expect(cancel).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledOnce();
  });
  it("sends nothing if already cancelled and classifies cancellation after dispatch as unknown", async () => {
    const controller = new AbortController(), fetch = vi.fn(); controller.abort();
    await redacted(create(fetch).generate(parameters, "test", controller.signal)); expect(fetch).not.toHaveBeenCalled();
    const active = new AbortController(), cancel = vi.fn();
    fetch.mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const pending = create(fetch).generate(parameters, "test", active.signal);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce()); active.abort();
    await redacted(pending, "unknown"); expect(cancel).toHaveBeenCalledOnce();
  });
  it("times out at 400 seconds and clears its timer without retry", async () => {
    vi.useFakeTimers(); const cancel = vi.fn(), fetch = vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const rejected = redacted(create(fetch).generate(parameters, "test", signal()), "unknown");
    await vi.advanceTimersByTimeAsync(399_999); expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await rejected;
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0); expect(fetch).toHaveBeenCalledOnce();
  });
  it("clears its timer on success", async () => {
    vi.useFakeTimers(); const fetch = vi.fn().mockResolvedValue(response());
    await create(fetch).generate(parameters, "test", signal()); expect(vi.getTimerCount()).toBe(0);
  });
});
