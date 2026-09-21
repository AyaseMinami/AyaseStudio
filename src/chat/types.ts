export type ChatProtocol =
  | "openai-chat"
  | "openai-responses"
  | "gemini-native"
  | "anthropic-native";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  search?: import("./nativeSearch").SearchRecord;
  providerReplay?: import("./nativeSearch").ProviderReplay;
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
  replayScope?: string;
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
  | { type: "search-update"; search: import("./nativeSearch").SearchRecord }
  | { type: "provider-replay"; replay: import("./nativeSearch").ProviderReplay }
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
