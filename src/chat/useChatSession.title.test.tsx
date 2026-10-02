// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatSession } from "./useChatSession";
import { createChatRepository } from "./repository";
import { saveConnectionSettings } from "./settings";
import type { ChatRequest, ChatTransport } from "./types";

const runtime = vi.hoisted(() => ({ createRuntimeChatTransport: vi.fn(), createRuntimeModelCatalogClient: vi.fn() }));
vi.mock("./runtime", () => runtime);
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));

describe("background conversation titles", () => {
  const repo = createChatRepository();
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;
  let session: ReturnType<typeof useChatSession>;
  let titles: Array<{ request: ChatRequest; finish(text?: string): void }>;
  let chats: ChatRequest[];
  async function wait(predicate: () => boolean) {
    for (let i = 0; i < 100 && !predicate(); i++) await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
    expect(predicate()).toBe(true);
  }
  async function send(text: string) {
    await act(async () => session.setDraft(text));
    await act(async () => session.sendMessage());
  }
  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.clear();
    await repo.load("current");
    const db = new Dexie("AyaseStudio"); await db.open();
    await Promise.all(db.tables.map((table) => table.clear())); db.close();
    titles = []; chats = [];
    runtime.createRuntimeChatTransport.mockResolvedValue({ async *stream(request) {
      if (request.config?.stream === false) {
        const text = await new Promise<string | undefined>((resolve) => {
          titles.push({ request, finish: resolve });
          request.signal?.addEventListener("abort", () => resolve(undefined), { once: true });
        });
        if (text) yield { type: "text-delta", text };
        yield { type: "completed", finishReason: "stop" };
      } else {
        chats.push(request);
        yield { type: "text-delta", text: "正常回复" };
        yield { type: "completed", finishReason: "stop" };
      }
    } } satisfies ChatTransport);
    saveConnectionSettings({ version: 3, activeModelId: "m", providers: [{ id: "p", name: "Synthetic", connections: [{
      id: "c", name: "Test", baseUrl: "https://test.example", apiKey: "synthetic-key", protocol: "openai-chat",
      models: [{ id: "m", modelId: "original-model" }, { id: "m2", modelId: "other-model" }],
    }] }] });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    function Probe() { session = useChatSession({ onConfigurationRequired: () => undefined }); return null; }
    await act(async () => root.render(<Probe />));
    await wait(() => session.isHydrated);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

  it("shows original text immediately, does not lock chat, keeps target when navigating and names only once", async () => {
    await send("  帮我安排\n周末旅行  ");
    await wait(() => titles.length === 1);
    expect(session.workspace.conversation?.title).toBe("帮我安排 周末旅行");
    expect(session.isGenerating).toBe(false);
    expect(session.workspace.busy).toBe(false);
    expect(session.messages[session.messages.length - 1]?.content).toBe("正常回复");
    await send("还有预算");
    expect(titles).toHaveLength(1);
    await act(async () => { await session.workspace.execute({ type: "create-conversation", id: "b", assistantId: "default" }); });
    await send("另一个问题");
    await wait(() => titles.length === 2);
    await act(async () => titles[0].finish("周末旅行计划"));
    await wait(() => session.workspace.snapshot?.conversations.find((c) => c.id === "current")?.title === "周末旅行计划");
    expect(session.workspace.conversation?.id).toBe("b");
    expect(session.workspace.conversation?.title).toBe("另一个问题");
    await act(async () => titles[1].finish());
    await wait(() => session.workspace.conversation?.titleNaming !== "manual" && session.workspace.conversation?.titleNaming?.status === "finished");
    expect(session.workspace.conversation?.title).toBe("另一个问题");
    expect(chats).toHaveLength(3);
    const restored = await repo.initializeWorkspace("m", ["m", "m2"]);
    expect(restored.conversations.find((c) => c.id === "current")?.title).toBe("周末旅行计划");
  });

  it("preserves manual titles while an old naming request completes", async () => {
    await send("首条原文"); await wait(() => titles.length === 1);
    await act(async () => { await session.workspace.execute({ type: "rename-conversation", id: "current", title: "新对话" }); });
    await act(async () => titles[0].finish("不应出现的标题"));
    await send("后续");
    expect(session.workspace.conversation?.title).toBe("新对话");
    expect(titles).toHaveLength(1);
  });

  it("waits for background naming before backup and holds the command gate after preparing", async () => {
    await send("待命名的合成消息"); await wait(() => titles.length === 1);
    expect(session.isGenerating).toBe(false);
    let ready = true;
    await act(async () => { ready = await session.prepareBackup(); });
    expect(ready).toBe(false); expect(session.backupPreparing).toBe(false);
    expect(titles[0].request.signal?.aborted).toBe(false);
    await act(async () => titles[0].finish("合成标题"));
    await wait(() => session.workspace.conversation?.title === "合成标题" && !session.backupDisabled);
    await act(async () => { ready = await session.prepareBackup(); });
    expect(ready).toBe(true); expect(session.backupPreparing).toBe(true);
    await act(async () => { expect(await session.workspace.execute({ type: "rename-conversation", id: "current", title: "blocked" })).toBe(false); });
    expect((await repo.initializeWorkspace("m", ["m", "m2"])).conversations.find(c => c.id === "current")?.title).toBe("合成标题");
    await act(async () => session.cancelBackupPreparation());
  });

  it("keeps frozen model/config independent of settings changes and ignores a title after clearing", async () => {
    await send("首条原文"); await wait(() => titles.length === 1);
    await act(async () => { await session.workspace.execute({ type: "configure-conversation", id: "current",
      settings: { modelId: "m2", config: { ...session.sessionConfig, systemInstruction: "role", webSearch: true } } }); });
    expect(titles[0].request.model).toBe("original-model");
    expect(titles[0].request.config?.webSearch).not.toBe(true);
    await act(async () => session.clearConversation());
    await wait(() => session.messages.length === 0);
    await act(async () => titles[0].finish("迟到标题"));
    await wait(() => session.workspace.conversation?.titleNaming !== "manual" && session.workspace.conversation?.titleNaming?.status === "finished");
    expect(session.workspace.conversation?.title).toBe("首条原文");
  });
});
