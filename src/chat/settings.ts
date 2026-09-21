import { getProtocolOption, protocolOptions } from "./protocolOptions";
import type { ChatProtocol } from "./types";

export interface ConfiguredModel {
  id: string;
  modelId: string;
  displayName?: string;
}

export interface ConnectionProfile {
  id: string;
  name: string;
  protocol: ChatProtocol;
  baseUrl: string;
  apiKey: string;
  models: ConfiguredModel[];
}

export interface ProviderGroup {
  id: string;
  name: string;
  connections: ConnectionProfile[];
}

export interface ConnectionSettingsState {
  version: 3;
  providers: ProviderGroup[];
  activeModelId: string | null;
}

export interface ActiveModelTarget {
  provider: ProviderGroup;
  connection: ConnectionProfile;
  model: ConfiguredModel;
}

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type ConnectionField = "name" | "protocol" | "baseUrl" | "apiKey";
export type ModelField = "modelId" | "displayName";
export type ProviderTemplateId = "openai" | "gemini" | "anthropic" | "custom";

interface ConnectionTemplate {
  name: string;
  protocol: ChatProtocol;
  baseUrl: string;
}

export interface ProviderTemplate {
  id: ProviderTemplateId;
  label: string;
  providerName: string;
  connections: readonly ConnectionTemplate[];
}

export const connectionSettingsStorageKey =
  "ayase-studio.connection-settings.v3";
export const previousConnectionSettingsStorageKey =
  "ayase-studio.connection-settings.v2";
export const legacyProviderProfilesStorageKey =
  "ayase-studio.provider-profiles.v1";

export const emptyConnectionSettings: ConnectionSettingsState = {
  version: 3,
  providers: [],
  activeModelId: null,
};

export const providerTemplates: readonly ProviderTemplate[] = [
  {
    id: "openai",
    label: "OpenAI",
    providerName: "OpenAI",
    connections: [
      {
        name: "OpenAI Chat",
        protocol: "openai-chat",
        baseUrl: "https://api.openai.com/v1",
      },
      {
        name: "OpenAI Responses",
        protocol: "openai-responses",
        baseUrl: "https://api.openai.com/v1",
      },
    ],
  },
  {
    id: "gemini",
    label: "Gemini",
    providerName: "Google Gemini",
    connections: [
      {
        name: "Gemini Native",
        protocol: "gemini-native",
        baseUrl: "https://generativelanguage.googleapis.com",
      },
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    providerName: "Anthropic",
    connections: [
      {
        name: "Anthropic Native",
        protocol: "anthropic-native",
        baseUrl: "https://api.anthropic.com",
      },
    ],
  },
  {
    id: "custom",
    label: "自定义",
    providerName: "自定义供应商",
    connections: [],
  },
];

const protocolValues = new Set<ChatProtocol>(
  protocolOptions.map((option) => option.value),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isProtocol(value: unknown): value is ChatProtocol {
  return typeof value === "string" && protocolValues.has(value as ChatProtocol);
}

function allConnections(state: ConnectionSettingsState): ConnectionProfile[] {
  return state.providers.flatMap((provider) => provider.connections);
}

function allModels(state: ConnectionSettingsState): ConfiguredModel[] {
  return allConnections(state).flatMap((connection) => connection.models);
}

function repairActiveModel(
  providers: ProviderGroup[],
  requestedId: string | null,
): ConnectionSettingsState {
  const activeModelId = providers.some((provider) =>
    provider.connections.some((connection) =>
      connection.models.some((model) => model.id === requestedId),
    ),
  )
    ? requestedId
    : null;

  return { version: 3, providers, activeModelId };
}

export function getConnection(
  state: ConnectionSettingsState,
  connectionId: string,
): ConnectionProfile | undefined {
  return allConnections(state).find((connection) => connection.id === connectionId);
}

export function getActiveTarget(
  state: ConnectionSettingsState,
): ActiveModelTarget | undefined {
  if (!state.activeModelId) {
    return undefined;
  }
  for (const provider of state.providers) {
    for (const connection of provider.connections) {
      const model = connection.models.find(
        (candidate) => candidate.id === state.activeModelId,
      );
      if (model) {
        return { provider, connection, model };
      }
    }
  }
  return undefined;
}

export function getActiveProvider(
  state: ConnectionSettingsState,
): ProviderGroup | undefined {
  return getActiveTarget(state)?.provider;
}

export function getActiveConnection(
  state: ConnectionSettingsState,
): ConnectionProfile | undefined {
  return getActiveTarget(state)?.connection;
}

export function getActiveModel(
  state: ConnectionSettingsState,
): ConfiguredModel | undefined {
  return getActiveTarget(state)?.model;
}

function sanitizeModel(
  value: unknown,
  modelIds: Set<string>,
  actualIds: Set<string>,
): ConfiguredModel | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { id, modelId, displayName } = value;
  const normalizedModelId = typeof modelId === "string" ? modelId.trim() : "";
  if (
    typeof id !== "string" ||
    !id.trim() ||
    modelIds.has(id) ||
    !normalizedModelId ||
    actualIds.has(normalizedModelId) ||
    (displayName !== undefined && typeof displayName !== "string")
  ) {
    return undefined;
  }
  modelIds.add(id);
  actualIds.add(normalizedModelId);
  const normalizedDisplayName =
    typeof displayName === "string" ? displayName.trim() : "";
  return {
    id,
    modelId: normalizedModelId,
    ...(normalizedDisplayName ? { displayName: normalizedDisplayName } : {}),
  };
}

function sanitizeConnection(
  value: unknown,
  connectionIds: Set<string>,
  modelIds: Set<string>,
): ConnectionProfile | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { id, name, protocol, baseUrl, apiKey, models } = value;
  if (
    typeof id !== "string" ||
    !id.trim() ||
    connectionIds.has(id) ||
    typeof name !== "string" ||
    !name.trim() ||
    !isProtocol(protocol) ||
    typeof baseUrl !== "string" ||
    typeof apiKey !== "string"
  ) {
    return undefined;
  }

  connectionIds.add(id);
  const actualIds = new Set<string>();
  const sanitizedModels = Array.isArray(models)
    ? models.flatMap((model) => {
        const sanitized = sanitizeModel(model, modelIds, actualIds);
        return sanitized ? [sanitized] : [];
      })
    : [];
  return {
    id,
    name: name.trim(),
    protocol,
    baseUrl,
    apiKey,
    models: sanitizedModels,
  };
}

