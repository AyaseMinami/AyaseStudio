import { beforeEach, describe, expect, it } from "vitest";

import {
  addConnection,
  addModel,
  connectionSettingsStorageKey,
  createProviderFromTemplate,
  deleteConnection,
  deleteModel,
  deleteProvider,
  emptyConnectionSettings,
  getActiveTarget,
  getActiveConnection,
  getDrawingModels,
  getDrawingTarget,
  loadConnectionSettings,
  previousConnectionSettingsStorageKey,
  renameProvider,
  moveProvider,
  moveConnection,
  saveConnectionSettings,
  selectModel,
  updateConnection,
  updateModel,
  type ConnectionSettingsState,
  type SettingsStorage,
} from "./settings";

class MemoryStorage implements SettingsStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function configuredState(): ConnectionSettingsState {
  let state = createProviderFromTemplate(emptyConnectionSettings, "custom", {
    providerId: "provider-relay",
    name: "Relay",
  });
  state = addConnection(state, "provider-relay", {
    id: "connection-primary",
    name: "Primary",
    protocol: "openai-responses",
  });
  state = updateConnection(
    updateConnection(
      state,
      "connection-primary",
      "baseUrl",
      "https://relay.example.com/v1",
    ),
    "connection-primary",
    "apiKey",
    "local-key",
  );
  state = addModel(state, "connection-primary", {
    id: "model-primary",
    modelId: "gpt-example",
  });
  return state;
}

