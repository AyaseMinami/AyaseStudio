import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, expect, it, vi } from "vitest";
import { createChatRepository } from "../chat/repository";
import { defaultSessionConfig, readSessionConfigData, restoreSessionConfig } from "../chat/sessionConfig";
import {
  connectionSettingsStorageKey, previousConnectionSettingsStorageKey, legacyProviderProfilesStorageKey,
  loadConnectionSettings, readConnectionSettingsData,
} from "../chat/settings";
import { defaultSearchConfiguration, loadSearchConfiguration, SEARCH_SETTINGS_KEY } from "../search/settings";
import { AyaseDatabase } from "./database";
import { DataContractError } from "./dataContract";

function memoryStorage(values: Record<string, string> = {}) {
  const entries = new Map(Object.entries(values));
  return {
    entries,
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { entries.set(key, value); }),
  };
}

function legacyConnections() {
  return {
    version: 2, activeConnectionId: "connection-two",
    providers: [{ id: "provider", name: "Synthetic provider", connections: [
      { id: "connection-one", protocol: "openai-chat", baseUrl: "https://one.example.invalid/v1", apiKey: "synthetic-one", model: "model-one" },
      { id: "connection-two", protocol: "openai-chat", baseUrl: "https://two.example.invalid/v1", apiKey: "synthetic-two", model: "model-two" },
    ] }],
  };
}

