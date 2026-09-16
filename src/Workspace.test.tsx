// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { createChatRepository } from "./chat/repository";
import { defaultSessionConfig } from "./chat/sessionConfig";
import { saveConnectionSettings } from "./chat/settings";
import type { ChatRequest, ChatTransport } from "./chat/types";
import { selectedConversation } from "./chat/workspace";

const runtime = vi.hoisted(() => ({ createRuntimeChatTransport: vi.fn(), createRuntimeModelCatalogClient: vi.fn() }));
vi.mock("./chat/runtime", () => runtime);

describe("assistant workspace public behavior", () => {
  const repo = createChatRepository();
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.clear();
    await repo.load("current");
    const database = new Dexie("AyaseStudio"); await database.open();
    await Promise.all(database.tables.map((table) => table.clear())); database.close();
    runtime.createRuntimeChatTransport.mockReset();
    saveConnectionSettings({ version: 3, activeModelId: "model-a", providers: [{ id: "p", name: "Synthetic", connections: [{
      id: "c", name: "Test", protocol: "openai-chat", baseUrl: "https://test.example", apiKey: "synthetic-only",
      models: [{ id: "model-a", modelId: "upstream-a" }, { id: "model-b", modelId: "upstream-b" }],
    }] }] });
    await repo.initializeWorkspace("model-a", ["model-a", "model-b"]);
    await repo.execute({ type: "rename-conversation", id: "current", title: "对话 A" });
    await repo.execute({ type: "create-assistant", id: "writer", input: { name: "写作助手", icon: "", defaultModelId: "model-b", defaultConfig: { ...defaultSessionConfig(), systemInstruction: "Only B" } } });
    await repo.execute({ type: "create-conversation", id: "b", assistantId: "writer" });
    await repo.execute({ type: "rename-conversation", id: "b", title: "对话 B" });
    await repo.execute({ type: "select", assistantId: "default", conversationId: "current" });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root.render(<App />));
    await wait(() => container.querySelector<HTMLTextAreaElement>(".composer-input")?.disabled === false);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  async function wait(predicate: () => boolean) {
    for (let i = 0; i < 150 && !predicate(); i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    expect(predicate()).toBe(true);
  }
  async function click(text: string) {
    const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.getAttribute("aria-label") === text || item.textContent?.trim() === text);
    expect(button, text).toBeTruthy(); expect(button!.disabled, text).toBe(false);
    await act(async () => button!.click());
  }
  async function fill(selector: string, value: string) {
    const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
    expect(field).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function chooseAssistant(name: string, title: string) {
    if (!container.querySelector('[aria-label="助手列表"]')) await click("助手与对话");
    await click(name);
    await wait(() => container.querySelector(".chat-header-copy")?.textContent?.includes(title) === true);
    await wait(() => container.querySelector<HTMLButtonElement>('[aria-label="编辑助手 默认助手"]')?.disabled === false);
  }

  it("couples both columns to the main toggle and allows collapsing only conversations", async () => {
    expect(container.querySelectorAll(".chat-navigation-pane")).toHaveLength(1);
    expect(container.querySelector(".conversation-cascade-pane")).toBeNull();
    await fill(".composer-input", "keep my draft");
    await click("默认助手");
    const panel = container.querySelector('[aria-label="默认助手的对话"]');
    expect(panel).not.toBeNull();
    expect(panel?.parentElement).toBe(container.querySelector(".chat-navigation-pane")?.parentElement);
    expect(container.querySelector(".chat-header-copy")?.textContent).toContain("对话 A");
    await chooseAssistant("写作助手", "对话 B");
    expect(container.querySelector('[aria-label="默认助手的对话"]')).toBeNull();
    expect(container.querySelector('[aria-label="写作助手的对话"]')).not.toBeNull();
    await click("对话 B");
    await wait(() => container.querySelector<HTMLButtonElement>('[aria-label="写作助手"]')?.disabled === false);
    expect(container.querySelector(".conversation-cascade-pane")).not.toBeNull();
    expect(container.querySelector(".chat-navigation-pane")).not.toBeNull();
    await click("助手与对话"); expect(container.querySelector(".chat-navigation-pane")).toBeNull();
    expect(container.querySelector(".conversation-cascade-pane")).toBeNull();
    await click("助手与对话");
    expect(container.querySelector(".conversation-cascade-pane")).not.toBeNull();
    await click("收起对话栏");
    expect(container.querySelector(".conversation-cascade-pane")).toBeNull();
    expect(container.querySelector(".chat-navigation-pane")).not.toBeNull();
    await chooseAssistant("默认助手", "对话 A");
    expect(container.querySelector<HTMLTextAreaElement>(".composer-input")?.value).toBe("keep my draft");
    await act(async () => container.querySelector(".conversation-cascade-pane")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector(".conversation-cascade-pane")).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("默认助手");
    await click("默认助手");
    await act(async () => container.querySelector<HTMLTextAreaElement>(".composer-input")?.focus());
    expect(container.querySelector(".conversation-cascade-pane")).not.toBeNull();
  });

  it("saves Gemini controls, resets incompatible model choices, and restores stopped summaries", async () => {
    await act(async () => root.unmount());
    saveConnectionSettings({ version: 3, activeModelId: "model-a", providers: [{ id: "p", name: "Synthetic", connections: [{
      id: "c", name: "Gemini", protocol: "gemini-native", baseUrl: "https://test.example", apiKey: "synthetic-only",
      models: [{ id: "model-a", modelId: "gemini-3-flash-preview" }, { id: "model-b", modelId: "gemini-3.8-flash" }],
    }] }] });
    root = createRoot(container); await act(async () => root.render(<App />));
    await wait(() => !!container.querySelector('button[aria-label="思考设置"]'));
    async function thinkingReady() {
      await wait(() => container.querySelector<HTMLTextAreaElement>(".composer-input")?.disabled === false);
      if (!container.querySelector(".thinking-popover")) await click("思考设置");
      await wait(() => container.querySelector<HTMLFieldSetElement>(".thinking-options")?.disabled === false);
    }
    async function choose(selector: string, value: string) {
      await act(async () => {
        const field = container.querySelector<HTMLSelectElement>(selector)!;
        expect(field).toBeTruthy(); field.value = value; field.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    await thinkingReady();
    await act(async () => container.querySelector<HTMLInputElement>('.thinking-popover input[value="minimal"]')!.click());
    await thinkingReady();
    expect((await repo.initializeWorkspace(null, ["model-a", "model-b"])).assistants.find((item) => item.id === "default")?.defaultConfig.geminiThinking?.choice).toBe("minimal");
    await click("编辑助手 默认助手");
    await choose("#assistant-model", "model-b");
    expect(container.textContent).toContain("原思考选项不适用于此模型");
    await click("保存助手");
    await thinkingReady();
    expect(container.querySelector<HTMLInputElement>('.thinking-popover input:checked')?.value).toBe("default");
    await act(async () => container.querySelector<HTMLInputElement>('.thinking-popover input[value="high"]')!.click());
    await thinkingReady();
    let captured: ChatRequest | undefined;
    const transport: ChatTransport = { async *stream(request) {
      captured = request;
      yield { type: "thinking-delta", text: "可恢复的摘要" };
      yield { type: "text-delta", text: "部分回答" };
      await new Promise<void>((resolve) => request.signal!.addEventListener("abort", () => resolve(), { once: true }));
      yield { type: "aborted" };
    } };
    runtime.createRuntimeChatTransport.mockResolvedValue(transport);
    await fill(".composer-input", "测试思考"); await click("发送");
    await wait(() => !!container.querySelector(".thinking-summary"));
    expect(captured?.config?.geminiThinking?.choice).toBe("high");
    await click("停止生成");
    await wait(() => !container.querySelector('[aria-label="停止生成"]'));
    const savedMessages = (await repo.load("current"))!.messages;
    const saved = savedMessages[savedMessages.length - 1];
    expect(saved).toMatchObject({ thinkingSummary: "可恢复的摘要", content: "部分回答", status: "aborted" });
    await act(async () => root.unmount()); root = createRoot(container);
    await act(async () => root.render(<App />));
    await wait(() => !!container.querySelector(".thinking-summary"));
    expect(container.querySelector('button[aria-label="思考设置"]')?.getAttribute("title")).toContain("思考：高");
    await act(async () => container.querySelector<HTMLButtonElement>(".thinking-summary-heading")!.click());
    expect(container.querySelector(".thinking-summary-content")?.textContent).toContain("可恢复的摘要");
  });

  it("keeps both columns on narrow screens until explicitly collapsed", async () => {
    await act(async () => root.unmount());
    vi.stubGlobal("innerWidth", 720);
    root = createRoot(container); await act(async () => root.render(<App />));
    await wait(() => container.querySelector<HTMLTextAreaElement>(".composer-input")?.disabled === false);
    expect(container.querySelector(".chat-navigation-pane")).toBeNull();
    await click("助手与对话");
    await click("写作助手");
    await wait(() => container.querySelector('[aria-label="写作助手的对话"]') !== null);
    await wait(() => !container.querySelector<HTMLButtonElement>('[aria-label="编辑助手 写作助手"]')?.disabled);
    await click("对话 B");
    await wait(() => container.querySelector<HTMLButtonElement>('[aria-label="写作助手"]')?.disabled === false);
    expect(container.querySelector(".conversation-cascade-pane")).not.toBeNull();
    await click("收起对话栏");
    expect(container.querySelector(".conversation-cascade-pane")).toBeNull();
    expect(container.querySelector(".chat-navigation-pane")).not.toBeNull();
    expect(container.querySelector(".chat-header-copy")?.textContent).toContain("对话 B");
    expect(container.querySelector<HTMLTextAreaElement>(".composer-input")?.disabled).toBe(false);
  });

  it("isolates draft, parameters and model by conversation and restores the selected assistant after remount", async () => {
    await fill(".composer-input", "A draft");
    await chooseAssistant("写作助手", "对话 B");
    expect(container.querySelector<HTMLTextAreaElement>(".composer-input")?.value).toBe("");
    expect(container.querySelector(".chat-header-copy")?.textContent).toContain("upstream-b");
    await fill(".composer-input", "B draft");
    await click("编辑助手 写作助手"); expect(container.querySelector<HTMLTextAreaElement>("#session-system")?.value).toBe("Only B");
    await click("关闭");
    await chooseAssistant("默认助手", "对话 A");
    expect(container.querySelector<HTMLTextAreaElement>(".composer-input")?.value).toBe("A draft");
    expect(container.querySelector(".chat-header-copy")?.textContent).toContain("upstream-a");
    await chooseAssistant("写作助手", "对话 B");
    await act(async () => root.unmount()); root = createRoot(container);
    await act(async () => root.render(<App />));
    await wait(() => container.querySelector(".chat-header-copy")?.textContent?.includes("对话 B") === true);
  });

  it("keeps a stream bound to its origin while another assistant is selected, including its terminal save", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let observed: ChatRequest | undefined;
    const transport: ChatTransport = { async *stream(request) { observed = request; yield { type: "text-delta", text: "A partial" }; await gate; yield { type: "text-delta", text: " finished" }; yield { type: "completed" }; } };
    runtime.createRuntimeChatTransport.mockResolvedValue(transport);
    await fill(".composer-input", "Question A"); await click("发送");
    await wait(() => container.textContent?.includes("A partial") === true);
    await chooseAssistant("写作助手", "对话 B");
    expect(container.querySelector(".message-list")?.textContent ?? "").not.toContain("A partial");
    await fill(".composer-input", "B during A");
    await act(async () => { container.querySelector(".composer-input")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(runtime.createRuntimeChatTransport).toHaveBeenCalledTimes(1);
    await act(async () => release());
    await wait(() => container.querySelector('[aria-label="发送"]') !== null);
    expect(container.querySelector<HTMLTextAreaElement>(".composer-input")?.value).toBe("B during A");
    expect((await repo.load("b"))?.messages).toEqual([]);
    const saved = (await repo.load("current"))!.messages;
    expect(saved[saved.length - 1]).toMatchObject({ content: "A partial finished", status: "complete" });
    expect(observed?.model).toBe("upstream-a");
    await chooseAssistant("默认助手", "对话 A");
    expect(container.textContent).toContain("A partial finished");
  });

  it("edits shared assistant settings and uses the destination assistant after moving conversations", async () => {
    await chooseAssistant("写作助手", "对话 B");
    await click("编辑助手 写作助手");
    await fill("#session-system", "Revised default"); await click("保存助手");
    await wait(() => !container.querySelector('[aria-label="编辑助手"][role="dialog"]'));
    expect((await repo.load("b"))?.generationConfig).toBeUndefined();
    expect(container.textContent).not.toContain("应用助手设置");
    await click("编辑助手 写作助手"); expect(container.querySelector<HTMLTextAreaElement>("#session-system")?.value).toBe("Revised default"); await click("关闭");
    await click("删除助手 写作助手");
    expect(container.textContent).toContain("包含 1 个对话");
    await click("迁移对话到默认助手并删除助手");
    await wait(() => !container.querySelector('[role="dialog"]'));
    const state = await repo.initializeWorkspace(null, ["model-a", "model-b"]);
    expect(selectedConversation(state)).toMatchObject({ id: "b", assistantId: "default" });
    expect(container.querySelector(".chat-header-copy")?.textContent).toContain("upstream-a");
    expect((await repo.load("b"))?.messages).toEqual([]);
  });

  it("creates, renames and permanently deletes a conversation through explicit UI actions", async () => {
    if (!container.querySelector('[aria-label="助手列表"]')) await click("助手与对话");
    await click("默认助手");
    await click("新建对话");
    await wait(() => container.querySelector(".chat-header-copy")?.textContent?.startsWith("新对话") === true);
    await wait(() => container.querySelector<HTMLButtonElement>('[aria-label="默认助手"]')?.disabled === false);
    expect(container.querySelector(".conversation-cascade-pane")).not.toBeNull();
    await wait(() => !container.querySelector<HTMLButtonElement>('[aria-label="重命名对话 新对话"]')?.disabled);
    await click("重命名对话 新对话"); await fill("#conversation-title", "新建验收"); await click("保存标题");
    await wait(() => container.querySelector(".chat-header-copy")?.textContent?.startsWith("新建验收") === true);
    await click("删除对话 新建验收"); await click("取消");
    expect(container.querySelector(".chat-header-copy")?.textContent).toContain("新建验收");
    await click("删除对话 新建验收"); await click("确认永久删除对话");
    await wait(() => container.querySelector(".chat-header-copy")?.textContent?.startsWith("对话 A") === true);
  });

  it("shares assistant changes across existing conversations with only rename and delete icons on each row", async () => {
    const observed: ChatRequest[] = [];
    runtime.createRuntimeChatTransport.mockResolvedValue({ async *stream(request: ChatRequest) {
      observed.push(request); yield { type: "completed" };
    } } satisfies ChatTransport);
    await click("默认助手");
    await click("新建对话");
    await wait(() => container.querySelector<HTMLButtonElement>('[aria-label="编辑助手 默认助手"]')?.disabled === false);
    expect(container.textContent).not.toContain("会话配置");
    const row = container.querySelector('.conversation-leaf')!;
    expect(row.querySelectorAll('.conversation-row-actions button')).toHaveLength(2);
    expect(row.querySelectorAll('.conversation-row-actions button svg')).toHaveLength(2);
    await click("编辑助手 默认助手");
    await fill("#session-system", "Shared instruction");
    await act(async () => {
      const model = container.querySelector<HTMLSelectElement>('#assistant-model')!;
      model.value = "model-b"; model.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click("保存助手"); await wait(() => !container.querySelector('[role="dialog"]'));
    for (const title of ["对话 A", "新对话"]) {
      await click(title); await wait(() => container.querySelector<HTMLTextAreaElement>('.composer-input')?.disabled === false);
      await fill('.composer-input', title); await click("发送");
      await wait(() => container.querySelector('[aria-label="发送"]') !== null);
    }
    expect(observed).toHaveLength(2);
    for (const request of observed) {
      expect(request.model).toBe("upstream-b");
      expect(request.config?.systemInstruction).toBe("Shared instruction");
    }
    expect((await repo.load("current"))?.generationConfig).toBeUndefined();
  });

  it("keeps a background failure on its originating conversation", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const transport: ChatTransport = { async *stream() { yield { type: "text-delta", text: "Partial A" }; await gate;
      yield { type: "failed", error: { kind: "server", message: "Only A failed", retryable: false } }; } };
    runtime.createRuntimeChatTransport.mockResolvedValue(transport);
    await fill(".composer-input", "A"); await click("发送"); await wait(() => container.textContent?.includes("Partial A") === true);
    await chooseAssistant("写作助手", "对话 B");
    await act(async () => release()); await wait(() => container.querySelector('[aria-label="发送"]') !== null);
    expect(container.textContent).not.toContain("Only A failed");
    expect((await repo.load("b"))?.messages).toEqual([]);
    await chooseAssistant("默认助手", "对话 A"); expect(container.textContent).toContain("Only A failed");
  });

  it("freezes the running assistant model and settings but uses edits on the next request", async () => {
    const observed: ChatRequest[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    runtime.createRuntimeChatTransport.mockResolvedValue({ async *stream(request: ChatRequest) {
      observed.push(request); yield { type: "text-delta", text: "Partial" };
      await gate; yield { type: "completed" };
    } } satisfies ChatTransport);
    await fill('.composer-input', 'First'); await click('发送');
    await wait(() => observed.length === 1);
    await click('编辑助手 默认助手');
    await fill('#session-system', 'New shared instruction');
    await act(async () => {
      const model = container.querySelector<HTMLSelectElement>('#assistant-model')!;
      model.value = 'model-b'; model.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await click('保存助手'); await wait(() => !container.querySelector('[role="dialog"]'));
    expect(observed[0].model).toBe('upstream-a');
    expect(observed[0].config?.systemInstruction).toBe('');
    await act(async () => release()); await wait(() => container.querySelector('[aria-label="发送"]') !== null);
    await fill('.composer-input', 'Second'); await click('发送');
    await wait(() => observed.length === 2);
    expect(observed[1].model).toBe('upstream-b');
    expect(observed[1].config?.systemInstruction).toBe('New shared instruction');
    await wait(() => container.querySelector('[aria-label="发送"]') !== null);
  });

  it("retains custom parameters while editing an assistant whose model is unavailable", async () => {
    await act(async () => root.unmount());
    await repo.execute({ type: "edit-assistant", id: "writer", input: { name: "写作助手", icon: "", defaultModelId: null,
      defaultConfig: { ...defaultSessionConfig(), topK: { mode: "custom", value: "20" } } } });
    root = createRoot(container); await act(async () => root.render(<App />));
    await wait(() => container.querySelector<HTMLTextAreaElement>(".composer-input")?.disabled === false);
    await chooseAssistant("写作助手", "对话 B"); await click("编辑助手 写作助手");
    await fill("#assistant-name", "改名助手"); await click("保存助手"); await wait(() => !container.querySelector('[role="dialog"]'));
    const state = await repo.initializeWorkspace(null, ["model-a", "model-b"]);
    expect(state.assistants.find((item) => item.id === "writer")).toMatchObject({ name: "改名助手", defaultModelId: null, defaultConfig: { topK: { mode: "custom", value: "20" } } });
  });
});
