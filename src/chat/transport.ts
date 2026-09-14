import OpenAI from "openai";

import { parseServerSentEvents } from "./sse";
import type {
  ChatEvent,
  ChatFailure,
  ChatProtocol,
  ChatRequest,
  ChatTransport,
  ChatTransportDependencies,
} from "./types";

class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpStatusError";
  }
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function providerFailure(code: string | null, message: string): ChatFailure {
  const normalizedCode = (code ?? "provider_error").toLowerCase();
  const isRateLimit =
    normalizedCode.includes("rate_limit") ||
    normalizedCode.includes("resource_exhausted");
  const isServer =
    normalizedCode.includes("server") ||
    normalizedCode.includes("internal") ||
    normalizedCode.includes("overload");

  return {
    kind: isRateLimit ? "rate-limit" : isServer ? "server" : "provider",
    message,
    retryable: isRateLimit || isServer,
  };
}

function failureFrom(error: unknown): ChatFailure {
  const rawStatus =
    typeof error === "object" && error !== null && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;
  const numericStatus = Number(rawStatus);
  const status = Number.isFinite(numericStatus) ? numericStatus : undefined;
  const message = error instanceof Error ? error.message : "Unknown transport error";

  if (error instanceof SyntaxError) {
    return { kind: "protocol", message, retryable: false };
  }

  if (status === 429) {
    return { kind: "rate-limit", message, status, retryable: true };
  }

  if (status !== undefined && status >= 500) {
    return { kind: "server", message, status, retryable: true };
  }

  if (status !== undefined) {
    return { kind: "http", message, status, retryable: status === 408 };
  }

  const providerCode =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : undefined;
  if (providerCode) {
    return providerFailure(providerCode, message);
  }

  return { kind: "network", message, retryable: true };
}

class OpenAIChatTransport implements ChatTransport {
  constructor(private readonly dependencies: ChatTransportDependencies) {}

  async *stream(request: ChatRequest): AsyncIterable<ChatEvent> {
    try {
      const client = new OpenAI({
        apiKey: request.apiKey,
        baseURL: withoutTrailingSlash(request.baseUrl),
        fetch: this.dependencies.fetch,
        dangerouslyAllowBrowser: true,
        maxRetries: 0,
      });
      const stream = await client.chat.completions.create(
        {
          model: request.model,
          messages: request.messages,
          stream: true,
        },
        { signal: request.signal },
      );
      let finishReason: string | undefined;

      for await (const chunk of stream) {
        for (const choice of chunk.choices) {
          if (choice.delta.content) {
            yield { type: "text-delta", text: choice.delta.content };
          }
          if (choice.delta.refusal) {
            yield { type: "text-delta", text: choice.delta.refusal };
          }
          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }
        }
      }

      if (request.signal?.aborted) {
        yield { type: "aborted" };
        return;
      }
      if (finishReason) {
        yield { type: "completed", finishReason };
      } else {
        yield {
          type: "failed",
          error: {
            kind: "protocol",
            message: "Chat Completions stream ended before a finish reason",
            retryable: true,
          },
        };
      }
    } catch (error) {
      if (request.signal?.aborted) {
        yield { type: "aborted" };
        return;
      }

      yield { type: "failed", error: failureFrom(error) };
    }
  }
}

class OpenAIResponsesTransport implements ChatTransport {
  constructor(private readonly dependencies: ChatTransportDependencies) {}

