import OpenAI from "openai";

import { parseServerSentEvents } from "./sse";
import { buildProtocolBody, RequestConfigError } from "./requestMapping";
import { includeThinkingSummary } from "./thinking";
import { ResponseThinking } from "./responseThinking";
import { SearchDecoder } from "./searchDecoding";
import {
  buildAnthropicDeepSeekReplay,
  buildResponsesDeepSeekReplay,
  containsDeepSeekToolBlocks,
  hasResponsesDeepSeekExtension,
} from "./deepseekReplay";
import { mergeTokenUsage, normalizeTokenUsage } from "./usage";
import { resolveSearchMode } from "../search/mode";
import { resolveGenerationEndpoint, UrlResolutionError } from "./urlResolution";
import type {
  ChatEvent,
  ChatFailure,
  ChatProtocol,
  ChatRequest,
  ChatTransport,
  ChatTransportDependencies,
  RefusalInfo,
  TokenUsage,
} from "./types";

// Documented compatible-service extension; never infer reasoning from answer text.
function* chatThinking(value: unknown, enabled: boolean): Iterable<ChatEvent> {
  if (!enabled || !value || typeof value !== "object" || !("reasoning_content" in value)) return;
  const text = value.reasoning_content;
  if (text == null) return;
  if (typeof text !== "string") throw new SyntaxError("Chat reasoning_content is malformed");
  if (text) yield { type: "thinking-delta", text };
}

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
      const search = new SearchDecoder(request.config ? resolveSearchMode(request.config) === "native" : false);
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
        const usage = normalizeTokenUsage("openai-chat", response.usage);
        if (usage) yield { type: "usage-update", usage };
        if (request.signal?.aborted) { yield { type: "aborted" }; return; }
        const choice = response.choices?.[0];
        search.openAI(choice?.message as unknown);
        const message = choice?.message;
        const content = message?.content;
        const hasReasoning = message && "reasoning_content" in message && typeof message.reasoning_content === "string";
        const text = content || message?.refusal || (content === null && hasReasoning ? "" : content);
        if (!choice || typeof text !== "string" || !choice.finish_reason) {
          yield { type: "failed", error: { kind: "protocol", message: "Chat Completions response is malformed", retryable: false } };
          return;
        }
        yield* chatThinking(choice.message, includeThinkingSummary(request.config, "openai-chat"));
        if (request.signal?.aborted) { yield { type: "aborted" }; return; }
        if (text) yield { type: "text-delta", text };
        const update = search.complete(); if (update) yield { type: "search-update", search: update };
        yield {
          type: "completed",
          finishReason: choice.finish_reason,
          ...(usage ? { usage } : {}),
        };
        return;
      }
      const stream = await client.chat.completions.create(
        body as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
        { signal: request.signal },
      );
      let finishReason: string | undefined;
      let usage: TokenUsage | undefined;

      for await (const chunk of stream) {
        if (request.signal?.aborted) { yield { type: "aborted" }; return; }
        const snapshot = normalizeTokenUsage("openai-chat", chunk.usage);
        if (snapshot) {
          usage = mergeTokenUsage(usage, snapshot);
          yield { type: "usage-update", usage: usage! };
        }
        if (request.signal?.aborted) { yield { type: "aborted" }; return; }
        for (const choice of chunk.choices) {
          yield* chatThinking(choice.delta, includeThinkingSummary(request.config, "openai-chat"));
          if (request.signal?.aborted) { yield { type: "aborted" }; return; }
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
        yield { type: "completed", finishReason, ...(usage ? { usage } : {}) };
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

function extractResponsesRefusalText(output: unknown): string {
  if (!Array.isArray(output)) return "";
  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object" || (item as { type?: unknown }).type !== "message") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (
        part
        && typeof part === "object"
        && (part as { type?: unknown }).type === "refusal"
        && typeof (part as { refusal?: unknown }).refusal === "string"
        && (part as { refusal: string }).refusal
      ) {
        parts.push((part as { refusal: string }).refusal);
      }
    }
  }
  return parts.join("\n").trim();
}

function extractAnthropicRefusalExplanation(stopDetails: unknown, apiKey: string): string | undefined {
  if (!stopDetails || typeof stopDetails !== "object" || Array.isArray(stopDetails)) return undefined;
  const explanation = (stopDetails as { explanation?: unknown }).explanation;
  if (typeof explanation !== "string" || !explanation.trim()) return undefined;
  return redactProviderText(explanation.trim(), apiKey);
}

