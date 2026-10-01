import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { AyaseDatabase } from "./database";
import { createChatRepository } from "../chat/repository";
import { defaultSessionConfig, readSessionConfigData } from "../chat/sessionConfig";
import { loadConnectionSettings, connectionSettingsStorageKey, previousConnectionSettingsStorageKey, legacyProviderProfilesStorageKey } from "../chat/settings";
import { createBackupDocument } from "../backup/snapshot";
import { preferenceKeys, type BackupFiles } from "../backup/types";

const databases: Dexie[] = [];
afterEach(async () => { for (const db of databases.splice(0)) await db.delete(); });
const files: BackupFiles = { read: async () => { throw new Error("not expected"); }, assertAvailable: async () => {}, write: async () => {}, remove: async () => {} };
function connection() {
  return { id: "c", name: "C", protocol: "openai-chat", baseUrl: "https://synthetic.invalid", apiKey: "synthetic", models: [{ id: "m", modelId: "synthetic" }] };
}
describe("data failures never become partial empty state", () => {
  it.each([
    { generationConfig: { ...defaultSessionConfig(), version: 99 }, lastUsedModelId: "m" },
    { generationConfig: { ...defaultSessionConfig(), temperature: { mode: "custom", value: 123 } }, lastUsedModelId: "m" },
    { generationConfig: defaultSessionConfig(), lastUsedModelId: {} },
  ])("rolls back historical schema upgrade before moving unsupported configuration", async raw => {
    const name = `data-schema-safety-${crypto.randomUUID()}`;
    const legacy = new Dexie(name); databases.push(legacy);
    legacy.version(2).stores({ chats: "id,updatedAt", assistants: "id,sortOrder", conversations: "id,assistantId,updatedAt", workspace: "id" });
    await legacy.table("chats").put({ id: "c", updatedAt: 1, generationConfig: raw.generationConfig, messages: [] });
    await legacy.table("conversations").put({ id: "c", assistantId: "a", title: "Keep", updatedAt: 1, lastUsedModelId: raw.lastUsedModelId });
    const original = await Promise.all(legacy.tables.map(table => table.toArray()));
    legacy.close();
    const current = new AyaseDatabase(name); databases.push(current);
    await expect(current.open()).rejects.toThrow();
    current.close();
    await legacy.open();
    expect(legacy.verno).toBe(2);
    expect(await Promise.all(legacy.tables.map(table => table.toArray()))).toEqual(original);
    expect(legacy.tables.some(table => table.name === "legacyConversationConfigs")).toBe(false);
    legacy.close();
  });
  it("moves a readable historical configuration without losing it", async () => {
    const name = `data-schema-readable-${crypto.randomUUID()}`;
    const legacy = new Dexie(name); databases.push(legacy);
    legacy.version(2).stores({ chats: "id,updatedAt", assistants: "id,sortOrder", conversations: "id,assistantId,updatedAt", workspace: "id" });
    const config = defaultSessionConfig();
    await legacy.table("chats").put({ id: "c", updatedAt: 1, generationConfig: config, messages: [] });
    await legacy.table("conversations").put({ id: "c", assistantId: "a", updatedAt: 1, lastUsedModelId: "m" });
    legacy.close();
    const current = new AyaseDatabase(name); databases.push(current);
    await current.open();
    expect(await current.legacyConversationConfigs.get("c")).toEqual({ id: "c", generationConfig: config, lastUsedModelId: "m" });
    expect(await current.chats.get("c")).not.toHaveProperty("generationConfig");
  });
  it.each([
    { version: 3, activeModelId: null, providers: [null] },
    { version: 3, activeModelId: null, providers: [{ id: "p", name: "P", connections: [{ ...connection(), protocol: "future-protocol" }] }] },
    { version: 3, activeModelId: null, providers: [{ id: "p", name: "P", connections: [{ ...connection(), futureOption: 1 }] }] },
    { version: 3, activeModelId: null, providers: [{ id: "p", name: "P", connections: [{ ...connection(), models: [null] }] }] },
    { version: 3, activeModelId: null, providers: [{ id: "p", name: "P", connections: [connection(), connection()] }] },
    { version: 2, providers: [{ id: "p", name: "P", connections: [{ id: "c", protocol: "future-protocol", apiKey: "synthetic", baseUrl: "", model: "M" }] }] },
  ])("rejects unsupported nested connections instead of dropping entries", raw => {
    const values = new Map([[raw.version === 3 ? connectionSettingsStorageKey : previousConnectionSettingsStorageKey, JSON.stringify(raw)]]);
    const before = [...values];
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
    expect(() => loadConnectionSettings(storage)).toThrow();
    expect([...values]).toEqual(before);
  });
  it.each([
    { "future-protocol": { baseUrl: "", apiKey: "", model: "" } },
    { "openai-chat": { baseUrl: 2, apiKey: "synthetic", model: "M" } },
    { "openai-chat": { baseUrl: "", apiKey: "", model: "", futureField: true } },
  ])("rejects unsafe legacy profiles without replacing them", raw => {
    const encoded = JSON.stringify(raw); let writes = 0;
    const storage = { getItem: (key: string) => key === legacyProviderProfilesStorageKey ? encoded : null, setItem: () => { writes++; } };
    expect(() => loadConnectionSettings(storage)).toThrow(); expect(writes).toBe(0);
  });
  it.each([
    { webSearch: "true" }, { temperature: { mode: "custom", value: 123 } },
    { thinking: { "future-chat": { choice: "default", budget: "", includeSummary: false } } },
    { geminiThinking: { choice: "default", budget: "", includeSummary: false, futureOption: true } },
    { customJson: { ...defaultSessionConfig().customJson, "future-protocol": "{}" } },
  ])("local and backup readers reject undeclared current-session shapes", async patch => {
    const raw = Object.assign(defaultSessionConfig(), patch);
    const before = structuredClone(raw);
    expect(() => readSessionConfigData(raw)).toThrow();
    await expect(createBackupDocument({ rows: { assistants: [{ id: "a", name: "A", icon: "", sortOrder: 0, defaultModelId: null, defaultConfig: raw }],
      conversations: [], chats: [], workspace: [], avatarLibrary: [], userAvatar: [], cherryImports: [], legacyConversationConfigs: [] },
      preferences: Object.fromEntries(preferenceKeys.map(key => [key, null])) }, { connections: false, credentials: false }, files)).rejects.toThrow();
    expect(raw).toEqual(before);
  });
  it.each([
    { version: 2, values: {} }, { version: 1, values: { futureParameter: 1 } },
    { version: 1, values: { modelId: {} } },
    { version: 1, values: { temperature: { mode: "custom", value: 123 } } },
  ])("retains unsupported legacy overrides and all rows after failed initialization", async overrides => {
    const db = new AyaseDatabase(`data-override-safety-${crypto.randomUUID()}`); databases.push(db);
    await db.assistants.put({ id: "a", name: "A", icon: "", sortOrder: 0, defaultModelId: null, defaultConfig: defaultSessionConfig() });
    await db.conversations.put({ id: "c", assistantId: "a", title: "Keep", createdAt: 1, updatedAt: 1, overrides } as never);
    const before = await Promise.all(db.tables.map(table => table.toArray()));
    await expect(createChatRepository(db.name).initializeWorkspace(null, [])).rejects.toThrow();
    expect(await Promise.all(db.tables.map(table => table.toArray()))).toEqual(before);
  });
  it.each([{ modelId: null }, { modelId: {}, config: defaultSessionConfig() }, { modelId: null, config: defaultSessionConfig(), futureWrapper: {} }])
    ("refuses unknown current conversation wrappers before initialization repairs", async settings => {
      const db = new AyaseDatabase(`data-wrapper-safety-${crypto.randomUUID()}`); databases.push(db);
      await db.conversations.put({ id: "c", assistantId: "a", title: "Keep", createdAt: 1, updatedAt: 1, settings } as never);
      const before = await Promise.all(db.tables.map(table => table.toArray()));
      await expect(createChatRepository(db.name).initializeWorkspace(null, [])).rejects.toThrow();
      expect(await Promise.all(db.tables.map(table => table.toArray()))).toEqual(before);
    });
});
