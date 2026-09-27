import { describe, expect, it } from "vitest";
import { buildProtocolBody, parameterCapability, parseCustomBody, RequestConfigError, validateRequestConfig } from "./requestMapping";
import { defaultSessionConfig, type SessionConfig } from "./sessionConfig";
import type { ChatProtocol, ChatRequest } from "./types";

const request: ChatRequest = {
  baseUrl: "https://relay.example",
  apiKey: "synthetic",
  model: "unlisted-model",
  messages: [{ role: "user", content: "Hello" }],
};

function configured(): SessionConfig {
  return {
    ...defaultSessionConfig(),
    systemInstruction: "Answer briefly.",
    temperature: { mode: "custom", value: "0.5" },
    topP: { mode: "custom", value: "0.8" },
    topK: { mode: "custom", value: "20" },
    maxOutput: { mode: "custom", value: "128" },
    dualSamplingConfirmed: true,
  };
}

describe("protocol request mapping", () => {
  it("sends Office unchanged through Responses and blocks incompatible history or oversized files", () => {
    const attachment = { name: "report.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const,
      size: 5, data: "UEsDBAE=" };
    const attached: ChatRequest = { ...request, messages: [
      { role: "user", content: "previous", attachments: [attachment] },
      { role: "assistant", content: "ok" }, { role: "user", content: "continue" },
    ] };
    const body = buildProtocolBody("openai-responses", attached);
    expect(body.store).toBe(false);
    expect(body.input).toMatchObject([{ content: [
      { type: "input_text" }, { type: "input_file", filename: attachment.name,
        file_data: `data:${attachment.mimeType};base64,${attachment.data}` },
    ] }, {}, {}]);
    for (const protocol of ["openai-chat", "gemini-native", "anthropic-native"] as const) {
      expect(() => buildProtocolBody(protocol, attached)).toThrow("Office 附件仅支持 Responses");
    }
    expect(() => buildProtocolBody("openai-responses", { ...request, messages: [
      { role: "user", content: "", attachments: [{ ...attachment, size: 50_000_000 }] },
    ] })).toThrow("50 MB");
  });
  it("maps images, PDFs and UTF-8 documents inline for each protocol without provider uploads", () => {
    const image = { name: "view.png", mimeType: "image/png" as const, size: 3, data: "AQID" };
    const pdf = { name: "report.pdf", mimeType: "application/pdf" as const, size: 5, data: "JVBERi0=" };
    const text = { name: "note.txt", mimeType: "text/plain" as const, size: 2, data: "SGk=" };
    const attached = { ...request, messages: [{ role: "user" as const, content: "Explain", attachments: [image, pdf, text] }] };
    const chat = buildProtocolBody("openai-chat", attached);
    expect(chat.messages).toMatchObject([{ role: "user", content: [
      { type: "text", text: "Explain" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
      { type: "file", file: { filename: "report.pdf", file_data: "data:application/pdf;base64,JVBERi0=" } },
      { type: "text", text: expect.stringContaining("Hi") },
    ] }]);
    const responses = buildProtocolBody("openai-responses", attached);
    expect(responses.input).toMatchObject([{ role: "user", content: [
      { type: "input_text", text: "Explain" },
      { type: "input_image", image_url: "data:image/png;base64,AQID" },
      { type: "input_file", filename: "report.pdf", file_data: "data:application/pdf;base64,JVBERi0=" },
      { type: "input_text", text: expect.stringContaining("Hi") },
    ] }]);
    const gemini = buildProtocolBody("gemini-native", attached);
    expect(gemini.contents).toMatchObject([{ role: "user", parts: [
      { text: "Explain" }, { inlineData: { mimeType: "image/png", data: "AQID" } },
      { inlineData: { mimeType: "application/pdf", data: "JVBERi0=" } },
      { text: expect.stringContaining("Hi") },
    ] }]);
    const anthropic = buildProtocolBody("anthropic-native", attached);
    expect(anthropic.messages).toMatchObject([{ role: "user", content: [
      { type: "text", text: "Explain" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } },
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0=" } },
      { type: "text", text: expect.stringContaining("Hi") },
    ] }]);
  });

  it("rejects a reference without loaded bytes and an Anthropic body beyond 32MB before fetch", () => {
    expect(() => buildProtocolBody("openai-chat", { ...request, messages: [{ role: "user", content: "hi",
      attachments: [{ reference: "attachments/test.pdf", name: "test.pdf", mimeType: "application/pdf", size: 1 }] }] })).toThrow(RequestConfigError);
    const data = "A".repeat(32_000_000);
    expect(() => buildProtocolBody("anthropic-native", { ...request, messages: [{ role: "user", content: "hi",
      attachments: [{ name: "large.pdf", mimeType: "application/pdf", size: 10_000_000, data }] }] })).toThrow(RequestConfigError);
  });

  it("uses Anthropic's encoded image limit instead of the former app file limit", () => {
    const data = "A".repeat(10_000_001);
    expect(() => buildProtocolBody("anthropic-native", { ...request, messages: [{ role: "user", content: "look",
      attachments: [{ name: "view.jpg", mimeType: "image/jpeg", size: 7_500_000, data }] }] }))
      .toThrow(/Anthropic.*10 MB/);
  });

  it("applies Gemini's official 20 MB inline request limit", () => {
    const data = "A".repeat(20_000_001);
    expect(() => buildProtocolBody("gemini-native", { ...request, messages: [{ role: "user", content: "look",
      attachments: [{ name: "view.jpg", mimeType: "image/jpeg", size: 15_000_000, data }] }] }))
      .toThrow(/Gemini.*20 MB/);
  });

  it("blocks a documented text-only OpenAI model with image or PDF before transport", () => {
    const image = { name: "view.png", mimeType: "image/png" as const, size: 3, data: "AQID" };
    for (const protocol of ["openai-chat", "openai-responses"] as const) {
      expect(() => buildProtocolBody(protocol, { ...request, model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: "look", attachments: [image] }] })).toThrow(RequestConfigError);
    }
  });

  it("does not apply the old 32 MB app request limit to OpenAI", () => {
    const data = "A".repeat(32_000_000);
    for (const protocol of ["openai-chat", "openai-responses"] as const) {
      expect(() => buildProtocolBody(protocol, { ...request, messages: [{ role: "user", content: "hi",
        attachments: [{ name: "large.pdf", mimeType: "application/pdf", size: 24_000_000, data }] }] })).not.toThrow();
    }
  });

  it("applies OpenAI's official 50 MB combined file-input limit", () => {
    for (const protocol of ["openai-chat", "openai-responses"] as const) {
      expect(() => buildProtocolBody(protocol, { ...request, messages: [{ role: "user", content: "read",
        attachments: [
          { name: "first.pdf", mimeType: "application/pdf", size: 30_000_000, data: "AQID" },
          { name: "second.pdf", mimeType: "application/pdf", size: 20_000_001, data: "AQID" },
        ] }] })).toThrow(/OpenAI.*50 MB/);
    }
  });

  it("does not confuse an empty but loaded image with an unread attachment reference", () => {
    expect(buildProtocolBody("openai-chat", { ...request, messages: [{ role: "user", content: "inspect",
      attachments: [{ name: "empty.png", mimeType: "image/png", size: 0, data: "" }] }] }).messages)
      .toMatchObject([{ role: "user", content: [{ type: "text", text: "inspect" },
        { type: "image_url", image_url: { url: "data:image/png;base64," } }] }]);
  });
  it("omits optional auto fields and uses only the labelled Anthropic fallback", () => {
    for (const protocol of ["openai-chat", "openai-responses", "gemini-native", "anthropic-native"] as ChatProtocol[]) {
      const body = buildProtocolBody(protocol, request);
      expect(JSON.stringify(body)).not.toMatch(/temperature|top_p|topP|topK/);
      if (protocol === "anthropic-native") expect(body.max_tokens).toBe(4096);
      else expect(JSON.stringify(body)).not.toMatch(/max_completion_tokens|max_output_tokens|maxOutputTokens/);
    }
  });

  it("maps custom values to four distinct protocol bodies", () => {
    const config = configured();
    const openaiConfig = { ...config, topK: { mode: "auto" as const } };
    expect(buildProtocolBody("openai-chat", { ...request, config: openaiConfig })).toMatchObject({
      messages: [{ role: "system", content: "Answer briefly." }, { role: "user", content: "Hello" }],
      temperature: 0.5, top_p: 0.8, max_completion_tokens: 128, stream: true,
    });
    expect(buildProtocolBody("openai-responses", { ...request, config: openaiConfig })).toMatchObject({
      instructions: "Answer briefly.", store: false, temperature: 0.5, top_p: 0.8, max_output_tokens: 128,
    });
    expect(buildProtocolBody("gemini-native", { ...request, config })).toMatchObject({
      systemInstruction: { parts: [{ text: "Answer briefly." }] },
      generationConfig: { temperature: 0.5, topP: 0.8, topK: 20, maxOutputTokens: 128 },
    });
    expect(buildProtocolBody("anthropic-native", { ...request, config })).toMatchObject({
      system: "Answer briefly.", temperature: 0.5, top_p: 0.8, top_k: 20, max_tokens: 128,
    });
  });

  it("does not invent an Anthropic Top-K maximum or reject its documented zero", () => {
    for (const value of ["0", "1001"]) {
      const config = { ...defaultSessionConfig(), topK: { mode: "custom" as const, value } };
      expect(buildProtocolBody("anthropic-native", { ...request, config }).top_k).toBe(Number(value));
    }
  });

  it("keeps Top-K unavailable for OpenAI because it has no mapped request field", () => {
    expect(parameterCapability("openai-chat", "any", "topK").support).toBe("unsupported");
    expect(parameterCapability("openai-responses", "gpt-5.6-sol", "topK").support).toBe("unsupported");
    expect(parameterCapability("gemini-native", "any", "topK").support).toBe("unknown");
    expect(validateRequestConfig({ ...defaultSessionConfig(), topK: { mode: "custom", value: "20" } }, "openai-chat", "x").topK).toBeTruthy();
    expect(parameterCapability("anthropic-native", "claude-opus-5", "temperature").support).toBe("unknown");
    expect(parameterCapability("gemini-native", "arbitrary-relay", "topP").support).toBe("unknown");
  });

  it.each(["gpt-5.6-sol", "relay-unlisted"])("forwards valid OpenAI sampling for %s", (model) => {
    const config = { ...defaultSessionConfig(), temperature: { mode: "custom" as const, value: "0.5" } };
    for (const protocol of ["openai-chat", "openai-responses"] as const) {
      expect(parameterCapability(protocol, model, "temperature").support).toBe("unknown");
      expect(validateRequestConfig(config, protocol, model).temperature).toBeUndefined();
      expect(buildProtocolBody(protocol, { ...request, model, config }).temperature).toBe(0.5);
    }
  });

  it.each([
    ["openai-chat", '{"model":"other"}'],
    ["openai-responses", '{"previous_response_id":"remote"}'],
    ["openai-responses", '{"store":true}'],
    ["gemini-native", '{"generationConfig":{"maxOutputTokens":999}}'],
    ["gemini-native", '{"tools":[{"type":"web_search"}]}'],
    ["anthropic-native", '{"stream":false}'],
    ["openai-chat", '{"max_tokens":999}'],
    ["openai-chat", '{"metadata":{"headers":"bad"}}'],
  ] as [ChatProtocol, string][])("rejects protected custom JSON in %s", (protocol, json) => {
    expect(() => parseCustomBody(protocol, json)).toThrow(RequestConfigError);
  });

  it("merges only the current protocol's safe custom JSON", () => {
    const config = {
      ...defaultSessionConfig(),
      customJson: { ...defaultSessionConfig().customJson,
        "openai-chat": '{"seed":7}',
        "gemini-native": '{"generationConfig":{"stopSequences":["END"]}}',
      },
    };
    expect(buildProtocolBody("openai-chat", { ...request, config }).seed).toBe(7);
    expect(buildProtocolBody("gemini-native", { ...request, config }).generationConfig).toEqual({ stopSequences: ["END"] });
    expect(buildProtocolBody("anthropic-native", { ...request, config })).not.toHaveProperty("seed");
  });
});
