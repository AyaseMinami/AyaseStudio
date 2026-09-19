import OpenAI from "openai";

import { parseServerSentEvents } from "./sse";
import { buildProtocolBody, RequestConfigError } from "./requestMapping";
import { includeThinkingSummary } from "./thinking";
import { ResponseThinking } from "./responseThinking";
import { SearchDecoder } from "./searchDecoding";
import { resolveGenerationEndpoint, UrlResolutionError } from "./urlResolution";
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

const credentialName = "(?:(?:x[-_ ]?)?api[-_ ]?key|(?:proxy[-_ ]?)?authorization|(?:(?:access|refresh|id|auth|session)[-_ ]?)?token|(?:client[-_ ]?)?secret|password|credential)";
const credentialField = new RegExp(`^${credentialName}$`, "i");
const credentialAssignment = new RegExp(`(["']?\\b${credentialName}["']?\\s*[:=]\\s*["']?)([^\\s"',}\\]]+)`, "gi");

const authorizationAssignment = /((?:proxy[-_ ]?)?authorization["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\r\n<]+)/gi;

function redactProviderText(value: string, apiKey?: string): string {
  let redacted = value;
  if (apiKey) {
    redacted = redacted.split(apiKey).join("[REDACTED]");
    if (apiKey.trim()) redacted = redacted.split(apiKey.trim()).join("[REDACTED]");
  }
  return redacted
    .replace(authorizationAssignment, (_match, prefix: string) => prefix + "[REDACTED]")
    .replace(/\b(Bearer\s+)([^\s"',}\]]+)/gi, (match, prefix: string, value: string) =>
      value.startsWith("[REDACTED") ? match : `${prefix}[REDACTED]`)
    .replace(credentialAssignment, (match, prefix: string, value: string) =>
      value.startsWith("[REDACTED") ? match : `${prefix}[REDACTED]`);
}

function redactProviderPayload(value: unknown, apiKey?: string): unknown {
  if (typeof value === "string") return redactProviderText(value, apiKey);
  if (Array.isArray(value)) return value.map((item) => redactProviderPayload(item, apiKey));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        credentialField.test(key) ? "[REDACTED]" : redactProviderPayload(item, apiKey),
      ]),
    );
  }
  return value;
}

function providerPayloadMessage(payload: unknown, fallback: string, apiKey?: string): string {
  if (typeof payload === "string") {
    if (!payload.trim()) return fallback;
    try {
      return JSON.stringify(redactProviderPayload(JSON.parse(payload), apiKey), null, 2);
    } catch {
      return redactProviderText(payload, apiKey);
    }
  }
  if (payload !== undefined) {
    try {
      return JSON.stringify(redactProviderPayload(payload, apiKey), null, 2);
    } catch {
      // Use the readable provider message if an unexpected value cannot be serialized.
    }
  }
  return redactProviderText(fallback, apiKey);
}

async function httpStatusError(response: Response, apiKey: string): Promise<HttpStatusError> {
  const body = await response.clone().text().catch(() => "");
  return new HttpStatusError(
    response.status,
    providerPayloadMessage(body, "Provider returned no error body.", apiKey),
  );
}

function providerFailure(
  code: string | null,
  message: string,
  payload?: unknown,
  apiKey?: string,
): ChatFailure {
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
    message: providerPayloadMessage(payload, message, apiKey),
    retryable: isRateLimit || isServer,
  };
}

function failureFrom(error: unknown, apiKey?: string): ChatFailure {
  if (error instanceof UrlResolutionError || error instanceof RequestConfigError) {
    return { kind: "protocol", message: error.message, retryable: false };
  }
  const rawStatus =
    typeof error === "object" && error !== null && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;
  const numericStatus = Number(rawStatus);
  const status = Number.isFinite(numericStatus) ? numericStatus : undefined;
  const message = error instanceof Error ? redactProviderText(error.message, apiKey) : "Unknown transport error";

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
    const payload =
      typeof error === "object" && error !== null && "error" in error
        ? (error as { error?: unknown }).error
        : undefined;
    return providerFailure(providerCode, message, payload, apiKey);
  }

  return { kind: "network", message, retryable: true };
}

