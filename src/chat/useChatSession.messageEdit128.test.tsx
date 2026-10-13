// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatSession } from "./useChatSession";
import { createChatRepository, type StoredChatMessage } from "./repository";
import { saveConnectionSettings } from "./settings";
import { bytesToBase64, prepareDraftAttachment, type RequestAttachment, type SentAttachment } from "./attachments";
import type { MessageEditDraft, MessageEditResult } from "./messageEditTypes";
import type { ChatRequest, ChatTransport } from "./types";
import { defaultSessionConfig } from "./sessionConfig";
import { SessionStore } from "./sessionStore";

const mocks = vi.hoisted(() => ({ createRuntimeChatTransport: vi.fn(), createRuntimeModelCatalogClient: vi.fn(),
  save: vi.fn(), read: vi.fn(), verify: vi.fn(), discardUncommitted: vi.fn(), cleanup: vi.fn() }));
vi.mock("./runtime", () => ({ createRuntimeChatTransport: mocks.createRuntimeChatTransport, createRuntimeModelCatalogClient: mocks.createRuntimeModelCatalogClient }));
vi.mock("./attachmentResources", () => ({ createTauriAttachmentStore: () => ({
  save: mocks.save, read: mocks.read, verify: mocks.verify, discardUncommitted: mocks.discardUncommitted, cleanup: mocks.cleanup,
}) }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn() }));

const old: SentAttachment = { name: "old.txt", reference: "attachments/00000000-0000-4000-8000-000000000001.txt", mimeType: "text/plain", size: 4 };
const kept: SentAttachment = { name: "kept.txt", reference: "attachments/00000000-0000-4000-8000-000000000002.txt", mimeType: "text/plain", size: 4 };
const original: StoredChatMessage[] = [
  { id: "user", role: "user", content: "original user", status: "complete", replyToId: null, attachments: [old, kept] },
  { id: "answer", role: "assistant", content: "original answer", status: "complete", replyToId: "user" },
];
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }

