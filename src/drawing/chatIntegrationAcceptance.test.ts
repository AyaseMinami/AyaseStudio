// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act, createElement, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChatRepository } from "../chat/repository";
import { saveConnectionSettings, type ConnectionSettingsState } from "../chat/settings";
import type { ChatEvent, ChatRequest, ChatTransport } from "../chat/types";
import { useChatSession } from "../chat/useChatSession";
import { AyaseDatabase } from "../storage/database";
import { DrawingController } from "./controller";
import { ImageGenerationError } from "./geminiImage";
import { DexieDrawingRepository } from "./repository";
import type { DrawingFiles, DrawingImageInput, ImageGenerationTransport } from "./types";

const runtime = vi.hoisted(() => ({
  databaseName: "drawing-chat-acceptance-isolated",
  createRuntimeChatTransport: vi.fn(), createRuntimeModelCatalogClient: vi.fn(),
}));
vi.mock("../chat/runtime", () => runtime);
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
// Route the production hook's module-owned repository to a synthetic database.
// Its repository, SessionStore and workspace behavior remain the real implementations.
vi.mock("../chat/repository", async importOriginal => {
  const actual = await importOriginal<typeof import("../chat/repository")>();
  return { ...actual, createChatRepository: (name?: string) => actual.createChatRepository(name ?? runtime.databaseName) };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

const pixels: DrawingImageInput[] = [{ mime: "image/png", data: "AQID" }];
const settings: ConnectionSettingsState = {
  version: 3, activeModelId: "chat-model", builtinsInitialized: true, providers: [{ id: "provider", name: "synthetic", connections: [
    { id: "chat", name: "chat", protocol: "openai-chat", baseUrl: "https://chat.example.test", apiKey: "synthetic-chat-key",
      models: [{ id: "chat-model", modelId: "synthetic-chat" }] },
    { id: "drawing", name: "drawing", protocol: "gemini-image", baseUrl: "https://drawing.example.test", apiKey: "synthetic-drawing-key",
      models: [{ id: "drawing-model", modelId: "synthetic-drawing" }] },
  ] }],
};

describe("simultaneous chat and drawing integration acceptance #94", () => {
  const database = new AyaseDatabase(runtime.databaseName);
  const chatRepository = createChatRepository(runtime.databaseName);
  let drawing: DrawingController;
  let session: ReturnType<typeof useChatSession>;
  let root: ReturnType<typeof createRoot>;
  let host: HTMLDivElement;
  let drawingResponse: ReturnType<typeof deferred<DrawingImageInput[]>>;
  let imageTransport: ImageGenerationTransport;
  let files: DrawingFiles;
  let chatRequests: { request: ChatRequest; terminal: ReturnType<typeof deferred<ChatEvent>> }[];

  function Probe() {
    const drawingState = useSyncExternalStore(drawing.subscribe, drawing.getSnapshot);
    session = useChatSession({ onConfigurationRequired: () => undefined, externalBusy: drawingState.busy });
    return null;
  }
  async function wait(predicate: () => boolean) {
    for (let index = 0; index < 200 && !predicate(); index++) {
      await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
    }
    expect(predicate()).toBe(true);
  }

  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.clear();
    runtime.createRuntimeChatTransport.mockReset();
    runtime.createRuntimeModelCatalogClient.mockReset();
    await database.open();
    await Promise.all(database.tables.map(table => table.clear()));
    chatRequests = [];
    const chatTransport: ChatTransport = {
      async *stream(request) {
        if (request.config?.stream === false) { yield { type: "completed", finishReason: "stop" }; return; }
        const terminal = deferred<ChatEvent>();
        chatRequests.push({ request, terminal });
        yield { type: "text-delta", text: "independent chat response" };
        yield await terminal.promise;
      },
    };
    runtime.createRuntimeChatTransport.mockResolvedValue(chatTransport);
    saveConnectionSettings(structuredClone(settings));
    await chatRepository.initializeWorkspace("chat-model", ["chat-model"]);
    await chatRepository.execute({ type: "rename-conversation", id: "current", title: "Synthetic acceptance" });
    drawingResponse = deferred<DrawingImageInput[]>();
    imageTransport = { generate: vi.fn(() => drawingResponse.promise) };
    files = {
      save: vi.fn(async taskId => [{ id: "image", reference: `drawing/${taskId}/image.png`, mime: "image/png", size: 3, width: 1, height: 1 }]),
      recover: vi.fn(async () => null), read: vi.fn(async () => pixels[0]), export: vi.fn(async () => true),
      importReference: vi.fn(async () => { throw new Error("No reference import in this fixture"); }),
      removeReferences: vi.fn(async () => undefined),
    };
    drawing = new DrawingController({ repository: new DexieDrawingRepository(database), files, transport: async () => imageTransport });
    await drawing.initialize();
    drawing.setDraft({ ...drawing.getSnapshot().draft, modelId: "drawing-model", prompt: "independent drawing prompt" });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(Probe)));
    await wait(() => session.isHydrated);
  });
  afterEach(async () => {
    drawing.cancel();
    chatRequests.forEach(({ terminal }) => terminal.resolve({ type: "aborted" }));
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });
  afterAll(async () => { await database.delete(); });

  async function startBoth() {
    let generation!: Promise<void>;
    let sending!: Promise<void>;
    await act(async () => {
      generation = drawing.generate(session.connectionSettings);
      session.setDraft("independent chat question");
    });
    await act(async () => { sending = session.sendMessage(); });
    await wait(() => chatRequests.length === 1 && vi.mocked(imageTransport.generate).mock.calls.length === 1 && session.isGenerating);
    await wait(() => session.messages.some(message => message.content === "independent chat response"));
    expect(drawing.getSnapshot().busy).toBe(true);
    expect(chatRequests[0].request).toMatchObject({ model: "synthetic-chat", apiKey: "synthetic-chat-key" });
    expect(imageTransport.generate).toHaveBeenCalledWith(expect.objectContaining({ modelId: "synthetic-drawing", prompt: "independent drawing prompt" }),
      "synthetic-drawing-key", expect.any(AbortSignal));
    return { generation, sending };
  }

  it.each(["cancel", "fail"] as const)("drawing %s leaves the chat request, transcript and generation guard intact", async outcome => {
    const { generation, sending } = await startBoth();
    const chatBefore = structuredClone(session.messages);
    await act(async () => {
      if (outcome === "cancel") drawing.cancel();
      else drawingResponse.reject(new ImageGenerationError("synthetic drawing rejection"));
      await generation;
    });
    expect(drawing.getSnapshot()).toMatchObject({ busy: false, tasks: [{ status: outcome === "cancel" ? "unknown" : "failed" }] });
    expect(session.isGenerating).toBe(true);
    expect(chatRequests[0].request.signal?.aborted).toBe(false);
    expect(session.messages).toEqual(chatBefore);
    expect(session.connectionSettings).toEqual(settings);
    await act(async () => { session.setDraft("duplicate while chat is active"); await session.sendMessage(); });
    expect(chatRequests).toHaveLength(1);
    await act(async () => { chatRequests[0].terminal.resolve({ type: "completed", finishReason: "stop" }); await sending; });
    await wait(() => !session.isGenerating);
    expect((await chatRepository.load("current"))?.messages).toEqual([
      expect.objectContaining({ role: "user", content: "independent chat question", status: "complete" }),
      expect.objectContaining({ role: "assistant", content: "independent chat response", status: "complete" }),
    ]);
    expect(await database.drawingResults.count()).toBe(0);
    expect(files.save).not.toHaveBeenCalled();
    expect(imageTransport.generate).toHaveBeenCalledOnce();
  });

  it.each(["complete", "fail"] as const)("chat %s does not finish, cancel or change a drawing request", async outcome => {
    const { generation, sending } = await startBoth();
    const taskBefore = structuredClone(drawing.getSnapshot().tasks[0]);
    await act(async () => {
      chatRequests[0].terminal.resolve(outcome === "complete" ? { type: "completed", finishReason: "stop" }
        : { type: "failed", error: { kind: "provider", message: "synthetic chat rejection", retryable: false } });
      await sending;
    });
    await wait(() => !session.isGenerating);
    expect(drawing.getSnapshot()).toMatchObject({ busy: true, tasks: [taskBefore], draft: { prompt: "independent drawing prompt" } });
    expect(vi.mocked(imageTransport.generate).mock.calls[0][2].aborted).toBe(false);
    expect(files.save).not.toHaveBeenCalled();
    expect(await database.drawingResults.count()).toBe(0);
    await act(async () => { drawingResponse.resolve(pixels); await generation; });
    const savedDrawing = await new DexieDrawingRepository(database).load();
    expect(savedDrawing.tasks).toEqual([expect.objectContaining({ id: taskBefore.id, status: "completed", parameters: taskBefore.parameters })]);
    expect(savedDrawing.results).toEqual([expect.objectContaining({ taskId: taskBefore.id, parameters: taskBefore.parameters })]);
    const savedChat = await chatRepository.load("current");
    expect(savedChat?.messages[1]).toMatchObject({ content: "independent chat response", status: outcome === "complete" ? "complete" : "failed" });
    expect(savedChat?.messages.every(message => !JSON.stringify(message).includes("independent drawing prompt"))).toBe(true);
    expect(imageTransport.generate).toHaveBeenCalledOnce();
    expect(chatRequests).toHaveLength(1);
    expect(JSON.stringify({ savedDrawing, savedChat })).not.toContain("synthetic-chat-key");
    expect(JSON.stringify({ savedDrawing, savedChat })).not.toContain("synthetic-drawing-key");
  });
});
