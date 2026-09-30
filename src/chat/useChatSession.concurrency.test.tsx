// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatSession } from "./useChatSession";
import { createChatRepository, type StoredChatMessage } from "./repository";
import { SessionStore } from "./sessionStore";
import { saveConnectionSettings } from "./settings";
import type { ChatEvent, ChatRequest, ChatTransport } from "./types";

const runtime = vi.hoisted(() => ({
  createRuntimeChatTransport: vi.fn(), createRuntimeModelCatalogClient: vi.fn(),
  read: vi.fn(), cleanup: vi.fn(), save: vi.fn(), verify: vi.fn(),
}));
vi.mock("./runtime", () => runtime);
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("./attachmentResources", () => ({ createTauriAttachmentStore: () => ({
  read: runtime.read, cleanup: runtime.cleanup, save: runtime.save, verify: runtime.verify,
}) }));

interface ControlledRequest {
  request: ChatRequest;
  push(event: ChatEvent): void;
  finish(): void;
}

function controlledTransport(requests: ControlledRequest[]): ChatTransport {
  return {
    async *stream(request) {
      // This fixture controls chat lifetimes; title requests finish independently.
      if (request.config?.stream === false) {
        yield { type: "completed", finishReason: "stop" };
        return;
      }
      const events: ChatEvent[] = [];
      let wake!: () => void;
      let done = false;
      const waiting = () => new Promise<void>((resolve) => { wake = resolve; });
      requests.push({ request, push(event) { events.push(event); wake?.(); }, finish() { done = true; wake?.(); } });
      while (!done || events.length) {
        if (!events.length) await waiting();
        while (events.length) yield events.shift()!;
      }
    },
  };
}