  async *stream(request: ChatRequest): AsyncIterable<ChatEvent> {
    try {
      const client = new OpenAI({
        apiKey: request.apiKey,
        baseURL: withoutTrailingSlash(request.baseUrl),
        fetch: this.dependencies.fetch,
        dangerouslyAllowBrowser: true,
        maxRetries: 0,
      });
      const stream = await client.responses.create(
        {
          model: request.model,
          input: request.messages,
          max_output_tokens: request.maxOutputTokens,
          store: false,
          stream: true,
        },
        { signal: request.signal },
      );

      for await (const event of stream) {
        if (event.type === "response.output_text.delta") {
          yield { type: "text-delta", text: event.delta };
          continue;
        }

        if (event.type === "response.refusal.delta") {
          yield { type: "text-delta", text: event.delta };
          continue;
        }

        if (event.type === "response.completed") {
          const usage = event.response.usage;
          yield {
            type: "completed",
            ...(usage
              ? {
                  usage: {
                    inputTokens: usage.input_tokens,
                    outputTokens: usage.output_tokens,
                  },
                }
              : {}),
          };
          return;
        }

        if (event.type === "response.failed") {
          const providerError = event.response.error;
          yield {
            type: "failed",
            error: providerFailure(
              providerError?.code ?? null,
              providerError?.message ?? "Provider failed to generate a response",
            ),
          };
          return;
        }

        if (event.type === "error") {
          yield {
            type: "failed",
            error: providerFailure(event.code, event.message),
          };
          return;
        }

        if (event.type === "response.incomplete") {
          const usage = event.response.usage;
          const reason = event.response.incomplete_details?.reason ?? "unknown";
          yield {
            type: "completed",
            finishReason: `incomplete:${reason}`,
            ...(usage
              ? {
                  usage: {
                    inputTokens: usage.input_tokens,
                    outputTokens: usage.output_tokens,
                  },
                }
              : {}),
          };
          return;
        }
      }

      if (request.signal?.aborted) {
        yield { type: "aborted" };
        return;
      }
      yield {
        type: "failed",
        error: {
          kind: "protocol",
          message: "Responses stream ended before a terminal event",
          retryable: true,
        },
      };
    } catch (error) {
      if (request.signal?.aborted) {
        yield { type: "aborted" };
        return;
      }

      yield { type: "failed", error: failureFrom(error) };
    }
  }
}

interface GeminiChunk {
  error?: { code?: number; message?: string; status?: string };
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
}

class GeminiNativeTransport implements ChatTransport {
  constructor(private readonly dependencies: ChatTransportDependencies) {}

  async *stream(request: ChatRequest): AsyncIterable<ChatEvent> {
    try {
      const systemText = request.messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n");
      const body = {
        contents: request.messages
          .filter((message) => message.role !== "system")
          .map((message) => ({
            role: message.role === "assistant" ? "model" : "user",
            parts: [{ text: message.content }],
          })),
        ...(systemText
          ? { systemInstruction: { parts: [{ text: systemText }] } }
          : {}),
        ...(request.maxOutputTokens
          ? {
              generationConfig: {
                maxOutputTokens: request.maxOutputTokens,
              },
            }
          : {}),
      };
      const url = `${withoutTrailingSlash(request.baseUrl)}/v1beta/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`;
      const response = await this.dependencies.fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": request.apiKey,
        },
        body: JSON.stringify(body),
        signal: request.signal,
      });

      if (!response.ok) {
        throw new HttpStatusError(response.status, `Gemini HTTP ${response.status}`);
      }

      let finishReason: string | undefined;
      for await (const event of parseServerSentEvents(response.body)) {
        if (event.data === "[DONE]") {
          continue;
        }
        const chunk = JSON.parse(event.data) as GeminiChunk;
        if (chunk.error) {
          yield {
            type: "failed",
            error: providerFailure(
              chunk.error.status ?? String(chunk.error.code ?? "provider_error"),
              chunk.error.message ?? "Gemini stream error",
            ),
          };
          return;
        }
        for (const candidate of chunk.candidates ?? []) {
          for (const part of candidate.content?.parts ?? []) {
            if (part.text) {
              yield { type: "text-delta", text: part.text };
            }
          }
          if (candidate.finishReason) {
            finishReason = candidate.finishReason;
          }
        }
      }

      if (request.signal?.aborted) {
        yield { type: "aborted" };
        return;
      }
      if (finishReason) {
        yield { type: "completed", finishReason };
      } else {
        yield {
          type: "failed",
          error: {
            kind: "protocol",
            message: "Gemini stream ended before a finish reason",
            retryable: true,
          },
        };
      }
    } catch (error) {
      if (request.signal?.aborted) {
        yield { type: "aborted" };
        return;
      }

      yield { type: "failed", error: failureFrom(error) };
    }
  }
}