function openAIFetch(
  dependencies: ChatTransportDependencies,
  apiKey: string,
): { fetch: ChatTransportDependencies["fetch"]; lastHttpError(): HttpStatusError | undefined } {
  let lastError: HttpStatusError | undefined;
  return {
    fetch: async (input, init) => {
      const response = await dependencies.fetch(input, init);
      if (!response.ok) lastError = await httpStatusError(response, apiKey);
      return response;
    },
    lastHttpError: () => lastError,
  };
}

class OpenAIChatTransport implements ChatTransport {
  constructor(private readonly dependencies: ChatTransportDependencies) {}

  async *stream(request: ChatRequest): AsyncIterable<ChatEvent> {
    let capturedFetch: ReturnType<typeof openAIFetch> | undefined;
    try {
      const body = buildProtocolBody("openai-chat", request);
      const search = new SearchDecoder(request.config?.webSearch === true);
      const { normalizedBaseUrl } = resolveGenerationEndpoint(
        "openai-chat",
        request.baseUrl,
      );
      capturedFetch = openAIFetch(this.dependencies, request.apiKey);
      const client = new OpenAI({
        apiKey: request.apiKey,
        baseURL: normalizedBaseUrl,
        fetch: capturedFetch.fetch,
        dangerouslyAllowBrowser: true,
        maxRetries: 0,
      });
      if (body.stream === false) {
        const response = await client.chat.completions.create(
          body as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
          { signal: request.signal },
        );
        if (request.signal?.aborted) { yield { type: "aborted" }; return; }
        const choice = response.choices?.[0];
        search.openAI(choice?.message as unknown);
        const text = choice?.message?.content || choice?.message?.refusal;
        if (!choice || typeof text !== "string" || !choice.finish_reason) {
          yield { type: "failed", error: { kind: "protocol", message: "Chat Completions response is malformed", retryable: false } };
          return;
        }
        if (text) yield { type: "text-delta", text };
        const update = search.complete(); if (update) yield { type: "search-update", search: update };
        yield {
          type: "completed",
          finishReason: choice.finish_reason,
          ...(response.usage ? { usage: { inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens } } : {}),
        };
        return;
      }
      const stream = await client.chat.completions.create(
        body as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
        { signal: request.signal },
      );
      let finishReason: string | undefined;

      for await (const chunk of stream) {
        for (const choice of chunk.choices) {
          search.openAI(choice.delta as unknown);
          const searchUpdate = search.snapshot(); if (searchUpdate) yield { type: "search-update", search: searchUpdate };
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
        const completedSearch = search.complete(); if (completedSearch) yield { type: "search-update", search: completedSearch };
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

      yield { type: "failed", error: failureFrom(capturedFetch?.lastHttpError() ?? error, request.apiKey) };
    }
  }
}

class OpenAIResponsesTransport implements ChatTransport {
  constructor(private readonly dependencies: ChatTransportDependencies) {}

  async *stream(request: ChatRequest): AsyncIterable<ChatEvent> {
    let capturedFetch: ReturnType<typeof openAIFetch> | undefined;
    try {
      const body = buildProtocolBody("openai-responses", request);
      const thinking = new ResponseThinking(includeThinkingSummary(request.config, "openai-responses"));
      const search = new SearchDecoder(request.config?.webSearch === true);
      const { normalizedBaseUrl } = resolveGenerationEndpoint(
        "openai-responses",
        request.baseUrl,
      );
      capturedFetch = openAIFetch(this.dependencies, request.apiKey);
      const client = new OpenAI({
        apiKey: request.apiKey,
        baseURL: normalizedBaseUrl,
        fetch: capturedFetch.fetch,
        dangerouslyAllowBrowser: true,
        maxRetries: 0,
      });
      if (body.stream === false) {
        const response = await client.responses.create(
          body as unknown as OpenAI.Responses.ResponseCreateParamsNonStreaming,
          { signal: request.signal },
        );
        if (request.signal?.aborted) { yield { type: "aborted" }; return; }
        yield* thinking.output(response.output);
        search.openAIOutput(response.output);
        if (response.status === "failed") {
          yield { type: "failed", error: providerFailure(response.error?.code ?? null, response.error?.message ?? "Provider failed to generate a response", response.error, request.apiKey) };
          return;
        }
        if (response.status !== "completed" && response.status !== "incomplete") {
          yield { type: "failed", error: { kind: "protocol", message: "Responses response is malformed", retryable: false } };
          return;
        }
        const text = response.output_text;
        if (typeof text !== "string") {
          yield { type: "failed", error: { kind: "protocol", message: "Responses text output is malformed", retryable: false } };
          return;
        }
        if (text) yield { type: "text-delta", text };
        const completedSearch = search.complete(); if (completedSearch) yield { type: "search-update", search: completedSearch };
        yield {
          type: "completed",
          ...(response.status === "incomplete" ? { finishReason: `incomplete:${response.incomplete_details?.reason ?? "unknown"}` } : {}),
          ...(response.usage ? { usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } } : {}),
        };
        return;
      }
      const stream = await client.responses.create(
        body as unknown as OpenAI.Responses.ResponseCreateParamsStreaming,
        { signal: request.signal },
      );

      const outputParts = new Map<number, Map<number, string>>();
      const offsetFor = (outputIndex: number, contentIndex: number) => [...outputParts.entries()]
        .sort(([a], [b]) => a - b).reduce((total, [index, parts]) => total + [...parts.entries()]
          .sort(([a], [b]) => a - b).reduce((partTotal, [partIndex, text]) => partTotal + ((index < outputIndex || index === outputIndex && partIndex < contentIndex) ? text.length : 0), 0), 0);
      for await (const event of stream) {
        if (request.signal?.aborted) { yield { type: "aborted" }; return; }
        yield* thinking.event(event);
        if (event.type === "response.output_text.delta") {
          const raw = event as unknown as { output_index?: unknown; content_index?: unknown };
          const outputIndex = Number(raw.output_index ?? 0); const contentIndex = Number(raw.content_index ?? 0);
          if (Number.isInteger(outputIndex) && Number.isInteger(contentIndex)) {
            const parts = outputParts.get(outputIndex) ?? new Map<number, string>();
            parts.set(contentIndex, `${parts.get(contentIndex) ?? ""}${event.delta}`); outputParts.set(outputIndex, parts);
          }
          yield { type: "text-delta", text: event.delta };
          continue;
        }

        if (event.type === "response.refusal.delta") {
          yield { type: "text-delta", text: event.delta };
          continue;
        }

        if (event.type === "response.completed") {
          search.openAIOutput(event.response.output);
          const update = search.complete(); if (update) yield { type: "search-update", search: update };
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
              event,
              request.apiKey,
            ),
          };
          return;
        }

        if (event.type === "error") {
          yield {
            type: "failed",
            error: providerFailure(event.code, event.message, event, request.apiKey),
          };
          return;
        }

        if (event.type === "response.incomplete") {
          search.openAIOutput(event.response.output);
          const update = search.complete(); if (update) yield { type: "search-update", search: update };
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

        const raw = event as unknown as { type?: string; item?: unknown; output_index?: unknown; content_index?: unknown };
        if (raw.type === "response.web_search_call.completed") search.searched();
        else if (raw.type?.startsWith("response.web_search_call.")) search.activity();
        search.openAI(event as unknown, offsetFor(Number(raw.output_index ?? 0), Number(raw.content_index ?? 0)));
        search.openAI(raw.item);
        const update = search.snapshot(); if (update) yield { type: "search-update", search: update };
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

      yield { type: "failed", error: failureFrom(capturedFetch?.lastHttpError() ?? error, request.apiKey) };
    }
  }
}

interface GeminiChunk {
  error?: { code?: number; message?: string; status?: string };
  promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    finishReason?: string;
    groundingMetadata?: unknown;
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

function blockedGeminiPrompt(chunk: GeminiChunk, apiKey: string): ChatFailure | undefined {
  const reason = chunk.promptFeedback?.blockReason;
  if (!reason) return undefined;
  const detail = chunk.promptFeedback?.blockReasonMessage;
  return providerFailure(reason, `Gemini 拦截了输入（${reason}）。${detail ? ` ${detail}` : ""}`, chunk, apiKey);
}

class GeminiNativeTransport implements ChatTransport {
  constructor(private readonly dependencies: ChatTransportDependencies) {}

