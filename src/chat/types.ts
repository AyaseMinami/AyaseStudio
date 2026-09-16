export type ChatProtocol =
  | "openai-chat"
  | "openai-responses"
  | "gemini-native"
  | "anthropic-native";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  attachments?: Array<import("./attachments").SentAttachment | import("./attachments").RequestAttachment>;
}

export interface ChatRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
  maxOutputTokens?: number;
  config?: import("./sessionConfig").SessionConfig;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export type ChatFailureKind =
  | "rate-limit"
  | "server"
  | "http"
  | "provider"
  | "network"
  | "protocol";

export interface ChatFailure {
  kind: ChatFailureKind;
  message: string;
  status?: number;
  retryable: boolean;
}

export type ChatEvent =
  | { type: "text-delta"; text: string }
  | { type: "thinking-delta"; text: string }
  | { type: "completed"; finishReason?: string; usage?: TokenUsage }
  | { type: "failed"; error: ChatFailure }
  | { type: "aborted" };

export interface ChatTransport {
  stream(request: ChatRequest): AsyncIterable<ChatEvent>;
}

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface ChatTransportDependencies {
  fetch: FetchLike;
}