describe("shared local preference compatibility", () => {
  it("migrates search v1 to v2 in memory, preserves MCP configuration and isolates the new API default", () => {
    const legacy = { version: 1, baseUrl: "https://search.example.invalid/mcp", apiKey: "synthetic-search", numResults: 8 };
    const encoded = JSON.stringify(legacy);
    const storage = memoryStorage({ [SEARCH_SETTINGS_KEY]: encoded });
    const first = loadSearchConfiguration(storage);
    expect(first).toEqual({ version: 2, exaMcp: legacy, exaApi: defaultSearchConfiguration().exaApi });
    first.exaApi.numResults = 1;
    first.exaMcp.apiKey = "modified-in-memory";
    expect(loadSearchConfiguration(storage)).toEqual({ version: 2, exaMcp: legacy, exaApi: defaultSearchConfiguration().exaApi });
    expect(storage.entries.get(SEARCH_SETTINGS_KEY)).toBe(encoded);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(legacy).toEqual(JSON.parse(encoded));
  });

  it("creates independent defaults for an absent search preference without writing storage", () => {
    const storage = memoryStorage();
    const first = loadSearchConfiguration(storage);
    first.exaApi.apiKey = "synthetic-edit";
    first.exaMcp.numResults = 1;
    expect(loadSearchConfiguration(storage)).toEqual(defaultSearchConfiguration());
    expect(storage.entries.size).toBe(0);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it.each(["{broken", "null", JSON.stringify({ version: 3 }), JSON.stringify({ version: 2, exaMcp: {}, exaApi: {} })])(
    "rejects malformed or future search data without replacing it with defaults", encoded => {
      const storage = memoryStorage({ [SEARCH_SETTINGS_KEY]: encoded });
      expect(() => loadSearchConfiguration(storage)).toThrow();
      expect(storage.entries.get(SEARCH_SETTINGS_KEY)).toBe(encoded);
      expect(storage.setItem).not.toHaveBeenCalled();
    },
  );

  it("migrates connections v2 to v3 without writes and keeps IDs, active model and reloads stable", () => {
    const legacy = legacyConnections();
    const encoded = JSON.stringify(legacy);
    const storage = memoryStorage({ [previousConnectionSettingsStorageKey]: encoded });
    const migrated = loadConnectionSettings(storage);
    expect(migrated.version).toBe(3);
    expect(migrated.providers[0].id).toBe("provider");
    expect(migrated.providers[0].connections.map(connection => connection.id)).toEqual(["connection-one", "connection-two"]);
    expect(migrated.providers[0].connections.map(connection => connection.models)).toEqual([
      [{ id: "migrated-model-connection-one", modelId: "model-one" }],
      [{ id: "migrated-model-connection-two", modelId: "model-two" }],
    ]);
    expect(migrated.activeModelId).toBe("migrated-model-connection-two");
    expect(readConnectionSettingsData(migrated)).toEqual(migrated);
    expect(loadConnectionSettings(storage)).toEqual(migrated);
    migrated.providers[0].connections[0].apiKey = "edited-in-memory";
    expect(loadConnectionSettings(storage).providers[0].connections[0].apiKey).toBe("synthetic-one");
    expect([...storage.entries]).toEqual([[previousConnectionSettingsStorageKey, encoded]]);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(legacy).toEqual(JSON.parse(encoded));
  });

  it.each(["{broken", "null", JSON.stringify({ version: 4, providers: [] }), JSON.stringify({ version: 3, providers: "invalid" })])(
    "rejects current malformed/future connections instead of falling back to older data", encoded => {
      const values = {
        [connectionSettingsStorageKey]: encoded,
        [previousConnectionSettingsStorageKey]: JSON.stringify(legacyConnections()),
        [legacyProviderProfilesStorageKey]: JSON.stringify({ "openai-chat": { baseUrl: "https://legacy.example.invalid", apiKey: "synthetic", model: "older" } }),
      };
      const storage = memoryStorage(values);
      expect(() => loadConnectionSettings(storage)).toThrow();
      expect(storage.getItem.mock.calls.map(([key]) => key)).toEqual([connectionSettingsStorageKey]);
      expect([...storage.entries]).toEqual(Object.entries(values));
      expect(storage.setItem).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed previous-version connections without using the older legacy source", () => {
    const values = {
      [previousConnectionSettingsStorageKey]: JSON.stringify({ version: 2, providers: null }),
      [legacyProviderProfilesStorageKey]: JSON.stringify({ "openai-chat": { baseUrl: "https://legacy.example.invalid", apiKey: "synthetic", model: "older" } }),
    };
    const storage = memoryStorage(values);
    expect(() => loadConnectionSettings(storage)).toThrow(DataContractError);
    expect(storage.getItem.mock.calls.map(([key]) => key)).toEqual([connectionSettingsStorageKey, previousConnectionSettingsStorageKey]);
    expect([...storage.entries]).toEqual(Object.entries(values));
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("keeps malformed legacy UI configuration editable while strict durable reads reject it", () => {
    const malformed = { version: 1, systemInstruction: "incomplete synthetic input" };
    expect(() => readSessionConfigData(malformed)).toThrow(DataContractError);
    expect(restoreSessionConfig(malformed)).toMatchObject({ ...defaultSessionConfig(), invalidStoredConfig: expect.any(String) });
    const editable = { ...defaultSessionConfig(), temperature: { mode: "custom", value: "unfinished numeric text" } };
    expect(readSessionConfigData(editable)).toEqual(editable);
    expect(restoreSessionConfig(editable)).toEqual(editable);
    expect(malformed).toEqual({ version: 1, systemInstruction: "incomplete synthetic input" });
  });
});

describe("workspace durable compatibility gate", () => {
  it.each(["assistant", "conversation", "creation", "legacy"] as const)(
    "rejects unsupported %s configuration before defaults or repairs can change persisted rows", async source => {
      const name = `DataCompatibility-${crypto.randomUUID()}`;
      const database = new AyaseDatabase(name);
      const futureConfig = { ...defaultSessionConfig(), version: 2 };
      try {
        await database.table("assistants").put({ id: "writer", name: "Original writer", icon: "", sortOrder: 9,
          defaultModelId: "unavailable-model", defaultConfig: source === "assistant" ? futureConfig : defaultSessionConfig() });
        await database.table("conversations").put({ id: "saved", assistantId: "missing-owner", title: "Original title", createdAt: 1, updatedAt: 2,
          ...(source === "conversation" ? { settings: { modelId: null, config: futureConfig } } : {}),
          ...(source === "creation" ? { creationConfig: { modelId: null, config: futureConfig } } : {}),
        });
        await database.table("chats").put({ id: "orphan", updatedAt: 3,
          messages: [{ id: "synthetic-message", role: "user", content: "Retained synthetic content", status: "complete" }] });
        await database.table("workspace").put({ id: "selection", activeAssistantId: "missing-owner", lastSelected: { writer: "missing-conversation" } });
        if (source === "legacy") await database.table("legacyConversationConfigs").put({ id: "current", generationConfig: futureConfig });
        const snapshot = async () => Object.fromEntries(await Promise.all(database.tables.map(async table => [table.name, await table.toArray()])));
        const original = await snapshot();
        const repository = createChatRepository(name);
        await expect(repository.initializeWorkspace("replacement-model", ["replacement-model"])).rejects.toThrow(DataContractError);
        expect(await snapshot()).toEqual(original);
        expect(await database.assistants.get("default")).toBeUndefined();
        expect(await database.chats.get("current")).toBeUndefined();
        expect(await database.conversations.get("orphan")).toBeUndefined();
      } finally {
        database.close();
        await Dexie.delete(name);
      }
    },
  );
});
