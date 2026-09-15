import type {
  ChatProtocol,
  ChatTransportDependencies,
  FetchLike,
} from "./types";
import { redactCredential } from "./redaction";
import {
  resolveModelCatalogEndpoint,
  UrlResolutionError,
} from "./urlResolution";

export interface DiscoveredModel {
  id: string;
  displayName?: string;
  ownedBy?: string;
  family?: string;
}

export interface ModelCatalogRequest {
  baseUrl: string;
  apiKey: string;
  signal?: AbortSignal;
}

export interface ModelCatalogClient {
  list(request: ModelCatalogRequest): Promise<DiscoveredModel[]>;
}

export class ModelCatalogError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ModelCatalogError";
    this.status = status;
  }
}

function readString(
  value: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

function parseCatalogEntry(
  value: unknown,
  protocol: ChatProtocol,
): DiscoveredModel | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const rawId = readString(record, "id", "name");
  if (!rawId) {
    return undefined;
  }
  const id =
    protocol === "gemini-native" && rawId.startsWith("models/")
      ? rawId.slice("models/".length)
      : rawId;
  if (!id) {
    return undefined;
  }
  const displayName = readString(record, "display_name", "displayName");
  const ownedBy = readString(record, "owned_by", "ownedBy", "publisher");
  const family = readString(record, "family", "model_family", "modelFamily");
  return {
    id,
    ...(displayName ? { displayName } : {}),
    ...(ownedBy ? { ownedBy } : {}),
    ...(family ? { family } : {}),
  };
}

function mergeModels(
  current: DiscoveredModel,
  incoming: DiscoveredModel,
): DiscoveredModel {
  return {
    id: current.id,
    ...(current.displayName || incoming.displayName
      ? { displayName: current.displayName ?? incoming.displayName }
      : {}),
    ...(current.ownedBy || incoming.ownedBy
      ? { ownedBy: current.ownedBy ?? incoming.ownedBy }
      : {}),
    ...(current.family || incoming.family
      ? { family: current.family ?? incoming.family }
      : {}),
  };
}

interface NormalizedCatalogPage {
  models: DiscoveredModel[];
  nextCursor?: string;
}

function mergeCatalog(models: DiscoveredModel[]): DiscoveredModel[] {
  const byId = new Map<string, DiscoveredModel>();
  for (const model of models) {
    const current = byId.get(model.id);
    byId.set(model.id, current ? mergeModels(current, model) : model);
  }
  return [...byId.values()].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
}

function normalizeCatalogPage(
  value: unknown,
  protocol: ChatProtocol,
): NormalizedCatalogPage {
  if (typeof value !== "object" || value === null) {
    throw new ModelCatalogError("模型列表响应格式无效。");
  }
  const record = value as Record<string, unknown>;
  const rawModels = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : Array.isArray(value)
        ? value
        : undefined;
  if (!rawModels) {
    throw new ModelCatalogError("模型列表响应中没有可识别的模型数组。");
  }

  const models: DiscoveredModel[] = [];
  for (const rawModel of rawModels) {
    const model = parseCatalogEntry(rawModel, protocol);
    if (model) models.push(model);
  }
  const nextCursor =
    protocol === "gemini-native"
      ? readString(record, "nextPageToken")
      : protocol === "anthropic-native" && record.has_more === true
        ? readString(record, "last_id")
        : undefined;
  if (protocol === "anthropic-native" && record.has_more === true && !nextCursor) {
    throw new ModelCatalogError("模型列表分页响应缺少下一页游标。");
  }
  return { models: mergeCatalog(models), ...(nextCursor ? { nextCursor } : {}) };
}

async function readErrorMessage(
  response: Response,
  credential: string,
): Promise<string> {
  try {
    const value = (await response.json()) as unknown;
    if (typeof value === "object" && value !== null) {
      const record = value as Record<string, unknown>;
      if (typeof record.error === "object" && record.error !== null) {
        const message = readString(
          record.error as Record<string, unknown>,
          "message",
        );
        if (message) {
          return redactCredential(message, credential);
        }
      }
      const message = readString(record, "message", "error");
      if (message) {
        return redactCredential(message, credential);
      }
    }
  } catch {
    // Fall through to a status-only message.
  }
  return `模型列表请求失败（HTTP ${response.status}）。`;
}

function catalogPageEndpoint(
  endpoint: string,
  protocol: ChatProtocol,
  cursor: string | undefined,
): string {
  if (!cursor) return endpoint;
  const url = new URL(endpoint);
  url.searchParams.set(
    protocol === "gemini-native" ? "pageToken" : "after_id",
    cursor,
  );
  return url.toString();
}

function catalogHeaders(
  protocol: ChatProtocol,
  apiKey: string,
): Record<string, string> {
  const common = { Accept: "application/json" };
  if (protocol === "gemini-native") {
    return { ...common, "x-goog-api-key": apiKey };
  }
  if (protocol === "anthropic-native") {
    return {
      ...common,
      "anthropic-version": "2023-06-01",
      "x-api-key": apiKey,
    };
  }
  return { ...common, Authorization: `Bearer ${apiKey}` };
}

class FetchModelCatalogClient implements ModelCatalogClient {
  constructor(
    private readonly protocol: ChatProtocol,
    private readonly fetch: FetchLike,
  ) {}

  async list(request: ModelCatalogRequest): Promise<DiscoveredModel[]> {
    let endpoint: string;
    try {
      endpoint = resolveModelCatalogEndpoint(
        this.protocol,
        request.baseUrl,
      ).resolvedEndpoint;
    } catch (error) {
      if (error instanceof UrlResolutionError) {
        throw new ModelCatalogError(error.message);
      }
      throw error;
    }
    const collected: DiscoveredModel[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      let response: Response;
      try {
        response = await this.fetch(
          catalogPageEndpoint(endpoint, this.protocol, cursor),
          {
            method: "GET",
            headers: catalogHeaders(this.protocol, request.apiKey),
            signal: request.signal,
          },
        );
      } catch (error) {
        if (request.signal?.aborted) {
          throw error;
        }
        throw new ModelCatalogError("无法连接模型列表接口。");
      }
      if (!response.ok) {
        throw new ModelCatalogError(
          await readErrorMessage(response, request.apiKey),
          response.status,
        );
      }
      let value: unknown;
      try {
        value = await response.json();
      } catch {
        throw new ModelCatalogError("模型列表响应不是有效 JSON。");
      }
      const normalized = normalizeCatalogPage(value, this.protocol);
      collected.push(...normalized.models);
      if (!normalized.nextCursor) {
        return mergeCatalog(collected);
      }
      if (seenCursors.has(normalized.nextCursor)) {
        throw new ModelCatalogError("模型列表返回了重复的分页游标。");
      }
      seenCursors.add(normalized.nextCursor);
      cursor = normalized.nextCursor;
    }
    throw new ModelCatalogError("模型列表分页数量超过安全上限。");
  }
}

export function createModelCatalogClient(
  protocol: ChatProtocol,
  dependencies: ChatTransportDependencies,
): ModelCatalogClient {
  return new FetchModelCatalogClient(protocol, dependencies.fetch);
}
