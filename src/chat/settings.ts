import { getProtocolOption, isDrawingProtocol, protocolOptions, type ServiceProtocol } from "./protocolOptions";
import type { ChatProtocol } from "./types";
import type { DrawingModelOption, DrawingProtocol } from "../drawing/types";
import { dataCheck, dataRecord, backupFields, migrateData, type DataMigration } from "../storage/dataContract";
import { dataPolicies } from "../storage/dataPolicies";
import { isBrandId, type BrandId, type ProviderAvatarSelection } from "../avatar/brandIds";
import { providerTemplates, getConnectionTemplate, type ProviderTemplateId } from "./providerPresets";
export { providerTemplates } from "./providerPresets";
export type { ProviderTemplateId, ProviderTemplate } from "./providerPresets";
export type { ServiceProtocol } from "./protocolOptions";

export interface ConfiguredModel {
  id: string;
  modelId: string;
  displayName?: string;
}

export interface ConnectionProfile {
  id: string;
  name: string;
  protocol: ServiceProtocol;
  baseUrl: string;
  apiKey: string;
  models: ConfiguredModel[];
  presetProtocol?: ServiceProtocol;
}

export interface ProviderGroup {
  id: string;
  name: string;
  connections: ConnectionProfile[];
  presetId?: BrandId;
  avatar?: ProviderAvatarSelection;
}

export interface ConnectionSettingsState {
  version: 3;
  providers: ProviderGroup[];
  activeModelId: string | null;
  builtinsInitialized?: true;
}

export interface ActiveModelTarget {
  provider: ProviderGroup;
  connection: ConnectionProfile & { protocol: ChatProtocol };
  model: ConfiguredModel;
}

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type ConnectionField = "name" | "protocol" | "baseUrl" | "apiKey";
export type ModelField = "modelId" | "displayName";

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