  async *stream(request: ChatRequest): AsyncIterable<ChatEvent> {
    try {
      const body = buildProtocolBody("gemini-native", request);
      const streaming = request.config?.stream ?? true;
      const showThinking = includeThinkingSummary(request.config, "gemini-native");
      const search = new SearchDecoder(request.config?.webSearch === true);
      const { resolvedEndpoint } = resolveGenerationEndpoint(
        "gemini-native",
        request.baseUrl,
        request.model,
        streaming,
      );
      const response = await this.dependencies.fetch(resolvedEndpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": request.apiKey,
        },
        body: JSON.stringify(body),
        signal: request.signal,
      });

      if (!response.ok) {
        throw await httpStatusError(response, request.apiKey);
      }

      if (!streaming) {
        const chunk = await response.json() as GeminiChunk;
        if (request.signal?.aborted) { yield { type: "aborted" }; return; }
        if (chunk.error) {
          yield { type: "failed", error: providerFailure(chunk.error.status ?? String(chunk.error.code ?? "provider_error"), chunk.error.message ?? "Gemini response error", chunk, request.apiKey) };
          return;
        }
        const blocked = blockedGeminiPrompt(chunk, request.apiKey);
        if (blocked) { yield { type: "failed", error: blocked }; return; }
        const candidate = chunk.candidates?.[0];
        if (!candidate || !candidate.finishReason || !Array.isArray(candidate.content?.parts)) {
          yield { type: "failed", error: { kind: "protocol", message: "Gemini response is malformed", retryable: false } };
          return;
        }
        let answerText = "";
        const groundedParts: Array<{ text: string; offset: number }> = [];
        for (const [partIndex, part] of candidate.content.parts.entries()) {
          groundedParts[partIndex] = { text: part.thought ? "" : part.text ?? "", offset: answerText.length };
          if (part.thought === true && !showThinking) continue;
          if (part.text) {
            if (part.thought !== true) answerText += part.text;
            yield { type: part.thought === true ? "thinking-delta" : "text-delta", text: part.text };
          }
        }
        search.gemini(candidate.groundingMetadata, groundedParts);
        const update = search.complete(); if (update) yield { type: "search-update", search: update };
        yield {
          type: "completed",
          finishReason: candidate.finishReason,
          ...(chunk.usageMetadata ? { usage: { inputTokens: chunk.usageMetadata.promptTokenCount, outputTokens: chunk.usageMetadata.candidatesTokenCount } } : {}),
        };
        return;
      }

