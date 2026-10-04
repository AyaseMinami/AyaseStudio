// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useChatSession } from "./useChatSession";
import { createChatRepository } from "./repository";
import { connectionSettingsStorageKey, loadConnectionSettings, saveConnectionSettings, type ConnectionSettingsState } from "./settings";
import { brandIds } from "../avatar/brandIds";
import type { UserAvatar } from "../avatar/repository";
import type { ChatRequest, ChatTransport } from "./types";

const mocks = vi.hoisted(() => ({ createRuntimeChatTransport: vi.fn(), createRuntimeModelCatalogClient: vi.fn(),
  avatarSave: vi.fn(), avatarGet: vi.fn(), invoke: vi.fn(), cleanup: vi.fn(), read: vi.fn(), verify: vi.fn(), save: vi.fn() }));
vi.mock("./runtime", () => ({ createRuntimeChatTransport: mocks.createRuntimeChatTransport, createRuntimeModelCatalogClient: mocks.createRuntimeModelCatalogClient }));
vi.mock("../avatar/providerAvatars", () => ({ providerAvatarRepository: { save: mocks.avatarSave, get: mocks.avatarGet } }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: mocks.invoke }));
vi.mock("./attachmentResources", () => ({ createTauriAttachmentStore: () => ({ read: mocks.read, cleanup: mocks.cleanup, verify: mocks.verify, save: mocks.save }) }));
// The actual repository and workspace run against a named, in-memory fake-indexeddb database.
vi.mock("./repository", async original => {
  const actual = await original<typeof import("./repository")>();
  return { ...actual, createChatRepository: () => actual.createChatRepository("Providers100Synthetic") };
});

it("saves group commands atomically and keeps React state and raw data when persistence fails", async () => {
  await act(async () => { expect(session.changeModelGroups("c", { kind: "create", id: "g", name: "常用" })).toBe(true); });
  await act(async () => { expect(session.changeModelGroups("c", { kind: "assign", modelIds: ["m"], groupId: "g" })).toBe(true); });
  const before = localStorage.getItem(connectionSettingsStorageKey), state = session.connectionSettings;
  expect(loadConnectionSettings().providers[0].connections[0].models[0].groupId).toBe("g");
  const write = localStorage.setItem.bind(localStorage);
  vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
    if (key === connectionSettingsStorageKey) throw new Error("synthetic group quota");
    write(key, value);
  });
  await act(async () => { expect(() => session.changeModelGroups("c", { kind: "delete", id: "g" })).toThrow("synthetic group quota"); });
  expect(session.connectionSettings).toBe(state);
  expect(localStorage.getItem(connectionSettingsStorageKey)).toBe(before);
});

it("blocks group commands while another workspace holds shared settings", async () => {
  externalBusy = true; await render();
  const before = localStorage.getItem(connectionSettingsStorageKey);
  await act(async () => { expect(session.changeModelGroups("c", { kind: "create", id: "g", name: "常用" })).toBe(false); });
  expect(localStorage.getItem(connectionSettingsStorageKey)).toBe(before);
});

const repository = createChatRepository();
const initial: ConnectionSettingsState = { version: 3, activeModelId: "m", providers: [
  { id: "p", name: "OpenAI", avatar: { kind: "builtin", id: "gemini" }, connections: [
    { id: "c", name: "合成线路", protocol: "openai-chat", baseUrl: "https://synthetic.example.invalid/v1", apiKey: "synthetic-test-key", models: [{ id: "m", modelId: "synthetic-model" }] },
  ] },
] };
const snapshot: UserAvatar = { original: new Blob(["synthetic-original"], { type: "image/png" }),
  thumbnail: new Blob(["synthetic-thumbnail"], { type: "image/png" }), crop: { x: .5, y: .5, zoom: 1 } };
const imageRecords = new Map<string, UserAvatar>();
let root: Root, host: HTMLDivElement, session: ReturnType<typeof useChatSession>, externalBusy: boolean;
let unmounted: boolean;