const protocolValues = new Set<ServiceProtocol>(
  protocolOptions.map((option) => option.value),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isProtocol(value: unknown): value is ServiceProtocol {
  return typeof value === "string" && protocolValues.has(value as ServiceProtocol);
}

export function isChatConnection(connection: ConnectionProfile): connection is ConnectionProfile & { protocol: ChatProtocol } {
  return !isDrawingProtocol(connection.protocol);
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
  original?: ConnectionSettingsState,
): ConnectionSettingsState {
  const activeModelId = providers.some((provider) =>
    provider.connections.some((connection) =>
      isChatConnection(connection) && connection.models.some((model) => model.id === requestedId),
    ),
  )
    ? requestedId
    : null;

  return { ...original, version: 3, providers, activeModelId };
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
      if (!isChatConnection(connection)) continue;
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
): ActiveModelTarget["connection"] | undefined {
  return getActiveTarget(state)?.connection;
}

export function getDrawingTarget(state: ConnectionSettingsState, configuredModelId: string | null): {
  provider: ProviderGroup;
  connection: ConnectionProfile & { protocol: DrawingProtocol };
  model: ConfiguredModel;
} | undefined {
  if (!configuredModelId) return undefined;
  for (const provider of state.providers) {
    for (const connection of provider.connections) {
      if (!isDrawingProtocol(connection.protocol)) continue;
      const model = connection.models.find((candidate) => candidate.id === configuredModelId);
      if (model) return { provider, connection: { ...connection, protocol: connection.protocol }, model };
    }
  }
  return undefined;
}

export function getDrawingModels(state: ConnectionSettingsState): DrawingModelOption[] {
  return state.providers.flatMap((provider) => provider.connections
    .filter((connection): connection is ConnectionProfile & { protocol: DrawingProtocol } => isDrawingProtocol(connection.protocol))
    .flatMap((connection) => connection.models.map((model) => ({
      id: model.id, label: `${provider.name} / ${connection.name} / ${model.displayName || model.modelId}`, protocol: connection.protocol,
    }))));
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
    ...(value.presetProtocol !== undefined ? { presetProtocol: value.presetProtocol as ServiceProtocol } : {}),
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
      ...(candidate.presetId !== undefined ? { presetId: candidate.presetId as BrandId } : {}),
      ...(candidate.avatar !== undefined ? { avatar: structuredClone(candidate.avatar) as ProviderAvatarSelection } : {}),
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
  return { ...repairActiveModel(providers, requestedId), ...(value.builtinsInitialized === true ? { builtinsInitialized: true as const } : {}) };
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
    !isProtocol(protocol) || isDrawingProtocol(protocol) ||
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
  if (value === undefined) return structuredClone(emptyConnectionSettings);
  dataRecord(value);
  dataCheck(Object.keys(value).every(key => ["openai-chat", "openai-responses", "gemini-native", "anthropic-native"].includes(key)),
    "旧连接配置包含不支持的协议；原数据未被修改，请升级应用。");
  for (const profile of Object.values(value)) {
    dataRecord(profile);
    dataCheck(Object.keys(profile).every(key => ["baseUrl", "apiKey", "model"].includes(key))
      && ["baseUrl", "apiKey", "model"].every(key => typeof profile[key] === "string"),
    "旧连接配置结构无法安全迁移；原数据未被修改。");
  }

  const connections = protocolOptions.filter((option) => !isDrawingProtocol(option.value)).flatMap(({ value: protocol, label }) => {
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
    return structuredClone(emptyConnectionSettings);
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
    throw new Error("连接配置已损坏；原数据未被修改，请修复后重试。");
  }
}

export function loadConnectionSettings(
  storage: SettingsStorage = localStorage,
): ConnectionSettingsState {
  const current = parseStoredJson(storage, connectionSettingsStorageKey);
  if (current !== undefined) return readConnectionSettingsData(current);
  const previous = parseStoredJson(storage, previousConnectionSettingsStorageKey);
  if (previous !== undefined) return readConnectionSettingsData(previous);
  return migrateLegacy(
    parseStoredJson(storage, legacyProviderProfilesStorageKey),
  );
}

export const connectionDataMigration: DataMigration = {
  version: 3, oldestVersion: 2,
  migrations: { 2: value => {
    assertConnectionStructure(value, 2);
    const migrated = migrateVersionTwo(value);
    dataCheck(migrated, "连接配置迁移失败；原数据未被修改。");
    return migrated as unknown as Record<string, unknown>;
  } },
};

export function readConnectionSettingsData(raw: unknown): ConnectionSettingsState {
  const value = migrateData(raw, connectionDataMigration);
  assertConnectionStructure(value, 3);
  const parsed = parseVersionThree(value);
  dataCheck(parsed, "连接配置结构不受支持；原数据未被修改。");
  return parsed;
}

function assertConnectionStructure(raw: unknown, version: 2 | 3): void {
  function record(value: unknown, allowed: string[], required = allowed): asserts value is Record<string, any> {
    dataRecord(value);
    dataCheck(Object.keys(value).every(key => allowed.includes(key)) && required.every(key => key in value),
      "连接配置含不支持的字段或结构；原数据未被修改，请升级应用或修复数据。");
  }
  record(raw, version === 3 ? backupFields(dataPolicies.connections) : ["version", "providers", "activeConnectionId"], ["version", "providers"]);
  if (version === 3) dataCheck(raw.builtinsInitialized === undefined || raw.builtinsInitialized === true);
  dataCheck(Array.isArray(raw.providers));
  const ids = new Set<string>();
  function unique(value: unknown) {
    dataCheck(typeof value === "string" && value.trim().length > 0 && !ids.has(value)); ids.add(value);
  }
  for (const provider of raw.providers) {
    record(provider, version === 3 ? backupFields(dataPolicies.provider) : ["id", "name", "connections"], ["id", "name", "connections"]); unique(provider.id);
    if (version === 3) {
      dataCheck(provider.presetId === undefined || isBrandId(provider.presetId));
      if (provider.avatar !== undefined) {
        record(provider.avatar, ["kind", "id"]);
        dataCheck(provider.avatar.kind === "builtin" ? isBrandId(provider.avatar.id)
          : provider.avatar.kind === "image" && typeof provider.avatar.id === "string" && !!provider.avatar.id.trim());
      }
    }
    dataCheck(typeof provider.name === "string" && provider.name.trim() && Array.isArray(provider.connections));
    for (const connection of provider.connections) {
      record(connection, version === 3 ? backupFields(dataPolicies.connection, true) : ["id", "protocol", "baseUrl", "apiKey", "model"], version === 3 ? ["id", "name", "protocol", "baseUrl", "apiKey", "models"] : ["id", "protocol", "baseUrl", "apiKey", "model"]);
      if (version === 3) dataCheck(connection.presetProtocol === undefined || !!getConnectionTemplate(provider.presetId, connection.presetProtocol), "内置连接身份无效，原数据未被修改。");
      unique(connection.id);
      dataCheck(isProtocol(connection.protocol) && (version === 3 || !isDrawingProtocol(connection.protocol)),
        "连接协议不受支持；原数据未被修改，请升级应用。");
      dataCheck(typeof connection.baseUrl === "string" && typeof connection.apiKey === "string");
      if (version === 2) { dataCheck(typeof connection.model === "string"); continue; }
      dataCheck(typeof connection.name === "string" && connection.name.trim() && Array.isArray(connection.models));
      const actualIds = new Set<string>();
      for (const model of connection.models) {
        record(model, backupFields(dataPolicies.model), ["id", "modelId"]); unique(model.id);
        dataCheck(typeof model.modelId === "string" && model.modelId.trim() && !actualIds.has(model.modelId.trim()));
        actualIds.add(model.modelId.trim());
        dataCheck(model.displayName === undefined || typeof model.displayName === "string");
      }
    }
  }
  dataCheck(version === 3 ? raw.activeModelId === undefined || raw.activeModelId === null || typeof raw.activeModelId === "string"
    : raw.activeConnectionId === undefined || raw.activeConnectionId === null || typeof raw.activeConnectionId === "string");
}

export function saveConnectionSettings(
  state: ConnectionSettingsState,
  storage: SettingsStorage = localStorage,
): void {
  // Strictly preflight both the original durable record and the replacement.
  loadConnectionSettings(storage);
  storage.setItem(connectionSettingsStorageKey, JSON.stringify(readConnectionSettingsData(state)));
}

export function createProviderFromTemplate(
  state: ConnectionSettingsState,
  templateId: ProviderTemplateId,
  options: {
    providerId: string;
    connectionIds?: Partial<Record<ServiceProtocol, string>>;
    name?: string;
    prepend?: boolean;
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
      ...(templateId !== "custom" ? { presetProtocol: connectionTemplate.protocol } : {}),
    });
  }

  const provider: ProviderGroup = { id: options.providerId, name, connections, ...(templateId !== "custom" ? { presetId: templateId } : {}) };
  return { ...state, providers: options.prepend ? [provider, ...state.providers] : [...state.providers, provider] };
}