describe("connection settings", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it.each(["gemini-image", "openai-images"] as const)("persists %s while keeping drawing model selection independent of chat", protocol => {
    let state = selectModel(configuredState(), "model-primary");
    state = addConnection(state, "provider-relay", { id: "drawing", name: "绘图", protocol });
    state = addModel(state, "drawing", { id: "image-model", modelId: "image/example", displayName: "Image" });
    const unchanged = selectModel(state, "image-model");
    expect(unchanged).toBe(state);
    expect(getActiveConnection(state)?.protocol).toBe("openai-responses");
    expect(getDrawingModels(state)).toEqual([{ id: "image-model", label: "Relay / 绘图 / Image", protocol }]);
    expect(getDrawingTarget(state, "image-model")?.connection.protocol).toBe(protocol);
    expect(getDrawingTarget(state, "model-primary")).toBeUndefined();
    expect(getDrawingTarget(state, null)).toBeUndefined();
    expect(getActiveTarget({ ...state, activeModelId: "image-model" })).toBeUndefined();
    saveConnectionSettings(state, storage);
    expect(loadConnectionSettings(storage)).toEqual(state);
    saveConnectionSettings({ ...state, activeModelId: "image-model" }, storage);
    expect(loadConnectionSettings(storage).activeModelId).toBeNull();
    expect(loadConnectionSettings(storage).providers[0].connections[1].protocol).toBe(protocol);
  });

  it.each(["gemini-image", "openai-images"] as const)("clears the chat default when its connection changes to %s", protocol => {
    const state = selectModel(configuredState(), "model-primary");
    const changed = updateConnection(state, "connection-primary", "protocol", protocol);
    expect(changed.activeModelId).toBeNull();
    expect(getActiveTarget(changed)).toBeUndefined();
    expect(getDrawingTarget(changed, "model-primary")?.model.modelId).toBe("gpt-example");
  });

  it("persists provider order without changing connections or the selected target", () => {
    let state = configuredState();
    state = selectModel(state, "model-primary");
    state = createProviderFromTemplate(state, "custom", { providerId: "b", name: "B" });
    state = createProviderFromTemplate(state, "custom", { providerId: "c", name: "C" });
    const active = getActiveTarget(state);
    const moved = moveProvider(state, "c", "provider-relay", "before");
    expect(moved.providers.map((item) => item.id)).toEqual(["c", "provider-relay", "b"]);
    expect(getActiveTarget(moved)).toEqual(active);
    expect(moved.providers[1]).toBe(state.providers[0]);
    const movedDown = moveProvider(moved, "c", "b", "after");
    saveConnectionSettings(movedDown, storage);
    expect(loadConnectionSettings(storage)).toEqual(movedDown);
    expect(movedDown.providers.map((item) => item.id)).toEqual(["provider-relay", "b", "c"]);
    expect(moveProvider(state, "missing", "b", "before")).toBe(state);
    expect(moveProvider(state, "b", "missing", "before")).toBe(state);
  });

  it("moves connections in both directions within their provider and persists the active target", () => {
    let state = selectModel(configuredState(), "model-primary");
    state = addConnection(state, "provider-relay", { id: "second", name: "Second", protocol: "openai-chat" });
    state = addConnection(state, "provider-relay", { id: "third", name: "Third", protocol: "gemini-image" });
    state = createProviderFromTemplate(state, "custom", { providerId: "other", name: "Other" });
    const active = getActiveTarget(state);
    const moved = moveConnection(state, "third", "connection-primary", "before");
    expect(moved.providers[0].connections.map((item) => item.id)).toEqual(["third", "connection-primary", "second"]);
    expect(moved.providers[1]).toBe(state.providers[1]);
    expect(moved.providers[0].connections).toEqual([
      state.providers[0].connections[2], state.providers[0].connections[0], state.providers[0].connections[1],
    ]);
    moved.providers[0].connections.forEach((connection) => {
      expect(connection).toBe(state.providers[0].connections.find((item) => item.id === connection.id));
    });
    expect(getActiveTarget(moved)?.provider.id).toBe(active?.provider.id);
    expect(getActiveTarget(moved)?.connection).toBe(active?.connection);
    expect(getActiveTarget(moved)?.model).toBe(active?.model);
    const movedDown = moveConnection(moved, "connection-primary", "second", "after");
    expect(movedDown.providers[0].connections.map((item) => item.id)).toEqual(["third", "second", "connection-primary"]);
    expect(movedDown.activeModelId).toBe(state.activeModelId);
    expect(getActiveTarget(movedDown)?.connection).toBe(active?.connection);
    expect(getActiveTarget(movedDown)?.model).toBe(active?.model);
    saveConnectionSettings(movedDown, storage);
    const restored = loadConnectionSettings(storage);
    expect(restored).toEqual(movedDown);
    expect(getActiveTarget(restored)?.provider.id).toBe(active?.provider.id);
    expect(getActiveTarget(restored)?.connection).toEqual(active?.connection);
    expect(getActiveTarget(restored)?.model).toEqual(active?.model);
    expect(state.providers[0].connections.map((item) => item.id)).toEqual(["connection-primary", "second", "third"]);
  });

  it("preserves state for missing, self, cross-provider and unchanged connection moves", () => {
    let state = configuredState();
    state = addConnection(state, "provider-relay", { id: "second", name: "Second", protocol: "openai-chat" });
    state = createProviderFromTemplate(state, "custom", { providerId: "other", name: "Other" });
    state = addConnection(state, "other", { id: "foreign", name: "Foreign", protocol: "openai-chat" });
    expect(moveConnection(state, "missing", "second", "before")).toBe(state);
    expect(moveConnection(state, "second", "missing", "after")).toBe(state);
    expect(moveConnection(state, "second", "second", "before")).toBe(state);
    expect(moveConnection(state, "connection-primary", "foreign", "after")).toBe(state);
    expect(moveConnection(state, "foreign", "connection-primary", "before")).toBe(state);
    expect(moveConnection(state, "connection-primary", "second", "before")).toBe(state);
    expect(moveConnection(state, "second", "connection-primary", "after")).toBe(state);
  });

  it("creates ordinary editable provider groups with named connection templates", () => {
    const state = createProviderFromTemplate(emptyConnectionSettings, "openai", {
      providerId: "provider-openai",
      connectionIds: {
        "openai-chat": "connection-chat",
        "openai-responses": "connection-responses",
      },
    });

    expect(state.providers).toEqual([
      {
        id: "provider-openai",
        name: "OpenAI",
        connections: [
          {
            id: "connection-chat",
            name: "OpenAI Chat",
            protocol: "openai-chat",
            baseUrl: "https://api.openai.com/v1",
            apiKey: "",
            models: [],
          },
          {
            id: "connection-responses",
            name: "OpenAI Responses",
            protocol: "openai-responses",
            baseUrl: "https://api.openai.com/v1",
            apiKey: "",
            models: [],
          },
        ],
      },
    ]);
    expect(state.activeModelId).toBeNull();
  });

  it("allows repeated protocols while keeping connection fields and models independent", () => {
    let state = configuredState();
    state = addConnection(state, "provider-relay", {
      id: "connection-backup",
      name: "Backup",
      protocol: "openai-responses",
      copyFromConnectionId: "connection-primary",
    });

    expect(state.providers[0]?.connections[1]).toEqual({
      id: "connection-backup",
      name: "Backup",
      protocol: "openai-responses",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "local-key",
      models: [],
    });

    state = addModel(state, "connection-backup", {
      id: "model-backup",
      modelId: "gpt-example",
    });
    const duplicate = addModel(state, "connection-backup", {
      id: "model-duplicate",
      modelId: " gpt-example ",
    });

    expect(duplicate).toBe(state);
    expect(state.providers[0]?.connections[0]?.models).toHaveLength(1);
    expect(state.providers[0]?.connections[1]?.models).toHaveLength(1);
  });

  it("persists and resolves one active model through its owning connection", () => {
    let state = configuredState();
    state = selectModel(state, "model-primary");
    saveConnectionSettings(state, storage);

    const restored = loadConnectionSettings(storage);
    expect(restored).toEqual(state);
    expect(getActiveTarget(restored)).toMatchObject({
      provider: { id: "provider-relay", name: "Relay" },
      connection: {
        id: "connection-primary",
        protocol: "openai-responses",
        baseUrl: "https://relay.example.com/v1",
        apiKey: "local-key",
      },
      model: { id: "model-primary", modelId: "gpt-example" },
    });
  });

  it("migrates v2 single-model connections without merging repeated protocols", () => {
    storage.setItem(
      previousConnectionSettingsStorageKey,
      JSON.stringify({
        version: 2,
        providers: [
          {
            id: "provider-relay",
            name: "Relay",
            connections: [
              {
                id: "connection-primary",
                protocol: "anthropic-native",
                baseUrl: "https://one.example.com",
                apiKey: "key-one",
                model: "claude-one",
              },
              {
                id: "connection-backup",
                protocol: "anthropic-native",
                baseUrl: "https://two.example.com",
                apiKey: "key-two",
                model: "claude-two",
              },
            ],
          },
        ],
        activeConnectionId: "connection-backup",
      }),
    );

    const migrated = loadConnectionSettings(storage);
    expect(migrated.version).toBe(3);
    expect(migrated.providers[0]?.connections).toHaveLength(2);
    expect(migrated.providers[0]?.connections[0]).toMatchObject({
      id: "connection-primary",
      name: "Anthropic Native",
      models: [
        {
          id: "migrated-model-connection-primary",
          modelId: "claude-one",
        },
      ],
    });
    expect(migrated.activeModelId).toBe("migrated-model-connection-backup");
  });

  it("migrates valid legacy protocol profiles into named connections and models", () => {
    storage.setItem(
      "ayase-studio.provider-profiles.v1",
      JSON.stringify({
        "openai-chat": {
          baseUrl: "https://relay.example.com/v1",
          apiKey: "legacy-key",
          model: "legacy-chat",
        },
        "openai-responses": { baseUrl: "", apiKey: "", model: "" },
        "gemini-native": {
          baseUrl: "https://gemini.example.com",
          apiKey: "gemini-key",
          model: "gemini-example",
        },
        "anthropic-native": { baseUrl: 42, apiKey: "bad", model: "bad" },
      }),
    );

    const migrated = loadConnectionSettings(storage);
    expect(migrated.providers[0]?.connections).toHaveLength(2);
    expect(migrated.providers[0]?.connections[0]).toMatchObject({
      id: "legacy-openai-chat",
      name: "OpenAI Chat",
      models: [
        { id: "legacy-model-openai-chat", modelId: "legacy-chat" },
      ],
    });
    expect(migrated.activeModelId).toBe("legacy-model-openai-chat");
  });

  it("sanitizes corrupt v3 records without inventing an active model", () => {
    storage.setItem(
      connectionSettingsStorageKey,
      JSON.stringify({
        version: 3,
        providers: [
          {
            id: "provider-valid",
            name: "Valid",
            connections: [
              {
                id: "connection-one",
                name: "One",
                protocol: "anthropic-native",
                baseUrl: "https://one.example.com",
                apiKey: "key-one",
                models: [
                  { id: "model-one", modelId: "claude-example" },
                  { id: "model-two", modelId: " claude-example " },
                ],
              },
              {
                id: "connection-two",
                name: "Two",
                protocol: "anthropic-native",
                baseUrl: "https://two.example.com",
                apiKey: "key-two",
                models: [{ id: "model-three", modelId: "claude-example" }],
              },
              { id: "connection-bad", protocol: "unknown" },
            ],
          },
        ],
        activeModelId: "missing-model",
      }),
    );

    const repaired = loadConnectionSettings(storage);
    expect(repaired.providers[0]?.connections).toHaveLength(2);
    expect(repaired.providers[0]?.connections[0]?.models).toEqual([
      { id: "model-one", modelId: "claude-example" },
    ]);
    expect(repaired.providers[0]?.connections[1]?.models).toHaveLength(1);
    expect(repaired.activeModelId).toBeNull();
  });

  it("keeps browsing data but clears an active model when its ancestry is deleted", () => {
    let state = selectModel(configuredState(), "model-primary");
    state = addConnection(state, "provider-relay", {
      id: "connection-secondary",
      name: "Secondary",
      protocol: "gemini-native",
    });
    state = addModel(state, "connection-secondary", {
      id: "model-secondary",
      modelId: "gemini-example",
    });

    const withoutSecondary = deleteModel(state, "model-secondary");
    expect(withoutSecondary.activeModelId).toBe("model-primary");

    const withoutActiveConnection = deleteConnection(
      withoutSecondary,
      "connection-primary",
    );
    expect(withoutActiveConnection.activeModelId).toBeNull();
    expect(withoutActiveConnection.providers[0]?.connections).toHaveLength(1);

    const withoutProvider = deleteProvider(withoutActiveConnection, "provider-relay");
    expect(withoutProvider).toEqual(emptyConnectionSettings);
  });

  it("renames providers, connections and models without allowing duplicate model IDs", () => {
    let state = configuredState();
    state = renameProvider(state, "provider-relay", "Company Relay");
    state = updateConnection(state, "connection-primary", "name", "Responses");
    state = addModel(state, "connection-primary", {
      id: "model-second",
      modelId: "gpt-second",
    });
    state = updateModel(state, "model-second", "displayName", "Fast model");
    const duplicate = updateModel(
      state,
      "model-second",
      "modelId",
      "gpt-example",
    );

    expect(duplicate).toBe(state);
    expect(state.providers[0]?.name).toBe("Company Relay");
    expect(state.providers[0]?.connections[0]?.name).toBe("Responses");
    expect(state.providers[0]?.connections[0]?.models[1]).toEqual({
      id: "model-second",
      modelId: "gpt-second",
      displayName: "Fast model",
    });
  });
});
