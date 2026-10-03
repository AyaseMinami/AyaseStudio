// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatSession } from "./useChatSession";
import { createChatRepository, type StoredChatMessage } from "./repository";
import { saveConnectionSettings } from "./settings";
import type { ChatRequest, ChatTransport } from "./types";

const runtime = vi.hoisted(() => ({ createRuntimeChatTransport: vi.fn(), createRuntimeModelCatalogClient: vi.fn(),
  read: vi.fn(), cleanup: vi.fn(), save: vi.fn(), verify: vi.fn() }));
vi.mock("./runtime", () => runtime);
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("./attachmentResources", () => ({ createTauriAttachmentStore: () => ({
  read: runtime.read, cleanup: runtime.cleanup, save: runtime.save, verify: runtime.verify,
}) }));

const attachment = { name: "note.txt", reference: "attachments/retained.txt", mimeType: "text/plain" as const, size: 4 };
const history: StoredChatMessage[] = [
  { id: "u1", role: "user", content: "one", status: "complete" },
  { id: "a1", role: "assistant", content: "old one", status: "complete" },
  { id: "u2", role: "user", content: "two", status: "complete", attachments: [attachment] },
  { id: "a2", role: "assistant", content: "old two", status: "complete" },
  { id: "u3", role: "user", content: "three", status: "complete", attachments: [{ ...attachment, reference: "attachments/truncated.txt" }] },
  { id: "a3", role: "assistant", content: "old three", status: "complete" },
];