class OpenAIResponsesTransport implements ChatTransport {
  constructor(private readonly dependencies: ChatTransportDependencies) {}

  async *stream(request: ChatRequest): AsyncIterable<ChatEvent> {
    let capturedFetch: ReturnType<typeof openAIFetch> | undefined;
    let refused: RefusalInfo | undefined;
    try {
      const body = buildProtocolBody("openai-responses", request);
      const searchMode = request.config ? resolveSearchMode(request.config) : "off";
      const isDeepSeekServer = searchMode === "deepseek-server";
      const thinking = new ResponseThinking(includeThinkingSummary(request.config, "openai-responses"));
      const search = new SearchDecoder(searchMode === "native" || isDeepSeekServer, {
        deepseekCodePointOffsets: isDeepSeekServer,
      });
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
        if (response.status === "incomplete" && response.incomplete_details?.reason === "content_filter") {
          const rawRefusal = extractResponsesRefusalText(response.output);
          const explanation = rawRefusal ? redactProviderText(rawRefusal, request.apiKey) : undefined;
          refused = { reason: "content_filter", ...(explanation ? { explanation } : {}) };
        }
        if (request.signal?.aborted) {
          yield { type: "aborted", ...(refused ? { clearRefusedContent: true, refusal: refused } : {}) };
          return;
        }
        const usage = normalizeTokenUsage("openai-responses", response.usage);
        if (usage) yield { type: "usage-update", usage };
        if (request.signal?.aborted) {
          yield { type: "aborted", ...(refused ? { clearRefusedContent: true, refusal: refused } : {}) };
          return;
        }
        if (response.status === "failed") {
          yield { type: "failed", error: providerFailure(response.error?.code ?? null, response.error?.message ?? "Provider failed to generate a response", response.error, request.apiKey) };
          return;
        }
        if (response.status !== "completed" && response.status !== "incomplete") {
          yield { type: "failed", error: { kind: "protocol", message: "Responses response is malformed", retryable: false } };
          return;
        }
        if (refused) {
          search.openAIOutput(response.output, { toolsOnly: true });
          search.clearCitations();
          const completedSearch = search.complete();
          if (completedSearch) yield { type: "search-update", search: completedSearch };
          if (request.signal?.aborted) {
            yield { type: "aborted", clearRefusedContent: true, refusal: refused };
            return;
          }
          yield {
            type: "completed",
            finishReason: "incomplete:content_filter",
            refusal: refused,
            ...(usage ? { usage } : {}),
          };
          return;
        }
        for (const event of thinking.output(response.output)) {
          yield event;
          if (request.signal?.aborted) { yield { type: "aborted" }; return; }
        }
        const refusalText = extractResponsesRefusalText(response.output);
        const text = typeof response.output_text === "string"
          ? (response.output_text || refusalText)
          : (refusalText || undefined);
        if (typeof text !== "string") {
          yield { type: "failed", error: { kind: "protocol", message: "Responses text output is malformed", retryable: false } };
          return;
        }
        search.openAIOutput(response.output, { maxTextLength: text.length });
        if (text) yield { type: "text-delta", text };
        const completedSearch = search.complete(); if (completedSearch) yield { type: "search-update", search: completedSearch };
        if (isDeepSeekServer || hasResponsesDeepSeekExtension(response.output)) {
          const replay = buildResponsesDeepSeekReplay(response.output, request.replayScope ?? request.baseUrl);
          if (replay) yield { type: "provider-replay", replay };
        }
        yield {
          type: "completed",
          ...(response.status === "incomplete" ? { finishReason: `incomplete:${response.incomplete_details?.reason ?? "unknown"}` } : {}),
          ...(usage ? { usage } : {}),
        };
        return;
      }
      const stream = await client.responses.create(
        body as unknown as OpenAI.Responses.ResponseCreateParamsStreaming,
        { signal: request.signal },
      );

      const outputParts = new Map<number, Map<number, string>>();
      let streamedRefusal = "";
      let usage: TokenUsage | undefined;
      const offsetFor = (outputIndex: number, contentIndex: number) => [...outputParts.entries()]
        .sort(([a], [b]) => a - b).reduce((total, [index, parts]) => total + [...parts.entries()]
          .sort(([a], [b]) => a - b).reduce((partTotal, [partIndex, text]) => partTotal + ((index < outputIndex || index === outputIndex && partIndex < contentIndex) ? text.length : 0), 0), 0);
      const totalOutputLength = () => [...outputParts.values()]
        .reduce((total, parts) => total + [...parts.values()].reduce((partTotal, text) => partTotal + text.length, 0), 0);
      for await (const event of stream) {
        if (event.type === "response.incomplete" && event.response.incomplete_details?.reason === "content_filter") {
          const rawRefusal = extractResponsesRefusalText(event.response.output) || streamedRefusal.trim();
          const explanation = rawRefusal ? redactProviderText(rawRefusal, request.apiKey) : undefined;
          refused = { reason: "content_filter", ...(explanation ? { explanation } : {}) };
        }
        if (request.signal?.aborted) {
          yield { type: "aborted", ...(refused ? { clearRefusedContent: true, refusal: refused } : {}) };
          return;
        }
        const snapshot = normalizeTokenUsage("openai-responses", "response" in event ? event.response.usage : undefined);
        if (snapshot) {
          usage = mergeTokenUsage(usage, snapshot);
          yield { type: "usage-update", usage: usage! };
        }
        if (request.signal?.aborted) {
          yield { type: "aborted", ...(refused ? { clearRefusedContent: true, refusal: refused } : {}) };
          return;
        }
        if (event.type === "response.incomplete" && refused) {
          search.openAIOutput(event.response.output, { toolsOnly: true });
          search.clearCitations();
          const update = search.complete();
          if (update) yield { type: "search-update", search: update };
          if (request.signal?.aborted) {
            yield { type: "aborted", clearRefusedContent: true, refusal: refused };
            return;
          }
          const terminalUsage = normalizeTokenUsage("openai-responses", event.response.usage);
          yield {
            type: "completed",
            finishReason: "incomplete:content_filter",
            refusal: refused,
            ...(terminalUsage ? { usage: terminalUsage } : {}),
          };
          return;
        }
        for (const thought of thinking.event(event)) {
          yield thought;
          if (request.signal?.aborted) {
            yield { type: "aborted", ...(refused ? { clearRefusedContent: true, refusal: refused } : {}) };
            return;
          }
        }
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
          const raw = event as unknown as { output_index?: unknown; content_index?: unknown };
          const outputIndex = Number(raw.output_index ?? 0); const contentIndex = Number(raw.content_index ?? 0);
          if (Number.isInteger(outputIndex) && Number.isInteger(contentIndex)) {
            const parts = outputParts.get(outputIndex) ?? new Map<number, string>();
            parts.set(contentIndex, `${parts.get(contentIndex) ?? ""}${event.delta}`); outputParts.set(outputIndex, parts);
          }
          streamedRefusal += event.delta;
          yield { type: "text-delta", text: event.delta };
          continue;
        }

        if (event.type === "response.completed") {
          search.openAIOutput(event.response.output, { maxTextLength: totalOutputLength(), streamedParts: outputParts });
          const update = search.complete(); if (update) yield { type: "search-update", search: update };
          if (isDeepSeekServer || hasResponsesDeepSeekExtension(event.response.output)) {
            const replay = buildResponsesDeepSeekReplay(event.response.output, request.replayScope ?? request.baseUrl);
            if (replay) yield { type: "provider-replay", replay };
          }
          const terminalUsage = normalizeTokenUsage("openai-responses", event.response.usage);
          yield {
            type: "completed",
            ...(terminalUsage ? { usage: terminalUsage } : {}),
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
            ...(refused ? { clearRefusedContent: true, refusal: refused } : {}),
          };
          return;
        }

        if (event.type === "error") {
          yield {
            type: "failed",
            error: providerFailure(event.code, event.message, event, request.apiKey),
            ...(refused ? { clearRefusedContent: true, refusal: refused } : {}),
          };
          return;
        }

        if (event.type === "response.incomplete") {
          search.openAIOutput(event.response.output, { maxTextLength: totalOutputLength(), streamedParts: outputParts });
          const update = search.complete(); if (update) yield { type: "search-update", search: update };
          if (isDeepSeekServer || hasResponsesDeepSeekExtension(event.response.output)) {
            const replay = buildResponsesDeepSeekReplay(event.response.output, request.replayScope ?? request.baseUrl);
            if (replay) yield { type: "provider-replay", replay };
          }
          const reason = event.response.incomplete_details?.reason ?? "unknown";
          const terminalUsage = normalizeTokenUsage("openai-responses", event.response.usage);
          yield {
            type: "completed",
            finishReason: `incomplete:${reason}`,
            ...(terminalUsage ? { usage: terminalUsage } : {}),
          };
          return;
        }

        const raw = event as unknown as {
          type?: string;
          item?: unknown;
          annotation?: unknown;
          annotations?: unknown;
          output_index?: unknown;
          content_index?: unknown;
        };
        if (raw.type === "response.web_search_call.completed") search.searched();
        else if (raw.type?.startsWith("response.web_search_call.")) search.activity();
        const outputIndex = Number(raw.output_index ?? 0);
        const contentIndex = Number(raw.content_index ?? 0);
        if (raw.annotation && Number.isInteger(outputIndex) && Number.isInteger(contentIndex)) {
          const partText = outputParts.get(outputIndex)?.get(contentIndex) ?? "";
          search.openAIAnnotation(
            outputIndex,
            contentIndex,
            raw.annotation,
            partText,
            offsetFor(outputIndex, contentIndex),
            totalOutputLength(),
          );
        } else if (Array.isArray(raw.annotations) && Number.isInteger(outputIndex) && Number.isInteger(contentIndex)) {
          const partText = outputParts.get(outputIndex)?.get(contentIndex) ?? "";
          for (const annotation of raw.annotations) {
            search.openAIAnnotation(
              outputIndex,
              contentIndex,
              annotation,
              partText,
              offsetFor(outputIndex, contentIndex),
              totalOutputLength(),
            );
          }
        }
        if (raw.item && typeof raw.item === "object" && !Array.isArray(raw.item)) {
          const item = raw.item as Record<string, unknown>;
          if (item.type === "web_search_call") {
            search.openAIWebSearchCall(item, Number.isInteger(outputIndex) ? `output:${outputIndex}` : undefined);
          } else if (item.type === "message" && Array.isArray(item.content) && Number.isInteger(outputIndex)) {
            for (let partIndex = 0; partIndex < item.content.length; partIndex += 1) {
              const part = item.content[partIndex];
              if (!part || typeof part !== "object" || Array.isArray(part)) continue;
              const recordPart = part as Record<string, unknown>;
              const partText = typeof recordPart.text === "string"
                ? recordPart.text
                : (outputParts.get(outputIndex)?.get(partIndex) ?? "");
              if (Array.isArray(recordPart.annotations)) {
                for (const annotation of recordPart.annotations) {
                  search.openAIAnnotation(
                    outputIndex,
                    partIndex,
                    annotation,
                    partText,
                    offsetFor(outputIndex, partIndex),
                    totalOutputLength(),
                  );
                }
              }
            }
          } else {
            search.openAI(raw.item);
          }
        }
        const update = search.snapshot(); if (update) yield { type: "search-update", search: update };
      }

