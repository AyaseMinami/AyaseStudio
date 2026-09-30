import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { AyaseDatabase } from "../storage/database";
import { defaultSessionConfig } from "../chat/sessionConfig";
import { connectionSettingsStorageKey } from "../chat/settings";
import { invoke } from "@tauri-apps/api/core";
import { BackupRepository } from "./repository";
import { createBackupDocument } from "./snapshot";
import { encodeBackup } from "./codec";
import { createBackupApi } from "./runtime";
import { BackupRecoveryError } from "./errors";
import type { BackupFiles } from "./types";
import { SEARCH_SETTINGS_KEY } from "../search/settings";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn() }));

const databases: AyaseDatabase[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(invoke).mockReset();
  for (const database of databases.splice(0)) await database.delete();
});
async function setup() {
  const database = new AyaseDatabase(`backup-runtime-${crypto.randomUUID()}`);
  databases.push(database);
  await database.assistants.put({ id: "default", name: "Synthetic", icon: "", sortOrder: 0, defaultModelId: null, defaultConfig: defaultSessionConfig() });
  const values = new Map<string, string>([[connectionSettingsStorageKey, JSON.stringify({ version: 3, activeModelId: null, providers: [{ id: "p", name: "Synthetic", connections: [{ id: "c", name: "Synthetic", protocol: "openai-chat", baseUrl: "https://synthetic.invalid", apiKey: "synthetic-runtime-key", models: [] }] }] })]]);
  values.set(SEARCH_SETTINGS_KEY, JSON.stringify({ version: 1, baseUrl: "https://mcp.exa.ai/mcp", apiKey: "synthetic-runtime-search-key", numResults: 5 }));
  const repository = new BackupRepository(database, { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } });
  const files: BackupFiles = { read: vi.fn(), assertAvailable: vi.fn(), write: vi.fn(), remove: vi.fn() };
  const serialized = await encodeBackup(await createBackupDocument(await repository.snapshot(), { connections: false, credentials: false }, files));
  const api = createBackupApi(repository, files);
  const preview = await api.inspect(serialized, "");
  return { database, repository, api, preview, serialized, values };
}
it.each([false, true])("exports and restores full connections and credentials with encrypted=%s through the real runtime", async encrypted => {
  const test = await setup(), password = encrypted ? "中" : "";
  vi.mocked(invoke).mockResolvedValue(true);
  const exported = await test.api.exportBackup({ encrypted }, password, password);
  expect(exported.preview.encrypted).toBe(encrypted);
  expect(exported.preview.document.options).toEqual({ connections: true, credentials: true });
  expect(exported.preview.document.version).toBe(3);
  expect(exported.preview.document.searchSettings).toMatchObject({ version: 2, exaMcp: { apiKey: "synthetic-runtime-search-key" }, exaApi: { apiKey: "" } });
  const saved = vi.mocked(invoke).mock.calls[0]!;
  expect(saved[0]).toBe("save_ayase_backup");
  const serialized = (saved[1] as { data: string }).data;
  expect(JSON.parse(serialized).encrypted).toBe(encrypted);
  expect(serialized.includes("synthetic-runtime-key")).toBe(!encrypted);
  expect(serialized.includes("synthetic-runtime-search-key")).toBe(!encrypted);
  const preview = await test.api.inspect(serialized, password);
  await test.api.conflicts(preview, "replace");
  await test.api.restore(preview, "replace");
  const restored = JSON.parse(test.values.get(connectionSettingsStorageKey)!);
  expect(restored.providers[0].connections[0].apiKey).toBe("synthetic-runtime-key");
  expect(JSON.parse(test.values.get(SEARCH_SETTINGS_KEY)!).exaMcp.apiKey).toBe("synthetic-runtime-search-key");
});
it("preserves recovery failure and locks subsequent actions even when the journal cannot be read", async () => {
  const test = await setup(), failure = new BackupRecoveryError();
  vi.spyOn(test.repository, "restore").mockRejectedValue(failure);
  const read = vi.spyOn(test.database.backupJournal, "get").mockRejectedValue(new Error("synthetic unavailable database"));
  await expect(test.api.restore(test.preview, "replace")).rejects.toBe(failure);
  expect(read).not.toHaveBeenCalled();
  await expect(test.api.inspect(test.serialized, "")).rejects.toThrow("回滚");
  await expect(test.api.selectBackup()).rejects.toThrow("回滚");
});
it("fails closed with the typed recovery error when an ordinary failure cannot be checked against the journal", async () => {
  const test = await setup();
  vi.spyOn(test.repository, "restore").mockRejectedValue(new Error("synthetic write failure"));
  vi.spyOn(test.database.backupJournal, "get").mockRejectedValue(new Error("synthetic unavailable database"));
  await expect(test.api.restore(test.preview, "replace")).rejects.toBeInstanceOf(BackupRecoveryError);
  await expect(test.api.conflicts(test.preview, "copy")).rejects.toThrow("回滚");
});
