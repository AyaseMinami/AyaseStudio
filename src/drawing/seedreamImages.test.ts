import { describe, expect, it, vi } from "vitest";
import { createSeedreamImagesTransport, initialSeedreamDrawingOptions, seedreamModelVersions, seedreamSizesByVersion, validSeedreamDrawingOptions, validateSeedreamImagesParameters } from "./seedreamImages";
import type { DrawingParameters } from "./types";

const jpeg = btoa(String.fromCharCode(255, 216, 255));
const parameters: Extract<DrawingParameters, { protocol: "seedream-images" }> = {
  prompt: " prompt ", providerId: "p", connectionId: "c", configuredModelId: "m", modelId: " arbitrary-alias ", modelName: "test",
  protocol: "seedream-images", baseUrl: "https://example.test", ...initialSeedreamDrawingOptions,
};
const signal = () => new AbortController().signal;
const fetcher = () => vi.fn().mockImplementation(async () => new Response(JSON.stringify({ data: [{ b64_json: jpeg }] })));

describe("Seedream JSON Images adapter", () => {
  it.each(seedreamModelVersions)("maps explicit profile %s and only supported sequential-generation controls", async modelVersion => {
    const fetch = fetcher();
    await createSeedreamImagesTransport(fetch).generate({ ...parameters, modelVersion }, " test ", signal());
    expect(fetch.mock.calls[0][0]).toBe("https://example.test/api/v3/images/generations");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ model: "arbitrary-alias", prompt: "prompt", response_format: "b64_json",
      ...(["4.0", "4.5", "5.0-lite"].includes(modelVersion) ? { sequential_image_generation: "disabled" } : {}) });
    expect(new Headers(fetch.mock.calls[0][1].headers).get("authorization")).toBe("Bearer test");
  });
  it.each([{ aspectRatio: "16:9" }, { quality: "high" }, { resolution: "2k" }, { stream: true }, { gemini: {} }, { unknown: undefined }])
    ("rejects explicit foreign or unknown fields before dispatch: %j", async fields => {
      const fetch = fetcher();
      await expect(createSeedreamImagesTransport(fetch).generate({ ...parameters, ...fields }, "test", signal())).rejects.toThrow("字段");
      expect(fetch).not.toHaveBeenCalled();
    });
  it.each(seedreamModelVersions)("enforces profile %s reference maximum without truncating", async modelVersion => {
    const maximum = modelVersion === "5.0-pro" || modelVersion === "5.0-flash" ? 10 : 14;
    const references = Array.from({ length: maximum }, (_, index) => ({ mime: "image/png", data: btoa(`original-${index}`) }));
    const fetch = fetcher();
    await createSeedreamImagesTransport(fetch).generate({ ...parameters, modelVersion }, "test", signal(), references);
    expect(JSON.parse(fetch.mock.calls[0][1].body).image).toEqual(references.map(image => `data:${image.mime};base64,${image.data}`));
    expect(fetch).toHaveBeenCalledOnce();
    const blocked = fetcher();
    await expect(createSeedreamImagesTransport(blocked).generate({ ...parameters, modelVersion }, "test", signal(), [...references, { mime: "image/png", data: jpeg }])).rejects.toThrow(String(maximum));
    expect(blocked).not.toHaveBeenCalled();
  });
  it.each([1, 3])("uses the same generation endpoint for %s ordered original edit references", async count => {
    const references = Array.from({ length: count }, (_, index) => ({ mime: index % 2 ? "image/bmp" : "image/png", data: btoa(`original-${index}`) }));
    const fetch = fetcher();
    await createSeedreamImagesTransport(fetch).generate({ ...parameters, modelVersion: "5.0-flash", size: "1.5K", outputFormat: "png", watermark: "off" }, "test", signal(), references);
    expect(fetch.mock.calls[0][0]).toBe("https://example.test/api/v3/images/generations");
    const images = references.map(image => `data:${image.mime};base64,${image.data}`);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ model: "arbitrary-alias", prompt: "prompt", response_format: "b64_json", size: "1.5K", output_format: "png", watermark: false, image: count === 1 ? images[0] : images });
  });
  it("maps enabled watermark and jpeg output explicitly", async () => {
    const fetch = fetcher();
    await createSeedreamImagesTransport(fetch).generate({ ...parameters, modelVersion: "5.0-lite", outputFormat: "jpeg", watermark: "on" }, "test", signal());
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ output_format: "jpeg", watermark: true });
  });
  it("accepts every profile's named size and matching numeric boundaries", () => {
    for (const modelVersion of seedreamModelVersions) {
      const numeric = modelVersion === "4.0" ? ["1280x720", "4096x4096"] : modelVersion === "4.5" || modelVersion === "5.0-lite" ? ["2560x1440", "4096x4096", "8000x500"] : ["1280x720", "2048x2048"];
      for (const size of [...seedreamSizesByVersion[modelVersion], ...numeric]) {
        expect(() => validateSeedreamImagesParameters({ ...parameters, modelVersion, size })).not.toThrow();
      }
    }
  });
  it("accepts editable/incompatible drafts structurally and validates profile semantics only at dispatch", () => {
    for (const size of ["", "2048x", "3K", "1024X1024", "invalid"]) expect(validSeedreamDrawingOptions({ ...initialSeedreamDrawingOptions, size })).toBe(true);
    expect(validSeedreamDrawingOptions({ ...initialSeedreamDrawingOptions, outputFormat: "png" })).toBe(true);
    expect(validSeedreamDrawingOptions({ ...initialSeedreamDrawingOptions, stream: true })).toBe(false);
    expect(validSeedreamDrawingOptions({ ...initialSeedreamDrawingOptions, modelVersion: "6" })).toBe(false);
    expect(validSeedreamDrawingOptions({ ...initialSeedreamDrawingOptions, watermark: false })).toBe(false);
  });
  it.each([{ size: "3K" }, { size: "1K" }, { size: "2048x" }, { size: "1024x1024" }, { size: "4096x4097" },
    { size: "8001x500" }, { size: "16001x250" }, { size: "0x2048" }, { size: "999999999999999999999x1" }, { outputFormat: "png" as const },
    { modelVersion: "5.0-pro" as const, size: "4K" }, { modelVersion: "5.0-flash" as const, size: "4096x4096" }, { prompt: " " }, { baseUrl: "http://example.test" }])
    ("rejects invalid request before dispatch: %j", async override => {
      const fetch = fetcher();
      await expect(createSeedreamImagesTransport(fetch).generate({ ...parameters, ...override }, "test", signal())).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
    });
});