function Probe({ busy }: { busy: boolean }) { session = useChatSession({ onConfigurationRequired: () => {}, externalBusy: busy }); return null; }
async function render() { await act(async () => root.render(<Probe busy={externalBusy} />)); }
async function wait(predicate: () => boolean) {
  for (let attempt = 0; attempt < 150 && !predicate(); attempt++) await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
  expect(predicate()).toBe(true);
}
function deferAvatarSave() {
  let resolve!: (id: string) => void;
  mocks.avatarSave.mockImplementation((avatar: UserAvatar) => new Promise<string>(done => {
    resolve = id => { imageRecords.set(id, avatar); done(id); };
  }));
  return (id = "synthetic-image") => resolve(id);
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const preferenceRecords = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() { return preferenceRecords.size; },
    getItem: (key: string) => preferenceRecords.get(key) ?? null,
    setItem: (key: string, value: string) => { preferenceRecords.set(key, value); },
    removeItem: (key: string) => { preferenceRecords.delete(key); },
    clear: () => preferenceRecords.clear(), key: (index: number) => [...preferenceRecords.keys()][index] ?? null,
  } satisfies Storage);
  imageRecords.clear();
  await repository.load("current");
  const database = new Dexie("Providers100Synthetic"); await database.open();
  await Promise.all(database.tables.map(table => table.clear())); database.close();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.cleanup.mockResolvedValue(undefined); mocks.verify.mockResolvedValue(undefined);
  mocks.avatarGet.mockImplementation(async id => imageRecords.get(id));
  mocks.avatarSave.mockImplementation(async avatar => { imageRecords.set("synthetic-image", avatar); return "synthetic-image"; });
  mocks.invoke.mockRejectedValue(new Error("Unexpected native request in isolated test"));
  saveConnectionSettings(structuredClone(initial));
  await repository.initializeWorkspace("m", ["m"]);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  externalBusy = false; unmounted = false;
  await render(); await wait(() => session.isHydrated && session.workspace.canSend() && !session.backupDisabled);
});
afterEach(async () => {
  if (!unmounted) await act(async () => root.unmount());
  host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it("initializes all eleven builtins after unchanged custom providers without inferring identity from names", () => {
  const providers = session.connectionSettings.providers;
  expect(providers).toHaveLength(12); expect(providers[0]).toEqual(initial.providers[0]);
  expect(providers[0].presetId).toBeUndefined();
  expect(providers.slice(1).map(provider => provider.presetId)).toEqual([...brandIds]);
  expect(loadConnectionSettings().builtinsInitialized).toBe(true);
  expect(loadConnectionSettings().providers).toEqual(providers);
});

it("persists a provider batch exactly once, rejects a duplicate and keeps unrelated providers intact", async () => {
  const targets = session.connectionSettings.providers.slice(0, 2), unrelated = session.connectionSettings.providers[2];
  const writes = vi.spyOn(localStorage, "setItem");
  let saved!: boolean, duplicate!: boolean;
  await act(async () => { saved = session.deleteProviders(targets); duplicate = session.deleteProviders(targets); });
  expect(saved).toBe(true); expect(duplicate).toBe(false);
  expect(writes.mock.calls.filter(([key]) => key === connectionSettingsStorageKey)).toHaveLength(1);
  expect(loadConnectionSettings().providers.some(provider => targets.some(target => target.id === provider.id))).toBe(false);
  expect(session.connectionSettings.providers.find(provider => provider.id === unrelated.id)).toBe(unrelated);
  expect((await repository.load("current"))?.messages).toEqual([]);
});

it("rejects stale and maintenance-blocked batches without any preference writes", async () => {
  const stale = session.connectionSettings.providers[0];
  await act(async () => session.updateConnection("c", "name", "changed synthetic connection"));
  const writes = vi.spyOn(localStorage, "setItem");
  expect(session.deleteProviders([stale])).toBe(false);
  externalBusy = true; await render();
  expect(session.deleteProviders([session.connectionSettings.providers[0]])).toBe(false);
  expect(session.deleteConnections("p", session.connectionSettings.providers[0].connections)).toBe(false);
  expect(writes.mock.calls.filter(([key]) => key === connectionSettingsStorageKey)).toHaveLength(0);
});

it("keeps the entire provider batch and its durable preference when saving fails", async () => {
  const targets = session.connectionSettings.providers.slice(0, 2), before = localStorage.getItem(connectionSettingsStorageKey);
  vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => { throw new Error("synthetic quota failure"); });
  await act(async () => { expect(() => session.deleteProviders(targets)).toThrow("synthetic quota failure"); });
  expect(session.connectionSettings.providers.slice(0, 2)).toEqual(targets);
  expect(localStorage.getItem(connectionSettingsStorageKey)).toBe(before);
});

it("removes a connection batch through one save while preserving its supplier and conversation settings", async () => {
  await act(async () => session.addConnection("p", "empty synthetic connection", "openai-chat"));
  const provider = session.connectionSettings.providers[0], config = session.workspace.conversation?.settings;
  const writes = vi.spyOn(localStorage, "setItem");
  let saved!: boolean;
  await act(async () => { saved = session.deleteConnections("p", provider.connections); });
  expect(saved).toBe(true);
  expect(writes.mock.calls.filter(([key]) => key === connectionSettingsStorageKey)).toHaveLength(1);
  expect(loadConnectionSettings().providers[0]).toMatchObject({ id: "p", connections: [] });
  expect(session.workspace.conversation?.settings).toEqual(config);
});

it("saves builtin avatar IDs durably while preserving every connection protocol and field", async () => {
  const before = structuredClone(session.connectionSettings.providers[0].connections);
  let result!: boolean;
  await act(async () => { result = await session.changeProviderAvatar("p", { kind: "builtin", id: "anthropic" }); });
  expect(result).toBe(true); expect(mocks.avatarSave).not.toHaveBeenCalled();
  expect(session.connectionSettings.providers[0].avatar).toEqual({ kind: "builtin", id: "anthropic" });
  expect(loadConnectionSettings().providers[0].avatar).toEqual({ kind: "builtin", id: "anthropic" });
  expect(session.connectionSettings.providers[0].connections).toEqual(before);
});

it("holds maintenance and supplier mutations until both image and preference saves finish", async () => {
  const resolve = deferAvatarSave();
  const before = structuredClone(session.connectionSettings.providers);
  let pending!: Promise<boolean>;
  await act(async () => { pending = session.changeProviderAvatar("p", snapshot); });
  expect(session.backupDisabled).toBe(true); expect(session.maintenanceBusy).toBe(true);
  expect(session.dataImport.disabled).toBe(true);
  let prepared!: boolean, duplicate!: boolean;
  await act(async () => {
    prepared = await session.prepareBackup();
    expect(session.addProvider("custom", "被阻止")).toBe("");
    expect(session.addConnection("p", "被阻止", "openai-chat")).toBe("");
    expect(session.addModel("c", "blocked-model")).toBe("");
    session.renameProvider("p", "被阻止"); session.deleteProvider("p");
    session.updateConnection("c", "baseUrl", "https://blocked.example.invalid");
    session.moveProvider("p", before[1].id, "after");
    duplicate = await session.changeProviderAvatar("p", { kind: "builtin", id: "xai" });
  });
  expect(prepared).toBe(false); expect(duplicate).toBe(false);
  expect(session.connectionSettings.providers).toEqual(before); expect(loadConnectionSettings().providers).toEqual(before);
  expect(mocks.avatarSave).toHaveBeenCalledExactlyOnceWith(snapshot);
  let saved!: boolean;
  await act(async () => { resolve(); saved = await pending; });
  expect(saved).toBe(true); expect(imageRecords.has("synthetic-image")).toBe(true);
  expect(loadConnectionSettings().providers[0].avatar).toEqual({ kind: "image", id: "synthetic-image" });
  expect(session.connectionSettings.providers[0].avatar).toEqual({ kind: "image", id: "synthetic-image" });
  expect(session.backupDisabled).toBe(false); expect(session.maintenanceBusy).toBe(false);
});

it("rejects a preference-write failure without replacing the previous persisted or visible avatar", async () => {
  const oldPreference = localStorage.getItem(connectionSettingsStorageKey);
  const oldProvider = structuredClone(session.connectionSettings.providers[0]);
  const write = localStorage.setItem.bind(localStorage);
  vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
    if (key === connectionSettingsStorageKey) throw new Error("synthetic preference quota");
    write(key, value);
  });
  await act(async () => { await expect(session.changeProviderAvatar("p", snapshot)).rejects.toThrow("synthetic preference quota"); });
  expect(localStorage.getItem(connectionSettingsStorageKey)).toBe(oldPreference);
  expect(session.connectionSettings.providers[0]).toEqual(oldProvider);
  expect(session.backupDisabled).toBe(false); expect(session.maintenanceBusy).toBe(false);
});

