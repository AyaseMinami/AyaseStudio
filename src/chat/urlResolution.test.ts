import { describe, expect, it } from "vitest";

import type { ChatProtocol } from "./types";
import {
  normalizeBaseUrl,
  resolveGrokImagesEndpoint,
  resolveSeedreamImagesEndpoint,
  resolveGenerationEndpoint,
  resolveImageGenerationEndpoint,
  resolveModelCatalogEndpoint,
  UrlResolutionError,
} from "./urlResolution";

describe("protocol-aware URL resolution", () => {
  it("uses the documented DeepSeek root without changing explicit or relay paths", () => {
    for (const protocol of ["openai-chat", "openai-responses"] as const) {
      const endpoint = protocol === "openai-chat" ? "chat/completions" : "responses";
      expect(resolveGenerationEndpoint(protocol, "https://api.deepseek.com/").resolvedEndpoint).toBe(`https://api.deepseek.com/${endpoint}`);
      expect(resolveModelCatalogEndpoint(protocol, "https://api.deepseek.com").resolvedEndpoint).toBe("https://api.deepseek.com/models");
      expect(resolveGenerationEndpoint(protocol, "https://api.deepseek.com/v1").resolvedEndpoint).toBe(`https://api.deepseek.com/v1/${endpoint}`);
      expect(resolveGenerationEndpoint(protocol, "https://synthetic.invalid").resolvedEndpoint).toBe(`https://synthetic.invalid/v1/${endpoint}`);
    }
  });
  it.each([
    ["https://open.bigmodel.cn/api/paas/v4", "https://open.bigmodel.cn/api/paas/v4/models"],
    ["https://ark.cn-beijing.volces.com/api/v3", "https://ark.cn-beijing.volces.com/api/v3/models"],
    ["https://generativelanguage.googleapis.com/v1beta/openai", "https://generativelanguage.googleapis.com/v1beta/openai/models"],
    ["https://synthetic.invalid/custom", "https://synthetic.invalid/custom/v1/models"],
  ])("preserves explicit catalog version prefixes in %s", (base, endpoint) => {
    expect(resolveModelCatalogEndpoint("openai-chat", base).resolvedEndpoint).toBe(endpoint);
  });
  it("shares Grok/Seedream HTTPS routes with settings, preserving relay prefixes", () => {
    expect(resolveGrokImagesEndpoint("https://api.x.ai", "alias")).toBe("https://api.x.ai/v1/images/generations");
    expect(resolveGrokImagesEndpoint("https://relay.test/custom///", "alias", "edits")).toBe("https://relay.test/custom/images/edits");
    expect(resolveSeedreamImagesEndpoint("https://ark.cn-beijing.volces.com", "alias")).toBe("https://ark.cn-beijing.volces.com/api/v3/images/generations");
    expect(resolveSeedreamImagesEndpoint("https://relay.test/custom/api/v3///", "alias")).toBe("https://relay.test/custom/api/v3/images/generations");
    expect(() => resolveModelCatalogEndpoint("seedream-images", "https://relay.test")).toThrow("手动添加");
    for (const resolve of [resolveGrokImagesEndpoint, resolveSeedreamImagesEndpoint]) {
      for (const base of ["http://relay.test", "https://u:p@relay.test", "https://relay.test?key=x", "https://relay.test#x"]) expect(() => resolve(base, "alias")).toThrow();
      expect(() => resolve("https://relay.test", " ")).toThrow();
    }
  });
  it("resolves drawing to the native non-streaming HTTPS endpoint with a trimmed encoded model", () => {
    expect(resolveImageGenerationEndpoint(" https://relay.example.com/custom/v1beta/// ", "  image/model ?#  "))
      .toBe("https://relay.example.com/custom/v1beta/models/image%2Fmodel%20%3F%23:generateContent");
    expect(normalizeBaseUrl("gemini-image", "https://relay.example.com///")).toBe("https://relay.example.com");
    expect(resolveModelCatalogEndpoint("gemini-image", "https://relay.example.com").resolvedEndpoint)
      .toBe("https://relay.example.com/v1beta/models");
  });

  it.each([
    ["http://localhost:1234", "image", "invalid-scheme"],
    ["http://relay.example.com", "image", "invalid-scheme"],
    ["https://name:password@relay.example.com", "image", "userinfo"],
    ["https://relay.example.com?key=secret", "image", "query"],
    ["https://relay.example.com#fragment", "image", "fragment"],
    ["https://relay.example.com", "  ", "missing-model"],
  ])("rejects invalid drawing endpoint %s with model %s", (base, model, code) => {
    expect(() => resolveImageGenerationEndpoint(base, model)).toThrow(expect.objectContaining({ code }));
  });
  it.each([
    ["openai-chat", "  https://relay.example.com///  ", "https://relay.example.com/v1", "https://relay.example.com/v1/chat/completions"],
    ["openai-responses", "https://relay.example.com/v1//", "https://relay.example.com/v1", "https://relay.example.com/v1/responses"],
    ["openai-chat", "https://relay.example.com/custom/v1/", "https://relay.example.com/custom/v1", "https://relay.example.com/custom/v1/chat/completions"],
    ["openai-responses", "https://relay.example.com:8443/custom///", "https://relay.example.com:8443/custom", "https://relay.example.com:8443/custom/responses"],
    ["gemini-native", "https://relay.example.com/", "https://relay.example.com", "https://relay.example.com/v1beta/models/model%2Fwith%20space:streamGenerateContent?alt=sse"],
    ["gemini-native", "https://relay.example.com/custom/v1beta//", "https://relay.example.com/custom/v1beta", "https://relay.example.com/custom/v1beta/models/model%2Fwith%20space:streamGenerateContent?alt=sse"],
    ["anthropic-native", "https://relay.example.com///", "https://relay.example.com", "https://relay.example.com/v1/messages"],
    ["anthropic-native", "https://relay.example.com:8443/custom/v1/", "https://relay.example.com:8443/custom/v1", "https://relay.example.com:8443/custom/v1/messages"],
  ] satisfies [ChatProtocol, string, string, string][])(
    "%s resolves %s without changing the configured URL",
    (protocol, configured, base, endpoint) => {
      const model = protocol === "gemini-native" ? "model/with space" : undefined;
      const resolved = resolveGenerationEndpoint(protocol, configured, model);
      expect(resolved).toEqual({
        normalizedBaseUrl: base,
        resolvedEndpoint: endpoint,
      });
      expect(normalizeBaseUrl(protocol, resolved.normalizedBaseUrl)).toBe(base);
      expect(resolveGenerationEndpoint(protocol, base, model)).toEqual(resolved);
    },
  );

  it.each([
    ["openai-chat", "https://relay.example.com/v1/models"],
    ["openai-responses", "https://relay.example.com/v1/models"],
    ["gemini-native", "https://relay.example.com/v1beta/models"],
    ["anthropic-native", "https://relay.example.com/v1/models"],
  ] satisfies [ChatProtocol, string][])(
    "%s uses the same normalized base for catalog requests",
    (protocol, endpoint) => {
      expect(resolveModelCatalogEndpoint(protocol, " https://relay.example.com/// ")).toEqual({
        normalizedBaseUrl: normalizeBaseUrl(
          protocol,
          " https://relay.example.com/// ",
        ),
        resolvedEndpoint: endpoint,
      });
    },
  );

  it.each([
    ["not-a-url", "invalid-url"],
    ["file:///tmp/models", "invalid-scheme"],
    ["https://relay.example.com/?x=1", "query"],
    ["https://relay.example.com/?", "query"],
    ["https://relay.example.com/#section", "fragment"],
    ["https://relay.example.com/#", "fragment"],
    ["https://relay.example.com/#section?inside-fragment", "fragment"],
    ["https://name:password@relay.example.com", "userinfo"],
  ] satisfies [string, UrlResolutionError["code"]][])(
    "rejects %s before an endpoint can be used",
    (configured, code) => {
      expect(() => normalizeBaseUrl("openai-chat", configured)).toThrow(
        expect.objectContaining({ name: "UrlResolutionError", code }),
      );
    },
  );

  it("requires a concrete Gemini model to name a final endpoint", () => {
    expect(() =>
      resolveGenerationEndpoint("gemini-native", "https://relay.example.com"),
    ).toThrow(
      expect.objectContaining({ name: "UrlResolutionError", code: "missing-model" }),
    );
  });
});
