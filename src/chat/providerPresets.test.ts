import { describe, expect, it, vi } from "vitest";
import {
  connectionSettingsStorageKey, createProviderFromTemplate, deleteProvider,
  emptyConnectionSettings, initializeProviderPresets, legacyProviderProfilesStorageKey, loadConnectionSettings,
  previousConnectionSettingsStorageKey, readConnectionSettingsData,
  resetPresetConnection, saveConnectionSettings, setProviderAvatar, updateConnection,
  type ConnectionSettingsState, type SettingsStorage,
} from "./settings";
import { presetCatalogOptions, providerTemplates } from "./providerPresets";

function legacyState(): ConnectionSettingsState {
  return { version: 3, activeModelId: "old-model", providers: [
    { id: "builtin:provider:openai", name: "OpenAI", connections: [
      { id: "builtin:connection:openai:openai-chat", name: "Own proxy", protocol: "openai-chat",
        baseUrl: "https://synthetic.invalid/v1", apiKey: "synthetic-old-key", models: [{ id: "old-model", modelId: "old-upstream" }] },
    ] },
    { id: "second-old", name: "Google Gemini", connections: [] },
  ] };
}
function storage(values: Record<string, string> = {}): SettingsStorage {
  const map = new Map(Object.entries(values));
  return { getItem: key => map.get(key) ?? null, setItem: vi.fn((key, value) => { map.set(key, value); }) };
}