describe("parallel conversation generation", () => {
  const repo = createChatRepository();
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;
  let session: ReturnType<typeof useChatSession>;

  async function wait(predicate: () => boolean) {
    for (let index = 0; index < 100 && !predicate(); index++) {
      await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
    }
    expect(predicate()).toBe(true);
  }

  async function select(id: string, assistantId = "default") {
    await act(async () => {
      await session.workspace.execute({ type: "select", assistantId, conversationId: id });
    });
    await wait(() => session.workspace.conversation?.id === id && session.isHydrated);
  }

  it("flushes every loaded conversation before backup, including after navigation", async () => {
    await act(async () => session.clearConversation());
    await select("other");
    const originalFlush = SessionStore.prototype.flush;
    const started = new Set<string>();
    const release = new Map<string, () => void>();
    vi.spyOn(SessionStore.prototype, "flush").mockImplementation(function (this: SessionStore) {
      started.add(this.id);
      return new Promise<void>((resolve, reject) => {
        release.set(this.id, () => { void originalFlush.call(this).then(resolve, reject); });
      });
    });

    let result: boolean | undefined;
    let prepare!: Promise<boolean>;
    await act(async () => { prepare = session.prepareBackup().then(value => { result = value; return value; }); });
    await wait(() => started.has("current") && started.has("other"));
    expect(result).toBeUndefined();
    expect(session.backupDisabled).toBe(true);

    await act(async () => {
      release.get("current")!();
      release.get("other")!();
      await prepare;
    });
    expect(result).toBe(true);
    expect(session.backupDisabled).toBe(false);
    expect((await repo.load("current"))?.messages).toEqual([]);
  });

  it("does not proceed to backup when pending conversation writes cannot flush", async () => {
    vi.spyOn(SessionStore.prototype, "flush").mockRejectedValue(new Error("synthetic storage failure"));
    let result: boolean | undefined;
    await act(async () => { result = await session.prepareBackup(); });
    expect(result).toBe(false);
    expect(session.backupPreparationError).toContain("无法保存待写入的对话记录");
  });

  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.clear();
    await repo.load("current");
    const database = new Dexie("AyaseStudio"); await database.open();
    await Promise.all(database.tables.map((table) => table.clear())); database.close();
    for (const mock of Object.values(runtime)) mock.mockReset();
    runtime.cleanup.mockResolvedValue(undefined);
    runtime.createRuntimeChatTransport.mockResolvedValue(controlledTransport([]));
    saveConnectionSettings({ version: 3, activeModelId: "model", providers: [{
      id: "provider", name: "Synthetic", connections: [{ id: "connection", name: "Test",
        baseUrl: "https://test.example", apiKey: "synthetic", protocol: "openai-chat",
        models: [{ id: "model", modelId: "synthetic-model" }],
      }],
    }] });
    await repo.initializeWorkspace("model", ["model"]);
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    function Probe() { session = useChatSession({ onConfigurationRequired: () => undefined }); return null; }
    await act(async () => root.render(<Probe />));
    await wait(() => session.isHydrated);
    await act(async () => { await session.workspace.execute({ type: "create-conversation", id: "other", assistantId: "default" }); });
    await select("current");
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("does not overwrite a newly edited recalled draft when an originating send commits in the background", async () => {
    const old: StoredChatMessage = { id: "old", role: "user", content: "historical question", status: "complete" };
    await act(async () => {
      session.workspace.setMessages([old]);
      await session.workspace.store!.updateMessages([old]);
      session.setDraft("original unsent");
    });
    await act(async () => { session.workspace.browseHistory(-1, { start: 3, end: 3 }); });
    let release!: () => void;
    let blocked = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const update = SessionStore.prototype.updateMessages;
    vi.spyOn(SessionStore.prototype, "updateMessages").mockImplementation(async function(this: SessionStore, messages) {
      if (this.id === "current" && messages.length === 3 && !blocked) { blocked = true; await gate; }
      return update.call(this, messages);
    });
    runtime.createRuntimeChatTransport.mockResolvedValue({ async *stream() { yield { type: "completed", finishReason: "stop" }; } } satisfies ChatTransport);
    let sending!: Promise<void>;
    await act(async () => { sending = session.sendMessage(); });
    await wait(() => blocked);
    await act(async () => session.setDraft("new edit during preparation"));
    await select("other");
    await act(async () => session.setDraft("other draft"));
    await act(async () => { release(); await sending; });
    expect(session.draft).toBe("other draft");
    await select("current");
    expect(session.draft).toBe("new edit during preparation");
    await act(async () => { session.workspace.browseHistory(1, { start: 27, end: 27 }); });
    // The newly committed message is newer than the recalled source; one more Down reaches the original.
    await act(async () => { session.workspace.browseHistory(1, { start: session.draft.length, end: session.draft.length }); });
    expect(session.draft).toBe("original unsent");
    expect((await repo.load("current"))?.messages.filter(item => item.role === "user").map(item => item.content))
      .toEqual(["historical question", "historical question"]);
  });

  it("streams two conversations independently and keeps only its own task locked while its final save is pending", async () => {
    const requests: ControlledRequest[] = [];
    runtime.createRuntimeChatTransport.mockResolvedValue(controlledTransport(requests));
    let finalSaveStarted!: () => void;
    let releaseFinalSave!: () => void;
    const finalSaveStartedPromise = new Promise<void>((resolve) => { finalSaveStarted = resolve; });
    const finalSaveGate = new Promise<void>((resolve) => { releaseFinalSave = resolve; });
    const updateMessages = SessionStore.prototype.updateMessages;
    vi.spyOn(SessionStore.prototype, "updateMessages").mockImplementation(function (this: SessionStore, messages: StoredChatMessage[]) {
      if (this.id === "other" && messages.slice(-1)[0]?.status === "complete") {
        finalSaveStarted();
        return finalSaveGate.then(() => updateMessages.call(this, messages));
      }
      return updateMessages.call(this, messages);
    });
    await act(async () => session.setDraft("A"));
    let sendingA!: Promise<void>;
    await act(async () => { sendingA = session.sendMessage(); });
    await wait(() => requests.length === 1);
    expect(session.generatingConversationIds).toEqual(new Set(["current"]));
    expect(session.isGenerating).toBe(true);

    await select("other");
    expect(session.isGenerating).toBe(false);
    await act(async () => session.setDraft("B"));
    let sendingB!: Promise<void>;
    await act(async () => { sendingB = session.sendMessage(); });
    await wait(() => requests.length === 2);
    expect(session.generatingConversationIds).toEqual(new Set(["current", "other"]));
    expect(session.isGenerating).toBe(true);

    await act(async () => { requests[0].push({ type: "text-delta", text: "A1" }); requests[1].push({ type: "text-delta", text: "B1" }); });
    await act(async () => { requests[0].push({ type: "text-delta", text: "A2" }); requests[0].push({ type: "completed", finishReason: "stop" }); requests[0].finish(); await sendingA; });
    await select("current");
    expect(session.messages.slice(-1)[0]).toMatchObject({ content: "A1A2", status: "complete" });
    expect(session.generatingConversationIds).toEqual(new Set(["other"]));

    await select("other");
    await act(async () => { requests[1].push({ type: "completed", finishReason: "stop" }); requests[1].finish(); await finalSaveStartedPromise; });
    expect(session.generatingConversationIds).toEqual(new Set(["other"]));
    expect(session.isGenerating).toBe(true);
    await act(async () => { session.setDraft("duplicate"); await session.sendMessage(); });
    expect(requests).toHaveLength(2);
    await act(async () => {
      expect(await session.workspace.execute({ type: "delete-conversation", id: "other" })).toBe(false);
    });
    await select("current");
    expect(session.isGenerating).toBe(false);
    await act(async () => { releaseFinalSave(); await sendingB; });
    expect((await repo.load("other"))?.messages.slice(-1)[0]).toMatchObject({ content: "B1", status: "complete" });
  });

  it("blocks a second send in one conversation while allowing another, and Stop aborts only the selected request", async () => {
    const requests: ControlledRequest[] = [];
    runtime.createRuntimeChatTransport.mockResolvedValue(controlledTransport(requests));
    await act(async () => session.setDraft("A"));
    let sendingA!: Promise<void>;
    await act(async () => { sendingA = session.sendMessage(); });
    await wait(() => requests.length === 1);
    await act(async () => { session.setDraft("duplicate"); await session.sendMessage(); });
    expect(requests).toHaveLength(1);

    await select("other");
    await act(async () => session.setDraft("B"));
    let sendingB!: Promise<void>;
    await act(async () => { sendingB = session.sendMessage(); });
    await wait(() => requests.length === 2);
    await act(async () => session.stopGeneration());
    expect(requests[1].request.signal?.aborted).toBe(true);
    expect(requests[0].request.signal?.aborted).toBe(false);
    await act(async () => { requests[1].push({ type: "aborted" }); requests[1].finish(); await sendingB; });
    expect(session.generatingConversationIds).toEqual(new Set(["current"]));

    await act(async () => { requests[0].push({ type: "completed", finishReason: "stop" }); requests[0].finish(); await sendingA; });
  });

  it("releases only the conversation whose attachment preparation fails", async () => {
    const requests: ControlledRequest[] = [];
    runtime.createRuntimeChatTransport.mockResolvedValue(controlledTransport(requests));
    await act(async () => session.setDraft("A"));
    let sendingA!: Promise<void>;
    await act(async () => { sendingA = session.sendMessage(); });
    await wait(() => requests.length === 1);

    await select("other");
    const attachment = { name: "missing.txt", mimeType: "text/plain" as const, size: 1, reference: "attachments/missing.txt" };
    const history: StoredChatMessage[] = [
      { id: "old-user", role: "user", content: "history", status: "complete", attachments: [attachment] },
      { id: "old-assistant", role: "assistant", content: "previous", status: "complete", replyToId: "old-user" },
    ];
    await act(async () => {
      session.workspace.setMessages(history);
      await session.workspace.store!.updateMessages(history);
      session.setDraft("B");
    });
    runtime.read.mockRejectedValueOnce(new Error("missing attachment"));
    await act(async () => session.sendMessage());
    expect(requests).toHaveLength(1);
    expect(session.isGenerating).toBe(false);
    expect(session.generatingConversationIds).toEqual(new Set(["current"]));

    await act(async () => { requests[0].push({ type: "completed", finishReason: "stop" }); requests[0].finish(); await sendingA; });
  });

  it("keeps a preparing conversation locked through Stop until its attachment read releases", async () => {
    const requests: ControlledRequest[] = [];
    runtime.createRuntimeChatTransport.mockResolvedValue(controlledTransport(requests));
    await act(async () => session.setDraft("A"));
    let sendingA!: Promise<void>;
    await act(async () => { sendingA = session.sendMessage(); });
    await wait(() => requests.length === 1);

    await select("other");
    const attachment = { name: "held.txt", mimeType: "text/plain" as const, size: 1, reference: "attachments/held.txt" };
    const history: StoredChatMessage[] = [
      { id: "held-user", role: "user", content: "history", status: "complete", attachments: [attachment] },
      { id: "held-assistant", role: "assistant", content: "previous", status: "complete", replyToId: "held-user" },
    ];
    await act(async () => {
      session.workspace.setMessages(history);
      await session.workspace.store!.updateMessages(history);
      session.setDraft("B");
    });
    let readStarted!: () => void;
    let releaseRead!: () => void;
    const readStartedPromise = new Promise<void>((resolve) => { readStarted = resolve; });
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    runtime.read.mockImplementationOnce(async () => { readStarted(); await readGate; return { ...attachment, data: "QQ==" }; });
    let sendingB!: Promise<void>;
    await act(async () => { sendingB = session.sendMessage(); });
    await readStartedPromise;
    await act(async () => {
      session.stopGeneration();
      expect(await session.workspace.execute({ type: "delete-conversation", id: "other" })).toBe(false);
    });
    expect(session.generatingConversationIds).toEqual(new Set(["current", "other"]));
    releaseRead();
    await act(async () => sendingB);
    expect(requests).toHaveLength(1);
    expect(session.messages).toEqual(history);
    expect(session.draft).toBe("B");
    expect((await repo.load("other"))?.messages).toEqual(history);
    expect(session.generatingConversationIds).toEqual(new Set(["current"]));

    await act(async () => { requests[0].push({ type: "completed", finishReason: "stop" }); requests[0].finish(); await sendingA; });
  });

  it("keeps B generating when A's terminal transcript save fails", async () => {
    const requests: ControlledRequest[] = [];
    runtime.createRuntimeChatTransport.mockResolvedValue(controlledTransport(requests));
    const updateMessages = SessionStore.prototype.updateMessages;
    vi.spyOn(SessionStore.prototype, "updateMessages").mockImplementation(function (this: SessionStore, messages: StoredChatMessage[]) {
      if (this.id === "current" && messages.slice(-1)[0]?.status === "complete") {
        return Promise.reject(new Error("A terminal save failed"));
      }
      return updateMessages.call(this, messages);
    });
    await act(async () => session.setDraft("A"));
    let sendingA!: Promise<void>;
    await act(async () => { sendingA = session.sendMessage(); });
    await wait(() => requests.length === 1);
    await select("other");
    await act(async () => session.setDraft("B"));
    let sendingB!: Promise<void>;
    await act(async () => { sendingB = session.sendMessage(); });
    await wait(() => requests.length === 2);

    await act(async () => { requests[0].push({ type: "completed", finishReason: "stop" }); requests[0].finish(); await sendingA; });
    expect(session.generatingConversationIds).toEqual(new Set(["other"]));
    await select("current");
    expect(session.error).toMatch(/保存本地记录失败/);
    expect(session.isGenerating).toBe(false);

    await select("other");
    expect(session.isGenerating).toBe(true);
    await act(async () => { requests[1].push({ type: "text-delta", text: "B" }); requests[1].push({ type: "completed", finishReason: "stop" }); requests[1].finish(); await sendingB; });
    expect((await repo.load("other"))?.messages.slice(-1)[0]).toMatchObject({ content: "B", status: "complete" });
  });

  it("keeps an active generation isolated when another conversation fails", async () => {
    const requests: ControlledRequest[] = [];
    runtime.createRuntimeChatTransport.mockResolvedValue(controlledTransport(requests));
    await act(async () => session.setDraft("A"));
    let sendingA!: Promise<void>;
    await act(async () => { sendingA = session.sendMessage(); });
    await wait(() => requests.length === 1);
    await select("other");
    await act(async () => session.setDraft("B"));
    let sendingB!: Promise<void>;
    await act(async () => { sendingB = session.sendMessage(); });
    await wait(() => requests.length === 2);
    await act(async () => { requests[1].push({ type: "failed", error: { kind: "network", message: "B failed", retryable: false } }); requests[1].finish(); await sendingB; });
    expect(session.messages.slice(-1)[0]).toMatchObject({ status: "failed" });
    expect(session.generatingConversationIds).toEqual(new Set(["current"]));
    await act(async () => { requests[0].push({ type: "completed", finishReason: "stop" }); requests[0].finish(); await sendingA; });
  });

  it("allows editing another conversation while blocking deletion of each generating conversation and its assistant", async () => {
    const requests: ControlledRequest[] = [];
    runtime.createRuntimeChatTransport.mockResolvedValue(controlledTransport(requests));
    await act(async () => {
      await session.workspace.execute({ type: "create-assistant", id: "temporary", input: {
        name: "Temporary", icon: "", defaultModelId: "model", defaultConfig: session.sessionConfig,
      } });
      await session.workspace.execute({ type: "create-conversation", id: "temporary-conversation", assistantId: "temporary" });
    });
    await select("current");
    await act(async () => session.setDraft("A"));
    let sendingA!: Promise<void>;
    await act(async () => { sendingA = session.sendMessage(); });
    await wait(() => requests.length === 1);
    await select("other");
    const old: StoredChatMessage = { id: "editable", role: "user", content: "before", status: "complete" };
    await act(async () => {
      session.workspace.setMessages([old]);
      await session.workspace.store!.updateMessages([old]);
    });
    // Let queued workspace metadata and the React snapshot settle before the user action.
    await wait(() => session.workspace.canSend());
    await act(async () => {
      expect(await session.editMessage("editable", "after")).toBe(true);
    });
    await select("temporary-conversation", "temporary");
    await act(async () => session.setDraft("B"));
    let sendingB!: Promise<void>;
    await act(async () => { sendingB = session.sendMessage(); });
    await wait(() => requests.length === 2);
    await act(async () => {
      expect(await session.workspace.execute({ type: "delete-conversation", id: "current" })).toBe(false);
      expect(await session.workspace.execute({ type: "delete-assistant", id: "temporary", mode: "delete" })).toBe(false);
    });
    await select("other");
    expect(session.isGenerating).toBe(false);
    await act(async () => {
      requests[0].push({ type: "aborted" }); requests[0].finish();
      requests[1].push({ type: "aborted" }); requests[1].finish();
      await Promise.all([sendingA, sendingB]);
    });
  });

  it("aborts every active request when the session unmounts", async () => {
    const requests: ControlledRequest[] = [];
    runtime.createRuntimeChatTransport.mockResolvedValue(controlledTransport(requests));
    await act(async () => session.setDraft("A"));
    let sendingA!: Promise<void>;
    await act(async () => { sendingA = session.sendMessage(); });
    await wait(() => requests.length === 1);
    await select("other");
    await act(async () => session.setDraft("B"));
    let sendingB!: Promise<void>;
    await act(async () => { sendingB = session.sendMessage(); });
    await wait(() => requests.length === 2);
    await act(async () => root.unmount());
    expect(requests.map(({ request }) => request.signal?.aborted)).toEqual([true, true]);
    requests[0].push({ type: "aborted" }); requests[0].finish();
    requests[1].push({ type: "aborted" }); requests[1].finish();
    await Promise.all([sendingA, sendingB]);
    root = createRoot(container);
  });
});
