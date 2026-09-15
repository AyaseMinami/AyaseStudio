import type { ChatProtocol } from "./types";

export type UrlResolutionErrorCode =
  | "invalid-url"
  | "invalid-scheme"
  | "query"
  | "fragment"
  | "userinfo"
  | "missing-model";

export class UrlResolutionError extends Error {
  constructor(readonly code: UrlResolutionErrorCode, message: string) {
    super(message);
    this.name = "UrlResolutionError";
  }
}

export interface ResolvedUrl {
  normalizedBaseUrl: string;
  resolvedEndpoint: string;
}

function parsedBaseUrl(configuredBaseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(configuredBaseUrl.trim());
  } catch {
    throw new UrlResolutionError("invalid-url", "Base URL 不是有效网址。");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UrlResolutionError("invalid-scheme", "Base URL 只支持 HTTP(S) 地址。");
  }
  if (url.username || url.password) {
    throw new UrlResolutionError("userinfo", "Base URL 不能包含用户名或密码。");
  }
  const queryIndex = url.href.indexOf("?");
  const fragmentIndex = url.href.indexOf("#");
  if (queryIndex >= 0 && (fragmentIndex < 0 || queryIndex < fragmentIndex)) {
    throw new UrlResolutionError("query", "Base URL 不能包含查询参数。");
  }
  if (fragmentIndex >= 0) {
    throw new UrlResolutionError("fragment", "Base URL 不能包含片段。");
  }
  return url;
}

export function normalizeBaseUrl(
  protocol: ChatProtocol,
  configuredBaseUrl: string,
): string {
  const url = parsedBaseUrl(configuredBaseUrl);
  const path = url.pathname.replace(/\/+$/, "");
  const normalizedPath =
    !path && (protocol === "openai-chat" || protocol === "openai-responses")
      ? "/v1"
      : path;
  return `${url.origin}${normalizedPath}`;
}

function versionedPath(base: string, version: "/v1" | "/v1beta"): string {
  return base.endsWith(version) ? base : `${base}${version}`;
}

export function resolveGenerationEndpoint(
  protocol: ChatProtocol,
  configuredBaseUrl: string,
  model?: string,
): ResolvedUrl {
  const normalizedBaseUrl = normalizeBaseUrl(protocol, configuredBaseUrl);
  let resolvedEndpoint: string;
  if (protocol === "openai-chat") {
    resolvedEndpoint = `${normalizedBaseUrl}/chat/completions`;
  } else if (protocol === "openai-responses") {
    resolvedEndpoint = `${normalizedBaseUrl}/responses`;
  } else if (protocol === "anthropic-native") {
    resolvedEndpoint = `${versionedPath(normalizedBaseUrl, "/v1")}/messages`;
  } else {
    if (!model?.trim()) {
      throw new UrlResolutionError("missing-model", "请先添加并选择 Gemini 模型 ID。");
    }
    resolvedEndpoint = `${versionedPath(normalizedBaseUrl, "/v1beta")}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  }
  return { normalizedBaseUrl, resolvedEndpoint };
}

export function resolveModelCatalogEndpoint(
  protocol: ChatProtocol,
  configuredBaseUrl: string,
): ResolvedUrl {
  const normalizedBaseUrl = normalizeBaseUrl(protocol, configuredBaseUrl);
  const version = protocol === "gemini-native" ? "/v1beta" : "/v1";
  return {
    normalizedBaseUrl,
    resolvedEndpoint: `${versionedPath(normalizedBaseUrl, version)}/models`,
  };
}
