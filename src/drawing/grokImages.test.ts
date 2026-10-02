import { describe, expect, it, vi } from "vitest";
import { createGrokImagesTransport, initialGrokDrawingOptions, validGrokDrawingOptions, validateGrokImagesParameters } from "./grokImages";
import type { DrawingParameters } from "./types";

const png = btoa(String.fromCharCode(137, 80, 78, 71, 13, 10, 26, 10));
const parameters: Extract<DrawingParameters, { protocol: "grok-images" }> = {
  prompt: " private prompt ", providerId: "p", connectionId: "c", configuredModelId: "m", modelId: " relay-alias ", modelName: "test",
  protocol: "grok-images", baseUrl: "https://example.test", ...initialGrokDrawingOptions,
};
const signal = () => new AbortController().signal;
const fetcher = () => vi.fn().mockImplementation(async () => new Response(JSON.stringify({ data: [{ b64_json: png }] })));

describe("Grok JSON Images adapter", () => {
  it("sends the explicit alias and mandatory fields, omitting automatic controls", async () => {
    const fetch = fetcher();
    await createGrokImagesTransport(fetch).generate(parameters, " synthetic-secret ", signal());
    const [endpoint, init] = fetch.mock.calls[0];
    expect(endpoint).toBe("https://example.test/v1/images/generations");
    expect(init).toMatchObject({ method: "POST", redirect: "error", credentials: "omit" });
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer synthetic-secret");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ model: "relay-alias", prompt: "private prompt", n: 1, response_format: "b64_json" });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each([{ size: "4K" }, { stream: true }, { outputFormat: "png" }, { watermark: "on" }, { gemini: {} }, { unknown: undefined }])
    ("rejects explicit foreign or unknown fields before dispatch: %j", async fields => {
      const fetch = fetcher();
      await expect(createGrokImagesTransport(fetch).generate({ ...parameters, ...fields }, "test", signal())).rejects.toThrow("字段");
      expect(fetch).not.toHaveBeenCalled();
    });
  it("passes explicit 2.0 controls without guessing the configured alias's model version", async () => {
    const fetch = fetcher();
    await createGrokImagesTransport(fetch).generate({ ...parameters, modelVersion: "2.0", aspectRatio: "21:9", resolution: "2k", quality: "medium" }, "test", signal());
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ model: "relay-alias", prompt: "private prompt", n: 1, response_format: "b64_json", aspect_ratio: "21:9", resolution: "2k", quality: "medium" });
  });
  it.each([1, 3, 5])("sends %s ordered original references as JSON image objects", async count => {
    const references = Array.from({ length: count }, (_, index) => ({ mime: index % 2 ? "image/bmp" : "image/png", data: btoa(`original-${index}`) }));
    const fetch = fetcher();
    await createGrokImagesTransport(fetch).generate(parameters, "test", signal(), references);
    expect(fetch.mock.calls[0][0]).toBe("https://example.test/v1/images/edits");
    const objects = references.map(image => ({ url: `data:${image.mime};base64,${image.data}`, type: "image_url" }));
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ model: "relay-alias", prompt: "private prompt", n: 1, response_format: "b64_json", ...(count === 1 ? { image: objects[0] } : { images: objects }) });
  });
  it("rejects a sixth reference before dispatch", async () => {
    const fetch = fetcher();
    await expect(createGrokImagesTransport(fetch).generate(parameters, "test", signal(), Array.from({ length: 6 }, () => ({ mime: "image/png", data: png })))).rejects.toThrow("5");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves incompatible draft options structurally but rejects explicit unsupported legacy controls", () => {
    for (const options of [{ quality: "low" }, { aspectRatio: "21:9" }, { aspectRatio: "5:2" }]) {
      expect(validGrokDrawingOptions({ ...initialGrokDrawingOptions, ...options })).toBe(true);
      expect(() => validateGrokImagesParameters({ ...parameters, ...options })).toThrow("2.0");
    }
    expect(validGrokDrawingOptions({ ...initialGrokDrawingOptions, stream: true })).toBe(false);
    expect(validGrokDrawingOptions({ ...initialGrokDrawingOptions, quality: "high" })).toBe(false);
  });
  it.each([{ prompt: " " }, { modelId: " " }, { aspectRatio: "4:5" }, { resolution: "2K" }, { quality: "high" },
    { baseUrl: "http://example.test" }, { baseUrl: "https://user:pass@example.test" }, { baseUrl: "https://example.test?private=1" }, { baseUrl: "https://example.test#secret" }])
    ("rejects invalid request before dispatch: %j", async override => {
      const fetch = fetcher();
      await expect(createGrokImagesTransport(fetch).generate({ ...parameters, ...override }, "test", signal())).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
    });
});