/** Explicit application initialization, never run by backup readers or migrations. */
export function initializeProviderPresets(state: ConnectionSettingsState): ConnectionSettingsState {
  if (state.builtinsInitialized) return state;
  let next = readConnectionSettingsData(state);
  const used = new Set(next.providers.flatMap(p => [p.id, ...p.connections.flatMap(c => [c.id, ...c.models.map(m => m.id)])]));
  function allocate(base: string) {
    let id = base, suffix = 1;
    while (used.has(id)) id = `${base}:${suffix++}`;
    used.add(id); return id;
  }
  for (const template of providerTemplates.filter(p => p.id !== "custom")) {
    if (next.providers.some(p => p.presetId === template.id)) continue;
    next = createProviderFromTemplate(next, template.id, {
      providerId: allocate(`builtin:provider:${template.id}`),
      connectionIds: Object.fromEntries(template.connections.map(c => [c.protocol, allocate(`builtin:connection:${template.id}:${c.protocol}`)])),
    });
  }
  return { ...next, builtinsInitialized: true };
}

export function setProviderAvatar(state: ConnectionSettingsState, providerId: string, avatar: ProviderAvatarSelection | undefined): ConnectionSettingsState {
  const next = { ...state, providers: state.providers.map(p => {
    if (p.id !== providerId) return p;
    const { avatar: _old, ...provider } = p;
    return { ...provider, ...(avatar ? { avatar } : {}) };
  }) };
  return readConnectionSettingsData(next);
}

export function resetPresetConnection(state: ConnectionSettingsState, connectionId: string): ConnectionSettingsState {
  let changed = false;
  const providers = state.providers.map(p => ({ ...p, connections: p.connections.map(c => {
    if (c.id !== connectionId) return c;
    const defaults = getConnectionTemplate(p.presetId, c.presetProtocol);
    if (!defaults) return c;
    changed = true; return { ...c, name: defaults.name, protocol: defaults.protocol, baseUrl: defaults.baseUrl };
  }) }));
  return changed ? repairActiveModel(providers, state.activeModelId, state) : state;
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
    : repairActiveModel(providers, state.activeModelId, state);
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

export function moveConnection(
  state: ConnectionSettingsState,
  connectionId: string,
  targetId: string,
  placement: "before" | "after",
): ConnectionSettingsState {
  if (connectionId === targetId) return state;
  const provider = state.providers.find((item) => item.connections.some((connection) => connection.id === connectionId));
  const connection = provider?.connections.find((item) => item.id === connectionId);
  if (!provider || !connection || !provider.connections.some((item) => item.id === targetId)) return state;
  const connections = provider.connections.filter((item) => item.id !== connectionId);
  const targetIndex = connections.findIndex((item) => item.id === targetId);
  connections.splice(targetIndex + (placement === "after" ? 1 : 0), 0, connection);
  if (connections.every((item, index) => item === provider.connections[index])) return state;
  return {
    ...state,
    providers: state.providers.map((item) => item === provider ? { ...provider, connections } : item),
  };
}

export function addConnection(
  state: ConnectionSettingsState,
  providerId: string,
  connection: {
    id: string;
    name: string;
    protocol: ServiceProtocol;
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
  if (!changed) return state;
  return field === "protocol" ? repairActiveModel(providers, state.activeModelId, state) : { ...state, providers };
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
    ? repairActiveModel(providers, state.activeModelId, state)
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
  return changed ? repairActiveModel(providers, state.activeModelId, state) : state;
}

export function selectModel(
  state: ConnectionSettingsState,
  configuredModelId: string,
): ConnectionSettingsState {
  return allConnections(state).filter(isChatConnection).some((connection) => connection.models.some((model) => model.id === configuredModelId))
    ? { ...state, activeModelId: configuredModelId }
    : state;
}