describe("#128 message edits through the real chat session", () => {
  const repository = createChatRepository();
  let root: ReturnType<typeof createRoot>, container: HTMLDivElement;
  let session: ReturnType<typeof useChatSession>;
  let saved: Map<string, RequestAttachment>, sequence: number;
  let releases: Array<() => void>;
  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.clear();
    await repository.load("current");
    const db = new Dexie("AyaseStudio"); await db.open();
    await Promise.all(db.tables.map(table => table.clear())); db.close();
    for (const mock of Object.values(mocks)) mock.mockReset();
    sequence = 10; releases = [];
    saved = new Map([old, kept].map(item => [item.reference, { name: item.name, mimeType: item.mimeType, size: item.size, data: bytesToBase64(new TextEncoder().encode(item === old ? "old!" : "keep")) }]));
    mocks.save.mockImplementation(saveFile);
    mocks.read.mockImplementation(async (item: SentAttachment) => {
      const value = saved.get(item.reference); if (!value) throw new Error("synthetic missing attachment"); return value;
    });
    mocks.verify.mockResolvedValue(undefined);
    mocks.discardUncommitted.mockImplementation(async (references: string[]) => { references.forEach(reference => saved.delete(reference)); });
    mocks.cleanup.mockResolvedValue(undefined);
    await repository.initializeWorkspace(null, []);
    await repository.save({ id: "current", updatedAt: 1, messages: original });
    await repository.execute({ type: "create-conversation", id: "other", assistantId: "default" });
    await repository.save({ id: "other", updatedAt: 1, messages: [
      { id: "other-user", role: "user", content: "other question", status: "complete", replyToId: null },
      { id: "other-answer", role: "assistant", content: "other answer", status: "complete", replyToId: "other-user" },
    ] });
    await repository.execute({ type: "select", assistantId: "default", conversationId: "current" });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => {
    releases.forEach(release => release());
    if (session) await act(async () => { session.cancelBackupPreparation(); await session.prepareForClose(); });
    await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks();
  });
  async function saveFile(item: RequestAttachment): Promise<SentAttachment> {
    const reference = `attachments/00000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}.txt`;
    saved.set(reference, item);
    return { reference, name: item.name, mimeType: item.mimeType, size: item.size };
  }
  async function wait(predicate: () => boolean) {
    for (let index = 0; index < 100 && !predicate(); index++) await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
    expect(predicate()).toBe(true);
  }
  async function mount(model = true) {
    saveConnectionSettings(model ? { version: 3, activeModelId: "m", providers: [{ id: "p", name: "Synthetic", connections: [{
      id: "c", name: "Synthetic", baseUrl: "https://example.invalid", apiKey: "synthetic-only", protocol: "openai-chat", models: [{ id: "m", modelId: "synthetic-model" }],
    }] }] } : { version: 3, activeModelId: null, providers: [] });
    for (const id of ["current", "other"]) await repository.execute({ type: "configure-conversation", id, settings: { modelId: model ? "m" : null, config: defaultSessionConfig() } });
    function Probe() { session = useChatSession({ onConfigurationRequired: () => undefined }); return null; }
    await act(async () => root.render(<Probe />)); await wait(() => session.isHydrated);
    mocks.cleanup.mockClear();
  }
  async function editorDraft(names = ["new.txt"]): Promise<MessageEditDraft> {
    const base = structuredClone(session.messages.find(message => message.id === "user")!);
    const additions = await Promise.all(names.map(name => prepareDraftAttachment(new File([name], name, { type: "text/plain" }))));
    return { base, attachments: [...additions.map(attachment => ({ kind: "added" as const, attachment })), { kind: "retained", attachment: kept }] };
  }
  async function composerDraft() {
    await act(async () => { session.setDraft("original bottom draft"); await session.addFiles([new File(["composer"], "composer.txt", { type: "text/plain" })]); });
    return session.draftAttachments;
  }
  async function select(id: string) {
    await act(async () => { expect(await session.workspace.execute({ type: "select", assistantId: "default", conversationId: id })).toBe(true); });
    await wait(() => session.isHydrated);
  }

  it("saves attachments offline without a model/key/provider and preserves the independent Composer draft", async () => {
    await mount(false); const bottom = await composerDraft();
    expect(session.activeModel).toBeUndefined();
    expect(session.connectionSettings.providers.flatMap(provider => provider.connections).every(connection => !connection.apiKey)).toBe(true);
    const draft = await editorDraft();
    await act(async () => { expect((await session.editMessage("user", "offline edited", draft)).status).toBe("saved"); });
    expect(session.draft).toBe("original bottom draft"); expect(session.draftAttachments).toEqual(bottom);
    expect(session.messages[0].attachments?.map(item => item.name)).toEqual(["new.txt", "kept.txt"]);
    expect(session.messages[1]).toEqual(original[1]);
    expect((await createChatRepository().load("current"))?.messages).toEqual(session.messages);
    expect(mocks.createRuntimeChatTransport).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledTimes(1); expect(mocks.verify).toHaveBeenCalledTimes(2);
    expect(mocks.cleanup).toHaveBeenLastCalledWith(session.messages[0].attachments!.map(item => item.reference), []);
  });

  it.each(["provider failure", "Stop"] as const)("returns saved before generation finishes and retains the new user after %s", async finish => {
    await mount(); const bottom = await composerDraft();
    const draft = await editorDraft(["second.txt", "first.txt"]);
    // Preserve this exact mixed order rather than grouping all new or all retained files.
    draft.attachments = [draft.attachments![0], draft.attachments![2], draft.attachments![1]];
    const gate = deferred<void>(); releases.push(() => gate.resolve());
    let request: ChatRequest | undefined;
    mocks.createRuntimeChatTransport.mockResolvedValue({ async *stream(value) {
      request = value; value.signal?.addEventListener("abort", () => gate.resolve(), { once: true });
      yield { type: "text-delta", text: "partial" }; await gate.promise;
      if (value.signal?.aborted) yield { type: "aborted" };
      else yield { type: "failed", error: { kind: "network", message: "synthetic ambiguous failure", retryable: true } };
    } } satisfies ChatTransport);
    await act(async () => { expect((await session.editAndSendMessage("user", "new user", draft)).status).toBe("saved"); });
    await wait(() => !!request);
    expect(session.isGenerating).toBe(true);
    expect(request?.messages.slice(-1)[0]?.attachments?.map(item => item.name)).toEqual(["second.txt", "kept.txt", "first.txt"]);
    expect(request?.messages.slice(-1)[0]?.attachments?.map(item => "data" in item ? item.data : undefined)).toEqual([
      bytesToBase64(new TextEncoder().encode("second.txt")), saved.get(kept.reference)!.data, bytesToBase64(new TextEncoder().encode("first.txt")),
    ]);
    const committed = (await repository.load("current"))!.messages;
    expect(committed[0].content).toBe("new user");
    expect(committed[0].roundVersions!.selected).toBe(1);
    expect(committed[0].roundVersions!.pairs[0]).toEqual(original);
    expect(committed[0].roundVersions!.pairs[1][0].attachments).toEqual(committed[0].attachments);
    expect(committed[0].attachments?.some(item => item.reference === old.reference)).toBe(false);
    await act(async () => { if (finish === "Stop") session.stopGeneration(); else gate.resolve(); });
    await wait(() => !session.isAnyGenerating);
    const persisted = (await repository.load("current"))!.messages;
    expect(persisted[0].content).toBe("new user"); expect(persisted[0].attachments).toEqual(committed[0].attachments);
    expect(persisted[1]).toMatchObject({ content: "partial", status: finish === "Stop" ? "aborted" : "failed" });
    expect(session.draft).toBe("original bottom draft"); expect(session.draftAttachments).toEqual(bottom);
    expect(mocks.discardUncommitted).not.toHaveBeenCalled(); expect(mocks.createRuntimeChatTransport).toHaveBeenCalledTimes(1);
  });

  it.each(["save", "verify"] as const)("allows navigation and another conversation generation while native %s waits, then publishes only to its origin", async phase => {
    await mount(); const bottom = await composerDraft(), draft = await editorDraft();
    const nativeGate = deferred<void>(), providerGate = deferred<void>();
    releases.push(() => nativeGate.resolve(), () => providerGate.resolve());
    let nativeStarted = false;
    if (phase === "save") mocks.save.mockImplementationOnce(async (item: RequestAttachment) => { nativeStarted = true; await nativeGate.promise; return saveFile(item); });
    else mocks.verify.mockImplementationOnce(async () => { nativeStarted = true; await nativeGate.promise; });
    let editing!: Promise<MessageEditResult>;
    await act(async () => { editing = session.editMessage("user", "edited while away", draft); });
    await wait(() => nativeStarted);
    expect(session.backupDisabled).toBe(true);
    await act(async () => { expect(await session.prepareBackup()).toBe(false); expect(await session.deleteMessage("user")).toBe(false);
      expect((await session.editMessage("user", "competing edit", draft)).status).toBe("notSaved"); await session.sendMessage(); });
    expect(mocks.createRuntimeChatTransport).not.toHaveBeenCalled();
    expect((await repository.load("current"))?.messages).toEqual(original);
    await select("other");
    await act(async () => session.setDraft("other bottom draft"));
    let otherRequest: ChatRequest | undefined;
    mocks.createRuntimeChatTransport.mockResolvedValue({ async *stream(request) {
      otherRequest = request; request.signal?.addEventListener("abort", () => providerGate.resolve(), { once: true });
      yield { type: "text-delta", text: "other partial" }; await providerGate.promise;
      if (request.signal?.aborted) yield { type: "aborted" }; else yield { type: "completed", finishReason: "stop" };
    } } satisfies ChatTransport);
    let generating!: Promise<void>;
    await act(async () => { generating = session.retryMessage("other-user"); });
    await wait(() => !!otherRequest);
    expect(otherRequest?.messages.slice(-1)[0]?.content).toBe("other question"); expect(session.isGenerating).toBe(true);
    await act(async () => { nativeGate.resolve(); expect((await editing).status).toBe("saved"); });
    expect(session.workspace.conversation?.id).toBe("other"); expect(session.draft).toBe("other bottom draft");
    expect(session.messages[0].content).toBe("other question"); expect(session.error).toBeUndefined();
    expect(session.isGenerating).toBe(true);
    await select("current");
    expect(session.messages[0].content).toBe("edited while away");
    expect(session.draft).toBe("original bottom draft"); expect(session.draftAttachments).toEqual(bottom);
    expect(session.isGenerating).toBe(false); expect(session.isAnyGenerating).toBe(true);
    await select("other");
    await act(async () => { session.stopGeneration(); await generating; });
    await wait(() => !session.isAnyGenerating);
    await act(async () => { expect(await session.prepareBackup()).toBe(true); session.cancelBackupPreparation(); });
    expect((await repository.load("current"))?.messages[0].content).toBe("edited while away");
    expect(mocks.createRuntimeChatTransport).toHaveBeenCalledTimes(1);
  });

  it("drains accepted commits during close and permits conditional rollback after the second verify rejects", async () => {
    await mount(false); await composerDraft(); const draft = await editorDraft();
    const verifyGate = deferred<void>(); releases.push(() => verifyGate.resolve());
    mocks.verify.mockResolvedValueOnce(undefined).mockImplementationOnce(() => verifyGate.promise);
    let editing!: Promise<MessageEditResult>;
    await act(async () => { editing = session.editMessage("user", "must roll back", draft); });
    await wait(() => mocks.verify.mock.calls.length === 2);
    expect((await repository.load("current"))?.messages[0].content).toBe("must roll back");
    let close!: Promise<boolean>, closed = false;
    await act(async () => { close = session.prepareForClose().then(value => { closed = true; return value; }); });
    expect(closed).toBe(false);
    await act(async () => { verifyGate.reject(new Error("synthetic second verify failure")); expect((await editing).status).toBe("notSaved"); expect(await close).toBe(true); });
    expect((await repository.load("current"))?.messages).toEqual(original);
    expect(session.messages).toEqual(original);
    expect(mocks.discardUncommitted).toHaveBeenCalledWith([expect.stringMatching(/^attachments\/.+\.txt$/)]);
    expect([...saved.keys()].sort()).toEqual([old.reference, kept.reference].sort());
    expect(mocks.createRuntimeChatTransport).not.toHaveBeenCalled();
    expect(session.draft).toBe("original bottom draft");
    await act(async () => session.cancelClose());
  });

  it.each([false, true])("detaches a savedNeedsReload store and recovers without resaving Files or requesting provider (send=%s)", async send => {
    await mount(); const bottom = await composerDraft(), draft = await editorDraft();
    const staleStore = session.workspace.store!;
    const staleWrite = vi.spyOn(staleStore, "updateMessages");
    const failReload = send
      ? vi.spyOn(SessionStore.prototype, "adoptConfirmed").mockImplementationOnce(() => { throw new Error("synthetic reload failure"); })
      : vi.spyOn(SessionStore.prototype, "hydrate").mockRejectedValueOnce(new Error("synthetic reload failure"));
    await act(async () => {
      const result = send ? await session.editAndSendMessage("user", "saved despite reload", draft) : await session.editMessage("user", "saved despite reload", draft);
      expect(result.status).toBe("savedNeedsReload");
    });
    failReload.mockRestore();
    expect(session.isHydrated).toBe(false); expect(session.workspace.store).toBeUndefined();
    expect(session.workspace.loadError).toMatch(/消息已保存/); expect(session.backupDisabled).toBe(true);
    await act(async () => { expect(await session.prepareBackup()).toBe(false); await session.sendMessage(); });
    expect(staleWrite).not.toHaveBeenCalled();
    expect((await repository.load("current"))?.messages[0]).toMatchObject({ content: "saved despite reload", attachments: [expect.objectContaining({ name: "new.txt" }), kept] });
    expect(mocks.save).toHaveBeenCalledTimes(1); expect(mocks.verify).toHaveBeenCalledTimes(2);
    await act(async () => session.workspace.retry());
    await wait(() => session.isHydrated && !session.workspace.loadError);
    expect(session.workspace.store).not.toBe(staleStore); expect(session.messages[0].content).toBe("saved despite reload");
    if (send) expect(session.messages[1].status).toBe("aborted");
    expect(session.draft).toBe("original bottom draft"); expect(session.draftAttachments).toEqual(bottom);
    expect(mocks.save).toHaveBeenCalledTimes(1); expect(mocks.verify).toHaveBeenCalledTimes(2);
    expect(mocks.createRuntimeChatTransport).not.toHaveBeenCalled(); expect(mocks.discardUncommitted).not.toHaveBeenCalled();
    await act(async () => { expect(await session.prepareBackup()).toBe(true); session.cancelBackupPreparation(); });
  });
});
