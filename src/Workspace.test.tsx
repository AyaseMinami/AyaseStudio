// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { createChatRepository } from "./chat/repository";
import { defaultSessionConfig } from "./chat/sessionConfig";
import { loadConnectionSettings, saveConnectionSettings } from "./chat/settings";
import { thinkingLabels } from "./chat/thinking";
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
    if (text.startsWith("编辑对话 ") && !container.querySelector(".conversation-cascade-pane:not([inert])")) await click("默认助手");
    const assistantAction = /^(?:编辑|删除|上移|下移)助手 (.+)$/.exec(text);
    if (assistantAction && !document.querySelector('[role="menu"]')) {
      if (container.querySelector('.conversation-workspace-body')?.getAttribute("data-assistant-expanded") !== "true") {
        const current = container.querySelector('.assistant-branch-toggle[aria-pressed="true"]')?.getAttribute("aria-label");
        expect(current).toBeTruthy(); await click(current!);
      }
      await click(`管理助手 ${assistantAction[1]}`);
    }
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.getAttribute("aria-label") === text || item.textContent?.trim() === text);
    expect(button, text).toBeTruthy(); expect(button!.disabled, text).toBe(false);
    await act(async () => button!.click());
  }
  async function fill(selector: string, value: string) {
    const field = (container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector) ?? document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector))!;
    expect(field).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function chooseModel(selector: string, modelId: string) {
    const model = loadConnectionSettings().providers.flatMap(provider => provider.connections.flatMap(connection => connection.models)).find(item => item.id === modelId);
    expect(model).toBeTruthy();
    const trigger = container.querySelector<HTMLButtonElement>(selector)!;
    expect(trigger).toBeInstanceOf(HTMLButtonElement);
    await act(async () => trigger.click());
    const option = [...document.querySelectorAll<HTMLButtonElement>(".model-picker-option")].find(item => item.querySelector("strong")?.textContent === (model!.displayName || model!.modelId));
    expect(option).toBeTruthy();
    await act(async () => option!.click());
    await wait(() => !document.querySelector(".model-picker"));
  }
  async function chooseAssistant(name: string, title: string) {
    if (!container.querySelector('[aria-label="助手列表"]:not([inert])')) await click("助手与对话");
    await click(name);
    await wait(() => container.querySelector(".workspace-conversation-title")?.textContent?.includes(title) === true);
    await wait(() => container.querySelector<HTMLButtonElement>('[aria-label="管理助手 默认助手"]')?.disabled === false);
  }

  it("keeps the backup entry available after every conversation has been deleted", async () => {
    await act(async () => root.unmount());
    await repo.execute({ type: "delete-conversation", id: "current" });
    const saved = await repo.execute({ type: "delete-conversation", id: "b" });
    expect(saved.conversations).toEqual([]);
    expect(saved.assistants).toHaveLength(2);
    expect(selectedConversation(saved)).toBeUndefined();
    root = createRoot(container);
    await act(async () => root.render(<App />));
    await wait(() => container.querySelector<HTMLButtonElement>('[aria-label="管理助手 默认助手"]')?.disabled === false);
    await click("设置");
    await click("数据管理");
    const backupEntry = () => [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find(button => button.textContent?.trim() === "进入备份与恢复");
    await wait(() => backupEntry()?.disabled === false);
    expect(backupEntry()).toBeTruthy();
    expect(runtime.createRuntimeChatTransport).not.toHaveBeenCalled();
    expect(runtime.createRuntimeModelCatalogClient).not.toHaveBeenCalled();
  });

  it("selects a model from the composer, scopes persistence to this conversation and restores focus on cancel", async () => {
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="切换模型"]')!;
    const tools = container.querySelector(".composer-tools")!;
    expect(tools.lastElementChild).toBe(trigger);
    expect(trigger.previousElementSibling?.querySelector("button")?.getAttribute("aria-label")).toBe("联网搜索：关闭");
    expect(container.querySelector(".conversation-navigation-toolbar .chat-model-trigger")).toBeNull();
    trigger.focus();
    await click("切换模型");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("搜索模型");
    await fill('[aria-label="搜索模型"]', "nothing-matches");
    expect(document.querySelector(".model-picker-empty")?.textContent).toContain("没有匹配的选项");
    await fill('[aria-label="搜索模型"]', "upstream-b");
    await click("upstream-b");
    await wait(() => !document.querySelector(".model-picker"));
    expect(container.querySelector(".chat-model-trigger")?.textContent).toContain("upstream-b");
    const saved = await repo.initializeWorkspace(null, ["model-a", "model-b"]);
    expect(saved.conversations.find((item) => item.id === "current")?.settings?.modelId).toBe("model-b");
    expect(saved.assistants.find((item) => item.id === "default")?.defaultModelId).toBe("model-a");
    expect(saved.conversations.find((item) => item.id === "b")?.settings?.modelId).toBe("model-b");
    expect(runtime.createRuntimeChatTransport).not.toHaveBeenCalled();
    expect(runtime.createRuntimeModelCatalogClient).not.toHaveBeenCalled();
    await click("切换模型");
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector(".model-picker")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("edits conversation fields explicitly, discards cancelled drafts and restores inheritance", async () => {
    expect(container.querySelector(".conversation-navigation-toolbar")?.textContent).not.toContain("会话设置");
    await click("默认助手");
    await click("编辑对话 对话 A");
    await fill("#session-system", "Conversation only");
    await chooseModel("#conversation-model", "model-b");
    await click("保存对话");
    await wait(() => !container.querySelector('[role="dialog"]'));
    let saved = await repo.initializeWorkspace(null, ["model-a", "model-b"]);
    expect(selectedConversation(saved)?.settings).toMatchObject({ config: { systemInstruction: "Conversation only" }, modelId: "model-b" });
    expect(saved.assistants.find((item) => item.id === "default")?.defaultConfig.systemInstruction).toBe("");
    expect(container.querySelector(".chat-model-trigger")?.textContent).toContain("upstream-b");
    await click("编辑对话 对话 A");
    await fill("#session-system", "Discard me");
    await fill("#conversation-title", "Discard title");
    await click("取消");
    await click("编辑对话 对话 A");
    expect(container.querySelector<HTMLInputElement>("#conversation-title")?.value).toBe("对话 A");
    expect(container.querySelector<HTMLTextAreaElement>("#session-system")?.value).toBe("Conversation only");
    await click("恢复助手默认值");
    expect(container.querySelector<HTMLTextAreaElement>("#session-system")?.value).toBe("");
    await click("保存对话");
    await wait(() => !container.querySelector('[role="dialog"]'));
    saved = await repo.initializeWorkspace(null, ["model-a", "model-b"]);
    expect(selectedConversation(saved)?.settings).toEqual({ modelId: "model-a", config: defaultSessionConfig() });
    await click("编辑对话 对话 A");
    await click("恢复助手默认值");
    await click("保存对话");
    await wait(() => !container.querySelector('[role="dialog"]'));
    expect(selectedConversation(await repo.initializeWorkspace(null, ["model-a", "model-b"]))?.settings).toEqual({ modelId: "model-a", config: defaultSessionConfig() });
  });

  it("edits another conversation without switching the active chat", async () => {
    await click("默认助手");
    await click("新建对话");
    await wait(() => container.querySelector(".workspace-conversation-title")?.textContent?.includes("新对话") === true);
    await wait(() => container.querySelector<HTMLButtonElement>('[aria-label="编辑对话 对话 A"]')?.disabled === false);
    const activeId = selectedConversation(await repo.initializeWorkspace(null, ["model-a", "model-b"]))?.id;
    await click("编辑对话 对话 A");
    await fill("#conversation-title", "Renamed A");
    await fill("#session-system", "Only A");
    await click("保存对话");
    await wait(() => !container.querySelector('[role="dialog"]'));
    const saved = await repo.initializeWorkspace(null, ["model-a", "model-b"]);
    expect(selectedConversation(saved)?.id).toBe(activeId);
    expect(selectedConversation(saved)?.overrides).toBeUndefined();
    expect(saved.conversations.find((item) => item.id === "current")).toMatchObject({ title: "Renamed A", settings: { config: { systemInstruction: "Only A" } } });
    expect(container.querySelector(".workspace-conversation-title")?.textContent).toContain("新对话");
  });

  it("couples both columns to the main toggle and allows collapsing only conversations", async () => {
    expect(container.querySelectorAll(".chat-navigation-pane")).toHaveLength(1);
    expect(container.querySelector(".conversation-cascade-pane:not([inert])")).not.toBeNull();
    expect(container.querySelector(".conversation-workspace-body")?.getAttribute("data-assistant-expanded")).toBe("false");
    await fill(".composer-input", "keep my draft");
    await click("默认助手");
    const panel = container.querySelector('[aria-label="默认助手的对话"]');
    expect(panel).not.toBeNull();
    expect(panel?.parentElement).toBe(container.querySelector(".chat-navigation-pane:not([inert])")?.parentElement);
    expect(container.querySelector(".workspace-conversation-title")?.textContent).toContain("对话 A");
    await chooseAssistant("写作助手", "对话 B");
    expect(container.querySelector('[aria-label="默认助手的对话"]')).toBeNull();
    expect(container.querySelector('[aria-label="写作助手的对话"]')).not.toBeNull();
    await click("对话 B");
    await wait(() => container.querySelector<HTMLButtonElement>('[aria-label="写作助手"]')?.disabled === false);
    expect(container.querySelector(".conversation-cascade-pane:not([inert])")).not.toBeNull();
    expect(container.querySelector(".chat-navigation-pane:not([inert])")).not.toBeNull();
    await click("助手与对话"); expect(container.querySelector(".chat-navigation-pane:not([inert])")).toBeNull();
    expect(container.querySelector(".conversation-cascade-pane:not([inert])")).toBeNull();
    await click("助手与对话");
    expect(container.querySelector(".conversation-cascade-pane:not([inert])")).not.toBeNull();
    await click("收起对话栏");
    expect(container.querySelector(".conversation-cascade-pane:not([inert])")).toBeNull();
    expect(container.querySelector(".chat-navigation-pane:not([inert])")).not.toBeNull();
    await chooseAssistant("默认助手", "对话 A");
    expect(container.querySelector<HTMLTextAreaElement>(".composer-input")?.value).toBe("keep my draft");
    await act(async () => container.querySelector(".conversation-cascade-pane:not([inert])")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector(".conversation-cascade-pane:not([inert])")).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("默认助手");
    await click("默认助手");
    await act(async () => container.querySelector<HTMLTextAreaElement>(".composer-input")?.focus());
    expect(container.querySelector(".conversation-cascade-pane:not([inert])")).not.toBeNull();
  });

  it("dismisses floating navigation without replacing the chat or losing its draft", async () => {
    await fill(".composer-input", "preserved draft");
    const composer = container.querySelector(".composer-input");
    await click("默认助手");
    const escape = async () => act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await act(async () => container.querySelector<HTMLButtonElement>(".conversation-collapse-button")?.focus());
    await escape();
    expect(container.querySelector(".conversation-cascade-pane")?.hasAttribute("inert")).toBe(true);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("默认助手");
    await escape();
    expect(container.querySelector(".chat-navigation-pane")?.getAttribute("aria-hidden")).toBe("true");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("助手与对话");
    expect(container.querySelector(".navigation-dismiss-layer")).toBeNull();
    for (let index = 0; index < 3; index++) {
      await click("助手与对话");
      await click("助手与对话");
    }
    expect(container.querySelector(".chat-navigation-pane")?.hasAttribute("inert")).toBe(true);
    expect(container.querySelector(".navigation-dismiss-layer")).toBeNull();
    expect(container.querySelector(".composer-input")).toBe(composer);
    expect((composer as HTMLTextAreaElement).value).toBe("preserved draft");
    await click("助手与对话");
    await click("默认助手");
    await act(async () => {
      composer?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      (composer as HTMLTextAreaElement).focus();
      (composer as HTMLTextAreaElement).click();
    });
    await fill(".composer-input", "continue typing with navigation open");
    expect(document.activeElement).toBe(composer);
    expect(container.querySelector(".chat-navigation-pane")?.hasAttribute("inert")).toBe(false);
    expect(container.querySelector(".conversation-cascade-pane")?.hasAttribute("inert")).toBe(false);
    expect((composer as HTMLTextAreaElement).value).toBe("continue typing with navigation open");
  });

  it("saves Gemini controls, preserves choices across model switches, and restores stopped summaries", async () => {
    await act(async () => root.unmount());
    saveConnectionSettings({ version: 3, activeModelId: "model-a", providers: [{ id: "p", name: "Synthetic", connections: [{
      id: "c", name: "Gemini", protocol: "gemini-native", baseUrl: "https://test.example", apiKey: "synthetic-only",
      models: [{ id: "model-a", modelId: "gemini-3-flash-preview" }, { id: "model-b", modelId: "gemini-3.8-flash" }],
    }] }] });
    root = createRoot(container); await act(async () => root.render(<App />));
    await wait(() => container.querySelector<HTMLButtonElement>('button[aria-label="思考设置"]')?.disabled === false);
    async function thinkingReady() {
      await wait(() => container.querySelector<HTMLTextAreaElement>(".composer-input")?.disabled === false);
      if (!container.querySelector(".thinking-popover")) await click("思考设置");
      await wait(() => container.querySelector<HTMLFieldSetElement>(".thinking-options")?.disabled === false);
    }
    async function choose(selector: string, value: string) {
      await chooseModel(selector, value);
    }
    await thinkingReady();
    await act(async () => container.querySelector<HTMLInputElement>('.thinking-popover input[value="minimal"]')!.click());
    await thinkingReady();
    expect((await repo.initializeWorkspace(null, ["model-a", "model-b"])).conversations.find((item) => item.id === "current")?.settings?.config.geminiThinking?.choice).toBe("minimal");
    await click("编辑对话 对话 A");
    await choose("#conversation-model", "model-b");
    expect(container.textContent).not.toContain("原思考选项不适用于此模型");
    await click("保存对话");
    await thinkingReady();
    expect(container.querySelector<HTMLInputElement>('.thinking-popover input:checked')?.value).toBe("minimal");
    await act(async () => container.querySelector<HTMLInputElement>('.thinking-popover input[value="high"]')!.click());
    await thinkingReady();
    await wait(() => container.querySelector<HTMLTextAreaElement>(".composer-input")?.disabled === false);
    if (!container.querySelector(".thinking-popover")) await click("思考设置");
    await act(async () => container.querySelector<HTMLInputElement>('.thinking-summary-toggle input')!.click());
    await wait(() => container.querySelector<HTMLTextAreaElement>(".composer-input")?.disabled === false);
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

  it("keeps saved thinking settings isolated while switching non-Gemini protocols", async () => {
    await act(async () => root.unmount());
    saveConnectionSettings({ version: 3, activeModelId: "model-a", providers: [{ id: "p", name: "Synthetic", connections: [
      { id: "responses", name: "Responses", protocol: "openai-responses", baseUrl: "https://test.example", apiKey: "synthetic-only",
        models: [{ id: "model-a", modelId: "o3" }] },
      { id: "anthropic", name: "Anthropic", protocol: "anthropic-native", baseUrl: "https://test.example", apiKey: "synthetic-only",
        models: [{ id: "model-b", modelId: "claude-opus-4-6" }] },
    ] }] });
    const snapshot = await repo.initializeWorkspace(null, ["model-a", "model-b"]);
    const assistant = snapshot.assistants.find((item) => item.id === "default")!;
    await repo.execute({ type: "edit-assistant", id: assistant.id, input: { ...assistant, defaultModelId: "model-a", defaultConfig: {
      ...assistant.defaultConfig,
      thinking: {
        "openai-responses": { choice: "high", budget: "1024", includeSummary: true },
        "anthropic-native": { choice: "adaptive", budget: "1024", includeSummary: false, effort: "max" },
      },
    } } });
    await repo.execute({ type: "configure-conversation", id: "current", settings: { modelId: "model-a", config: {
      ...assistant.defaultConfig, thinking: {
        "openai-responses": { choice: "high", budget: "1024", includeSummary: true },
        "anthropic-native": { choice: "adaptive", budget: "1024", includeSummary: false, effort: "max" },
      },
    } } });
    root = createRoot(container); await act(async () => root.render(<App />));
    await wait(() => container.querySelector<HTMLButtonElement>('button[aria-label="思考设置"]')?.disabled === false);
    await click("思考设置");
    expect(container.querySelector<HTMLInputElement>('.thinking-popover input:checked')?.value).toBe("high");
    await click("编辑助手 默认助手");
    await chooseModel("#assistant-model", "model-b");
    expect(container.querySelector<HTMLButtonElement>('[aria-label="思考模式（当前助手）"]')?.textContent).toBe(thinkingLabels.default);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="思考力度（当前助手）"]')?.textContent).toBe(thinkingLabels.default);
    const restored = await repo.initializeWorkspace(null, ["model-a", "model-b"]);
    expect(restored.assistants.find((item) => item.id === "default")?.defaultConfig.thinking).toMatchObject({
      "openai-responses": { choice: "high" }, "anthropic-native": { choice: "adaptive", effort: "max" },
    });
    await click("取消");
    await click("编辑对话 对话 A");
    for (const modelId of ["model-b", "model-a"]) {
      await chooseModel("#conversation-model", modelId);
      const choiceLabel = modelId === "model-b" ? "思考模式" : "思考强度";
      expect(container.querySelector<HTMLButtonElement>(`[aria-label="${choiceLabel}（当前会话）"]`)?.textContent).toBe(thinkingLabels.default);
    }
    await click("保存对话");
    const changed = await repo.initializeWorkspace(null, ["model-a", "model-b"]);
    expect(changed.conversations.find((item) => item.id === "current")?.settings?.config.thinking).toMatchObject({
      "openai-responses": { choice: "default", budget: "" }, "anthropic-native": { choice: "default", effort: "default", budget: "" },
    });
  });

  it("freezes, preserves choices, and restores stopped OpenAI Responses thinking summaries", async () => {
    await act(async () => root.unmount());
    saveConnectionSettings({ version: 3, activeModelId: "model-a", providers: [{ id: "p", name: "Synthetic", connections: [{
      id: "responses", name: "Responses", protocol: "openai-responses", baseUrl: "https://test.example", apiKey: "synthetic-only",
      models: [{ id: "model-a", modelId: "gpt-5" }, { id: "model-b", modelId: "gpt-5.6-sol" }],
    }] }] });
    root = createRoot(container); await act(async () => root.render(<App />));
    await wait(() => container.querySelector<HTMLButtonElement>('button[aria-label="思考设置"]')?.disabled === false);
    await click("思考设置");
    await act(async () => container.querySelector<HTMLInputElement>('.thinking-popover input[value="minimal"]')!.click());
    await wait(() => container.querySelector<HTMLButtonElement>('[aria-label="管理助手 默认助手"]')?.disabled === false);
    await click("编辑对话 对话 A");
    await chooseModel("#conversation-model", "model-b");
    expect(container.textContent).not.toContain("原思考选项不适用于此模型");
    await click("保存对话");
    await wait(() => container.querySelector<HTMLTextAreaElement>(".composer-input")?.disabled === false);
    if (!container.querySelector(".thinking-popover")) await click("思考设置");
    await wait(() => container.querySelector<HTMLInputElement>('.thinking-popover input:checked')?.value === "minimal");
    await act(async () => container.querySelector<HTMLInputElement>('.thinking-popover input[value="max"]')!.click());
    await wait(() => container.querySelector<HTMLTextAreaElement>(".composer-input")?.disabled === false);
    if (!container.querySelector(".thinking-popover")) await click("思考设置");
    await act(async () => container.querySelector<HTMLInputElement>('.thinking-summary-toggle input')!.click());
    await wait(() => container.querySelector<HTMLTextAreaElement>(".composer-input")?.disabled === false);
    let captured: ChatRequest | undefined;
    const transport: ChatTransport = { async *stream(request) {
      captured = request;
      yield { type: "thinking-delta", text: "Responses 摘要" };
      yield { type: "text-delta", text: "部分回复" };
      await new Promise<void>((resolve) => request.signal!.addEventListener("abort", () => resolve(), { once: true }));
      yield { type: "aborted" };
    } };
    runtime.createRuntimeChatTransport.mockResolvedValue(transport);
    await fill(".composer-input", "测试 Responses 思考");
    await wait(() => container.querySelector<HTMLButtonElement>('[aria-label="发送"]')?.disabled === false);
    await click("发送");
    await wait(() => !!container.querySelector(".thinking-summary"));
    expect(captured?.config?.thinking?.["openai-responses"]).toMatchObject({ choice: "max", includeSummary: true });
    await click("停止生成"); await wait(() => !container.querySelector('[aria-label="停止生成"]'));
    const responsesMessages = (await repo.load("current"))!.messages;
    expect(responsesMessages[responsesMessages.length - 1]).toMatchObject({
      thinkingSummary: "Responses 摘要", content: "部分回复", status: "aborted",
    });
    await act(async () => root.unmount()); root = createRoot(container);
    await act(async () => root.render(<App />));
    await wait(() => !!container.querySelector(".thinking-summary"));
    expect(container.querySelector('button[aria-label="思考设置"]')?.getAttribute("title")).toContain("思考：最高");
  });

  it("freezes, preserves choices, and restores stopped Anthropic summaries with effort", async () => {
    await act(async () => root.unmount());
    saveConnectionSettings({ version: 3, activeModelId: "model-a", providers: [{ id: "p", name: "Synthetic", connections: [{
      id: "anthropic", name: "Anthropic", protocol: "anthropic-native", baseUrl: "https://test.example", apiKey: "synthetic-only",
      models: [{ id: "model-a", modelId: "claude-opus-4-6" }, { id: "model-b", modelId: "claude-opus-5" }],
    }] }] });
    root = createRoot(container); await act(async () => root.render(<App />));
    await wait(() => container.querySelector<HTMLButtonElement>('button[aria-label="思考设置"]')?.disabled === false);
    await click("思考设置");
    await act(async () => container.querySelector<HTMLInputElement>('.thinking-popover input[value="budget"]')!.click());
    await wait(() => container.querySelector<HTMLButtonElement>('[aria-label="管理助手 默认助手"]')?.disabled === false);
    await click("编辑对话 对话 A");
    await chooseModel("#conversation-model", "model-b");
    expect(container.textContent).not.toContain("原思考选项不适用于此模型");
    await click("保存对话");
    await wait(() => container.querySelector<HTMLTextAreaElement>(".composer-input")?.disabled === false);
    if (!container.querySelector(".thinking-popover")) await click("思考设置");
    await wait(() => container.querySelector<HTMLInputElement>('.thinking-popover input:checked')?.value === "budget");
    await act(async () => container.querySelector<HTMLInputElement>('.thinking-popover input[value="adaptive"]')!.click());
    let savedChoice: string | undefined;
    for (let attempt = 0; attempt < 150 && savedChoice !== "adaptive"; attempt++) {
      await act(async () => {
        savedChoice = (await repo.initializeWorkspace(null, ["model-a", "model-b"])).conversations.find((item) => item.id === "current")
          ?.settings?.config.thinking?.["anthropic-native"]?.choice;
      });
      if (savedChoice !== "adaptive") await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    }
    expect(savedChoice).toBe("adaptive");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="思考力度（当前会话）"]')!.click());
    const effortOption = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === thinkingLabels.xhigh)!;
    await act(async () => effortOption.click());
    let savedEffort: string | undefined;
    for (let attempt = 0; attempt < 150 && savedEffort !== "xhigh"; attempt++) {
      await act(async () => {
        savedEffort = (await repo.initializeWorkspace(null, ["model-a", "model-b"])).conversations.find((item) => item.id === "current")
          ?.settings?.config.thinking?.["anthropic-native"]?.effort;
      });
      if (savedEffort !== "xhigh") await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    }
    expect(savedEffort).toBe("xhigh");
    await wait(() => container.querySelector<HTMLTextAreaElement>(".composer-input")?.disabled === false);
    if (!container.querySelector(".thinking-popover")) await click("思考设置");
    await act(async () => container.querySelector<HTMLInputElement>('.thinking-summary-toggle input')!.click());
    await wait(() => container.querySelector<HTMLTextAreaElement>(".composer-input")?.disabled === false);
    let captured: ChatRequest | undefined;
    const transport: ChatTransport = { async *stream(request) {
      captured = request;
      yield { type: "thinking-delta", text: "Anthropic 摘要" };
      yield { type: "text-delta", text: "部分回复" };
      await new Promise<void>((resolve) => request.signal!.addEventListener("abort", () => resolve(), { once: true }));
      yield { type: "aborted" };
    } };
    runtime.createRuntimeChatTransport.mockResolvedValue(transport);
    await fill(".composer-input", "测试 Anthropic 思考");
    await wait(() => container.querySelector<HTMLButtonElement>('[aria-label="发送"]')?.disabled === false);
    await click("发送");
    await wait(() => !!container.querySelector(".thinking-summary"));
    expect(captured?.config?.thinking?.["anthropic-native"]).toMatchObject({ choice: "adaptive", effort: "xhigh", includeSummary: true });
    await click("停止生成"); await wait(() => !container.querySelector('[aria-label="停止生成"]'));
    const anthropicMessages = (await repo.load("current"))!.messages;
    expect(anthropicMessages[anthropicMessages.length - 1]).toMatchObject({
      thinkingSummary: "Anthropic 摘要", content: "部分回复", status: "aborted",
    });
    await act(async () => root.unmount()); root = createRoot(container);
    await act(async () => root.render(<App />));
    await wait(() => !!container.querySelector(".thinking-summary"));
    await click("思考设置");
    expect(container.querySelector<HTMLButtonElement>('[aria-label="思考力度（当前会话）"]')?.textContent).toBe(thinkingLabels.xhigh);
  });

  it("preserves a standalone Anthropic effort during an editor model switch", async () => {
    await act(async () => root.unmount());
    saveConnectionSettings({ version: 3, activeModelId: "model-a", providers: [{ id: "p", name: "Synthetic", connections: [{
      id: "anthropic", name: "Anthropic", protocol: "anthropic-native", baseUrl: "https://test.example", apiKey: "synthetic-only",
      models: [{ id: "model-a", modelId: "claude-opus-4-6" }, { id: "model-b", modelId: "claude-opus-4-5" }],
    }] }] });
    const snapshot = await repo.initializeWorkspace(null, ["model-a", "model-b"]);
    const assistant = snapshot.assistants.find((item) => item.id === "default")!;
    await repo.execute({ type: "edit-assistant", id: assistant.id, input: { ...assistant, defaultModelId: "model-a", defaultConfig: {
      ...assistant.defaultConfig,
      thinking: { "anthropic-native": { choice: "default", budget: "1024", includeSummary: false, effort: "max" } },
    } } });
    root = createRoot(container); await act(async () => root.render(<App />));
    await wait(() => container.querySelector<HTMLButtonElement>('[aria-label="管理助手 默认助手"]')?.disabled === false);
    await click("编辑助手 默认助手");
    await chooseModel("#assistant-model", "model-b");
    expect(container.textContent).not.toContain("原思考选项不适用于此模型");
    await click("保存助手");
    const restored = await repo.initializeWorkspace(null, ["model-a", "model-b"]);
    const thinking = restored.assistants.find((item) => item.id === "default")?.defaultConfig.thinking?.["anthropic-native"];
    expect(thinking).toMatchObject({ choice: "default", includeSummary: false });
    expect(thinking?.effort).toBe("max");
  });

  it("drops malicious thinking deltas when the frozen summary preference is off", async () => {
    await act(async () => root.unmount());
    saveConnectionSettings({ version: 3, activeModelId: "model-a", providers: [{ id: "p", name: "Synthetic", connections: [{
      id: "responses", name: "Responses", protocol: "openai-responses", baseUrl: "https://test.example", apiKey: "synthetic-only",
      models: [{ id: "model-a", modelId: "gpt-5" }],
    }] }] });
    const snapshot = await repo.initializeWorkspace(null, ["model-a"]);
    const assistant = snapshot.assistants.find((item) => item.id === "default")!;
    await repo.execute({ type: "edit-assistant", id: assistant.id, input: { ...assistant, defaultModelId: "model-a", defaultConfig: {
      ...assistant.defaultConfig,
      thinking: { "openai-responses": { choice: "high", budget: "1024", includeSummary: false } },
    } } });
    let captured: ChatRequest | undefined;
    const malicious: ChatTransport = { async *stream(request: ChatRequest) {
      captured = request;
      yield { type: "thinking-delta", text: "不得保存的摘要" };
      yield { type: "text-delta", text: "可保存的回答" };
      yield { type: "completed" };
    } };
    runtime.createRuntimeChatTransport.mockResolvedValue(malicious);
    const seeded = (await repo.initializeWorkspace(null, ["model-a"])).assistants.find((item) => item.id === "default")!;
    await repo.execute({ type: "configure-conversation", id: "current", settings: { modelId: seeded.defaultModelId, config: seeded.defaultConfig } });
    root = createRoot(container); await act(async () => root.render(<App />));
    await wait(() => container.querySelector<HTMLTextAreaElement>(".composer-input")?.disabled === false);
    await fill(".composer-input", "关闭摘要"); await click("发送");
    await wait(() => container.textContent?.includes("可保存的回答") === true);
    await wait(() => container.querySelector('[aria-label="停止生成"]') === null);
    expect(captured?.config?.thinking?.["openai-responses"]?.includeSummary).toBe(false);
    expect(container.querySelector(".thinking-summary")).toBeNull();
    const savedMessages = (await repo.load("current"))!.messages;
    const saved = savedMessages[savedMessages.length - 1]!;
    expect(saved).toMatchObject({ content: "可保存的回答", status: "complete" });
    expect(saved).not.toHaveProperty("thinkingSummary");
  });

  it("keeps both columns on narrow screens until explicitly collapsed", async () => {
    await act(async () => root.unmount());
    vi.stubGlobal("innerWidth", 720);
    root = createRoot(container); await act(async () => root.render(<App />));
    await wait(() => container.querySelector<HTMLTextAreaElement>(".composer-input")?.disabled === false);
    expect(container.querySelector(".chat-navigation-pane:not([inert])")).toBeNull();
    await click("助手与对话");
    await click("写作助手");
    await wait(() => container.querySelector('[aria-label="写作助手的对话"]') !== null);
    await wait(() => container.querySelector<HTMLButtonElement>('[aria-label="管理助手 写作助手"]')?.disabled === false);
    await click("对话 B");
    await wait(() => container.querySelector<HTMLButtonElement>('[aria-label="写作助手"]')?.disabled === false);
    expect(container.querySelector(".conversation-cascade-pane:not([inert])")).not.toBeNull();
    await click("收起对话栏");
    expect(container.querySelector(".conversation-cascade-pane:not([inert])")).toBeNull();
    expect(container.querySelector(".chat-navigation-pane:not([inert])")).not.toBeNull();
    expect(container.querySelector(".workspace-conversation-title")?.textContent).toContain("对话 B");
    expect(container.querySelector<HTMLTextAreaElement>(".composer-input")?.disabled).toBe(false);
  });

  it("isolates draft, parameters and model by conversation and restores the selected assistant after remount", async () => {
    await fill(".composer-input", "A draft");
    await chooseAssistant("写作助手", "对话 B");
    expect(container.querySelector<HTMLTextAreaElement>(".composer-input")?.value).toBe("");
    expect(container.querySelector(".chat-model-trigger")?.textContent).toContain("upstream-b");
    await fill(".composer-input", "B draft");
    await click("编辑助手 写作助手"); expect(container.querySelector<HTMLTextAreaElement>("#session-system")?.value).toBe("Only B");
    await click("关闭");
    await chooseAssistant("默认助手", "对话 A");
    expect(container.querySelector<HTMLTextAreaElement>(".composer-input")?.value).toBe("A draft");
    expect(container.querySelector(".chat-model-trigger")?.textContent).toContain("upstream-a");
    await chooseAssistant("写作助手", "对话 B");
    await act(async () => root.unmount()); root = createRoot(container);
    await act(async () => root.render(<App />));
    await wait(() => container.querySelector(".workspace-conversation-title")?.textContent?.includes("对话 B") === true);
  });

  it("sends in another assistant while the original stream continues and saves both conversations", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let observed: ChatRequest | undefined;
    const transport: ChatTransport = { async *stream(request) {
      if (request.model === "upstream-b") {
        yield { type: "text-delta", text: "B answer" }; yield { type: "completed" }; return;
      }
      observed = request; yield { type: "text-delta", text: "A partial" }; await gate;
      yield { type: "text-delta", text: " finished" }; yield { type: "completed" };
    } };
    runtime.createRuntimeChatTransport.mockResolvedValue(transport);
    await fill(".composer-input", "Question A"); await click("发送");
    await wait(() => container.textContent?.includes("A partial") === true);
    await chooseAssistant("写作助手", "对话 B");
    expect(container.querySelector(".message-list")?.textContent ?? "").not.toContain("A partial");
    await fill(".composer-input", "B during A");
    await act(async () => { container.querySelector(".composer-input")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await wait(() => container.textContent?.includes("B answer") === true);
    expect(runtime.createRuntimeChatTransport).toHaveBeenCalledTimes(2);
    expect(observed?.signal?.aborted).toBe(false);
    await act(async () => release());
    await wait(() => container.querySelector('[aria-label="发送"]') !== null);
    expect(container.querySelector<HTMLTextAreaElement>(".composer-input")?.value).toBe("");
    expect((await repo.load("b"))?.messages.map((item) => item.content)).toEqual(["B during A", "B answer"]);
    const saved = (await repo.load("current"))!.messages;
    expect(saved[saved.length - 1]).toMatchObject({ content: "A partial finished", status: "complete" });
    expect(observed?.model).toBe("upstream-a");
    await chooseAssistant("默认助手", "对话 A");
    expect(container.textContent).toContain("A partial finished");
  });

  it("allows metadata sorting while another conversation generates and keeps its stream and selection", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let signal: AbortSignal | undefined;
    runtime.createRuntimeChatTransport.mockResolvedValue({ async *stream(request: ChatRequest) {
      signal = request.signal; yield { type: "text-delta", text: "Synthetic partial" }; await gate;
      yield { type: "text-delta", text: " completed" }; yield { type: "completed" };
    } } satisfies ChatTransport);
    await chooseAssistant("写作助手", "对话 B"); await fill(".composer-input", "Generate B"); await click("发送");
    await wait(() => container.textContent?.includes("Synthetic partial") === true);
    try {
      await chooseAssistant("默认助手", "对话 A");
      await fill(".composer-input", "Keep A draft");
      expect(container.querySelector<HTMLButtonElement>('[aria-label="拖动助手 写作助手"]')?.disabled).toBe(false);
      await click("上移助手 写作助手");
      await wait(() => container.querySelector<HTMLButtonElement>('[aria-label="拖动助手 写作助手"]')?.disabled === false);
      expect([...container.querySelectorAll(".assistant-branch-name")].map(item => item.textContent)).toEqual(["写作助手", "默认助手"]);
      expect(container.querySelector(".workspace-conversation-title")?.textContent).toBe("对话 A");
      expect(container.querySelector<HTMLTextAreaElement>(".composer-input")?.value).toBe("Keep A draft");
      expect(signal?.aborted).toBe(false);
    } finally { await act(async () => release()); }
    await wait(() => !container.querySelector(".background-generation"));
    expect((await repo.load("b"))?.messages.slice(-1)[0]).toMatchObject({ content: "Synthetic partial completed", status: "complete" });
  });

  it("opens assistant actions without navigating and supports keyboard dismissal and ordering", async () => {
    await click("默认助手");
    await click("管理助手 写作助手");
    expect(container.querySelector('.workspace-conversation-title')?.textContent).toContain("对话 A");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("编辑助手 写作助手");
    await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(document.activeElement?.getAttribute("aria-label")).toBe("上移助手 写作助手");
    await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(container.querySelector('.conversation-cascade-pane:not([inert])')).not.toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("管理助手 写作助手");
    await click("上移助手 写作助手");
    await wait(() => container.querySelector<HTMLButtonElement>('[aria-label="管理助手 写作助手"]')?.disabled === false);
    expect([...container.querySelectorAll('.assistant-branch-name')].map((item) => item.textContent)).toEqual(["写作助手", "默认助手"]);
    await click("管理助手 默认助手");
    const defaultDelete = document.querySelector<HTMLButtonElement>('[aria-label="删除助手 默认助手"]');
    expect(defaultDelete?.disabled).toBe(true);
    expect(document.querySelector('.action-menu-note')?.textContent).toBe("默认助手不可删除");
    await act(async () => defaultDelete!.click());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => container.querySelector('.composer-input')?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("opens the actual unselected assistant by right click and keyboard without changing navigation", async () => {
    await click("默认助手");
    const row = container.querySelector('[aria-label="写作助手"]')!.closest("li")!;
    await act(async () => row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 100, clientY: 120 })));
    expect(container.querySelector(".workspace-conversation-title")?.textContent).toBe("对话 A");
    expect(document.querySelector('[role="menu"]')?.getAttribute("aria-label")).toBe("写作助手的管理菜单");
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })));
    expect(document.activeElement?.getAttribute("aria-label")).toBe("写作助手");
    expect(container.querySelector(".conversation-cascade-pane:not([inert])")).not.toBeNull();
    await act(async () => row.querySelector(".chat-navigation-select")!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "F10", shiftKey: true })));
    await click("编辑助手 写作助手");
    expect(container.querySelector<HTMLInputElement>("#assistant-name")?.value).toBe("写作助手");
    expect(container.querySelector(".workspace-conversation-title")?.textContent).toBe("对话 A");
    await click("取消");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("写作助手");
  });

  it("sorts both navigation lists with drag handles, retains selection and draft, and reloads the saved order", async () => {
    await click("默认助手"); await click("新建对话");
    await wait(() => container.querySelector<HTMLButtonElement>('[aria-label="拖动对话 对话 A"]')?.disabled === false);
    const selected = selectedConversation(await repo.initializeWorkspace(null, ["model-a", "model-b"]))!;
    await fill(".composer-input", "Keep my unsent draft");
    const pointer = (target: EventTarget, type: string, y: number) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 41, isPrimary: true, button: 0, clientX: 25, clientY: y,
    }));
    const reorder = async (source: HTMLButtonElement, target: HTMLElement) => {
      vi.spyOn(document, "elementFromPoint").mockReturnValue(target);
      vi.spyOn(target, "getBoundingClientRect").mockReturnValue({ top: 50, height: 40 } as DOMRect);
      await act(async () => { pointer(source, "pointerdown", 10); pointer(window, "pointermove", 60); });
      expect(source.closest("li")?.getAttribute("data-dragging")).toBe("true");
      expect(target.getAttribute("data-drop-placement")).toBe("before");
      await act(async () => pointer(window, "pointerup", 60));
      await wait(() => !source.disabled);
    };
    const currentRow = container.querySelector<HTMLElement>('[data-conversation-id="current"]')!;
    const activeRow = container.querySelector<HTMLElement>(`[data-conversation-id="${selected.id}"]`)!;
    await reorder(currentRow.querySelector<HTMLButtonElement>(".navigation-drag-handle")!, activeRow);
    expect([...container.querySelectorAll(".conversation-leaf")].map(row => row.getAttribute("data-conversation-id"))).toEqual(["current", selected.id]);
    await reorder(container.querySelector<HTMLButtonElement>('[aria-label="拖动助手 写作助手"]')!, container.querySelector<HTMLElement>('[data-navigation-sort-id="default"]')!);
    expect([...container.querySelectorAll(".assistant-branch-name")].map(item => item.textContent)).toEqual(["写作助手", "默认助手"]);
    expect(container.querySelector<HTMLTextAreaElement>(".composer-input")?.value).toBe("Keep my unsent draft");
    expect(container.querySelector(".chat-model-trigger")?.textContent).toContain("upstream-a");
    const saved = await repo.initializeWorkspace(null, ["model-a", "model-b"]);
    expect(selectedConversation(saved)?.id).toBe(selected.id);
    expect(saved.conversations.filter(item => item.assistantId === "default").map(item => item.id)).toEqual(["current", selected.id]);
    expect(saved.conversations.find(item => item.id === "b")?.assistantId).toBe("writer");
    await act(async () => root.unmount()); root = createRoot(container);
    await act(async () => root.render(<App />));
    await wait(() => container.querySelector<HTMLButtonElement>('[aria-label="拖动助手 默认助手"]')?.disabled === false);
    expect([...container.querySelectorAll(".assistant-branch-name")].map(item => item.textContent)).toEqual(["写作助手", "默认助手"]);
    await click("默认助手");
    expect([...container.querySelectorAll(".conversation-leaf")].map(row => row.getAttribute("data-conversation-id"))).toEqual(["current", selected.id]);
    expect(runtime.createRuntimeChatTransport).not.toHaveBeenCalled();
  });

  it("opens handle menus with keyboard and moves only the target conversation without selecting it", async () => {
    await click("默认助手"); await click("新建对话");
    await wait(() => container.querySelector<HTMLButtonElement>('[aria-label="拖动对话 对话 A"]')?.disabled === false);
    const title = container.querySelector(".workspace-conversation-title")?.textContent;
    const handle = container.querySelector<HTMLButtonElement>('[aria-label="拖动对话 对话 A"]')!;
    handle.focus();
    await act(async () => handle.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "F10", shiftKey: true })));
    expect(document.querySelector<HTMLButtonElement>('[aria-label="上移对话 对话 A"]')?.disabled).toBe(false);
    expect(document.querySelector<HTMLButtonElement>('[aria-label="下移对话 对话 A"]')?.disabled).toBe(true);
    await click("上移对话 对话 A");
    await wait(() => !handle.disabled);
    expect(container.querySelector(".workspace-conversation-title")?.textContent).toBe(title);
    expect(container.querySelector('.sr-only[role="status"]')?.textContent).toBe("对话 A的顺序已保存。");
    await act(async () => handle.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ContextMenu" })));
    expect(document.querySelector<HTMLButtonElement>('[aria-label="上移对话 对话 A"]')?.disabled).toBe(true);
    await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })));
    expect(document.activeElement).toBe(handle);
    expect(container.querySelector(".conversation-cascade-pane:not([inert])")).not.toBeNull();
    expect((await repo.initializeWorkspace(null, ["model-a", "model-b"])).conversations.find(item => item.id === "b")?.assistantId).toBe("writer");
  });

  it("cancels drag with Escape without closing navigation, rejects cross-list drops, and keeps action buttons separate", async () => {
    await click("默认助手");
    const source = container.querySelector<HTMLButtonElement>('[aria-label="拖动对话 对话 A"]')!;
    const assistant = container.querySelector<HTMLElement>('[data-navigation-sort-id="writer"]')!;
    vi.spyOn(document, "elementFromPoint").mockReturnValue(assistant);
    const pointer = (target: EventTarget, type: string) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 44, isPrimary: true, button: 0, clientX: 20, clientY: type === "pointerdown" ? 10 : 80,
    }));
    await click("删除对话 对话 A");
    await act(async () => { pointer(source, "pointerdown"); pointer(window, "pointermove"); });
    expect(container.querySelector('[aria-label="确认删除对话 对话 A"]')).toBeNull();
    expect(source.closest("li")?.getAttribute("data-dragging")).toBe("true");
    expect(assistant.getAttribute("data-drop-placement")).toBeNull();
    await act(async () => source.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" })));
    expect(container.querySelector(".conversation-cascade-pane:not([inert])")).not.toBeNull();
    expect(source.closest("li")?.getAttribute("data-dragging")).toBeNull();
    await act(async () => pointer(window, "pointerup"));
    await act(async () => { pointer(source, "pointerdown"); pointer(window, "pointermove"); pointer(window, "pointerup"); });
    const unchanged = await repo.initializeWorkspace(null, ["model-a", "model-b"]);
    expect(unchanged.conversations.find(item => item.id === "current")?.assistantId).toBe("default");
    expect(unchanged.conversations.find(item => item.id === "b")?.assistantId).toBe("writer");
    await act(async () => pointer(container.querySelector('[aria-label="编辑对话 对话 A"]')!, "pointerdown"));
    expect(container.querySelector('[data-dragging="true"]')).toBeNull();
    await click("编辑对话 对话 A");
    await act(async () => { pointer(source, "pointerdown"); pointer(window, "pointermove"); });
    expect(container.querySelector('[data-dragging="true"]')).toBeNull();
    await click("取消");
    await click("管理助手 写作助手");
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(container.querySelector(".workspace-conversation-title")?.textContent).toBe("对话 A");
    expect(runtime.createRuntimeChatTransport).not.toHaveBeenCalled();
  });

  it("hands right-click deletion to the target row's second confirmation without selecting that conversation", async () => {
    await click("默认助手"); await click("新建对话");
    await wait(() => container.querySelector<HTMLButtonElement>('[aria-label="删除对话 对话 A"]')?.disabled === false);
    const title = container.querySelector(".workspace-conversation-title")?.textContent;
    const open = async () => {
      const row = container.querySelector('[data-conversation-id="current"]')!;
      await act(async () => row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
      await act(async () => document.querySelector<HTMLButtonElement>('[role="menu"] [aria-label="删除对话 对话 A"]')!.click());
    };
    await open();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("确认删除对话 对话 A");
    expect(container.querySelector(".workspace-conversation-title")?.textContent).toBe(title);
    expect((await repo.load("current"))).toBeDefined();
    await click("取消删除对话 对话 A");
    expect(container.querySelector('[aria-label="确认删除对话 对话 A"]')).toBeNull();
    await open(); await click("确认删除对话 对话 A");
    await wait(() => !container.querySelector('[data-conversation-id="current"]'));
    expect(container.querySelector(".workspace-conversation-title")?.textContent).toBe(title);
  });

  it("disables deletion of a running conversation and its owning assistant in right-click menus", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    runtime.createRuntimeChatTransport.mockResolvedValue({ async *stream() {
      await gate; yield { type: "completed" };
    } } satisfies ChatTransport);
    await chooseAssistant("写作助手", "对话 B"); await fill(".composer-input", "synthetic generation"); await click("发送");
    await wait(() => container.querySelector('[aria-label="停止生成"]') !== null);
    try {
      const conversationRow = container.querySelector('[data-conversation-id="b"]')!;
      await act(async () => conversationRow.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
      expect(document.querySelector<HTMLButtonElement>('[role="menu"] [aria-label="删除对话 对话 B"]')?.disabled).toBe(true);
      expect(document.querySelector<HTMLButtonElement>('[role="menu"] [aria-label="编辑对话 对话 B"]')?.disabled).toBe(false);
      const assistantRow = container.querySelector('[aria-label="写作助手"]')!.closest("li")!;
      await act(async () => assistantRow.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
      expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
      expect(document.querySelector<HTMLButtonElement>('[role="menu"] [aria-label="删除助手 写作助手"]')?.disabled).toBe(true);
    } finally { await act(async () => release()); }
    await wait(() => container.querySelector('[aria-label="发送"]') !== null);
  });

  it("keeps advanced JSON collapsed unless opened or invalid, without losing its draft", async () => {
    await click("编辑助手 默认助手");
    expect(container.querySelector('#session-custom-json')).toBeNull();
    await click("高级 JSON");
    await fill("#session-custom-json", "{");
    await click("高级 JSON");
    expect(container.querySelector<HTMLTextAreaElement>('#session-custom-json')?.value).toBe("{");
    const save = [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === "保存助手");
    expect(save?.disabled).toBe(true);
    await fill("#session-custom-json", '{"seed":1}');
    await click("高级 JSON");
    expect(container.querySelector('#session-custom-json')).toBeNull();
    await click("高级 JSON");
    expect(container.querySelector<HTMLTextAreaElement>('#session-custom-json')?.value).toBe('{"seed":1}');
    await click("取消");
  });

  it("discards modal drafts on cancel and close, and restores focus to the menu trigger", async () => {
    await click("编辑助手 写作助手");
    expect(container.querySelector('.session-config-modal')).not.toBeNull();
    expect(container.querySelector('.session-config-panel-footer')?.textContent).toContain("取消保存助手");
    await fill("#assistant-name", "未保存名称");
    await fill("#session-system", "未保存指令");
    await click("取消");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("管理助手 写作助手");
    await click("编辑助手 写作助手");
    expect(container.querySelector<HTMLInputElement>('#assistant-name')?.value).toBe("写作助手");
    expect(container.querySelector<HTMLTextAreaElement>('#session-system')?.value).toBe("Only B");
    await fill("#session-system", "关闭也不保存");
    await click("关闭");
    expect((await repo.initializeWorkspace(null, ["model-a", "model-b"])).assistants.find((item) => item.id === "writer")?.defaultConfig.systemInstruction).toBe("Only B");
    await click("新建助手");
    await fill("#assistant-name", "取消创建");
    await click("取消");
    expect((await repo.initializeWorkspace(null, ["model-a", "model-b"])).assistants).toHaveLength(2);
  });

  it("preserves conversation settings when editing or deleting its assistant", async () => {
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
    expect(container.querySelector(".chat-model-trigger")?.textContent).toContain("upstream-b");
    expect(selectedConversation(state)?.settings?.config.systemInstruction).toBe("Only B");
    expect((await repo.load("b"))?.messages).toEqual([]);
  });

  it("creates, renames and permanently deletes a conversation through explicit UI actions", async () => {
    if (!container.querySelector('[aria-label="助手列表"]')) await click("助手与对话");
    await click("默认助手");
    await click("新建对话");
    await wait(() => container.querySelector(".workspace-conversation-title")?.textContent?.startsWith("新对话") === true);
    await wait(() => container.querySelector<HTMLButtonElement>('[aria-label="默认助手"]')?.disabled === false);
    expect(container.querySelector(".conversation-cascade-pane:not([inert])")).not.toBeNull();
    await wait(() => !container.querySelector<HTMLButtonElement>('[aria-label="编辑对话 新对话"]')?.disabled);
    await click("编辑对话 新对话"); await fill("#conversation-title", "新建验收"); await click("保存对话");
    await wait(() => container.querySelector(".workspace-conversation-title")?.textContent?.startsWith("新建验收") === true);
    await click("删除对话 新建验收"); await click("取消");
    expect(container.querySelector(".workspace-conversation-title")?.textContent).toContain("新建验收");
    await click("删除对话 新建验收");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await click("确认删除对话 新建验收");
    await wait(() => container.querySelector(".workspace-conversation-title")?.textContent?.startsWith("对话 A") === true);
  });

  it("cancels inline deletion on Escape, outside click, focus departure and panel closure without deleting", async () => {
    await click("默认助手");
    const pending = () => container.querySelector('[aria-label="确认删除对话 对话 A"]');
    await click("删除对话 对话 A");
    await act(async () => pending()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(pending()).toBeNull();
    expect(container.querySelector('.conversation-cascade-pane:not([inert])')).not.toBeNull();
    await click("删除对话 对话 A");
    await act(async () => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(pending()).toBeNull();
    await click("删除对话 对话 A");
    await act(async () => { (pending() as HTMLButtonElement).focus(); container.querySelector<HTMLTextAreaElement>('.composer-input')!.focus(); });
    expect(pending()).toBeNull();
    await click("删除对话 对话 A");
    await click("收起对话栏");
    await click("默认助手");
    expect(pending()).toBeNull();
    expect((await repo.initializeWorkspace(null, ["model-a", "model-b"])).conversations.some((item) => item.id === "current")).toBe(true);
  });

  it("requires two clicks even with Ctrl and keeps the same button for rapid confirmation", async () => {
    await click("默认助手");
    const button = container.querySelector<HTMLButtonElement>('[aria-label="删除对话 对话 A"]')!;
    await act(async () => button.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true })));
    expect(button.getAttribute("aria-label")).toBe("确认删除对话 对话 A");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect((await repo.initializeWorkspace(null, ["model-a", "model-b"])).conversations.some((item) => item.id === "current")).toBe(true);
    await act(async () => button.click());
    await wait(() => !container.querySelector('[aria-label="删除对话 对话 A"]') && !container.querySelector('[aria-label="确认删除对话 对话 A"]'));
    expect((await repo.initializeWorkspace(null, ["model-a", "model-b"])).conversations.some((item) => item.id === "current")).toBe(false);
  });

  it("only marks a conversation title manual when its field was edited", async () => {
    await click("默认助手"); await click("新建对话");
    await wait(() => !!container.querySelector('[aria-label="编辑对话 新对话"]'));
    await click("编辑对话 新对话");
    await fill("#session-system", "Only change the persona");
    await click("保存对话"); await wait(() => !container.querySelector('[role="dialog"]'));
    const state = await repo.initializeWorkspace(null, ["model-a", "model-b"]);
    const id = state.selection.lastSelected.default!;
    expect(state.conversations.find((item) => item.id === id)?.titleNaming).toBeUndefined();
    await click("编辑对话 新对话");
    await fill("#conversation-title", "自定"); await fill("#conversation-title", "新对话");
    await click("保存对话"); await wait(() => !container.querySelector('[role="dialog"]'));
    expect((await repo.initializeWorkspace(null, ["model-a", "model-b"])).conversations.find((item) => item.id === id)?.titleNaming).toBe("manual");
  });

  it("keeps existing conversations independent of later assistant edits", async () => {
    const observed: ChatRequest[] = [];
    runtime.createRuntimeChatTransport.mockResolvedValue({ async *stream(request: ChatRequest) {
      if (request.config?.stream !== false) observed.push(request);
      yield { type: "completed" };
    } } satisfies ChatTransport);
    await click("默认助手");
    await click("新建对话");
    await wait(() => container.querySelector<HTMLButtonElement>('[aria-label="管理助手 默认助手"]')?.disabled === false);
    expect(container.textContent).not.toContain("会话配置");
    const row = container.querySelector('.conversation-leaf')!;
    expect(row.querySelectorAll('.conversation-row-actions button')).toHaveLength(2);
    expect(row.querySelectorAll('.conversation-row-actions button svg')).toHaveLength(2);
    await click("编辑助手 默认助手");
    await fill("#session-system", "Shared instruction");
    await chooseModel("#assistant-model", "model-b");
    await click("保存助手"); await wait(() => !container.querySelector('[role="dialog"]'));
    for (const title of ["对话 A", "新对话"]) {
      await click(title); await wait(() => container.querySelector<HTMLTextAreaElement>('.composer-input')?.disabled === false);
      await fill('.composer-input', title); await click("发送");
      await wait(() => container.querySelector('[aria-label="发送"]') !== null);
    }
    expect(observed).toHaveLength(2);
    for (const request of observed) {
      expect(request.model).toBe("upstream-a");
      expect(request.config?.systemInstruction).toBe("");
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

  it("freezes the running conversation model and settings but uses edits on the next request", async () => {
    const observed: ChatRequest[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    runtime.createRuntimeChatTransport.mockResolvedValue({ async *stream(request: ChatRequest) {
      observed.push(request); yield { type: "text-delta", text: "Partial" };
      await gate; yield { type: "completed" };
    } } satisfies ChatTransport);
    await fill('.composer-input', 'First'); await click('发送');
    await wait(() => observed.length === 1);
    await click('编辑对话 对话 A');
    await fill('#session-system', 'New shared instruction');
    await chooseModel("#conversation-model", 'model-b');
    await click('保存对话'); await wait(() => !container.querySelector('[role="dialog"]'));
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