describe("Issue 100 provider preset lifecycle", () => {
  it("has the approved eleven suppliers and all 32 explicit protocol/URL defaults", () => {
    expect(providerTemplates.map(p => p.id)).toEqual([
      "openai", "anthropic", "gemini", "xai", "openrouter", "deepseek", "zhipu", "qwen", "moonshot", "doubao", "minimax", "custom",
    ]);
    expect(providerTemplates.flatMap(p => p.connections.map(c => [p.id, c.protocol, c.baseUrl]))).toEqual([
      ["openai", "openai-chat", "https://api.openai.com/v1"],
      ["openai", "openai-responses", "https://api.openai.com/v1"],
      ["openai", "openai-images", "https://api.openai.com/v1"],
      ["anthropic", "anthropic-native", "https://api.anthropic.com"],
      ["anthropic", "openai-chat", "https://api.anthropic.com/v1"],
      ["gemini", "gemini-native", "https://generativelanguage.googleapis.com"],
      ["gemini", "gemini-image", "https://generativelanguage.googleapis.com"],
      ["gemini", "openai-chat", "https://generativelanguage.googleapis.com/v1beta/openai"],
      ["xai", "openai-chat", "https://api.x.ai/v1"],
      ["xai", "openai-responses", "https://api.x.ai/v1"],
      ["xai", "grok-images", "https://api.x.ai/v1"],
      ["openrouter", "openai-chat", "https://openrouter.ai/api/v1"],
      ["openrouter", "openai-responses", "https://openrouter.ai/api/v1"],
      ["deepseek", "openai-chat", "https://api.deepseek.com"],
      ["deepseek", "openai-responses", "https://api.deepseek.com"],
      ["deepseek", "anthropic-native", "https://api.deepseek.com/anthropic"],
      ["zhipu", "openai-chat", "https://open.bigmodel.cn/api/paas/v4"],
      ["zhipu", "openai-responses", "https://open.bigmodel.cn/api/v1"],
      ["zhipu", "anthropic-native", "https://open.bigmodel.cn/api/anthropic"],
      ["qwen", "openai-chat", "https://dashscope.aliyuncs.com/compatible-mode/v1"],
      ["qwen", "openai-responses", "https://dashscope.aliyuncs.com/compatible-mode/v1"],
      ["qwen", "anthropic-native", "https://dashscope.aliyuncs.com/apps/anthropic"],
      ["moonshot", "openai-chat", "https://api.moonshot.cn/v1"],
      ["moonshot", "openai-responses", "https://api.moonshot.cn/v1"],
      ["moonshot", "anthropic-native", "https://api.moonshot.cn/anthropic"],
      ["doubao", "openai-chat", "https://ark.cn-beijing.volces.com/api/v3"],
      ["doubao", "openai-responses", "https://ark.cn-beijing.volces.com/api/v3"],
      ["doubao", "seedream-images", "https://ark.cn-beijing.volces.com/api/v3"],
      ["doubao", "anthropic-native", "https://ark.cn-beijing.volces.com/api/compatible"],
      ["minimax", "openai-chat", "https://api.minimax.cn/v1"],
      ["minimax", "openai-responses", "https://api.minimax.cn/v1"],
      ["minimax", "anthropic-native", "https://api.minimax.cn/anthropic"],
    ]);
    expect(providerTemplates.find(p => p.id === "custom")?.connections).toEqual([]);
  });

  it("appends once, preserves old config/order/active/key, never infers names, and allocates collision-safe deterministic identities", () => {
    const old = legacyState(), original = structuredClone(old);
    const initialized = initializeProviderPresets(old);
    expect(initialized.providers.slice(0, 2)).toEqual(old.providers);
    expect(initialized.activeModelId).toBe("old-model");
    expect(initialized.providers[0].presetId).toBeUndefined();
    expect(initialized.providers[1].presetId).toBeUndefined();
    expect(initialized.providers.slice(2).map(p => p.presetId)).toEqual(providerTemplates.slice(0, 11).map(p => p.id));
    expect(initialized.providers[2].id).toBe("builtin:provider:openai:1");
    expect(initialized.providers[2].connections[0].id).toBe("builtin:connection:openai:openai-chat:1");
    const allIds = initialized.providers.flatMap(p => [p.id, ...p.connections.flatMap(c => [c.id, ...c.models.map(m => m.id)])]);
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(initialized.providers.slice(2).flatMap(p => p.connections).every(c => c.apiKey === "" && c.models.length === 0)).toBe(true);
    expect(initialized.builtinsInitialized).toBe(true);
    expect(initializeProviderPresets(old)).toEqual(initialized);
    expect(initializeProviderPresets(initialized)).toBe(initialized);
    expect(old).toEqual(original);
  });

  it("does not resurrect a deleted builtin across save/load or repeated initialization", () => {
    const initialized = initializeProviderPresets(emptyConnectionSettings);
    const deleted = deleteProvider(initialized, initialized.providers[0].id), store = storage();
    saveConnectionSettings(deleted, store);
    const reloaded = loadConnectionSettings(store);
    expect(reloaded.providers).toHaveLength(10);
    expect(initializeProviderPresets(reloaded)).toEqual(deleted);
    expect(reloaded.providers.some(p => p.presetId === "openai")).toBe(false);
  });

  it("ordinary reads do not seed or write and v2 migration preserves IDs/model/key without inference", () => {
    const old = legacyState(), store = storage({ [connectionSettingsStorageKey]: JSON.stringify(old) });
    expect(loadConnectionSettings(store)).toEqual(old);
    expect(readConnectionSettingsData(old)).toEqual(old);
    expect(loadConnectionSettings(storage())).toEqual(emptyConnectionSettings);
    expect(store.setItem).not.toHaveBeenCalled();
    const v2 = { version: 2, activeConnectionId: "old-connection", providers: [{ id: "old-provider", name: "OpenAI",
      connections: [{ id: "old-connection", protocol: "openai-chat", baseUrl: "https://old.invalid", apiKey: "synthetic-key", model: "kept" }] }] };
    const v2Store = storage({ [previousConnectionSettingsStorageKey]: JSON.stringify(v2) });
    const migrated = loadConnectionSettings(v2Store);
    expect(migrated.providers).toHaveLength(1);
    expect(migrated.providers[0]).toMatchObject({ id: "old-provider", name: "OpenAI", connections: [
      { id: "old-connection", apiKey: "synthetic-key", baseUrl: "https://old.invalid", models: [{ id: "migrated-model-old-connection", modelId: "kept" }] },
    ] });
    expect(migrated.providers[0].presetId).toBeUndefined();
    expect(migrated.builtinsInitialized).toBeUndefined();
    expect(readConnectionSettingsData(migrated)).toEqual(migrated);
    expect(v2Store.setItem).not.toHaveBeenCalled();
    expect(v2.version).toBe(2);
  });

  it("prepends explicit custom creation and permits independent shared brand selection/reset", () => {
    const initial = initializeProviderPresets(emptyConnectionSettings);
    const custom = createProviderFromTemplate(initial, "custom", { providerId: "custom", name: "My relay", prepend: true });
    expect(custom.providers[0]).toEqual({ id: "custom", name: "My relay", connections: [] });
    expect(custom.providers.slice(1)).toEqual(initial.providers);
    const chosen = setProviderAvatar(custom, "custom", { kind: "builtin", id: "deepseek" });
    expect(chosen.providers[0].avatar).toEqual({ kind: "builtin", id: "deepseek" });
    expect(chosen.providers[0].presetId).toBeUndefined();
    expect(setProviderAvatar(chosen, "custom", undefined)).toEqual(custom);
  });

  it("reads the legacy profile source without writing or injecting presets and preserves it when explicitly initialized", () => {
    const legacy = { "openai-chat": { baseUrl: "https://legacy.invalid/v1", apiKey: "synthetic-legacy-key", model: "legacy-model" } };
    const store = storage({ [legacyProviderProfilesStorageKey]: JSON.stringify(legacy) });
    const loaded = loadConnectionSettings(store);
    expect(loaded.providers).toHaveLength(1);
    expect(loaded.providers[0]).toMatchObject({ id: "legacy-provider", connections: [
      { id: "legacy-openai-chat", baseUrl: "https://legacy.invalid/v1", apiKey: "synthetic-legacy-key", models: [{ id: "legacy-model-openai-chat", modelId: "legacy-model" }] },
    ] });
    expect(loaded.activeModelId).toBe("legacy-model-openai-chat");
    expect(loaded.providers[0].presetId).toBeUndefined();
    expect(loaded.builtinsInitialized).toBeUndefined();
    const initialized = initializeProviderPresets(loaded);
    expect(initialized.providers).toHaveLength(12);
    expect(initialized.providers[0]).toEqual(loaded.providers[0]);
    expect(initialized.activeModelId).toBe(loaded.activeModelId);
    expect(store.setItem).not.toHaveBeenCalled();
    expect(store.getItem(legacyProviderProfilesStorageKey)).toBe(JSON.stringify(legacy));
  });

  it("allows protocol overrides and resets original template name/protocol/URL without changing key/models/identity/order", () => {
    const initial = initializeProviderPresets(emptyConnectionSettings), provider = initial.providers[0], connection = provider.connections[0];
    connection.apiKey = "synthetic-reset-key";
    connection.models = [{ id: "reset-model", modelId: "upstream" }];
    initial.activeModelId = "reset-model";
    let edited = updateConnection(initial, connection.id, "name", "Own name");
    edited = updateConnection(edited, connection.id, "protocol", "anthropic-native");
    edited = updateConnection(edited, connection.id, "baseUrl", "https://relay.invalid/anthropic");
    expect(readConnectionSettingsData(edited).providers[0].connections[0].protocol).toBe("anthropic-native");
    expect(presetCatalogOptions(edited.providers[0], edited.providers[0].connections[0])).toBeUndefined();
    const reset = resetPresetConnection(edited, connection.id);
    expect(reset).toEqual(initial);
    expect(edited.providers[0].connections[0]).toMatchObject({ name: "Own name", protocol: "anthropic-native", presetProtocol: "openai-chat" });
    expect(presetCatalogOptions(reset.providers[0], reset.providers[0].connections[0])).toMatchObject({ name: "OpenAI Chat" });
    expect(resetPresetConnection(legacyState(), "builtin:connection:openai:openai-chat")).toEqual(legacyState());
  });

  it.each([
    { builtinsInitialized: false },
    { version: 4 },
    { providers: [{ id: "future", name: "Future", connections: [], presetId: "future-brand" }] },
    { providers: [{ id: "future", name: "Future", connections: [], avatar: { kind: "builtin", id: "future-brand" } }] },
    { providers: [{ id: "future", name: "Future", connections: [], avatar: { kind: "image", id: "" } }] },
  ])("rejects unsupported supplier structures before writing: %#", invalid => {
    const raw = { ...legacyState(), ...invalid }, text = JSON.stringify(raw), store = storage({ [connectionSettingsStorageKey]: text });
    expect(() => loadConnectionSettings(store)).toThrow();
    expect(() => saveConnectionSettings(emptyConnectionSettings, store)).toThrow();
    expect(store.getItem(connectionSettingsStorageKey)).toBe(text);
    expect(store.setItem).not.toHaveBeenCalled();
  });
});