function sanitizeProviders(value: unknown): ProviderGroup[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const providerIds = new Set<string>();
  const connectionIds = new Set<string>();
  const modelIds = new Set<string>();
  const providers: ProviderGroup[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) {
      continue;
    }
    const { id, name, connections } = candidate;
    if (
      typeof id !== "string" ||
      !id.trim() ||
      providerIds.has(id) ||
      typeof name !== "string" ||
      !name.trim()
    ) {
      continue;
    }

    providerIds.add(id);
    const sanitizedConnections = Array.isArray(connections)
      ? connections.flatMap((connection) => {
          const sanitized = sanitizeConnection(
            connection,
            connectionIds,
            modelIds,
          );
          return sanitized ? [sanitized] : [];
        })
      : [];
    providers.push({
      id,
      name: name.trim(),
      connections: sanitizedConnections,
    });
  }
  return providers;
}

function parseVersionThree(value: unknown): ConnectionSettingsState | undefined {
  if (!isRecord(value) || value.version !== 3) {
    return undefined;
  }
  const providers = sanitizeProviders(value.providers);
  if (!providers) {
    return undefined;
  }
  const requestedId =
    typeof value.activeModelId === "string" ? value.activeModelId : null;
  return repairActiveModel(providers, requestedId);
}

interface PreviousConnectionProfile {
  id: string;
  protocol: ChatProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
}

function parsePreviousConnection(
  value: unknown,
  connectionIds: Set<string>,
): PreviousConnectionProfile | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { id, protocol, baseUrl, apiKey, model } = value;
  if (
    typeof id !== "string" ||
    !id.trim() ||
    connectionIds.has(id) ||
    !isProtocol(protocol) ||
    typeof baseUrl !== "string" ||
    typeof apiKey !== "string" ||
    typeof model !== "string"
  ) {
    return undefined;
  }
  connectionIds.add(id);
  return { id, protocol, baseUrl, apiKey, model };
}

