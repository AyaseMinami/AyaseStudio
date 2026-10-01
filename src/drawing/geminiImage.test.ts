import { describe, expect, it, vi } from "vitest";
import { createGeminiImageTransport, ImageGenerationError, parseGeminiImages } from "./geminiImage";
import type { DrawingParameters } from "./types";
import { geminiSafetyCategories, geminiSafetyThresholds } from "./geminiOptions";

const parameters: DrawingParameters = { prompt: "A synthetic square", aspectRatio: "16:9", resolution: "2K",
  providerId: "p", connectionId: "c", configuredModelId: "m", modelId: "gemini-image-test", modelName: "test",
  protocol: "gemini-image", baseUrl: "https://example.test" };
const image = { mimeType: "image/png", data: "AQID" };
const body = { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "done" }, { inlineData: image }] } }] };
describe("Gemini image protocol", () => {
  it.each(geminiSafetyThresholds)("maps explicit threshold %s uniformly with temperature and IMAGE output", async safetyThreshold => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));
    await createGeminiImageTransport(fetcher).generate({ ...parameters,
      gemini: { temperature: 0, safetyThreshold, outputMode: "image" },
    }, "test", new AbortController().signal);
    const request = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(request.safetySettings).toEqual(geminiSafetyCategories.map(category => ({ category, threshold: safetyThreshold })));
    expect(request.generationConfig).toEqual({ candidateCount: 1, responseModalities: ["IMAGE"], temperature: 0,
      imageConfig: { aspectRatio: "16:9", imageSize: "2K" } });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([{}, { outputMode: "text-image" }])("omits default temperature and safety settings: %j", async gemini => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));
    await createGeminiImageTransport(fetcher).generate({ ...parameters, gemini } as DrawingParameters, "test", new AbortController().signal);
    const request = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(request).not.toHaveProperty("safetySettings");
    expect(request.generationConfig).not.toHaveProperty("temperature");
    expect(request.generationConfig.responseModalities).toEqual(["TEXT", "IMAGE"]);
  });
  it.each([0, 1, 2])("forwards explicit valid temperature %s", async temperature => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));
    await createGeminiImageTransport(fetcher).generate({ ...parameters, gemini: { temperature } }, "test", new AbortController().signal);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).generationConfig.temperature).toBe(temperature);
  });
  it.each([null, [], { temperature: -0.1 }, { temperature: 2.1 }, { temperature: Infinity }, { temperature: NaN },
    { temperature: "1" }, { temperature: undefined }, { safetyThreshold: "automatic" }, { outputMode: "TEXT" }, { unknown: true }])
    ("rejects invalid Gemini settings before dispatch: %j", async gemini => {
      const fetcher = vi.fn();
      await expect(createGeminiImageTransport(fetcher).generate({ ...parameters, gemini } as DrawingParameters,
        "test", new AbortController().signal)).rejects.toThrow("Gemini");
      expect(fetcher).not.toHaveBeenCalled();
    });
  it("submits long trimmed Gemini prompts without the OpenAI character cap", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));
    const prompt = "字😀".repeat(32_001);
    await createGeminiImageTransport(fetcher).generate({ ...parameters, prompt: ` \n${prompt}\n ` }, "test", new AbortController().signal);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).contents[0].parts[0].text).toBe(prompt);
    expect(fetcher).toHaveBeenCalledOnce();
    const emptyFetcher = vi.fn();
    await expect(createGeminiImageTransport(emptyFetcher).generate({ ...parameters, prompt: " \n " }, "test",
      new AbortController().signal)).rejects.toThrow("提示词不能为空");
    expect(emptyFetcher).not.toHaveBeenCalled();
  });
  it("normalizes CR/LF and matching image data URLs while retaining all non-thought images", () => {
    expect(parseGeminiImages({ candidates: [{ content: { parts: [
      { inlineData: { mimeType: "image/png", data: "data:image/png;base64,AQ\r\nID" } },
      { inline_data: { mime_type: "image/jpeg", data: "BA\nUG\r" } },
    ] } }] })).toEqual([{ mime: "image/png", data: "AQID" }, { mime: "image/jpeg", data: "BAUG" }]);
  });
  it.each(["data:image/jpeg;base64,AQID", "data:image/svg+xml;base64,AQID", "AB==", "AAF=", "AQ ID", "https://remote-image.test"])
    ("rejects invalid wrappers, MIME mismatch and noncanonical bytes: %s", data => {
      expect(() => parseGeminiImages({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data } }] } }] }))
        .toThrow(ImageGenerationError);
    });
  it("keeps Gemini output count and aggregate byte budgets after normalization", () => {
    const result = (data: string[]) => ({ candidates: [{ content: { parts: data.map(data => ({ inlineData: { mimeType: "image/png", data } })) } }] });
    expect(() => parseGeminiImages(result(Array.from({ length: 9 }, () => "AQ\r\nID")))).toThrow(ImageGenerationError);
    const maximum = "A".repeat(Math.ceil(32 * 1024 * 1024 / 3) * 4 - 1) + "=";
    expect(parseGeminiImages(result([maximum, maximum]))).toHaveLength(2);
    expect(() => parseGeminiImages(result([maximum, maximum, "AA=="]))).toThrow(ImageGenerationError);
  });
  it("sends ordered original references without preprocessing or input-count caps", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));
    const references = Array.from({ length: 10 }, (_, index) => ({ mime: index % 2 ? "image/bmp" : "image/png", data: btoa(`original-${index}`) }));
    await createGeminiImageTransport(fetcher).generate(parameters, "test", new AbortController().signal, references);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).contents[0].parts).toEqual([
      { text: parameters.prompt }, ...references.map(image => ({ inlineData: { mimeType: image.mime, data: image.data } })),
    ]);
  });
  it.each(["1:1", "1:4", "4:1", "1:8", "8:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"])("maps the current documented ratio %s and literal 512 size", async aspectRatio => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));
    await createGeminiImageTransport(fetcher).generate({ ...parameters, aspectRatio, resolution: "512" }, "test", new AbortController().signal);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).generationConfig.imageConfig).toEqual({ aspectRatio, imageSize: "512" });
  });
  it("uses the shared non-stream endpoint and key header, freezes a single request, maps only image parameters", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));
    const signal = new AbortController().signal;
    const images = await createGeminiImageTransport(fetcher).generate(parameters, "synthetic-key", signal);
    expect(images).toEqual([{ mime: "image/png", data: "AQID" }]);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://example.test/v1beta/models/gemini-image-test:generateContent");
    expect(url).not.toContain("synthetic-key");
    expect(init).toMatchObject({ method: "POST", redirect: "error", headers: { "x-goog-api-key": "synthetic-key" } });
    expect(JSON.parse(init.body)).toEqual({ contents: [{ role: "user", parts: [{ text: "A synthetic square" }] }],
      generationConfig: { candidateCount: 1, responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "2K" } } });
  });
  it("omits automatic parameters and keeps every output image while excluding thought images", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [
      { thought: true, inlineData: image }, { inlineData: image }, { inline_data: { mime_type: "image/jpeg", data: "BAUG" } },
    ] } }] })));
    expect(await createGeminiImageTransport(fetcher).generate({ ...parameters, aspectRatio: "auto", resolution: "auto" }, "test", new AbortController().signal)).toHaveLength(2);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).generationConfig).not.toHaveProperty("imageConfig");
  });
  it.each([
    [null, "无效响应"], [{ candidates: [] }, "候选"], [{ promptFeedback: { blockReason: "SAFETY" } }, "拦截"],
    [{ candidates: [{ finishReason: "SAFETY" }] }, "拦截"], [{ candidates: [{ content: { parts: [{ text: "cannot" }] } }] }, "未返回图片"],
    [{ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/svg+xml", data: "AQID" } }] } }] }, "无效"],
    [{ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "bad!" } }] } }] }, "无效"],
  ])("rejects blocked/no image/malformed results without fallback", (value, message) => {
    expect(() => parseGeminiImages(value)).toThrow(message as string);
  });
  it.each([400, 429, 500])("never retries HTTP %s or exposes server echoes", async status => {
    const fetcher = vi.fn().mockResolvedValue(new Response("synthetic-secret-key private prompt", { status }));
    try { await createGeminiImageTransport(fetcher).generate(parameters, "synthetic-secret-key", new AbortController().signal); throw new Error("expected failure"); }
    catch (error) { expect(error).toBeInstanceOf(ImageGenerationError); expect(String(error)).not.toMatch(/secret|private prompt/); expect((error as ImageGenerationError).outcome).toBe(status === 500 ? "unknown" : "failed");
      expect(error).toMatchObject({ category: status === 429 ? "rate-limited" : status === 500 ? "network-unknown" : "rejected", httpStatus: status }); }
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("rejects malformed JSON and excessive body headers without requesting again", async () => {
    for (const response of [new Response("{broken"), new Response("{}", { headers: { "content-length": String(100 * 1024 * 1024) } })]) {
      const fetcher = vi.fn().mockResolvedValue(response);
      await expect(createGeminiImageTransport(fetcher).generate(parameters, "test", new AbortController().signal)).rejects.toBeInstanceOf(ImageGenerationError);
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });
  it("refuses invalid URL/empty key before sending and treats network throws as unknown, with redaction", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("synthetic-secret in stack"));
    const transport = createGeminiImageTransport(fetcher);
    await expect(transport.generate({ ...parameters, baseUrl: "http://example.test" }, "test", new AbortController().signal)).rejects.toThrow();
    await expect(transport.generate(parameters, "", new AbortController().signal)).rejects.toThrow("API Key");
    expect(fetcher).not.toHaveBeenCalled();
    await expect(transport.generate(parameters, "synthetic-secret", new AbortController().signal)).rejects.toMatchObject({ outcome: "unknown" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("cancels a stalled body once with no retries", async () => {
    const cancel = vi.fn(), controller = new AbortController();
    const fetcher = vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const pending = createGeminiImageTransport(fetcher).generate(parameters, "test", controller.signal);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ outcome: "unknown" });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
