// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatSession } from "./useChatSession";
import { createChatRepository } from "./repository";
import { saveConnectionSettings } from "./settings";
import { buildProtocolBody } from "./requestMapping";
import type { ChatRequest, ChatTransport } from "./types";

const mocks = vi.hoisted(() => ({
  createRuntimeChatTransport: vi.fn(),
  createRuntimeModelCatalogClient: vi.fn(),
  save: vi.fn(), read: vi.fn(), verify: vi.fn(), discardUncommitted: vi.fn(), cleanup: vi.fn(),
}));
vi.mock("./runtime", () => ({ createRuntimeChatTransport: mocks.createRuntimeChatTransport,
  createRuntimeModelCatalogClient: mocks.createRuntimeModelCatalogClient }));
vi.mock("./attachmentResources", () => ({ createTauriAttachmentStore: () => ({
  save: mocks.save, read: mocks.read, verify: mocks.verify,
  discardUncommitted: mocks.discardUncommitted, cleanup: mocks.cleanup,
}) }));

describe("attachment send ownership", () => {
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;
  let session: ReturnType<typeof useChatSession>;
  const repository = createChatRepository();
  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.clear();
    await repository.load("current");
    const database = new Dexie("AyaseStudio"); await database.open();
    await Promise.all(database.tables.map((table) => table.clear())); database.close();
    saveConnectionSettings({ version: 3, providers: [{ id: "p", name: "Synthetic", connections: [{
      id: "c", name: "Local", protocol: "openai-chat", baseUrl: "https://relay.example.com",
      apiKey: "synthetic", models: [{ id: "configured", modelId: "synthetic-model" }],
    }] }], activeModelId: "configured" });
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.save.mockImplementation(async (draft) => ({
      reference: "attachments/123e4567-e89b-42d3-a456-426614174000.txt",
      name: draft.name, mimeType: draft.mimeType, size: draft.size,
    }));
    mocks.read.mockImplementation(async (sent) => ({ ...sent, data: "SGVsbG8=" }));
    mocks.verify.mockResolvedValue(undefined);
    mocks.discardUncommitted.mockResolvedValue(undefined);
    mocks.cleanup.mockResolvedValue(undefined);
    container = document.createElement("div"); document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root?.unmount()); container.remove(); });
  async function mount() {
    function Probe() { session = useChatSession({ onConfigurationRequired: () => undefined }); return null; }
    await act(async () => root.render(<Probe />));
    for (let index = 0; index < 50 && !session.isHydrated; index++) {
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    }
    expect(session.isHydrated).toBe(true);
  }
  async function stage() {
    const file = new File(["Hello"], "note.txt", { type: "text/plain" });
    await act(async () => session.addFiles([file]));
    expect(session.draftAttachments).toHaveLength(1);
    expect((await repository.load("current"))?.messages).toEqual([]);
    expect(mocks.save).not.toHaveBeenCalled();
  }

  it("does not save or request before Send; persists an attachment-only user message and recovers on restart", async () => {
    let observed: ChatRequest | undefined;
    const transport: ChatTransport = { async *stream(request) {
      if (request.config?.stream !== false) observed = request;
      yield { type: "text-delta", text: "read" };
      yield { type: "completed", finishReason: "stop" };
    } };
    mocks.createRuntimeChatTransport.mockResolvedValue(transport);
    await mount(); await stage();
    expect(mocks.createRuntimeChatTransport).not.toHaveBeenCalled();
    await act(async () => session.sendMessage());
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.verify).toHaveBeenCalledWith([expect.objectContaining({ name: "note.txt" })]);
    expect(mocks.discardUncommitted).not.toHaveBeenCalled();
    expect(session.contextPlan).not.toHaveProperty("messages");
    expect(JSON.stringify(session.contextPlan)).not.toContain("SGVsbG8=");
    expect(observed?.messages).toMatchObject([{ role: "user", content: "", attachments: [{ data: "SGVsbG8=" }] }]);
    const stored = await repository.load("current");
    expect(stored?.messages).toMatchObject([
      { role: "user", status: "complete", attachments: [{ reference: expect.stringContaining("attachments/") }] },
      { role: "assistant", status: "complete", content: "read" },
    ]);
    expect(JSON.stringify(stored)).not.toContain("SGVsbG8=");
    await act(async () => root.unmount()); root = createRoot(container);
    await mount();
    expect(session.draftAttachments).toEqual([]);
    expect(session.messages[0].attachments).toEqual(stored?.messages[0].attachments);
    expect(await session.readAttachment(session.messages[0].attachments![0])).toMatchObject({ data: "SGVsbG8=" });
  });

  it("retains the sent copy when a provider request fails", async () => {
    mocks.createRuntimeChatTransport.mockResolvedValue({ async *stream() {
      yield { type: "failed", error: { kind: "server", message: "synthetic failure", retryable: true } };
    } } satisfies ChatTransport);
    await mount(); await stage();
    await act(async () => session.sendMessage());
    expect((await repository.load("current"))?.messages).toMatchObject([
      { role: "user", status: "complete", attachments: [expect.objectContaining({ name: "note.txt" })] },
      { role: "assistant", status: "failed" },
    ]);
  });

  it("discards a staged file before any provider request when the first history write fails", async () => {
    const transport: ChatTransport = { async *stream() {
      yield { type: "completed", finishReason: "stop" };
    } };
    mocks.createRuntimeChatTransport.mockResolvedValue(transport);
    await mount(); await stage();
    const store = session.workspace.store!;
    const actualUpdate = store.updateMessages.bind(store);
    vi.spyOn(store, "updateMessages")
      .mockRejectedValueOnce(new Error("synthetic DB failure"))
      .mockImplementation(actualUpdate);
    await act(async () => session.sendMessage());
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.discardUncommitted).toHaveBeenCalledWith([expect.stringContaining("attachments/")]);
    expect(mocks.createRuntimeChatTransport).not.toHaveBeenCalled();
    expect((await repository.load("current"))?.messages).toEqual([]);
    expect(session.draftAttachments).toHaveLength(1);
  });

  it("never calls the provider when a committed attachment cannot be read", async () => {
    mocks.verify.mockRejectedValue(new Error("missing"));
    await mount(); await stage();
    await act(async () => session.sendMessage());
    expect(mocks.createRuntimeChatTransport).not.toHaveBeenCalled();
    expect(mocks.discardUncommitted).toHaveBeenCalledTimes(1);
    expect((await repository.load("current"))?.messages).toEqual([]);
    expect(session.draftAttachments).toHaveLength(1);
    expect(session.error).toMatch(/无法读取|未发送/);
  });

  it("stops between historical reads without saving a new message or opening a provider request", async () => {
    await mount(); await stage();
    const history = [
      { id: "u1", role: "user" as const, content: "previous", status: "complete" as const,
        attachments: ["first", "second"].map((name) => ({ name: `${name}.txt`, mimeType: "text/plain" as const,
          size: 5, reference: `attachments/${name}.txt` })) },
      { id: "a1", role: "assistant" as const, content: "reply", status: "complete" as const },
    ];
    await act(async () => {
      session.workspace.setMessages(history);
      await session.workspace.store!.updateMessages(history);
    });
    let readStarted!: () => void;
    let releaseRead!: (value: { name: string; mimeType: "text/plain"; size: number; data: string }) => void;
    const started = new Promise<void>((resolve) => { readStarted = resolve; });
    mocks.read.mockImplementationOnce(() => new Promise((resolve) => { releaseRead = resolve; readStarted(); }))
      .mockResolvedValue({ name: "second.txt", mimeType: "text/plain", size: 5, data: "SGVsbG8=" });
    let sending!: Promise<void>;
    await act(async () => { sending = session.sendMessage(); });
    await started;
    expect(mocks.read).toHaveBeenCalledTimes(1);
    await act(async () => session.stopGeneration());
    releaseRead({ name: "first.txt", mimeType: "text/plain", size: 5, data: "SGVsbG8=" });
    await act(async () => sending);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.createRuntimeChatTransport).not.toHaveBeenCalled();
    expect((await repository.load("current"))?.messages).toEqual(history);
    expect(session.draftAttachments).toHaveLength(1);
  });

  it("retains the sent user attachment after explicit cancellation", async () => {
    let signalReady!: () => void;
    const ready = new Promise<void>((resolve) => { signalReady = resolve; });
    mocks.createRuntimeChatTransport.mockResolvedValue({ async *stream(request) {
      yield { type: "text-delta", text: "partial" };
      await new Promise<void>((resolve) => {
        request.signal?.addEventListener("abort", () => resolve(), { once: true });
        signalReady();
      });
      yield { type: "aborted" };
    } } satisfies ChatTransport);
    await mount(); await stage();
    let sending!: Promise<void>;
    await act(async () => { sending = session.sendMessage(); });
    await ready;
    await act(async () => session.stopGeneration());
    await act(async () => sending);
    expect((await repository.load("current"))?.messages).toMatchObject([
      { role: "user", status: "complete", attachments: [expect.objectContaining({ name: "note.txt" })] },
      { role: "assistant", status: "aborted", content: "partial" },
    ]);
  });

  it("names a committed first attachment after Stop while verification is pending", async () => {
    let verifyStarted!: () => void;
    let releaseVerify!: () => void;
    const started = new Promise<void>((resolve) => { verifyStarted = resolve; });
    mocks.verify.mockImplementationOnce(() => new Promise<void>((resolve) => {
      releaseVerify = resolve;
      verifyStarted();
    }));
    const titleRequests: ChatRequest[] = [];
    mocks.createRuntimeChatTransport.mockResolvedValue({ async *stream(request) {
      titleRequests.push(request);
      yield { type: "failed", error: { kind: "network", message: "offline", retryable: false } };
    } } satisfies ChatTransport);
    await mount(); await stage();
    let sending!: Promise<void>;
    await act(async () => { sending = session.sendMessage(); });
    await started;
    expect((await repository.load("current"))?.messages[0]).toMatchObject({
      role: "user", status: "complete", content: "", attachments: [expect.objectContaining({ name: "note.txt" })],
    });
    await act(async () => session.stopGeneration());
    releaseVerify();
    await act(async () => sending);
    let named = (await repository.initializeWorkspace(null, [])).conversations.find((item) => item.id === "current");
    for (let index = 0; index < 50 &&
      (typeof named?.titleNaming !== "object" || named.titleNaming.status !== "finished"); index++) {
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      named = (await repository.initializeWorkspace(null, [])).conversations.find((item) => item.id === "current");
    }
    expect((await repository.load("current"))?.messages).toMatchObject([
      { role: "user", status: "complete", attachments: [expect.objectContaining({ name: "note.txt" })] },
      { role: "assistant", status: "aborted" },
    ]);
    expect(session.draftAttachments).toEqual([]);
    expect(named).toMatchObject({ title: "note.txt", titleNaming: { source: "note.txt", status: "finished" } });
    expect(titleRequests).toMatchObject([{ messages: [{ role: "user", content: "note.txt" }], config: { stream: false } }]);
    expect(mocks.discardUncommitted).not.toHaveBeenCalled();
  });

  it("does not use the old 30 MB app gate for OpenAI historical attachments", async () => {
    mocks.createRuntimeChatTransport.mockResolvedValue({ async *stream() {
      yield { type: "text-delta", text: "continued" };
      yield { type: "completed", finishReason: "stop" };
    } } satisfies ChatTransport);
    await mount();
    const history = Array.from({ length: 3 }, (_, index) => [
      { id: `u${index}`, role: "user" as const, content: `question ${index}`, status: "complete" as const,
        attachments: [{ name: `${index}.pdf`, mimeType: "application/pdf" as const, size: 10_000_000,
          reference: `attachments/${index}.pdf` }] },
      { id: `a${index}`, role: "assistant" as const, content: "answer", status: "complete" as const },
    ]).flat();
    await act(async () => {
      session.workspace.setMessages(history);
      await session.workspace.store!.updateMessages(history);
      session.setDraft("continue");
    });
    await act(async () => session.sendMessage());
    expect(session.error).toBeUndefined();
    expect(mocks.read).toHaveBeenCalledTimes(3);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.createRuntimeChatTransport).toHaveBeenCalledTimes(1);
    expect((await repository.load("current"))?.messages).toMatchObject([
      ...history, { role: "user", content: "continue" }, { role: "assistant", content: "continued" },
    ]);
  });

  it("sends Office attachments and retained Office history through gemini-native as inlineData", async () => {
    saveConnectionSettings({ version: 3, providers: [{ id: "p", name: "Synthetic", connections: [{
      id: "c", name: "Gemini", protocol: "gemini-native", baseUrl: "https://relay.example.com",
      apiKey: "synthetic", models: [{ id: "configured", modelId: "gemini-2.5-pro" }],
    }] }], activeModelId: "configured" });
    const storedFiles = new Map<string, { name: string; mimeType: string; size: number; data: string }>();
    let seq = 1;
    mocks.save.mockImplementation(async (draft) => {
      const reference = `attachments/123e4567-e89b-42d3-a456-${String(seq++).padStart(12, "0")}.${draft.name.split(".").pop()}`;
      storedFiles.set(reference, { name: draft.name, mimeType: draft.mimeType, size: draft.size, data: draft.data });
      return { reference, name: draft.name, mimeType: draft.mimeType, size: draft.size };
    });
    mocks.read.mockImplementation(async (sent) => {
      const record = storedFiles.get(sent.reference);
      if (!record) throw new Error(`missing synthetic attachment ${sent.reference}`);
      return { ...sent, data: record.data };
    });
    const observed: ChatRequest[] = [];
    mocks.createRuntimeChatTransport.mockResolvedValue({ async *stream(request) {
      if (request.config?.stream !== false) observed.push(request);
      yield { type: "text-delta", text: "ok" };
      yield { type: "completed", finishReason: "STOP" };
    } } satisfies ChatTransport);
    await mount();
    const officeFiles = [
      new File([new Uint8Array([80, 75, 3, 4, 1])], "report.docx"),
      new File([new Uint8Array([80, 75, 3, 4, 2])], "sheet.xlsx"),
      new File([new Uint8Array([80, 75, 3, 4, 3])], "deck.pptx"),
    ];
    await act(async () => session.addFiles(officeFiles));
    await act(async () => session.setDraft("summarize"));
    await act(async () => { await session.sendMessage(); });
    expect(session.error).toBeUndefined();
    expect(observed).toHaveLength(1);
    const firstBody = buildProtocolBody("gemini-native", observed[0]);
    expect(firstBody.contents).toMatchObject([{ role: "user", parts: [
      { text: "summarize" },
      { inlineData: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", data: "UEsDBAE=" } },
      { inlineData: { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", data: "UEsDBAI=" } },
      { inlineData: { mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", data: "UEsDBAM=" } },
    ] }]);
    // Follow-up turn retains the historical Office attachments via attachmentStore.read.
    await act(async () => session.setDraft("follow up"));
    await act(async () => { await session.sendMessage(); });
    expect(session.error).toBeUndefined();
    expect(observed).toHaveLength(2);
    const secondBody = buildProtocolBody("gemini-native", observed[1]);
    expect(secondBody.contents).toMatchObject([
      { role: "user", parts: [
        { text: "summarize" },
        { inlineData: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", data: "UEsDBAE=" } },
        { inlineData: { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", data: "UEsDBAI=" } },
        { inlineData: { mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", data: "UEsDBAM=" } },
      ] },
      { role: "model", parts: [{ text: "ok" }] },
      { role: "user", parts: [{ text: "follow up" }] },
    ]);
  });

  it("blocks oversized normal sends before persisting messages or calling transport", async () => {
    saveConnectionSettings({ version: 3, providers: [{ id: "p", name: "Synthetic", connections: [{
      id: "c", name: "Gemini", protocol: "gemini-native", baseUrl: "https://relay.example.com",
      apiKey: "synthetic", models: [{ id: "configured", modelId: "gemini-2.5-pro" }],
    }] }], activeModelId: "configured" });
    await mount();
    const history = [
      { id: "u1", role: "user" as const, content: "old", status: "complete" as const,
        attachments: [{ name: "huge.pdf", mimeType: "application/pdf" as const, size: 50_000_001,
          reference: "attachments/huge.pdf" }] },
      { id: "a1", role: "assistant" as const, content: "reply", status: "complete" as const },
    ];
    await act(async () => {
      session.workspace.setMessages(history);
      await session.workspace.store!.updateMessages(history);
    });
    const updateSpy = vi.spyOn(session.workspace.store!, "updateMessages");
    mocks.read.mockResolvedValue({ name: "huge.pdf", mimeType: "application/pdf", size: 50_000_001, data: "JVBERi0=" });
    await act(async () => session.setDraft("next question"));
    await act(async () => { await session.sendMessage(); });
    expect(session.error).toMatch(/Gemini.*50 MB/);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.createRuntimeChatTransport).not.toHaveBeenCalled();
    expect((await repository.load("current"))?.messages).toEqual(history);
    expect(session.draft).toBe("next question");
  });

  it("shows preparing-attachments and waiting-for-model send status in order and clarifies ambiguous disconnect errors", async () => {
    let releaseSave!: (value: { reference: string; name: string; mimeType: "text/plain"; size: number }) => void;
    let saveStarted!: () => void;
    const saveGate = new Promise<void>((resolve) => { saveStarted = resolve; });
    mocks.save.mockImplementationOnce(async () => {
      saveStarted();
      return await new Promise((resolve) => { releaseSave = resolve; });
    });
    let releaseStream!: () => void;
    let streamStarted!: () => void;
    const streamGate = new Promise<void>((resolve) => { streamStarted = resolve; });
    mocks.createRuntimeChatTransport.mockResolvedValue({ async *stream(request) {
      if (request.config?.stream === false) {
        yield { type: "text-delta", text: "title" };
        yield { type: "completed", finishReason: "stop" };
        return;
      }
      streamStarted();
      await new Promise<void>((resolve) => { releaseStream = resolve; });
      yield { type: "failed", error: { kind: "network", message: "connection reset", retryable: true } };
    } } satisfies ChatTransport);
    await mount(); await stage();
    let sending!: Promise<void>;
    await act(async () => { sending = session.sendMessage(); });
    await saveGate;
    expect(session.sendStatus).toBe("正在准备附件，请稍候…");
    await act(async () => {
      releaseSave({ reference: "attachments/123e4567-e89b-42d3-a456-426614174000.txt", name: "note.txt", mimeType: "text/plain", size: 5 });
    });
    await streamGate;
    expect(session.sendStatus).toBe("正在等待模型响应…");
    await act(async () => { releaseStream(); await sending; });
    expect(session.sendStatus).toBeUndefined();
    expect(session.error).toContain("未收到完整响应，发送结果未确认");
    expect(session.error).toContain("connection reset");
  });

  it("marks premature stream end protocol failures as unconfirmed without prefixing malformed protocol errors", async () => {
    mocks.createRuntimeChatTransport.mockResolvedValue({ async *stream(request) {
      if (request.config?.stream === false) {
        yield { type: "text-delta", text: "title" };
        yield { type: "completed", finishReason: "stop" };
        return;
      }
      yield {
        type: "failed",
        error: {
          kind: "protocol",
          message: "Gemini stream ended before a finish reason",
          retryable: true,
        },
      };
    } } satisfies ChatTransport);
    await mount();
    await act(async () => session.setDraft("first"));
    await act(async () => { await session.sendMessage(); });
    expect(session.error).toContain("未收到完整响应，发送结果未确认；请决定是否重试");
    expect(session.error).toContain("Gemini stream ended before a finish reason");

    mocks.createRuntimeChatTransport.mockResolvedValue({ async *stream(request) {
      if (request.config?.stream === false) {
        yield { type: "text-delta", text: "title" };
        yield { type: "completed", finishReason: "stop" };
        return;
      }
      yield {
        type: "failed",
        error: {
          kind: "protocol",
          message: "Gemini response is malformed",
          retryable: false,
        },
      };
    } } satisfies ChatTransport);
    await act(async () => session.setDraft("second"));
    await act(async () => { await session.sendMessage(); });
    expect(session.error).toBe("Gemini response is malformed");
  });
});