describe("message actions through the session", () => {
  const repo = createChatRepository();
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;
  let session: ReturnType<typeof useChatSession>;
  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.clear();
    await repo.load("current");
    const db = new Dexie("AyaseStudio"); await db.open();
    await Promise.all(db.tables.map((table) => table.clear())); db.close();
    for (const mock of Object.values(runtime)) mock.mockReset();
    runtime.read.mockImplementation(async (item) => ({ ...item, data: "bm90ZQ==" }));
    runtime.cleanup.mockResolvedValue(undefined);
    runtime.verify.mockResolvedValue(undefined);
    saveConnectionSettings({ version: 3, activeModelId: "m", providers: [{ id: "p", name: "Synthetic", connections: [{
      id: "c", name: "Test", baseUrl: "https://test.example", apiKey: "synthetic-key", protocol: "openai-chat",
      models: [{ id: "m", modelId: "any-model" }, { id: "m2", modelId: "other-model" }],
    }, { id: "gemini", name: "Gemini", baseUrl: "https://gemini.example", apiKey: "synthetic-gemini", protocol: "gemini-native",
      models: [{ id: "m3", modelId: "same-arbitrary-name" }] }] }] });
    await repo.initializeWorkspace("m", ["m", "m2", "m3"]);
    await repo.save({ id: "current", updatedAt: 1, messages: history });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    function Probe() { session = useChatSession({ onConfigurationRequired: () => undefined }); return null; }
    await act(async () => root.render(<Probe />));
    await wait(() => session.isHydrated);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
  async function wait(predicate: () => boolean) {
    for (let i = 0; i < 100 && !predicate(); i++) await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
    expect(predicate()).toBe(true);
  }
  function respond(observe?: (request: ChatRequest) => void) {
    runtime.createRuntimeChatTransport.mockResolvedValue({ async *stream(request) {
      observe?.(request);
      yield { type: "text-delta", text: "new answer" };
      yield { type: "completed", finishReason: "stop" };
    } } satisfies ChatTransport);
  }

  it("sends a recalled edit as a new message and restores the unsent original", async () => {
    let sent: ChatRequest | undefined;
    respond(request => { sent = request; });
    await act(async () => session.setDraft("keep original draft"));
    await act(async () => { session.workspace.browseHistory(-1, { start: 5, end: 5 }); });
    expect(session.draft).toBe("three");
    expect(session.draftAttachments).toEqual([]);
    await act(async () => session.setDraft("three recalled and edited"));
    await act(async () => { await session.sendMessage(); });
    expect(sent?.messages.slice(-1)[0].content).toBe("three recalled and edited");
    expect(session.draft).toBe("keep original draft");
    expect(session.workspace.view.draftSelection).toEqual({ start: 5, end: 5 });
    expect(session.messages.find(item => item.id === "u3")?.content).toBe("three");
  });

  it("retains a recalled edit and its original when send preflight rejects it", async () => {
    await act(async () => session.setDraft("original"));
    await act(async () => { session.workspace.browseHistory(-1, { start: 0, end: 0 }); });
    await act(async () => session.setDraft("edited history"));
    await act(async () => { await session.workspace.execute({ type: "configure-conversation", id: "current",
      settings: { ...session.workspace.effective, modelId: null } }); });
    await act(async () => { await session.sendMessage(); });
    expect(session.draft).toBe("edited history");
    await act(async () => { session.workspace.browseHistory(1, { start: 14, end: 14 }); });
    expect(session.draft).toBe("original");
    expect(runtime.createRuntimeChatTransport).not.toHaveBeenCalled();
  });

  it("switches latest paired versions, persists selection and discards alternatives on the next turn", async () => {
    respond();
    await act(async () => { await session.editAndSendMessage("u3", "three revised"); });
    expect(session.messages[session.messages.length - 2]?.roundVersions?.pairs).toHaveLength(2);
    await act(async () => { expect(await session.selectRoundVersion(0)).toBe(true); });
    expect(session.messages.slice(-2).map((item) => item.content)).toEqual(["three", "old three"]);
    expect((await repo.load("current"))?.messages.slice(-2)[0]?.roundVersions?.selected).toBe(0);
    await act(async () => { await session.retryMessage("a3"); });
    expect(session.messages[session.messages.length - 2]?.roundVersions?.pairs).toHaveLength(3);
    await act(async () => { await session.selectRoundVersion(1); });
    expect(session.messages.slice(-2).map((item) => item.content)).toEqual(["three revised", "new answer"]);
    let sent: ChatRequest | undefined;
    respond((request) => { sent = request; });
    await act(async () => session.setDraft("four"));
    await act(async () => { await session.sendMessage(); });
    expect(sent?.messages.map((item) => item.content)).toEqual(["one", "old one", "two", "old two", "three revised", "new answer", "four"]);
    expect(session.messages.every((item) => !item.roundVersions)).toBe(true);
    expect((await repo.load("current"))?.messages.every((item) => !item.roundVersions)).toBe(true);
  });

  it("keeps the old pair after a failed regeneration and forbids switching during generation", async () => {
    let finish!: () => void;
    runtime.createRuntimeChatTransport.mockResolvedValue({ async *stream() {
      await new Promise<void>((resolve) => { finish = resolve; });
      throw new Error("synthetic failure");
      yield { type: "completed", finishReason: "stop" };
    } } satisfies ChatTransport);
    let sending!: Promise<void>;
    await act(async () => { sending = session.retryMessage("a3"); });
    await wait(() => !!finish);
    await act(async () => { expect(await session.selectRoundVersion(0)).toBe(false); });
    await act(async () => { finish(); await sending; });
    expect(session.messages[session.messages.length - 1]?.status).toBe("failed");
    await act(async () => { expect(await session.selectRoundVersion(0)).toBe(true); });
    expect(session.messages.slice(-2).map((item) => item.content)).toEqual(["three", "old three"]);
  });

  it("sends the original math source from restored history", async () => {
    const source = String.raw`设 $A^2=I$，求 \(A\)。`;
    await act(async () => { await session.editMessage("u3", source); });
    let sent: ChatRequest | undefined;
    respond((request) => { sent = request; });
    await act(async () => { await session.retryMessage("u3"); });
    expect(sent?.messages[sent.messages.length - 1]?.content).toBe(source);
  });

  it("saves an edit without generating or cleaning attachments and preserves later messages", async () => {
    const original = session.messages;
    runtime.cleanup.mockClear();
    await act(async () => { expect(await session.editMessage("u2", "edited")).toBe(true); });
    expect(session.messages.slice(3)).toEqual(original.slice(3));
    expect(session.messages[2]).toMatchObject({ content: "edited", editedAt: expect.any(Number), attachments: [attachment] });
    expect(runtime.cleanup).not.toHaveBeenCalled();
    expect(runtime.createRuntimeChatTransport).not.toHaveBeenCalled();
    const persisted = (await repo.load("current"))!.messages;
    expect(persisted.slice(3)).toEqual(history.slice(3));
    expect(persisted[2]).toMatchObject({ content: "edited", editedAt: expect.any(Number), attachments: [attachment] });
  });

  it("edits and sends once, preserving shared attachments and the composer draft", async () => {
    await repo.execute({ type: "fork-conversation", id: "shared", conversationId: "current", messageId: "a3",
      creationConfig: { modelId: "m", config: session.sessionConfig } });
    let request: ChatRequest | undefined;
    respond((value) => { request = value; });
    await act(async () => session.setDraft("unsent"));
    await act(async () => { expect(await session.editAndSendMessage("u2", "changed")).toBe(true); });
    expect(request?.messages.map((item) => item.content)).toEqual(["one", "old one", "changed"]);
    expect(session.messages.map((item) => item.content)).toEqual(["one", "old one", "changed", "new answer"]);
    expect(session.messages[2]).toMatchObject({ id: "u2", editedAt: expect.any(Number), attachments: [attachment] });
    expect(runtime.createRuntimeChatTransport).toHaveBeenCalledTimes(1);
    expect(session.draft).toBe("unsent");
    expect(runtime.cleanup).toHaveBeenLastCalledWith(expect.arrayContaining([attachment.reference, "attachments/truncated.txt"]), []);
    expect((await repo.load("current"))?.messages).toEqual(session.messages);
  });

  it("freezes overrides during generation and uses edited fields only for the next request", async () => {
    const requests: ChatRequest[] = [];
    let finish!: () => void;
    runtime.createRuntimeChatTransport.mockResolvedValue({ async *stream(request) {
      requests.push(request);
      yield { type: "text-delta", text: "answer" };
      if (requests.length === 1) await new Promise<void>((resolve) => { finish = resolve; });
      yield { type: "completed", finishReason: "stop" };
    } } satisfies ChatTransport);
    let sending!: Promise<void>;
    await act(async () => { sending = session.retryMessage("a2"); });
    await wait(() => !!finish);
    await act(async () => session.workspace.execute({ type: "configure-conversation", id: "current", settings: {
      modelId: "m2", config: { ...session.sessionConfig, systemInstruction: "Next request" },
    } }));
    expect(requests[0].model).toBe("any-model");
    expect(requests[0].config?.systemInstruction).toBe("");
    expect(session.messages.slice(-1)[0]?.generationModel).toBe("any-model");
    expect(runtime.createRuntimeChatTransport).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); await sending; });
    expect((await repo.load("current"))?.messages.slice(-1)[0]?.generationModel).toBe("any-model");
    await act(async () => session.retryMessage("u2"));
    expect(requests[1].model).toBe("other-model");
    expect(requests[1].config?.systemInstruction).toBe("Next request");
    expect(session.messages.slice(-1)[0]?.generationModel).toBe("other-model");
    const versions = session.messages.slice(-2)[0]?.roundVersions!;
    expect(versions.pairs.map(pair => pair[1].generationModel)).toEqual(["any-model", "other-model"]);
    await act(async () => { await session.selectRoundVersion(0); });
    expect(session.messages.slice(-1)[0]?.generationModel).toBe("any-model");
    expect((await repo.load("current"))?.messages.slice(-1)[0]?.generationModel).toBe("any-model");
    expect(session.workspace.assistant?.defaultModelId).toBe("m");
    expect(session.workspace.assistant?.defaultConfig.systemInstruction).toBe("");
  });

  it("blocks an invalid conversation model without falling back or changing the transcript", async () => {
    const original = session.messages;
    respond();
    await act(async () => session.workspace.execute({ type: "configure-conversation", id: "current", settings: { modelId: "deleted-model", config: session.sessionConfig } }));
    await act(async () => session.retryMessage("a2"));
    expect(session.activeModel).toBeUndefined();
    expect(session.messages).toEqual(original);
    expect(runtime.createRuntimeChatTransport).not.toHaveBeenCalled();
    await act(async () => session.workspace.execute({ type: "configure-conversation", id: "current", settings: { modelId: "m", config: session.sessionConfig } }));
    await act(async () => session.retryMessage("a2"));
    expect(runtime.createRuntimeChatTransport).toHaveBeenCalledTimes(1);
  });

  it("switches the complete connection for the next request while preserving the running request and draft", async () => {
    const requests: ChatRequest[] = [];
    let finish!: () => void;
    runtime.createRuntimeChatTransport.mockResolvedValue({ async *stream(request) {
      requests.push(request);
      yield { type: "text-delta", text: "answer" };
      if (requests.length === 1) await new Promise<void>((resolve) => { finish = resolve; });
      yield { type: "completed", finishReason: "stop" };
    } } satisfies ChatTransport);
    await act(async () => session.setWebSearch(true));
    let sending!: Promise<void>;
    await act(async () => { sending = session.retryMessage("a2"); });
    await wait(() => !!finish);
    await act(async () => session.setDraft("keep this draft"));
    await act(async () => { expect(await session.setConversationModel("m3")).toBe(true); });
    expect(session.activeConnection?.protocol).toBe("gemini-native");
    expect(session.draft).toBe("keep this draft");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ model: "any-model", baseUrl: "https://test.example", apiKey: "synthetic-key" });
    await act(async () => { finish(); await sending; });
    await act(async () => session.retryMessage("u2"));
    expect(runtime.createRuntimeChatTransport.mock.calls.map(([protocol]) => protocol)).toEqual(["openai-chat", "gemini-native"]);
    expect(requests[1]).toMatchObject({ model: "same-arbitrary-name", baseUrl: "https://gemini.example", apiKey: "synthetic-gemini", config: { webSearch: true } });
    expect(session.workspace.assistant?.defaultModelId).toBe("m");
    expect((await repo.initializeWorkspace(null, ["m", "m2", "m3"])).conversations.find((c) => c.id === "current")?.settings?.modelId).toBe("m3");
  });

  it("native search persists citations and clears them on edited text", async () => {
    await act(async () => session.setWebSearch(true));
    const search = { enabled: true, status: "completed" as const,
      sources: [{ id: "https://example.test", url: "https://example.test", title: "Example" }],
      citations: [{ start: 0, end: 6, sourceIds: ["https://example.test"] }], queries: ["query"] };
    runtime.createRuntimeChatTransport.mockResolvedValue({ async *stream(request) {
      expect(request.config?.webSearch).toBe(true);
      yield { type: "text-delta", text: "answer" };
      yield { type: "search-update", search };
      yield { type: "completed", finishReason: "stop" };
    } } satisfies ChatTransport);
    await act(async () => session.retryMessage("a2"));
    const answer = session.messages[3];
    expect((await repo.load("current"))?.messages[3].search).toEqual(search);
    await act(async () => { await session.editMessage(answer.id, "edited"); });
    expect(session.messages[3].search).toBeUndefined();
    expect(runtime.createRuntimeChatTransport).toHaveBeenCalledTimes(1);
  });

  it("native search continues a paused Anthropic response once with frozen config and original blocks", async () => {
    await act(async () => session.updateConnection("c", "protocol", "anthropic-native"));
    await act(async () => session.setWebSearch(true));
    const requests: ChatRequest[] = [];
    runtime.createRuntimeChatTransport.mockResolvedValue({ async *stream(request) {
      requests.push(request);
      yield { type: "text-delta", text: requests.length === 1 ? "first" : "second" };
      yield { type: "provider-replay", replay: { protocol: "anthropic-native", scope: request.replayScope!,
        content: [{ type: "text", text: requests.length === 1 ? "first" : "second" }] } };
      yield { type: "completed", finishReason: requests.length === 1 ? "pause_turn" : "end_turn" };
    } } satisfies ChatTransport);
    await act(async () => session.retryMessage("a2"));
    const paused = session.messages[3];
    expect(paused.status).toBe("paused");
    expect(requests).toHaveLength(1);
    await act(async () => session.setWebSearch(false));
    await act(async () => session.continueMessage(paused.id));
    expect(requests).toHaveLength(2);
    expect(requests[1].config?.webSearch).toBe(true);
    expect(requests[1].messages.slice(-1)[0].providerReplay?.content).toEqual([{ type: "text", text: "first" }]);
    expect(session.messages[3]).toMatchObject({ id: paused.id, content: "firstsecond", status: "complete" });
    expect(session.messages[3].continuation).toBeUndefined();
    expect((await repo.load("current"))?.messages[3].providerReplay?.responses).toHaveLength(2);
  });

  it.each(["u2", "a2"])("retries %s once with current config and only its preceding history", async (id) => {
    let request: ChatRequest | undefined;
    respond((value) => { request = value; });
    await act(async () => {
      await session.workspace.execute({ type: "configure-conversation", id: "current",
        settings: { modelId: "m2", config: { ...session.sessionConfig, systemInstruction: "Current instruction" } } });
    });
    await act(async () => session.setDraft("keep draft"));
    await act(async () => session.retryMessage(id));
    expect(runtime.createRuntimeChatTransport).toHaveBeenCalledTimes(1);
    expect(request?.model).toBe("other-model");
    expect(request?.config?.systemInstruction).toBe("Current instruction");
    expect(request?.messages.map((item) => item.content)).toEqual(["one", "old one", "two"]);
    expect(request?.messages.slice(-1)[0]?.attachments?.[0]).toMatchObject({ data: "bm90ZQ==" });
    expect(session.messages.map((item) => item.content)).toEqual(["one", "old one", "two", "new answer"]);
    expect(session.messages.slice(-1)[0]?.replyToId).toBe("u2");
    expect(session.draft).toBe("keep draft");
    expect(runtime.save).not.toHaveBeenCalled();
    expect(runtime.cleanup).toHaveBeenLastCalledWith([attachment.reference], []);
    expect((await repo.load("current"))!.messages).toEqual(session.messages);
  });

  it("preserves the original transcript on failed preflight, then persists a provider failure without retry", async () => {
    const original = session.messages;
    runtime.read.mockRejectedValueOnce(new Error("missing attachment"));
    await act(async () => session.editAndSendMessage("u2", "changed"));
    expect(session.messages).toEqual(original);
    expect(runtime.createRuntimeChatTransport).not.toHaveBeenCalled();
    runtime.createRuntimeChatTransport.mockResolvedValue({ async *stream() {
      yield { type: "failed", error: { kind: "network", message: "ambiguous failure", retryable: true } };
    } } satisfies ChatTransport);
    await act(async () => session.editAndSendMessage("u2", "changed"));
    expect(session.messages).toHaveLength(4);
    expect(session.messages[2]).toMatchObject({ content: "changed", editedAt: expect.any(Number) });
    expect(session.messages.slice(-1)[0]?.status).toBe("failed");
    expect(runtime.createRuntimeChatTransport).toHaveBeenCalledTimes(1);
    expect((await repo.load("current"))?.messages.slice(-1)[0]?.status).toBe("failed");
  });

  it("keeps request ownership across navigation, blocks conflicts and double send, and persists Stop", async () => {
    let request: ChatRequest | undefined;
    runtime.createRuntimeChatTransport.mockResolvedValue({ async *stream(value) {
      request = value;
      yield { type: "text-delta", text: "partial" };
      await new Promise<void>((resolve) => value.signal!.addEventListener("abort", () => resolve(), { once: true }));
      yield { type: "aborted" };
    } } satisfies ChatTransport);
    let sending!: Promise<void>;
    await act(async () => { sending = session.editAndSendMessage("u2", "changed").then(() => {}); });
    await wait(() => !!request);
    await act(async () => {
      expect(await session.deleteMessage("u1")).toBe(false);
      expect(await session.editMessage("u1", "changed")).toBe(false);
      expect(await session.branchMessage("u1")).toBe(false);
      await session.retryMessage("u2");
      expect(await session.editAndSendMessage("u2", "duplicate")).toBe(false);
    });
    await act(async () => session.workspace.execute({ type: "create-conversation", id: "elsewhere", assistantId: "default" }));
    await act(async () => session.setActiveModel("m2"));
    expect(request?.model).toBe("any-model");
    await act(async () => session.stopGeneration());
    expect(request?.signal?.aborted).toBe(false);
    await act(async () => session.workspace.execute({ type: "select", assistantId: "default", conversationId: "current" }));
    await act(async () => { session.stopGeneration(); await sending; });
    expect(session.messages.slice(-1)[0]?.status).toBe("aborted");
    expect((await repo.load("current"))?.messages.slice(-1)[0]).toMatchObject({ content: "partial", status: "aborted" });
    expect((await repo.load("current"))?.messages[2]).toMatchObject({ content: "changed", editedAt: expect.any(Number) });
    expect(runtime.createRuntimeChatTransport).toHaveBeenCalledTimes(1);
  });

  it("creates an offline branch with its own settings and retains shared attachments after edit", async () => {
    await act(async () => { expect(await session.branchMessage("a2")).toBe(true); });
    const branchId = session.workspace.conversation!.id;
    expect(branchId).not.toBe("current");
    expect(session.messages).toHaveLength(4);
    expect(runtime.createRuntimeChatTransport).not.toHaveBeenCalled();
    expect(session.workspace.conversation?.creationConfig?.modelId).toBe("m");
    await act(async () => session.setActiveModel("m2"));
    await wait(() => session.isHydrated);
    expect(session.activeModel?.id).toBe("m");
    await act(async () => session.workspace.execute({ type: "configure-conversation", id: branchId, settings: { modelId: "m2", config: session.sessionConfig } }));
    let request: ChatRequest | undefined;
    respond((value) => { request = value; });
    await act(async () => session.retryMessage(session.messages[3].id));
    expect(request?.model).toBe("other-model");
    expect(session.workspace.conversation?.creationConfig?.modelId).toBe("m");
    await act(async () => { expect(await session.editMessage(session.messages[0].id, "changed")).toBe(true); });
    expect(session.messages).toHaveLength(4);
    expect((await repo.load("current"))?.messages).toHaveLength(6);
    expect(await repo.attachmentReferences()).toContain(attachment.reference);
    expect(runtime.cleanup.mock.calls.slice(-1)[0]?.[0]).toContain(attachment.reference);
    await act(async () => session.workspace.execute({ type: "select", assistantId: "default", conversationId: "current" }));
    expect(session.messages).toHaveLength(6);
    await act(async () => session.workspace.execute({ type: "select", assistantId: "default", conversationId: branchId }));
    expect(session.messages.map((item) => item.content)).toEqual(["changed", "old one", "two", "new answer"]);
  });
});
