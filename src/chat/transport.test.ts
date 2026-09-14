import { describe, expect, it } from "vitest";

import { createChatTransport } from "./transport";
import type { ChatEvent, ChatRequest, FetchLike } from "./types";

const request: ChatRequest = {
  baseUrl: "https://relay.example/v1",
  apiKey: "test-key",
  model: "test-model",
  messages: [{ role: "user", content: "Say hello" }],
};

function sseResponse(records: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const record of records) {
        controller.enqueue(encoder.encode(record));
      }
      controller.close();
    },
  });

  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

async function collectEvents(
  protocol: Parameters<typeof createChatTransport>[0],
  fetch: FetchLike,
  chatRequest: ChatRequest = request,
): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  const transport = createChatTransport(protocol, { fetch });

  for await (const event of transport.stream(chatRequest)) {
    events.push(event);
  }

  return events;
}

describe("ChatTransport", () => {
  it("streams OpenAI Chat text in order and completes once", async () => {
    const fetch: FetchLike = async (_input, init) => {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        max_completion_tokens: 8,
      });
      return sseResponse([
        'data: {"id":"one","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{"content":"Hel"},"finish_reason":null}]}\n\n',
        'data: {"id":"one","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ]);
    };

    await expect(
      collectEvents("openai-chat", fetch, { ...request, maxOutputTokens: 8 }),
    ).resolves.toEqual([
      { type: "text-delta", text: "Hel" },
      { type: "text-delta", text: "lo" },
      { type: "completed", finishReason: "stop" },
    ]);
  });

  it("preserves OpenAI Chat refusal text", async () => {
    const fetch: FetchLike = async () =>
      sseResponse([
        'data: {"id":"one","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{"refusal":"I can’t help with that."},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ]);

    await expect(collectEvents("openai-chat", fetch)).resolves.toEqual([
      { type: "text-delta", text: "I can’t help with that." },
      { type: "completed", finishReason: "stop" },
    ]);
  });

  it("normalizes an HTTP 429 without waiting for a real provider failure", async () => {
    let requestCount = 0;
    const fetch: FetchLike = async () => {
      requestCount += 1;
      return new Response(
        JSON.stringify({ error: { message: "Synthetic rate limit" } }),
        {
          status: 429,
          headers: { "content-type": "application/json" },
        },
      );
    };

    const events = await collectEvents("openai-chat", fetch);

    expect(requestCount).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "failed",
      error: { kind: "rate-limit", status: 429, retryable: true },
    });
  });

  it("normalizes an HTTP 500 as a retryable server failure", async () => {
    const fetch: FetchLike = async () =>
      new Response("upstream unavailable", { status: 500 });

    const events = await collectEvents("openai-chat", fetch);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "failed",
      error: { kind: "server", status: 500, retryable: true },
    });
  });

  it("ends with aborted when the caller cancels an in-flight request", async () => {
    const controller = new AbortController();
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const fetch: FetchLike = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        markStarted?.();
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Synthetic cancellation", "AbortError")),
          { once: true },
        );
      });

    const eventsPromise = collectEvents("openai-chat", fetch, {
      ...request,
      signal: controller.signal,
    });
    await started;
    controller.abort();

    await expect(eventsPromise).resolves.toEqual([{ type: "aborted" }]);
  });

  it("preserves partial text when cancellation happens after streaming starts", async () => {
    const controller = new AbortController();
    const fetch: FetchLike = async (_input, init) => {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(
            encoder.encode(
              'data: {"id":"one","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}\n\n',
            ),
          );
          init?.signal?.addEventListener(
            "abort",
            () =>
              streamController.error(
                new DOMException("Synthetic cancellation", "AbortError"),
              ),
            { once: true },
          );
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };

    const transport = createChatTransport("openai-chat", { fetch });
    const iterator = transport.stream({
      ...request,
      signal: controller.signal,
    })[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { type: "text-delta", text: "partial" },
    });
    controller.abort();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { type: "aborted" },
    });
    await expect(iterator.next()).resolves.toEqual({ done: true });
  });

  it("streams OpenAI Responses text while ignoring relay-specific events", async () => {
    const fetch: FetchLike = async (input, init) => {
      expect(String(input)).toBe("https://relay.example/v1/responses");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: "test-model",
        stream: true,
        store: false,
      });

      return sseResponse([
        'event: codex.rate_limits\ndata: {"type":"codex.rate_limits","remaining":99}\n\n',
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hi","item_id":"m1","output_index":0,"content_index":0}\n\n',
        'event: codex.response.metadata\ndata: {"type":"codex.response.metadata","trace":"opaque"}\n\n',
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"!","item_id":"m1","output_index":0,"content_index":0}\n\n',
        'event: response.completed\ndata: {"type":"response.completed","response":{"id":"r1","status":"completed","usage":{"input_tokens":3,"output_tokens":2,"total_tokens":5}}}\n\n',
      ]);
    };

    await expect(collectEvents("openai-responses", fetch)).resolves.toEqual([
      { type: "text-delta", text: "Hi" },
      { type: "text-delta", text: "!" },
      {
        type: "completed",
        usage: { inputTokens: 3, outputTokens: 2 },
      },
    ]);
  });

  it("preserves OpenAI Responses refusal text", async () => {
    const fetch: FetchLike = async () =>
      sseResponse([
        'event: response.refusal.delta\ndata: {"type":"response.refusal.delta","delta":"I can’t help with that.","item_id":"m1","output_index":0,"content_index":0}\n\n',
        'event: response.completed\ndata: {"type":"response.completed","response":{"id":"r1","status":"completed"}}\n\n',
      ]);

    await expect(collectEvents("openai-responses", fetch)).resolves.toEqual([
      { type: "text-delta", text: "I can’t help with that." },
      { type: "completed" },
    ]);
  });

  it("maps Gemini native SSE chunks into neutral text events", async () => {
    const fetch: FetchLike = async (input, init) => {
      expect(String(input)).toBe(
        "https://relay.example/v1beta/models/test-model:streamGenerateContent?alt=sse",
      );
      expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("test-key");
      expect(JSON.parse(String(init?.body))).toEqual({
        contents: [{ role: "user", parts: [{ text: "Say hello" }] }],
      });

      return sseResponse([
        'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Ge"}]}}]}\r\n',
        '\r\ndata: {"candidates":[{"content":{"role":"model","parts":[{"text":"mini"}]},"finishReason":"STOP"}]}\r\n\r\n',
      ]);
    };

    await expect(
      collectEvents("gemini-native", fetch, {
        ...request,
        baseUrl: "https://relay.example",
      }),
    ).resolves.toEqual([
      { type: "text-delta", text: "Ge" },
      { type: "text-delta", text: "mini" },
      { type: "completed", finishReason: "STOP" },
    ]);
  });

  it("maps Anthropic native message events and ignores ping events", async () => {
    const fetch: FetchLike = async (input, init) => {
      expect(String(input)).toBe("https://relay.example/v1/messages");
      const headers = new Headers(init?.headers);
      expect(headers.get("x-api-key")).toBe("test-key");
      expect(headers.get("anthropic-version")).toBe("2023-06-01");
      expect(JSON.parse(String(init?.body))).toEqual({
        model: "test-model",
        max_tokens: 128,
        stream: true,
        system: "Be concise",
        messages: [{ role: "user", content: "Say hello" }],
      });

      return sseResponse([
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":7,"output_tokens":0}}}\n\n',
        'event: ping\ndata: {"type":"ping"}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Anth"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ropic"}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ]);
    };

    await expect(
      collectEvents("anthropic-native", fetch, {
        ...request,
        baseUrl: "https://relay.example",
        maxOutputTokens: 128,
        messages: [
          { role: "system", content: "Be concise" },
          { role: "user", content: "Say hello" },
        ],
      }),
    ).resolves.toEqual([
      { type: "text-delta", text: "Anth" },
      { type: "text-delta", text: "ropic" },
      {
        type: "completed",
        finishReason: "end_turn",
        usage: { inputTokens: 7, outputTokens: 4 },
      },
    ]);
  });

  it("reports malformed Gemini SSE data as a protocol failure", async () => {
    const fetch: FetchLike = async () =>
      sseResponse(['data: {"candidates": broken}\n\n']);

    const events = await collectEvents("gemini-native", fetch, {
      ...request,
      baseUrl: "https://relay.example",
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "failed",
      error: { kind: "protocol", retryable: false },
    });
  });

  it("does not turn a Responses failure event into a successful completion", async () => {
    const fetch: FetchLike = async () =>
      sseResponse([
        'event: response.failed\ndata: {"type":"response.failed","response":{"id":"r1","status":"failed","error":{"code":"server_error","message":"Synthetic provider failure"}}}\n\n',
      ]);

    const events = await collectEvents("openai-responses", fetch);

    expect(events).toEqual([
      {
        type: "failed",
        error: {
          kind: "server",
          message: "Synthetic provider failure",
          retryable: true,
        },
      },
    ]);
  });

  it("normalizes a fetch rejection as a retryable network failure", async () => {
    const fetch: FetchLike = async () => {
      throw new Error("Synthetic connection loss");
    };

    const events = await collectEvents("openai-chat", fetch);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "failed",
      error: { kind: "network", retryable: true },
    });
  });

  it("reports a Responses stream that closes without a terminal event", async () => {
    const fetch: FetchLike = async () =>
      sseResponse([
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"partial","item_id":"m1","output_index":0,"content_index":0}\n\n',
      ]);

    const events = await collectEvents("openai-responses", fetch);

    expect(events).toEqual([
      { type: "text-delta", text: "partial" },
      {
        type: "failed",
        error: {
          kind: "protocol",
          message: "Responses stream ended before a terminal event",
          retryable: true,
        },
      },
    ]);
  });

  it("keeps partial Responses output when the provider reports incomplete", async () => {
    const fetch: FetchLike = async () =>
      sseResponse([
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"partial","item_id":"m1","output_index":0,"content_index":0}\n\n',
        'event: response.incomplete\ndata: {"type":"response.incomplete","response":{"id":"r1","status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"usage":{"input_tokens":5,"output_tokens":8,"total_tokens":13}}}\n\n',
      ]);

    const events = await collectEvents("openai-responses", fetch);

    expect(events).toEqual([
      { type: "text-delta", text: "partial" },
      {
        type: "completed",
        finishReason: "incomplete:max_output_tokens",
        usage: { inputTokens: 5, outputTokens: 8 },
      },
    ]);
  });

  it("preserves Anthropic stream error semantics", async () => {
    const fetch: FetchLike = async () =>
      sseResponse([
        'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Synthetic overload"}}\n\n',
      ]);

    const events = await collectEvents("anthropic-native", fetch, {
      ...request,
      baseUrl: "https://relay.example",
    });

    expect(events).toEqual([
      {
        type: "failed",
        error: {
          kind: "server",
          message: "Synthetic overload",
          retryable: true,
        },
      },
    ]);
  });

  it("preserves a top-level Responses error event", async () => {
    const fetch: FetchLike = async () =>
      sseResponse([
        'event: error\ndata: {"type":"error","code":"rate_limit_exceeded","message":"Synthetic stream limit","param":null,"sequence_number":1}\n\n',
      ]);

    const events = await collectEvents("openai-responses", fetch);

    expect(events).toEqual([
      {
        type: "failed",
        error: {
          kind: "rate-limit",
          message: "Synthetic stream limit",
          retryable: true,
        },
      },
    ]);
  });
});
