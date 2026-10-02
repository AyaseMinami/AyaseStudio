import type { ChatProtocol } from "./types";
import { isDrawingProtocol, type ServiceProtocol } from "./protocolOptions";

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
  protocol: ServiceProtocol,
  configuredBaseUrl: string,
): string {
  const url = parsedBaseUrl(configuredBaseUrl);
  if (isDrawingProtocol(protocol) && url.protocol !== "https:") {
    throw new UrlResolutionError("invalid-scheme", "绘图 Base URL 只支持 HTTPS 地址。");
  }
  const path = url.pathname.replace(/\/+$/, "");
  // DeepSeek's current official Chat/Responses contract uses an unversioned root.
  // Explicit paths and other hosts retain the existing generic URL rules.
  const deepSeekRoot = !path && url.origin === "https://api.deepseek.com"
    && (protocol === "openai-chat" || protocol === "openai-responses");
  const normalizedPath =
    !path && !deepSeekRoot && (protocol === "openai-chat" || protocol === "openai-responses" || protocol === "openai-images" || protocol === "grok-images")
      ? "/v1"
      : !path && protocol === "seedream-images" ? "/api/v3"
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
  stream = true,
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
    resolvedEndpoint = `${versionedPath(normalizedBaseUrl, "/v1beta")}/models/${encodeURIComponent(model)}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`;
  }
  return { normalizedBaseUrl, resolvedEndpoint };
}

export function resolveModelCatalogEndpoint(
  protocol: ServiceProtocol,
  configuredBaseUrl: string,
): ResolvedUrl {
  if (protocol === "seedream-images") throw new UrlResolutionError("invalid-url", "Seedream 绘图请手动添加模型，尚未接入模型目录接口。");
  const normalizedBaseUrl = normalizeBaseUrl(protocol, configuredBaseUrl);
  const version = protocol === "gemini-native" || protocol === "gemini-image" ? "/v1beta" : "/v1";
  return {
    normalizedBaseUrl,
    resolvedEndpoint: `${((protocol === "openai-chat" || protocol === "openai-responses") && normalizedBaseUrl === "https://api.deepseek.com") || /\/v\d+(?:beta\d*)?(?:\/openai)?$/.test(normalizedBaseUrl)
      ? normalizedBaseUrl : versionedPath(normalizedBaseUrl, version)}/models`,
  };
}

export function resolveImageGenerationEndpoint(baseUrl: string, modelId: string): string {
  const normalizedBaseUrl = normalizeBaseUrl("gemini-image", baseUrl);
  return resolveGenerationEndpoint("gemini-native", normalizedBaseUrl, modelId.trim(), false).resolvedEndpoint;
}

export function resolveOpenAIImagesEndpoint(baseUrl: string, modelId: string, operation: "generations" | "edits" = "generations"): string {
  const base = normalizeBaseUrl("openai-images", baseUrl);
  if (!modelId.trim()) throw new UrlResolutionError("missing-model", "请先添加并选择绘图模型 ID。");
  return `${base}/images/${operation}`;
}

export function resolveGrokImagesEndpoint(baseUrl: string, modelId: string, operation: "generations" | "edits" = "generations"): string {
  const base = normalizeBaseUrl("grok-images", baseUrl);
  if (!modelId.trim()) throw new UrlResolutionError("missing-model", "请先添加并选择绘图模型 ID。");
  return `${base}/images/${operation}`;
}

export function resolveSeedreamImagesEndpoint(baseUrl: string, modelId: string): string {
  const base = normalizeBaseUrl("seedream-images", baseUrl);
  if (!modelId.trim()) throw new UrlResolutionError("missing-model", "请先添加并选择绘图模型 ID。");
  return `${base}/images/generations`;
}