it("refuses a late image completion after external work starts and retains the old avatar", async () => {
  const resolve = deferAvatarSave();
  const before = localStorage.getItem(connectionSettingsStorageKey);
  let pending!: Promise<boolean>;
  await act(async () => { pending = session.changeProviderAvatar("p", snapshot); });
  externalBusy = true; await render();
  let saved!: boolean;
  await act(async () => { resolve(); saved = await pending; });
  expect(saved).toBe(false); expect(localStorage.getItem(connectionSettingsStorageKey)).toBe(before);
  expect(session.connectionSettings.providers[0].avatar).toEqual(initial.providers[0].avatar);
});

it("does not write preferences when an image save completes after hook unmount", async () => {
  const resolve = deferAvatarSave();
  const before = localStorage.getItem(connectionSettingsStorageKey);
  let pending!: Promise<boolean>;
  await act(async () => { pending = session.changeProviderAvatar("p", snapshot); });
  await act(async () => root.unmount()); unmounted = true;
  const writes = vi.spyOn(localStorage, "setItem");
  let saved!: boolean;
  await act(async () => { resolve(); saved = await pending; });
  expect(saved).toBe(false); expect(localStorage.getItem(connectionSettingsStorageKey)).toBe(before);
  expect(writes).not.toHaveBeenCalled();
});