type AnthropicEvent =
  | {
      type: "message_start";
      message?: { usage?: { input_tokens?: number; output_tokens?: number } };
    }
  | {
      type: "content_block_delta";
      delta?: { type?: string; text?: string };
    }
  | {
      type: "message_delta";
      delta?: { stop_reason?: string };
      usage?: { output_tokens?: number };
    }
  | {
      type: "error";
      error?: { type?: string; message?: string };
    }
  | { type: "message_stop" }
  | { type: string };

class AnthropicNativeTransport implements ChatTransport {
  constructor(private readonly dependencies: ChatTransportDependencies) {}

  async *stream(request: ChatRequest): AsyncIterable<ChatEvent> {
    try {
      const system = request.messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n");
      const response = await this.dependencies.fetch(
        `${withoutTrailingSlash(request.baseUrl)}/v1/messages`,
        {
          method: "POST",
          headers: {
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
            "x-api-key": request.apiKey,
          },
          body: JSON.stringify({
            model: request.model,
            max_tokens: request.maxOutputTokens ?? 4096,
            stream: true,
            ...(system ? { system } : {}),
            messages: request.messages
              .filter((message) => message.role !== "system")
              .map((message) => ({
                role: message.role,
                content: message.content,
              })),
          }),
          signal: request.signal,
        },
      );

      if (!response.ok) {
        throw new HttpStatusError(
          response.status,
          `Anthropic HTTP ${response.status}`,
        );
      }

      let finishReason: string | undefined;
      let inputTokens: number | undefined;
      let outputTokens: number | undefined;

      for await (const event of parseServerSentEvents(response.body)) {
        const payload = JSON.parse(event.data) as AnthropicEvent;

        if (payload.type === "message_start" && "message" in payload) {
          inputTokens = payload.message?.usage?.input_tokens;
          outputTokens = payload.message?.usage?.output_tokens;
          continue;
        }

        if (payload.type === "content_block_delta" && "delta" in payload) {
          if (payload.delta?.type === "text_delta" && payload.delta.text) {
            yield { type: "text-delta", text: payload.delta.text };
          }
          continue;
        }

        if (payload.type === "message_delta") {
          if ("delta" in payload && payload.delta?.stop_reason) {
            finishReason = payload.delta.stop_reason;
          }
          if ("usage" in payload && payload.usage?.output_tokens !== undefined) {
            outputTokens = payload.usage.output_tokens;
          }
          continue;
        }

        if (payload.type === "error" && "error" in payload) {
          yield {
            type: "failed",
            error: providerFailure(
              payload.error?.type ?? null,
              payload.error?.message ?? "Anthropic stream error",
            ),
          };
          return;
        }

        if (payload.type === "message_stop") {
          yield {
            type: "completed",
            finishReason,
            ...(inputTokens !== undefined || outputTokens !== undefined
              ? { usage: { inputTokens, outputTokens } }
              : {}),
          };
          return;
        }
      }

      if (request.signal?.aborted) {
        yield { type: "aborted" };
        return;
      }
      yield {
        type: "failed",
        error: {
          kind: "protocol",
          message: "Anthropic stream ended before message_stop",
          retryable: true,
        },
      };
    } catch (error) {
      if (request.signal?.aborted) {
        yield { type: "aborted" };
        return;
      }

      yield { type: "failed", error: failureFrom(error) };
    }
  }
}

export function createChatTransport(
  protocol: ChatProtocol,
  dependencies: ChatTransportDependencies,
): ChatTransport {
  if (protocol === "openai-chat") {
    return new OpenAIChatTransport(dependencies);
  }

  if (protocol === "openai-responses") {
    return new OpenAIResponsesTransport(dependencies);
  }

  if (protocol === "gemini-native") {
    return new GeminiNativeTransport(dependencies);
  }

  if (protocol === "anthropic-native") {
    return new AnthropicNativeTransport(dependencies);
  }

  throw new Error(`Unsupported chat protocol: ${protocol}`);
}