      if (request.signal?.aborted) {
        yield { type: "aborted", ...(refused ? { clearRefusedContent: true, refusal: refused } : {}) };
        return;
      }
      yield {
        type: "failed",
        error: {
          kind: "protocol",
          message: "Responses stream ended before a terminal event",
          retryable: true,
        },
        ...(refused ? { clearRefusedContent: true, refusal: refused } : {}),
      };
    } catch (error) {
      if (request.signal?.aborted) {
        yield { type: "aborted", ...(refused ? { clearRefusedContent: true, refusal: refused } : {}) };
        return;
      }

      yield {
        type: "failed",
        error: failureFrom(capturedFetch?.lastHttpError() ?? error, request.apiKey),
        ...(refused ? { clearRefusedContent: true, refusal: refused } : {}),
      };
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
  usageMetadata?: unknown;
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
      const search = new SearchDecoder(request.config ? resolveSearchMode(request.config) === "native" : false);
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
        const usage = normalizeTokenUsage("gemini-native", chunk.usageMetadata);
        if (usage) yield { type: "usage-update", usage };
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
          ...(usage ? { usage } : {}),
        };
        return;
      }

      let finishReason: string | undefined;
      let usage: TokenUsage | undefined;
      let answerText = "";
      let singleTextPart = true;
      for await (const event of parseServerSentEvents(response.body)) {
        if (request.signal?.aborted) { yield { type: "aborted" }; return; }
        if (event.data === "[DONE]") {
          continue;
        }
        const chunk = JSON.parse(event.data) as GeminiChunk;
        const snapshot = normalizeTokenUsage("gemini-native", chunk.usageMetadata);
        if (snapshot) {
          usage = mergeTokenUsage(usage, snapshot);
          yield { type: "usage-update", usage: usage! };
        }
        if (request.signal?.aborted) { yield { type: "aborted" }; return; }
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
        yield { type: "completed", finishReason, ...(usage ? { usage } : {}) };
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
      message?: { usage?: unknown };
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
      delta?: { stop_reason?: string; stop_details?: unknown };
      usage?: unknown;
    }
  | {
      type: "error";
      error?: { type?: string; message?: string };
      usage?: unknown;
    }
  | { type: "message_stop" }
  | { type: "ping" }
  | { type?: string; error?: { type?: string; message?: string }; usage?: unknown };