function migrateVersionTwo(value: unknown): ConnectionSettingsState | undefined {
  if (!isRecord(value) || value.version !== 2 || !Array.isArray(value.providers)) {
    return undefined;
  }
  const providerIds = new Set<string>();
  const connectionIds = new Set<string>();
  const modelIdByConnectionId = new Map<string, string>();
  const providers: ProviderGroup[] = [];

  for (const candidate of value.providers) {
    if (!isRecord(candidate)) {
      continue;
    }
    const { id, name, connections } = candidate;
    if (
      typeof id !== "string" ||
      !id.trim() ||
      providerIds.has(id) ||
      typeof name !== "string" ||
      !name.trim()
    ) {
      continue;
    }
    providerIds.add(id);
    const nameCounts = new Map<string, number>();
    const migratedConnections: ConnectionProfile[] = [];
    if (Array.isArray(connections)) {
      for (const rawConnection of connections) {
        const previous = parsePreviousConnection(rawConnection, connectionIds);
        if (!previous) {
          continue;
        }
        const baseName = getProtocolOption(previous.protocol).label;
        const count = (nameCounts.get(baseName) ?? 0) + 1;
        nameCounts.set(baseName, count);
        const modelId = previous.model.trim();
        const model = modelId
          ? {
              id: `migrated-model-${previous.id}`,
              modelId,
            }
          : undefined;
        if (model) {
          modelIdByConnectionId.set(previous.id, model.id);
        }
        migratedConnections.push({
          id: previous.id,
          name: count === 1 ? baseName : `${baseName} ${count}`,
          protocol: previous.protocol,
          baseUrl: previous.baseUrl,
          apiKey: previous.apiKey,
          models: model ? [model] : [],
        });
      }
    }
    providers.push({ id, name: name.trim(), connections: migratedConnections });
  }

  const previousActiveConnectionId =
    typeof value.activeConnectionId === "string" ? value.activeConnectionId : "";
  return repairActiveModel(
    providers,
    modelIdByConnectionId.get(previousActiveConnectionId) ?? null,
  );
}

interface LegacyProviderProfile {
  baseUrl: string;
  apiKey: string;
  model: string;
}

function parseLegacyProfile(value: unknown): LegacyProviderProfile | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { baseUrl, apiKey, model } = value;
  if (
    typeof baseUrl !== "string" ||
    typeof apiKey !== "string" ||
    typeof model !== "string" ||
    [baseUrl, apiKey, model].every((field) => !field.trim())
  ) {
    return undefined;
  }
  return { baseUrl, apiKey, model };
}

function migrateLegacy(value: unknown): ConnectionSettingsState {
  if (!isRecord(value)) {
    return emptyConnectionSettings;
  }

  const connections = protocolOptions.flatMap(({ value: protocol, label }) => {
    const profile = parseLegacyProfile(value[protocol]);
    if (!profile) {
      return [];
    }
    const modelId = profile.model.trim();
    return [
      {
        id: `legacy-${protocol}`,
        name: label,
        protocol,
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey,
        models: modelId
          ? [{ id: `legacy-model-${protocol}`, modelId }]
          : [],
      },
    ];
  });
  if (connections.length === 0) {
    return emptyConnectionSettings;
  }
  const firstModelId = connections.flatMap((connection) => connection.models)[0]?.id;
  return {
    version: 3,
    providers: [
      { id: "legacy-provider", name: "已迁移配置", connections },
    ],
    activeModelId: firstModelId ?? null,
  };
}

function parseStoredJson(storage: SettingsStorage, key: string): unknown {
  const serialized = storage.getItem(key);
  if (serialized === null) {
    return undefined;
  }
  try {
    return JSON.parse(serialized) as unknown;
  } catch {
    return undefined;
  }
}

export function loadConnectionSettings(
  storage: SettingsStorage = localStorage,
): ConnectionSettingsState {
  const current = parseVersionThree(
    parseStoredJson(storage, connectionSettingsStorageKey),
  );
  if (current) {
    return current;
  }
  const previous = migrateVersionTwo(
    parseStoredJson(storage, previousConnectionSettingsStorageKey),
  );
  if (previous) {
    return previous;
  }
  return migrateLegacy(
    parseStoredJson(storage, legacyProviderProfilesStorageKey),
  );
}