it("restores preset fields through the real hook, retaining Key/models and cancelling catalog/model probes", async () => {
  const provider = session.connectionSettings.providers.find(provider => provider.presetId === "openai")!;
  const connectionId = provider.connections[0].id;
  let modelId!: string;
  await act(async () => {
    session.updateConnection(connectionId, "name", "改名合成连接");
    session.updateConnection(connectionId, "baseUrl", "https://relay.example.invalid/v1");
    session.updateConnection(connectionId, "apiKey", "synthetic-retained-key");
    modelId = session.addModel(connectionId, "synthetic-retained-model", "保留模型");
  });
  const before = structuredClone(session.connectionSettings.providers.find(item => item.id === provider.id)!.connections[0]);
  let catalogSignal!: AbortSignal, testSignal!: AbortSignal, resolveCatalog!: (models: []) => void;
  mocks.createRuntimeModelCatalogClient.mockResolvedValue({ list: ({ signal }: { signal: AbortSignal }) => new Promise<[]>(resolve => { catalogSignal = signal; resolveCatalog = resolve; }) });
  mocks.createRuntimeChatTransport.mockResolvedValue({ stream(request: ChatRequest) {
    testSignal = request.signal!;
    return { [Symbol.asyncIterator]() { return { next: () => new Promise<IteratorResult<never>>(() => {}), return: async () => ({ done: true as const, value: undefined }) }; } };
  } } satisfies ChatTransport);
  let catalogPending!: Promise<void>, testPending!: Promise<void>;
  await act(async () => { catalogPending = session.refreshModelCatalog(connectionId); testPending = session.runModelTest(connectionId, modelId); });
  await wait(() => !!catalogSignal && !!testSignal);
  await act(async () => session.resetPresetConnection(connectionId));
  expect(catalogSignal.aborted).toBe(true); expect(testSignal.aborted).toBe(true);
  await act(async () => { resolveCatalog([]); await catalogPending; await testPending; });
  const after = loadConnectionSettings().providers.find(item => item.id === provider.id)!.connections[0];
  expect(after.name).toBe("OpenAI Chat"); expect(after.protocol).toBe("openai-chat"); expect(after.baseUrl).toBe("https://api.openai.com/v1");
  expect(after.apiKey).toBe(before.apiKey); expect(after.models).toEqual(before.models);
  expect(session.modelCatalogs[connectionId]).toBeUndefined(); expect(session.modelTests[modelId]).toBeUndefined();
});