class AnthropicNativeTransport implements ChatTransport {
  constructor(private readonly dependencies: ChatTransportDependencies) {}

  async *stream(request: ChatRequest): AsyncIterable<ChatEvent> {
    let refused: RefusalInfo | undefined;
    try {
      const body = buildProtocolBody("anthropic-native", request);
      const searchMode = request.config ? resolveSearchMode(request.config) : "off";
      const isDeepSeekServer = searchMode === "deepseek-server";
      const showThinking = includeThinkingSummary(request.config, "anthropic-native");
      const streaming = request.config?.stream ?? true;
      const search = new SearchDecoder(searchMode === "native" || isDeepSeekServer);
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
          stop_details?: unknown;
          usage?: unknown;
          error?: { type?: string; message?: string };
        };
        if (payload.type === "message" && Array.isArray(payload.content) && payload.stop_reason === "refusal") {
          const explanation = extractAnthropicRefusalExplanation(payload.stop_details, request.apiKey);
          refused = { reason: "refusal", ...(explanation ? { explanation } : {}) };
        }
        if (request.signal?.aborted) {
          yield { type: "aborted", ...(refused ? { clearRefusedContent: true, refusal: refused } : {}) };
          return;
        }
        const usage = normalizeTokenUsage("anthropic-native", payload.usage);
        if (usage) yield { type: "usage-update", usage };
        if (request.signal?.aborted) {
          yield { type: "aborted", ...(refused ? { clearRefusedContent: true, refusal: refused } : {}) };
          return;
        }
        if (payload.type === "error" || payload.error) {
          yield {
            type: "failed",
            error: providerFailure(payload.error?.type ?? null, payload.error?.message ?? "Anthropic response error", payload, request.apiKey),
            ...(refused ? { clearRefusedContent: true, refusal: refused } : {}),
          };
          return;
        }
        if (payload.type !== "message" || !Array.isArray(payload.content) || !payload.stop_reason) {
          yield {
            type: "failed",
            error: { kind: "protocol", message: "Anthropic response is malformed", retryable: false },
            ...(refused ? { clearRefusedContent: true, refusal: refused } : {}),
          };
          return;
        }
        if (refused) {
          for (const [blockIndex, block] of payload.content.entries()) {
            if (block.type !== "text" && block.type !== "thinking" && block.type !== "redacted_thinking") {
              search.anthropic(block, 0, 0, undefined, `block:${blockIndex}`);
            }
          }
          search.clearCitations();
          const update = search.complete();
          if (update) yield { type: "search-update", search: update };
          if (request.signal?.aborted) {
            yield { type: "aborted", clearRefusedContent: true, refusal: refused };
            return;
          }
          yield {
            type: "completed",
            finishReason: "refusal",
            refusal: refused,
            ...(usage ? { usage } : {}),
          };
          return;
        }
        let answerText = "";
        for (const [blockIndex, block] of payload.content.entries()) {
          const textStart = answerText.length;
          const blockKey = `block:${blockIndex}`;
          if (block.type !== "text") {
            search.anthropic(block, textStart, textStart, undefined, blockKey);
          }
          if (block.type === "text" && typeof block.text === "string" && block.text) {
            answerText += block.text;
            yield { type: "text-delta", text: block.text };
          }
          if (showThinking && block.type === "thinking" && block.thinking) {
            if (typeof block.thinking !== "string") throw new SyntaxError("Anthropic thinking text is malformed");
            yield { type: "thinking-delta", text: block.thinking };
          }
          if (block.type === "text") {
            search.anthropic(block, textStart, answerText.length, typeof block.text === "string" ? block.text : undefined, blockKey);
          }
        }
        const isDeepSeek = isDeepSeekServer || containsDeepSeekToolBlocks(payload.content);
        const update = (!isDeepSeek && payload.stop_reason === "pause_turn") ? search.snapshot() : search.complete();
        if (update) yield { type: "search-update", search: update };
        if (isDeepSeek) {
          const replay = buildAnthropicDeepSeekReplay(payload.content, request.replayScope ?? request.baseUrl);
          if (replay) yield { type: "provider-replay", replay };
        } else if (payload.stop_reason === "pause_turn" || search.search && search.search.status !== "not-used") {
          yield { type: "provider-replay", replay: { protocol: "anthropic-native", scope: request.replayScope ?? request.baseUrl, content: payload.content } };
        }

        yield {
          type: "completed", finishReason: payload.stop_reason,
          ...(usage ? { usage } : {}),
        };
        return;
      }