export function saveConnectionSettings(
  state: ConnectionSettingsState,
  storage: SettingsStorage = localStorage,
): void {
  storage.setItem(connectionSettingsStorageKey, JSON.stringify(state));
}

export function createProviderFromTemplate(
  state: ConnectionSettingsState,
  templateId: ProviderTemplateId,
  options: {
    providerId: string;
    connectionIds?: Partial<Record<ChatProtocol, string>>;
    name?: string;
  },
): ConnectionSettingsState {
  const template = providerTemplates.find((candidate) => candidate.id === templateId);
  const name = (options.name ?? template?.providerName ?? "").trim();
  if (
    !template ||
    !options.providerId.trim() ||
    !name ||
    state.providers.some((provider) => provider.id === options.providerId)
  ) {
    return state;
  }

  const existingConnectionIds = new Set(
    allConnections(state).map((connection) => connection.id),
  );
  const connections: ConnectionProfile[] = [];
  for (const connectionTemplate of template.connections) {
    const id = options.connectionIds?.[connectionTemplate.protocol];
    if (!id?.trim() || existingConnectionIds.has(id)) {
      return state;
    }
    existingConnectionIds.add(id);
    connections.push({
      id,
      name: connectionTemplate.name,
      protocol: connectionTemplate.protocol,
      baseUrl: connectionTemplate.baseUrl,
      apiKey: "",
      models: [],
    });
  }

  return {
    ...state,
    providers: [...state.providers, { id: options.providerId, name, connections }],
  };
}

export function renameProvider(
  state: ConnectionSettingsState,
  providerId: string,
  name: string,
): ConnectionSettingsState {
  const normalizedName = name.trim();
  if (!normalizedName) {
    return state;
  }
  let changed = false;
  const providers = state.providers.map((provider) => {
    if (provider.id !== providerId || provider.name === normalizedName) {
      return provider;
    }
    changed = true;
    return { ...provider, name: normalizedName };
  });
  return changed ? { ...state, providers } : state;
}

export function deleteProvider(
  state: ConnectionSettingsState,
  providerId: string,
): ConnectionSettingsState {
  const providers = state.providers.filter((provider) => provider.id !== providerId);
  return providers.length === state.providers.length
    ? state
    : repairActiveModel(providers, state.activeModelId);
}

export function moveProvider(
  state: ConnectionSettingsState,
  providerId: string,
  targetId: string,
  placement: "before" | "after",
): ConnectionSettingsState {
  const provider = state.providers.find((item) => item.id === providerId);
  if (!provider || providerId === targetId || !state.providers.some((item) => item.id === targetId)) return state;
  const providers = state.providers.filter((item) => item.id !== providerId);
  const targetIndex = providers.findIndex((item) => item.id === targetId);
  providers.splice(targetIndex + (placement === "after" ? 1 : 0), 0, provider);
  return providers.every((item, index) => item === state.providers[index]) ? state : { ...state, providers };
}

export function addConnection(
  state: ConnectionSettingsState,
  providerId: string,
  connection: {
    id: string;
    name: string;
    protocol: ChatProtocol;
    copyFromConnectionId?: string;
  },
): ConnectionSettingsState {
  const name = connection.name.trim();
  if (
    !connection.id.trim() ||
    !name ||
    !isProtocol(connection.protocol) ||
    allConnections(state).some((candidate) => candidate.id === connection.id)
  ) {
    return state;
  }

  let added = false;
  const providers = state.providers.map((provider) => {
    if (provider.id !== providerId) {
      return provider;
    }
    const source = provider.connections.find(
      (candidate) => candidate.id === connection.copyFromConnectionId,
    );
    added = true;
    return {
      ...provider,
      connections: [
        ...provider.connections,
        {
          id: connection.id,
          name,
          protocol: connection.protocol,
          baseUrl: source?.baseUrl ?? "",
          apiKey: source?.apiKey ?? "",
          models: [],
        },
      ],
    };
  });
  return added ? { ...state, providers } : state;
}

