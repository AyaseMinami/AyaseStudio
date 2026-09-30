// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatSession } from "./useChatSession";
import { createChatRepository } from "./repository";
import { saveConnectionSettings } from "./settings";
import { saveSearchSettings, defaultSearchSettings, loadSearchConfiguration, saveSearchConfiguration, type ExternalSearchProvider } from "../search/settings";
import type { ChatProtocol, ChatRequest, ChatTransport } from "./types";

const mocks = vi.hoisted(() => ({ createRuntimeChatTransport: vi.fn(), createRuntimeModelCatalogClient: vi.fn(), searchExa: vi.fn(), read: vi.fn(), cleanup: vi.fn(), verify: vi.fn(), save: vi.fn() }));
vi.mock("./runtime", () => mocks);
vi.mock("../search/runtime", () => ({ searchExa: mocks.searchExa }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("./attachmentResources", () => ({ createTauriAttachmentStore: () => ({ read: mocks.read, cleanup: mocks.cleanup, verify: mocks.verify, save: mocks.save }) }));
const source = { id: "source_1", title: "Search source", url: "https://source.example/", excerpt: "Retrieved material" };

describe("external search in session generation", () => {
  const repo = createChatRepository();
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;
  let session: ReturnType<typeof useChatSession>;
  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.clear(); await repo.load("current");
    const db = new Dexie("AyaseStudio"); await db.open();
    await Promise.all(db.tables.map(table => table.clear())); db.close();
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.cleanup.mockResolvedValue(undefined); mocks.verify.mockResolvedValue(undefined);
    mocks.read.mockImplementation(async item => ({ ...item, data: "aGk=" }));
    mocks.searchExa.mockResolvedValue({ sources: [source] });
    saveConnectionSettings({ version: 3, activeModelId: "m", providers: [{ id: "p", name: "Synthetic", connections: [{ id: "c", name: "Test", protocol: "openai-chat", baseUrl: "https://model.example", apiKey: "synthetic-chat-key", models: [{ id: "m", modelId: "any" }] }] }] });
    saveSearchSettings({ ...defaultSearchSettings(), apiKey: "synthetic-search-key" });
    saveSearchConfiguration({ ...loadSearchConfiguration(), exaApi: { ...defaultSearchSettings("exa-api"), apiKey: "synthetic-api-key", numResults: 2 } });
    await repo.initializeWorkspace("m", ["m"]);
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    function Probe() { session = useChatSession({ onConfigurationRequired: () => undefined }); return null; }
    await act(async () => root.render(<Probe />));
    await wait(() => session.isHydrated && session.workspace.canSend());
    await act(async () => { await session.setSearchMode("exa-mcp"); });
    respond();
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
  async function wait(predicate: () => boolean) {
    for (let i = 0; i < 150 && !predicate(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
    expect(predicate()).toBe(true);
  }
  function respond(observe?: (request: ChatRequest) => void, reason = "stop") {
    mocks.createRuntimeChatTransport.mockResolvedValue({ async *stream(request) {
      observe?.(request);
      yield { type: "text-delta", text: "Answer [ayase-source:source_1]" };
      yield { type: "completed", finishReason: reason };
    } } satisfies ChatTransport);
  }
  async function draft(value = "current question") { await act(async () => session.setDraft(value)); }
  it.each((["exa-mcp", "exa-api"] as ExternalSearchProvider[]).flatMap(provider =>
    (["openai-chat", "openai-responses", "gemini-native", "anthropic-native"] as ChatProtocol[]).map(protocol => ({ provider, protocol }))))("retrieves once via $provider before $protocol answer and keeps credentials separate", async ({ provider, protocol }) => {
    await act(async () => { await session.setSearchMode(provider); });
    await act(async () => { await session.updateConnection("c", "protocol", protocol); });
    const requests: ChatRequest[] = []; respond(request => requests.push(request), protocol === "anthropic-native" ? "end_turn" : "stop");
    await draft(); await act(async () => { await session.sendMessage(); });
    expect(mocks.searchExa).toHaveBeenCalledTimes(1);
    expect(mocks.searchExa.mock.calls[0][1]).toBe("current question");
    expect(mocks.searchExa.mock.calls[0][3]).toBe(provider);
    expect(mocks.searchExa.mock.calls[0][0].apiKey).toBe(provider === "exa-api" ? "synthetic-api-key" : "synthetic-search-key");
    const answer = requests.find(request => request.messages.some(message => message.content.includes("Retrieved material")))!;
    expect(answer).toBeDefined(); expect(answer.config?.webSearch).toBe(false);
    expect(answer.apiKey).toBe("synthetic-chat-key");
    expect(JSON.stringify(answer.messages)).not.toContain("synthetic-search-key");
    expect(JSON.stringify(answer.messages)).not.toContain("synthetic-api-key");
    expect(session.messages[0].content).toBe("current question");
    expect(session.messages[1].search?.status).toBe("completed");
    expect(session.messages[1].search?.provider).toBe(provider);
    expect(session.messages[1].search?.citations).toHaveLength(1);
    expect(JSON.stringify((await repo.load("current"))?.messages)).not.toContain("synthetic-search-key");
  });
  it("rejects an unconfigured API profile before search, model, title or message writes", async () => {
    const config = loadSearchConfiguration();
    saveSearchConfiguration({ ...config, exaApi: { ...config.exaApi, apiKey: "" } });
    await act(async () => { await session.setSearchMode("exa-api"); });
    await draft(); await act(async () => { await session.sendMessage(); });
    expect(session.error).toContain("Key");
    expect(session.draft).toBe("current question"); expect(session.messages).toHaveLength(0);
    expect(mocks.searchExa).not.toHaveBeenCalled(); expect(mocks.createRuntimeChatTransport).not.toHaveBeenCalled();
  });
  it("does not call model or title service when retrieval fails", async () => {
    mocks.searchExa.mockRejectedValue(new Error("Exa 搜索失败"));
    await draft(); await act(async () => { await session.sendMessage(); });
    expect(mocks.createRuntimeChatTransport).not.toHaveBeenCalled();
    expect(session.messages.map(message => message.status)).toEqual(["complete", "failed"]);
    expect(session.messages[1].search?.status).toBe("failed");
    expect(session.draft).toBe("");
  });
  it("keeps successful sources when answer fails", async () => {
    mocks.createRuntimeChatTransport.mockResolvedValue({ async *stream() { yield { type: "failed", error: { kind: "server", message: "model failed", retryable: false } }; } } satisfies ChatTransport);
    await draft(); await act(async () => { await session.sendMessage(); });
    expect(session.messages[1].status).toBe("failed"); expect(session.messages[1].search?.status).toBe("completed");
    expect(session.messages[1].search?.sources).toEqual([source]);
  });
  it("does not start model after cancelled late retrieval and preserves newer draft", async () => {
    let resolve!: (value: { sources: typeof source[] }) => void;
    mocks.searchExa.mockImplementation(() => new Promise(r => { resolve = r; }));
    await draft(); let pending!: Promise<unknown>;
    await act(async () => { pending = session.sendMessage(); });
    await wait(() => mocks.searchExa.mock.calls.length === 1);
    await draft("next draft"); await act(async () => session.stopGeneration());
    await act(async () => { resolve({ sources: [source] }); await pending; });
    expect(mocks.createRuntimeChatTransport).not.toHaveBeenCalled();
    expect(session.messages[1].status).toBe("aborted"); expect(session.messages[1].search?.status).toBe("cancelled");
    expect(session.draft).toBe("next draft");
  });
  it("freezes settings and mode while searching", async () => {
    let resolve!: (value: { sources: typeof source[] }) => void;
    mocks.searchExa.mockImplementation(() => new Promise(r => { resolve = r; }));
    await draft(); let pending!: Promise<unknown>;
    await act(async () => { pending = session.sendMessage(); });
    await wait(() => mocks.searchExa.mock.calls.length === 1);
    saveSearchSettings({ ...defaultSearchSettings(), apiKey: "new-search-key" });
    await act(async () => { await session.setSearchMode("native"); });
    await act(async () => { resolve({ sources: [source] }); await pending; });
    expect(mocks.searchExa.mock.calls[0][0].apiKey).toBe("synthetic-search-key");
    expect(session.messages[1].search?.provider).toBe("exa-mcp"); expect(session.searchMode).toBe("native");
  });
  it("rejects empty and oversized queries before writing or searching", async () => {
    await draft("a".repeat(2001)); await act(async () => { await session.sendMessage(); });
    expect(mocks.searchExa).not.toHaveBeenCalled(); expect(session.messages).toHaveLength(0);
    expect(session.draft).toHaveLength(2001);
  });
  it("blocks final budget failure after retrieval without title/answer", async () => {
    await act(async () => { await session.workspace.execute({ type: "configure-conversation", id: "current", settings: { ...session.workspace.effective,
      config: { ...session.workspace.effective.config, contextBudget: { mode: "custom", value: "80" } } } }); });
    await draft("small question"); await act(async () => { await session.sendMessage(); });
    expect(mocks.searchExa).toHaveBeenCalledTimes(1); expect(mocks.createRuntimeChatTransport).not.toHaveBeenCalled();
    expect(session.messages[1].search?.status).toBe("completed"); expect(session.messages[1].status).toBe("failed");
  });
  it.each<ExternalSearchProvider>(["exa-mcp", "exa-api"])("continues paused Anthropic via %s with the exact prepared context and source snapshot", async provider => {
    await act(async () => { await session.setSearchMode(provider); });
    await act(async () => { await session.updateConnection("c", "protocol", "anthropic-native");
      await session.workspace.execute({ type: "rename-conversation", id: "current", title: "manual" }); });
    const requests: ChatRequest[] = [];
    mocks.createRuntimeChatTransport.mockResolvedValue({ async *stream(request) {
      requests.push(request);
      yield { type: "text-delta", text: requests.length === 1 ? "first [ayase-source:source_1]" : " second [ayase-source:source_1]" };
      yield { type: "provider-replay", replay: { protocol: "anthropic-native", scope: request.replayScope!, content: [{ type: "text", text: "provider replay" }] } };
      yield { type: "completed", finishReason: requests.length === 1 ? "pause_turn" : "end_turn" };
    } } satisfies ChatTransport);
    await draft(); await act(async () => { await session.sendMessage(); });
    const paused = session.messages[1];
    expect(paused.status).toBe("paused"); expect(paused.continuation?.messages[0].content).toContain("Retrieved material");
    saveSearchSettings({ ...defaultSearchSettings(), apiKey: "changed" });
    await act(async () => { await session.setSearchMode("off"); });
    await act(async () => { await session.continueMessage(paused.id); });
    expect(session.error).toBeUndefined();
    expect(mocks.searchExa).toHaveBeenCalledTimes(1);
    expect(session.messages[1].search?.provider).toBe(provider);
    expect(requests[1].messages[0]).toEqual(requests[0].messages[0]);
    expect(requests[1].messages[1].providerReplay).toBeDefined();
    expect(session.messages[1].search?.citations).toHaveLength(2);
    const followup: ChatRequest[] = []; respond(request => followup.push(request), "end_turn");
    await draft("followup"); await act(async () => { await session.sendMessage(); });
    expect(JSON.stringify(followup[0].messages)).not.toContain("Retrieved material");
    expect(JSON.stringify(followup[0].messages)).not.toContain("provider replay");
    expect(JSON.stringify(followup[0].messages)).not.toContain("ayase-source:source_1");
    expect(followup[0].messages[1].content).toContain("https://source.example/");
  });
  it("regenerates new sources for each candidate and restores their own snapshots", async () => {
    await act(async () => { await session.workspace.execute({ type: "rename-conversation", id: "current", title: "manual" }); });
    await draft(); await act(async () => { await session.sendMessage(); });
    const original = session.messages[1];
    const second = { ...source, id: "source_2", title: "Second search" };
    mocks.searchExa.mockResolvedValue({ sources: [second] });
    respond(); await act(async () => { await session.retryMessage(original.id); });
    expect(mocks.searchExa).toHaveBeenCalledTimes(2);
    expect(session.messages[1].search?.sources).toEqual([second]);
    // The fake model used an old id: it cannot cite the new candidate's sources.
    expect(session.messages[1].search?.citations).toEqual([]);
    await act(async () => { await session.selectRoundVersion(0); });
    expect(session.messages[1].search?.sources).toEqual([source]);
    expect(session.messages[1].search?.citations).toHaveLength(1);
    await act(async () => { await session.editMessage(session.messages[1].id, "changed answer"); });
    expect(session.messages[1].search).toBeUndefined();
  });
  it("keeps concurrent conversation retrieval and late writes bound to their origin", async () => {
    const resolvers = new Map<string, (value: { sources: typeof source[] }) => void>();
    mocks.searchExa.mockImplementation((_settings, query: string) => new Promise(resolve => resolvers.set(query, resolve)));
    await act(async () => { await session.workspace.execute({ type: "rename-conversation", id: "current", title: "manual" }); });
    await draft("first conversation"); let first!: Promise<unknown>;
    await act(async () => { first = session.sendMessage(); }); await wait(() => resolvers.has("first conversation"));
    await act(async () => { await session.workspace.execute({ type: "create-conversation", id: "other", assistantId: session.workspace.assistant!.id }); });
    await wait(() => session.workspace.conversation?.id === "other" && session.isHydrated && session.workspace.canSend());
    await act(async () => { await session.setSearchMode("exa-mcp"); await session.workspace.execute({ type: "rename-conversation", id: "other", title: "manual other" }); });
    await draft("second conversation"); let second!: Promise<unknown>;
    await act(async () => { second = session.sendMessage(); }); await wait(() => resolvers.has("second conversation"));
    await draft("next other draft");
    await act(async () => { resolvers.get("first conversation")!({ sources: [source] }); await first; });
    expect(session.isGenerating).toBe(true); expect(session.draft).toBe("next other draft");
    expect((await repo.load("current"))?.messages[0].content).toBe("first conversation");
    await act(async () => session.stopGeneration());
    await act(async () => { resolvers.get("second conversation")!({ sources: [source] }); await second; });
    expect((await repo.load("other"))?.messages[1].status).toBe("aborted");
    expect((await repo.load("current"))?.messages[1].status).toBe("complete");
  });
});