      let finishReason: string | undefined;
      let usage: TokenUsage | undefined;
      let terminalOutputTokens: number | undefined;
      let terminalReasoningTokens: number | undefined;
      const thinkingBlocks = new Set<number>();
      const startedBlocks = new Set<number>();
      const replayBlocks = new Map<number, Record<string, unknown>>();
      const jsonDeltas = new Map<number, string>();
      const textStarts = new Map<number, number>();
      let answerText = "";

      for await (const event of parseServerSentEvents(response.body)) {
        if (request.signal?.aborted) {
          if (!refused) {
            try {
              const buffered = JSON.parse(event.data) as AnthropicEvent;
              if (buffered.type === "message_delta" && "delta" in buffered && buffered.delta?.stop_reason === "refusal") {
                const explanation = extractAnthropicRefusalExplanation(buffered.delta.stop_details, request.apiKey);
                refused = { reason: "refusal", ...(explanation ? { explanation } : {}) };
              }
            } catch { /* ignore truncated frame on abort */ }
          }
          yield { type: "aborted", ...(refused ? { clearRefusedContent: true, refusal: refused } : {}) };
          return;
        }
        let payload: AnthropicEvent;
        try {
          payload = JSON.parse(event.data) as AnthropicEvent;
        } catch (parseError) {
          if (event.event === "error") {
            yield {
              type: "failed",
              error: providerFailure("stream_error", event.data || "Anthropic stream error", event.data, request.apiKey),
              ...(refused ? { clearRefusedContent: true, refusal: refused } : {}),
            };
            return;
          }
          throw parseError;
        }
        if (payload.type === "ping") continue;

        if (payload.type === "error" || ("error" in payload && payload.error && typeof payload.error === "object")) {
          if ("usage" in payload && payload.usage) {
            const snapshot = normalizeTokenUsage("anthropic-native", payload.usage);
            if (snapshot) {
              usage = mergeTokenUsage(usage, snapshot, { replaceOutput: true });
              if (usage) yield { type: "usage-update", usage };
              if (request.signal?.aborted) {
                yield { type: "aborted", ...(refused ? { clearRefusedContent: true, refusal: refused } : {}) };
                return;
              }
            }
          }
          yield {
            type: "failed",
            error: providerFailure(
              payload.error?.type ?? null,
              payload.error?.message ?? "Anthropic stream error",
              payload,
              request.apiKey,
            ),
            ...(refused ? { clearRefusedContent: true, refusal: refused } : {}),
          };
          return;
        }

        if (payload.type === "content_block_start" && "content_block" in payload && payload.index !== undefined) {
          if (startedBlocks.has(payload.index)) continue;
          startedBlocks.add(payload.index);
          const block = { ...payload.content_block };
          replayBlocks.set(payload.index, block);
          if (block.type !== "text") search.anthropic(block, answerText.length, answerText.length, undefined, `block:${payload.index}`);
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
          if (block) {
            search.anthropic(
              block,
              textStarts.get(payload.index) ?? answerText.length,
              answerText.length,
              block.type === "text" && typeof block.text === "string" ? block.text : undefined,
              `block:${payload.index}`,
            );
          }
          const update = search.snapshot(); if (update) yield { type: "search-update", search: update };
          thinkingBlocks.delete(payload.index);
          continue;
        }

        if (payload.type === "message_start" && "message" in payload) {
          const snapshot = normalizeTokenUsage("anthropic-native", payload.message?.usage);
          if (snapshot) {
            usage = mergeTokenUsage(usage, snapshot, { replaceOutput: true });
            if (usage) yield { type: "usage-update", usage };
            if (request.signal?.aborted) {
              yield { type: "aborted", ...(refused ? { clearRefusedContent: true, refusal: refused } : {}) };
              return;
            }
          }
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
          const snapshot = normalizeTokenUsage("anthropic-native", "usage" in payload ? payload.usage : undefined);
          if ("delta" in payload && payload.delta?.stop_reason) {
            finishReason = payload.delta.stop_reason;
            terminalOutputTokens = snapshot?.outputTokens;
            terminalReasoningTokens = snapshot?.outputTokens !== undefined ? snapshot.reasoningTokens : undefined;
            if (finishReason === "refusal") {
              const explanation = extractAnthropicRefusalExplanation(payload.delta.stop_details, request.apiKey);
              refused = { reason: "refusal", ...(explanation ? { explanation } : {}) };
            }
          }
          if (snapshot) {
            usage = mergeTokenUsage(usage, snapshot, { replaceOutput: true });
            if (usage) yield { type: "usage-update", usage };
            if (request.signal?.aborted) {
              yield { type: "aborted", ...(refused ? { clearRefusedContent: true, refusal: refused } : {}) };
              return;
            }
          }
          continue;
        }

        if (payload.type === "message_stop") {
          if (!finishReason) {
            yield {
              type: "failed",
              error: { kind: "protocol", message: "Anthropic stream ended without a stop reason", retryable: false },
              ...(refused ? { clearRefusedContent: true, refusal: refused } : {}),
            };
            return;
          }
          const finalObservation = { ...usage };
          delete finalObservation.outputTokens;
          delete finalObservation.reasoningTokens;
          delete finalObservation.totalTokens;
          if (terminalOutputTokens !== undefined) {
            finalObservation.outputTokens = terminalOutputTokens;
            if (terminalReasoningTokens !== undefined) finalObservation.reasoningTokens = terminalReasoningTokens;
          }
          const terminalUsage = mergeTokenUsage(undefined, finalObservation, { replaceOutput: true });
          if (refused) {
            search.clearCitations();
            const update = search.complete();
            if (update) yield { type: "search-update", search: update };
            if (request.signal?.aborted) {
              yield { type: "aborted", clearRefusedContent: true, refusal: refused };
              return;
            }
            yield {
              type: "completed",
              finishReason: "refusal",
              refusal: refused,
              ...(terminalUsage ? { usage: terminalUsage } : {}),
            };
            return;
          }
          const allBlocks = [...replayBlocks.entries()].sort(([a], [b]) => a - b).map(([, block]) => block);
          const isDeepSeek = isDeepSeekServer || containsDeepSeekToolBlocks(allBlocks);
          const update = (!isDeepSeek && finishReason === "pause_turn") ? search.snapshot() : search.complete();
          if (update) yield { type: "search-update", search: update };
          if (isDeepSeek) {
            const replay = buildAnthropicDeepSeekReplay(allBlocks, request.replayScope ?? request.baseUrl);
            if (replay) yield { type: "provider-replay", replay };
          } else if (finishReason === "pause_turn" || search.search && search.search.status !== "not-used") {
            yield {
              type: "provider-replay",
              replay: {
                protocol: "anthropic-native",
                scope: request.replayScope ?? request.baseUrl,
                content: allBlocks,
              },
            };
          }
          yield {
            type: "completed",
            finishReason,
            ...(terminalUsage ? { usage: terminalUsage } : {}),
          };
          return;
        }
      }

      if (request.signal?.aborted) {
        yield { type: "aborted", ...(refused ? { clearRefusedContent: true, refusal: refused } : {}) };
        return;
      }
      yield {
        type: "failed",
        error: {
          kind: "protocol",
          message: "Anthropic stream ended before message_stop",
          retryable: true,
        },
        ...(refused ? { clearRefusedContent: true, refusal: refused } : {}),
      };
    } catch (error) {
      if (request.signal?.aborted) {
        yield { type: "aborted", ...(refused ? { clearRefusedContent: true, refusal: refused } : {}) };
        return;
      }

      yield {
        type: "failed",
        error: failureFrom(error, request.apiKey),
        ...(refused ? { clearRefusedContent: true, refusal: refused } : {}),
      };
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