export function updateConnection(
  state: ConnectionSettingsState,
  connectionId: string,
  field: ConnectionField,
  value: string,
): ConnectionSettingsState {
  if (field === "protocol" && !isProtocol(value)) {
    return state;
  }
  const normalizedValue = field === "name" ? value.trim() : value;
  if (field === "name" && !normalizedValue) {
    return state;
  }
  let changed = false;
  const providers = state.providers.map((provider) => ({
    ...provider,
    connections: provider.connections.map((connection) => {
      if (connection.id !== connectionId || connection[field] === normalizedValue) {
        return connection;
      }
      changed = true;
      return { ...connection, [field]: normalizedValue };
    }),
  }));
  return changed ? { ...state, providers } : state;
}

export function deleteConnection(
  state: ConnectionSettingsState,
  connectionId: string,
): ConnectionSettingsState {
  let changed = false;
  const providers = state.providers.map((provider) => {
    const connections = provider.connections.filter(
      (connection) => connection.id !== connectionId,
    );
    if (connections.length === provider.connections.length) {
      return provider;
    }
    changed = true;
    return { ...provider, connections };
  });
  return changed
    ? repairActiveModel(providers, state.activeModelId)
    : state;
}

export function addModel(
  state: ConnectionSettingsState,
  connectionId: string,
  model: { id: string; modelId: string; displayName?: string },
): ConnectionSettingsState {
  const modelId = model.modelId.trim();
  const displayName = model.displayName?.trim();
  if (
    !model.id.trim() ||
    !modelId ||
    allModels(state).some((candidate) => candidate.id === model.id)
  ) {
    return state;
  }
  let changed = false;
  const providers = state.providers.map((provider) => ({
    ...provider,
    connections: provider.connections.map((connection) => {
      if (
        connection.id !== connectionId ||
        connection.models.some((candidate) => candidate.modelId === modelId)
      ) {
        return connection;
      }
      changed = true;
      return {
        ...connection,
        models: [
          ...connection.models,
          {
            id: model.id,
            modelId,
            ...(displayName ? { displayName } : {}),
          },
        ],
      };
    }),
  }));
  return changed ? { ...state, providers } : state;
}

export function updateModel(
  state: ConnectionSettingsState,
  configuredModelId: string,
  field: ModelField,
  value: string,
): ConnectionSettingsState {
  const normalizedValue = value.trim();
  if (field === "modelId" && !normalizedValue) {
    return state;
  }
  let changed = false;
  const providers = state.providers.map((provider) => ({
    ...provider,
    connections: provider.connections.map((connection) => {
      const target = connection.models.find(
        (model) => model.id === configuredModelId,
      );
      if (!target) {
        return connection;
      }
      if (
        field === "modelId" &&
        connection.models.some(
          (model) =>
            model.id !== configuredModelId && model.modelId === normalizedValue,
        )
      ) {
        return connection;
      }
      const nextModels = connection.models.map((model) => {
        if (model.id !== configuredModelId) {
          return model;
        }
        if (field === "displayName") {
          if ((model.displayName ?? "") === normalizedValue) {
            return model;
          }
          changed = true;
          const { displayName: _displayName, ...withoutDisplayName } = model;
          return normalizedValue
            ? { ...withoutDisplayName, displayName: normalizedValue }
            : withoutDisplayName;
        }
        if (model.modelId === normalizedValue) {
          return model;
        }
        changed = true;
        return { ...model, modelId: normalizedValue };
      });
      return changed ? { ...connection, models: nextModels } : connection;
    }),
  }));
  return changed ? { ...state, providers } : state;
}

export function deleteModel(
  state: ConnectionSettingsState,
  configuredModelId: string,
): ConnectionSettingsState {
  let changed = false;
  const providers = state.providers.map((provider) => ({
    ...provider,
    connections: provider.connections.map((connection) => {
      const models = connection.models.filter(
        (model) => model.id !== configuredModelId,
      );
      if (models.length === connection.models.length) {
        return connection;
      }
      changed = true;
      return { ...connection, models };
    }),
  }));
  return changed ? repairActiveModel(providers, state.activeModelId) : state;
}

export function selectModel(
  state: ConnectionSettingsState,
  configuredModelId: string,
): ConnectionSettingsState {
  return allModels(state).some((model) => model.id === configuredModelId)
    ? { ...state, activeModelId: configuredModelId }
    : state;
}
