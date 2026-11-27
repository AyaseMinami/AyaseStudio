import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: native.fetch }));

import { createRuntimeChatTransport, createRuntimeModelCatalogClient } from "./runtime";
import { defaultSessionConfig } from "./sessionConfig";

beforeEach(() => {
  native.fetch.mockReset();
});

describe("chat runtime fetch guard", () => {
  it.each(["openai-chat", "openai-responses", "gemini-native", "anthropic-native"] as const)(
    "disables redirects at both native and fetch layers for %s chat transport",
    async (protocol) => {
      native.fetch.mockResolvedValueOnce(
        new Response("redirect body", { status: 302, headers: { Location: "https://evil.example" } }),
      );
      const transport = await createRuntimeChatTransport(protocol);
      const events = [];
      for await (const event of transport.stream({
        baseUrl: "https://relay.example/v1",
        apiKey: "secret-chat-key",
        model: "test-model",
        messages: [{ role: "user", content: "hi" }],
        config: { ...defaultSessionConfig(), stream: false },
      })) {
        events.push(event);
      }
      expect(native.fetch).toHaveBeenCalledOnce();
      expect(native.fetch.mock.calls[0][1]).toMatchObject({
        maxRedirections: 0,
        redirect: "error",
      });
      expect(events).toMatchObject([{ type: "failed", error: { kind: "http", status: 302, retryable: false } }]);
    },
  );

  it.each(["openai-chat", "openai-responses", "gemini-native", "anthropic-native"] as const)(
    "disables redirects at both native and fetch layers for %s model catalog client",
    async (protocol) => {
      native.fetch.mockResolvedValueOnce(
        new Response("redirect body", { status: 301, headers: { Location: "https://evil.example" } }),
      );
      const client = await createRuntimeModelCatalogClient(protocol);
      await expect(
        client.list({ baseUrl: "https://relay.example/v1", apiKey: "secret-catalog-key" }),
      ).rejects.toMatchObject({ name: "ModelCatalogError", status: 301 });
      expect(native.fetch).toHaveBeenCalledOnce();
      expect(native.fetch.mock.calls[0][1]).toMatchObject({
        maxRedirections: 0,
        redirect: "error",
      });
    },
  );
});