      let finishReason: string | undefined;
      let answerText = "";
      let singleTextPart = true;
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
              chunk,
              request.apiKey,
            ),
          };
          return;
        }
        const blocked = blockedGeminiPrompt(chunk, request.apiKey);
        if (blocked) { yield { type: "failed", error: blocked }; return; }
        const candidate = chunk.candidates?.[0];
        if (candidate) {
          if ((candidate.content?.parts?.length ?? 0) > 1 || candidate.content?.parts?.some((part) => part.thought)) singleTextPart = false;
          for (const part of candidate.content?.parts ?? []) {
            if (part.thought === true && !showThinking) continue;
            if (part.text) {
              if (part.thought !== true) answerText += part.text;
              yield { type: part.thought === true ? "thinking-delta" : "text-delta", text: part.text };
            }
          }
          if (candidate.finishReason) {
            finishReason = candidate.finishReason;
          }
          search.gemini(candidate.groundingMetadata, singleTextPart ? [{ text: answerText, offset: 0 }] : [], answerText);
          const update = search.snapshot(); if (update) yield { type: "search-update", search: update };
        }
      }

      if (request.signal?.aborted) {
        yield { type: "aborted" };
        return;
      }
      if (finishReason) {
        const update = search.complete(); if (update) yield { type: "search-update", search: update };
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

      yield { type: "failed", error: failureFrom(error, request.apiKey) };
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
      index?: number;
      delta?: { type?: string; text?: string; thinking?: string; signature?: string; partial_json?: string; citation?: unknown };
    }
  | { type: "content_block_start"; index?: number; content_block?: Record<string, unknown> }
  | { type: "content_block_stop"; index?: number }
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
      const body = buildProtocolBody("anthropic-native", request);
      const showThinking = includeThinkingSummary(request.config, "anthropic-native");
      const streaming = request.config?.stream ?? true;
      const search = new SearchDecoder(request.config?.webSearch === true);
      const { resolvedEndpoint } = resolveGenerationEndpoint(
        "anthropic-native",
        request.baseUrl,
      );
      const response = await this.dependencies.fetch(
        resolvedEndpoint,
        {
          method: "POST",
          headers: {
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
            "x-api-key": request.apiKey,
          },
          body: JSON.stringify(body),
          signal: request.signal,
        },
      );

      if (!response.ok) {
        throw await httpStatusError(response, request.apiKey);
      }

      if (!streaming) {
        const payload = await response.json() as {
          type?: string;
          content?: Array<Record<string, unknown>>;
          stop_reason?: string | null;
          usage?: { input_tokens?: number; output_tokens?: number };
          error?: { type?: string; message?: string };
        };
        if (request.signal?.aborted) { yield { type: "aborted" }; return; }
        if (payload.type === "error" || payload.error) {
          yield { type: "failed", error: providerFailure(payload.error?.type ?? null, payload.error?.message ?? "Anthropic response error", payload, request.apiKey) };
          return;
        }
        if (payload.type !== "message" || !Array.isArray(payload.content) || !payload.stop_reason) {
          yield { type: "failed", error: { kind: "protocol", message: "Anthropic response is malformed", retryable: false } };
          return;
        }
        let answerText = "";
        for (const block of payload.content) {
          const textStart = answerText.length;
          search.anthropic(block, textStart);
          if (block.type === "text" && typeof block.text === "string" && block.text) {
            answerText += block.text;
            yield { type: "text-delta", text: block.text };
          }
          if (showThinking && block.type === "thinking" && block.thinking) {
            if (typeof block.thinking !== "string") throw new SyntaxError("Anthropic thinking text is malformed");
            yield { type: "thinking-delta", text: block.thinking };
          }
          search.anthropic(block, textStart, answerText.length);
        }
        const update = payload.stop_reason === "pause_turn" ? search.snapshot() : search.complete();
        if (update) yield { type: "search-update", search: update };
        if (payload.stop_reason === "pause_turn" || search.search && search.search.status !== "not-used") yield { type: "provider-replay", replay: { protocol: "anthropic-native", scope: request.replayScope ?? request.baseUrl, content: payload.content } };

        yield {
          type: "completed", finishReason: payload.stop_reason,
          ...(payload.usage ? { usage: { inputTokens: payload.usage.input_tokens, outputTokens: payload.usage.output_tokens } } : {}),
        };
        return;
      }

      let finishReason: string | undefined;
      let inputTokens: number | undefined;
      let outputTokens: number | undefined;
      const thinkingBlocks = new Set<number>();
      const startedBlocks = new Set<number>();
      const replayBlocks = new Map<number, Record<string, unknown>>();
      const jsonDeltas = new Map<number, string>();
      const textStarts = new Map<number, number>();
      let answerText = "";

      for await (const event of parseServerSentEvents(response.body)) {
        if (request.signal?.aborted) { yield { type: "aborted" }; return; }
        const payload = JSON.parse(event.data) as AnthropicEvent;

        if (payload.type === "content_block_start" && "content_block" in payload && payload.index !== undefined) {
          if (startedBlocks.has(payload.index)) continue;
          startedBlocks.add(payload.index);
          const block = { ...payload.content_block };
          replayBlocks.set(payload.index, block);
          if (block.type !== "text") search.anthropic(block, answerText.length);
          if (block.type === "text") textStarts.set(payload.index, answerText.length);
          if (block.type === "text" && typeof block.text === "string" && block.text) {
            answerText += block.text;
            yield { type: "text-delta", text: block.text };
          }
          if (payload.content_block?.type === "thinking") {
            thinkingBlocks.add(payload.index);
            if (showThinking && payload.content_block.thinking) {
              if (typeof payload.content_block.thinking !== "string") throw new SyntaxError("Anthropic thinking text is malformed");
              yield { type: "thinking-delta", text: payload.content_block.thinking };
            }
          }
          const update = search.snapshot(); if (update) yield { type: "search-update", search: update };
          continue;
        }
        if (payload.type === "content_block_stop" && "index" in payload && payload.index !== undefined) {
          const json = jsonDeltas.get(payload.index);
          if (json) {
            try { replayBlocks.get(payload.index)!.input = JSON.parse(json); } catch { /* preserve start block when partial JSON is malformed */ }
          }
          const block = replayBlocks.get(payload.index);
          if (block) search.anthropic(block, textStarts.get(payload.index) ?? answerText.length, answerText.length);
          const update = search.snapshot(); if (update) yield { type: "search-update", search: update };
          thinkingBlocks.delete(payload.index);
          continue;
        }

        if (payload.type === "message_start" && "message" in payload) {
          inputTokens = payload.message?.usage?.input_tokens;
          outputTokens = payload.message?.usage?.output_tokens;
          continue;
        }

        if (payload.type === "content_block_delta" && "delta" in payload) {
          const block = payload.index === undefined ? undefined : replayBlocks.get(payload.index);
          if (block && payload.delta?.type === "text_delta" && typeof payload.delta.text === "string") {
            block.text = `${typeof block.text === "string" ? block.text : ""}${payload.delta.text}`;
            answerText += payload.delta.text;
          }
          if (block && payload.delta?.type === "thinking_delta" && typeof payload.delta.thinking === "string") {
            block.thinking = `${typeof block.thinking === "string" ? block.thinking : ""}${payload.delta.thinking}`;
          }
          if (block && payload.delta?.type === "signature_delta" && typeof payload.delta.signature === "string") {
            block.signature = `${typeof block.signature === "string" ? block.signature : ""}${payload.delta.signature}`;
          }
          if (block && payload.delta?.type === "citations_delta" && payload.delta.citation) {
            const citations = Array.isArray(block.citations) ? block.citations : [];
            citations.push(payload.delta.citation); block.citations = citations;
          }
          if (block && payload.delta?.type === "input_json_delta") {
            const partial = (payload.delta as { partial_json?: unknown }).partial_json;
            if (typeof partial === "string") jsonDeltas.set(payload.index!, `${jsonDeltas.get(payload.index!) ?? ""}${partial}`);
          }
          if (showThinking && payload.delta?.type === "thinking_delta" && payload.index !== undefined && thinkingBlocks.has(payload.index)) {
            if (typeof payload.delta.thinking !== "string") throw new SyntaxError("Anthropic thinking delta is malformed");
            if (payload.delta.thinking) yield { type: "thinking-delta", text: payload.delta.thinking };
          }
          if (payload.delta?.type === "text_delta" && payload.delta.text) {
            yield { type: "text-delta", text: payload.delta.text };
          }
          const update = search.snapshot(); if (update) yield { type: "search-update", search: update };
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
              payload,
              request.apiKey,
            ),
          };
          return;
        }

        if (payload.type === "message_stop") {
          if (!finishReason) {
            yield { type: "failed", error: { kind: "protocol", message: "Anthropic stream ended without a stop reason", retryable: false } };
            return;
          }
          const update = finishReason === "pause_turn" ? search.snapshot() : search.complete();
          if (update) yield { type: "search-update", search: update };
          if (finishReason === "pause_turn" || search.search && search.search.status !== "not-used") yield { type: "provider-replay", replay: {
            protocol: "anthropic-native", scope: request.replayScope ?? request.baseUrl,
            content: [...replayBlocks.entries()].sort(([a], [b]) => a - b).map(([, block]) => block),
          } };
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

      yield { type: "failed", error: failureFrom(error, request.apiKey) };
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
