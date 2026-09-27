// @vitest-environment happy-dom

import "fake-indexeddb/auto";
import Dexie from "dexie";

import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import App from "./App";
import * as contextBudget from "./chat/contextBudget";
import { createChatRepository, type ChatSnapshot } from "./chat/repository";
import { defaultSessionConfig } from "./chat/sessionConfig";
import {
  loadConnectionSettings,
  saveConnectionSettings,
  type ConnectionSettingsState,
} from "./chat/settings";
import type { ChatRequest, ChatTransport } from "./chat/types";

const runtimeMocks = vi.hoisted(() => ({
  createRuntimeChatTransport: vi.fn(),
  createRuntimeModelCatalogClient: vi.fn(),
}));

vi.mock("./chat/runtime", () => runtimeMocks);

describe("App navigation", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.clear();
    await createChatRepository().load("current");
    const database = new Dexie("AyaseStudio");
    await database.open();
    await Promise.all(database.tables.map((table) => table.clear()));
    database.close();
    runtimeMocks.createRuntimeChatTransport.mockReset();
    runtimeMocks.createRuntimeModelCatalogClient.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  async function renderApp(): Promise<void> {
    await act(async () => {
      root.render(<App />);
    });
    await waitFor(
      () =>
        container.querySelector<HTMLTextAreaElement>("textarea")?.disabled ===
        false,
    );
  }

  function getButton(label: string): HTMLButtonElement {
    const button = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    );
    expect(button).toBeInstanceOf(HTMLButtonElement);
    return button as HTMLButtonElement;
  }

  async function setDraft(value: string): Promise<void> {
    const draft = container.querySelector<HTMLTextAreaElement>("textarea");
    expect(draft).toBeInstanceOf(HTMLTextAreaElement);

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(draft, value);
      draft?.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function setBaseUrl(value: string): Promise<void> {
    const field = container.querySelector<HTMLInputElement>("#base-url");
    expect(field).toBeInstanceOf(HTMLInputElement);
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(field, value);
      field?.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function clickButton(label: string): Promise<void> {
    await act(async () => {
      getButton(label).click();
    });
  }

  async function openConnectionMenu(name: string): Promise<void> {
    await act(async () => {
      container.querySelector<HTMLElement>(`summary[aria-label="管理连接 ${name}"]`)!.click();
    });
  }

  it("reorders only provider groups through drag and menu actions, retaining the selected connection", async () => {
    saveConnectionSettings({
      version: 3, activeModelId: "model-a",
      providers: ["a", "b", "c"].map((id) => ({
        id, name: id.toUpperCase(), connections: [{
          id: `connection-${id}`, name: `线路 ${id}`, protocol: "openai-chat",
          baseUrl: "https://example.com/v1", apiKey: "",
          models: [{ id: `model-${id}`, modelId: `upstream-${id}` }],
        }],
      })),
    });
    await renderApp();
    await clickButton("设置");
    const handle = getButton("拖动排序 C");
    const target = getButton("A").closest(".connection-tree-group")!;
    const transfer = new DataTransfer();
    Object.assign(transfer, { setDragImage: vi.fn() });
    const dragStart = new Event("dragstart", { bubbles: true });
    Object.assign(dragStart, { dataTransfer: transfer });
    const drop = new Event("drop", { bubbles: true });
    Object.assign(drop, { dataTransfer: transfer, clientY: -1 });
    await act(async () => handle.dispatchEvent(dragStart));
    await act(async () => target.dispatchEvent(drop));
    expect(loadConnectionSettings().providers.map((item) => item.id)).toEqual(["c", "a", "b"]);
    expect(getButton("查看连接 线路 a").getAttribute("aria-current")).toBe("true");
    await act(async () => container.querySelector<HTMLElement>('summary[aria-label="管理供应商 C"]')!.click());
    expect(getButton("上移供应商 C").disabled).toBe(true);
    expect(container.querySelector('[role="menu"]')?.classList.contains("assistant-menu")).toBe(true);
    await clickButton("下移供应商 C");
    expect(loadConnectionSettings().providers.map((item) => item.id)).toEqual(["a", "c", "b"]);
    expect(getButton("查看连接 线路 a").getAttribute("aria-current")).toBe("true");
    expect(loadConnectionSettings().activeModelId).toBe("model-a");
  });

  async function clickButtonWithText(text: string): Promise<void> {
    if (text === "编辑助手") {
      if (!container.querySelector('#assistant-navigation:not([inert])')) await clickButtonWithText("助手与对话");
      await clickButton("管理助手 默认助手");
      const assistant = document.querySelector<HTMLButtonElement>('[aria-label="编辑助手 默认助手"]');
      await act(async () => assistant!.click());
      return;
    }
    if (text === "编辑对话") {
      if (!container.querySelector('#assistant-navigation:not([inert])')) await clickButtonWithText("助手与对话");
      await waitFor(() => container.querySelector<HTMLButtonElement>('[aria-label="默认助手"]')?.disabled === false);
      if (!container.querySelector('.conversation-cascade-pane:not([inert])')) await clickButton("默认助手");
      const editor = container.querySelector<HTMLButtonElement>('.conversation-leaf:has([aria-pressed="true"]) [aria-label^="编辑对话 "]')!;
      await act(async () => editor.click());
      return;
    }
    const button = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((candidate) => candidate.textContent?.trim() === text);
    expect(button).toBeInstanceOf(HTMLButtonElement);
    await act(async () => button?.click());
  }

  async function waitFor(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (predicate()) {
        return;
      }
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(predicate()).toBe(true);
  }

  async function waitForSaved(predicate: (snapshot: ChatSnapshot | undefined) => boolean): Promise<ChatSnapshot | undefined> {
    const repository = createChatRepository();
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const snapshot = await repository.load("current");
      if (predicate(snapshot)) return snapshot;
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    }
    const snapshot = await repository.load("current");
    expect(predicate(snapshot)).toBe(true);
    return snapshot;
  }

  function configureChatTarget(protocol: "openai-chat" | "gemini-native" = "openai-chat") {
    saveConnectionSettings({
      version: 3,
      providers: [{ id: "provider", name: "Synthetic", connections: [{
        id: "connection", name: "Local", protocol,
        baseUrl: "https://relay.example.com", apiKey: "synthetic-key",
        models: [{ id: "configured-model", modelId: "test-model" }],
      }] }],
      activeModelId: "configured-model",
    });
  }

  async function setPanelText(selector: string, value: string): Promise<void> {
    const element = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
    expect(element).not.toBeNull();
    await act(async () => {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
      element?.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("saves conversation configuration explicitly and retains it after clear and remount", async () => {
    configureChatTarget();
    await renderApp();
    await clickButtonWithText("编辑对话");
    await setPanelText("#session-system", "Stay concise.");
    await clickButtonWithText("高级 JSON");
    await setPanelText("#session-custom-json", '{"seed":7}');
    await act(async () => container.querySelector<HTMLInputElement>("#session-stream")?.click());
    await waitFor(() => container.querySelector<HTMLInputElement>("#session-stream")?.checked === false);
    await clickButtonWithText("保存对话");
    await waitFor(() => !container.querySelector('[role="dialog"]'));
    await clickButtonWithText("清空");
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("清空当前对话？");
    await clickButtonWithText("取消");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await clickButtonWithText("清空");
    await clickButtonWithText("确认清空");
    await waitFor(() => container.querySelector(".message-bubble") === null);
    await act(async () => root.unmount());
    root = createRoot(container);
    await renderApp();
    await clickButtonWithText("编辑对话");
    expect(container.querySelector<HTMLTextAreaElement>("#session-system")?.value).toBe("Stay concise.");
    await clickButtonWithText("高级 JSON");
    expect(container.querySelector<HTMLTextAreaElement>("#session-custom-json")?.value).toBe('{"seed":7}');
    expect(container.querySelector<HTMLInputElement>("#session-stream")?.checked).toBe(false);
    const snapshot = await createChatRepository().load("current");
    expect(snapshot?.messages).toEqual([]);
  });

  it("blocks invalid settings before clearing draft, then saves a completed non-streaming reply", async () => {
    configureChatTarget();
    let observed: ChatRequest | undefined;
    runtimeMocks.createRuntimeChatTransport.mockResolvedValue({
      async *stream(request: ChatRequest) {
        if (request.config?.systemInstruction?.includes("对话标题")) {
          yield { type: "completed" };
          return;
        }
        observed = request;
        yield { type: "text-delta", text: "Complete answer" };
        yield { type: "completed" };
      },
    } satisfies ChatTransport);
    await renderApp();
    await setDraft("Keep draft");
    await clickButtonWithText("编辑对话");
    await act(async () => {
      const select = container.querySelector<HTMLSelectElement>("#config-temperature");
      if (select) select.value = "custom";
      select?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await setPanelText('input[aria-label="Temperature 自定义值"]', "bad");
    const save = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === "保存对话");
    expect(save?.disabled).toBe(false);
    await clickButtonWithText("保存对话");
    await waitFor(() => !container.querySelector('[role="dialog"]'));
    await clickButton("发送");
    await clickButtonWithText("编辑对话");
    expect(container.querySelector<HTMLTextAreaElement>(".composer-input")?.value).toBe("Keep draft");
    expect(runtimeMocks.createRuntimeChatTransport).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Temperature");
    await setPanelText('input[aria-label="Temperature 自定义值"]', "0.7");
    await act(async () => container.querySelector<HTMLInputElement>("#session-stream")?.click());
    await clickButtonWithText("保存对话");
    await waitFor(() => !container.querySelector('[role="dialog"]'));
    await clickButton("发送");
    await waitFor(() => observed !== undefined);
    await waitFor(() => container.textContent?.includes("Complete answer") === true);
    expect(observed?.config?.stream).toBe(false);
    expect(observed?.config?.temperature).toEqual({ mode: "custom", value: "0.7" });
    await waitFor(() => container.querySelector<HTMLTextAreaElement>(".composer-input")?.value === "");
    const snapshot = await waitForSaved((candidate) => candidate?.messages[1]?.status === "complete");
    expect(snapshot?.messages.map((message) => message.status)).toEqual(["complete", "complete"]);
    expect(snapshot?.messages[1]?.content).toBe("Complete answer");
  });

  it("freezes request settings while preserving edits made during generation", async () => {
    configureChatTarget();
    let observed: ChatRequest | undefined;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    runtimeMocks.createRuntimeChatTransport.mockResolvedValue({
      async *stream(request: ChatRequest) {
        if (request.config?.systemInstruction?.includes("对话标题")) {
          yield { type: "completed" };
          return;
        }
        observed = request;
        yield { type: "text-delta", text: "partial" };
        await gate;
        yield { type: "completed" };
      },
    } satisfies ChatTransport);
    await renderApp();
    await setDraft("Freeze settings");
    await clickButton("发送");
    await waitFor(() => observed !== undefined);
    await clickButtonWithText("编辑对话");
    await act(async () => container.querySelector<HTMLInputElement>("#session-stream")?.click());
    expect(observed?.config?.stream).toBe(true);
    await clickButtonWithText("保存对话");
    await waitFor(() => !container.querySelector('[role="dialog"]'));
    release();
    await waitFor(() => container.textContent?.includes("partial") === true);
    await waitFor(() => container.querySelector<HTMLTextAreaElement>(".composer-input")?.disabled === false);
    const snapshot = await waitForSaved((candidate) => candidate?.messages[1]?.status === "complete");
    const workspace = await createChatRepository().initializeWorkspace(null, ["configured-model"]);
    expect(workspace.conversations.find((item) => item.id === "current")?.settings?.config.stream).toBe(false);
    expect(observed?.config?.stream).toBe(true);
    expect(snapshot?.messages[1]?.status).toBe("complete");
  });

  it("keeps clear unavailable while a slow context calculation is pending", async () => {
    configureChatTarget();
    await createChatRepository().save({
      id: "current", updatedAt: 1, generationConfig: defaultSessionConfig(),
      messages: [
        { id: "old-user", role: "user", content: "Old question", status: "complete" },
        { id: "old-assistant", role: "assistant", content: "Old answer", status: "complete" },
      ],
    });
    const actualPlan = contextBudget.planContextBudget;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(contextBudget, "planContextBudget").mockImplementation(async (...args) => {
      await gate;
      return actualPlan(...args);
    });
    let observed: ChatRequest | undefined;
    runtimeMocks.createRuntimeChatTransport.mockResolvedValue({
      async *stream(request: ChatRequest) {
        observed = request;
        yield { type: "text-delta", text: "New answer" };
        yield { type: "completed", finishReason: "stop" };
      },
    } satisfies ChatTransport);
    await renderApp();
    await setDraft("New question");
    await clickButton("发送");
    const clear = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "清空");
    expect(clear?.disabled).toBe(true);
    await act(async () => clear?.click());
    expect(container.textContent).toContain("Old question");
    release();
    await waitFor(() => observed !== undefined);
    const snapshot = await waitForSaved((candidate) => candidate?.messages[3]?.status === "complete");
    expect(snapshot?.messages.map((message) => message.content)).toEqual([
      "Old question", "Old answer", "New question", "New answer",
    ]);
  });

  it("stores an incomplete reply without sending that round as future context", async () => {
    configureChatTarget();
    const observed: ChatRequest[] = [];
    runtimeMocks.createRuntimeChatTransport.mockResolvedValue({
      async *stream(request: ChatRequest) {
        if (request.config?.systemInstruction?.includes("对话标题")) {
          yield { type: "completed" };
          return;
        }
        observed.push(request);
        yield { type: "text-delta", text: observed.length === 1 ? "Cut short" : "Next answer" };
        yield { type: "completed", finishReason: observed.length === 1 ? "length" : "stop" };
      },
    } satisfies ChatTransport);
    await renderApp();
    await setDraft("First question");
    await clickButton("发送");
    await waitForSaved((candidate) => candidate?.messages[1]?.status === "incomplete");
    expect(container.textContent).toContain("回复未完整");
    await waitFor(() => container.querySelector<HTMLTextAreaElement>(".composer-input")?.disabled === false);
    await setDraft("Second question");
    await clickButton("发送");
    await waitFor(() => observed.length === 2);
    expect(observed[1].messages).toEqual([{ role: "user", content: "Second question" }]);
    const snapshot = await waitForSaved((candidate) => candidate?.messages[3]?.status === "complete");
    expect(snapshot?.messages[1]).toMatchObject({ content: "Cut short", status: "incomplete" });
  });

  it("shows Gemini's non-streaming URL in settings when the session disables streaming", async () => {
    configureChatTarget("gemini-native");
    await renderApp();
    await clickButtonWithText("编辑助手");
    await act(async () => container.querySelector<HTMLInputElement>("#session-stream")?.click());
    await clickButtonWithText("保存助手");
    await waitFor(() => !container.querySelector('[role="dialog"]'));
    await clickButton("设置");
    expect(container.querySelector(".endpoint-preview")?.textContent).toContain(
      "https://relay.example.com/v1beta/models/test-model:generateContent",
    );
    expect(container.querySelector(".endpoint-preview")?.textContent).not.toContain("streamGenerateContent");
  });

  it("keeps the draft and switches between independent settings categories", async () => {
    await renderApp();
    await setDraft("状态保留检查");

    await clickButton("设置");
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).toContain("连接配置");
    expect(container.textContent).toContain("添加供应商");

    await clickButton("外观");
    expect(container.textContent).toContain("主题模式");
    expect(container.textContent).not.toContain("添加供应商");

    await clickButton("聊天");
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      "状态保留检查",
    );
  });

  it("redirects missing configuration to connections and retains the error", async () => {
    await renderApp();
    await setDraft("需要配置");
    await clickButton("发送");

    expect(getButton("设置").getAttribute("aria-current")).toBe("page");
    expect(getButton("连接配置").getAttribute("aria-current")).toBe("page");

    await clickButton("聊天");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "当前会话的模型未选择或已失效，请通过对话行的编辑按钮选择模型或恢复助手默认值。",
    );
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      "需要配置",
    );
  });

  it("keeps one active stream alive and stoppable across page navigation", async () => {
    saveConnectionSettings({
      version: 3,
      providers: [
        {
          id: "provider-openai",
          name: "OpenAI Test",
          connections: [
            {
              id: "connection-chat",
              name: "OpenAI 主线路",
              protocol: "openai-chat",
              baseUrl: "https://relay.example.com/v1",
              apiKey: "synthetic-test-key",
              models: [{ id: "model-chat", modelId: "test-model" }],
            },
          ],
        },
      ],
      activeModelId: "model-chat",
    });

    let observedRequest: ChatRequest | undefined;
    let releaseStream: () => void = () => undefined;
    let streamCalls = 0;
    const streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    const transport: ChatTransport = {
      async *stream(request) {
        streamCalls += 1;
        observedRequest = request;
        yield { type: "text-delta", text: "部分回复" };
        await Promise.race([
          streamGate,
          new Promise<void>((resolve) =>
            request.signal?.addEventListener("abort", () => resolve(), {
              once: true,
            }),
          ),
        ]);
        if (request.signal?.aborted) {
          yield { type: "aborted" };
          return;
        }
        yield { type: "completed" };
      },
    };
    runtimeMocks.createRuntimeChatTransport.mockResolvedValue(transport);

    await renderApp();
    await setDraft("流式状态检查");
    await clickButton("发送");
    await waitFor(() => container.textContent?.includes("部分回复") === true);

    expect(getButton("停止生成")).toBeInstanceOf(HTMLButtonElement);
    expect(streamCalls).toBe(1);
    expect(observedRequest?.signal?.aborted).toBe(false);

    await clickButton("设置");
    expect(observedRequest?.signal?.aborted).toBe(false);
    expect(streamCalls).toBe(1);

    await clickButton("聊天");
    expect(container.textContent).toContain("流式状态检查");
    expect(container.textContent).toContain("部分回复");
    expect(getButton("停止生成")).toBeInstanceOf(HTMLButtonElement);
    expect(streamCalls).toBe(1);

    await clickButton("停止生成");
    await waitFor(() => container.textContent?.includes("已停止") === true);
    expect(observedRequest?.signal?.aborted).toBe(true);
    releaseStream();
  });

  it("switches the complete active model atomically and restores it after remount", async () => {
    const settings: ConnectionSettingsState = {
      version: 3,
      providers: [
        {
          id: "provider-openai",
          name: "OpenAI Test",
          connections: [
            {
              id: "connection-chat",
              name: "OpenAI 主线路",
              protocol: "openai-chat",
              baseUrl: "https://openai.example.com/v1",
              apiKey: "synthetic-openai-key",
              models: [{ id: "model-openai", modelId: "openai-model" }],
            },
          ],
        },
        {
          id: "provider-gemini",
          name: "Gemini Test",
          connections: [
            {
              id: "connection-gemini",
              name: "Gemini 专线",
              protocol: "gemini-native",
              baseUrl: "https://gemini.example.com",
              apiKey: "synthetic-gemini-key",
              models: [{ id: "model-gemini", modelId: "gemini-model" }],
            },
          ],
        },
      ],
      activeModelId: "model-openai",
    };
    saveConnectionSettings(settings);

    let observedRequest: ChatRequest | undefined;
    const transport: ChatTransport = {
      async *stream(request) {
        observedRequest = request;
        yield { type: "completed" };
      },
    };
    runtimeMocks.createRuntimeChatTransport.mockResolvedValue(transport);

    await renderApp();
    await clickButton("设置");
    await clickButton("查看连接 Gemini 专线");
    await clickButton("设为助手默认模型 gemini-model");
    await clickButton("聊天");
    expect(container.querySelector('[aria-label="切换模型"]')?.getAttribute("title")).toBe("OpenAI Test · OpenAI 主线路 · openai-model");
    await clickButtonWithText("编辑对话");
    await clickButtonWithText("恢复助手默认值");
    await clickButtonWithText("保存对话");
    await waitFor(() => container.querySelector('[aria-label="切换模型"]')?.textContent === "gemini-model");

    expect(container.querySelector('[aria-label="切换模型"]')?.getAttribute("title")).toBe(
      "Gemini Test · Gemini 专线 · gemini-model",
    );
    await setDraft("原子切换检查");
    await clickButton("发送");
    await waitFor(() => observedRequest !== undefined);

    expect(runtimeMocks.createRuntimeChatTransport).toHaveBeenCalledWith(
      "gemini-native",
    );
    expect(observedRequest).toMatchObject({
      baseUrl: "https://gemini.example.com",
      apiKey: "synthetic-gemini-key",
      model: "gemini-model",
      messages: [{ role: "user", content: "原子切换检查" }],
    });

    await act(async () => {
      root.unmount();
    });
    root = createRoot(container);
    await renderApp();
    expect(container.querySelector('[aria-label="切换模型"]')?.getAttribute("title")).toBe(
      "Gemini Test · Gemini 专线 · gemini-model",
    );
  });

  it("shows each connection's own models without changing the active model", async () => {
    saveConnectionSettings({
      version: 3,
      providers: [
        {
          id: "provider-relay",
          name: "中转站 A",
          connections: [
            {
              id: "connection-one",
              name: "连接 1",
              protocol: "openai-chat",
              baseUrl: "https://one.example.com/v1",
              apiKey: "synthetic-one-key",
              models: [
                { id: "model-a", modelId: "model-a" },
                { id: "model-b", modelId: "model-b" },
              ],
            },
            {
              id: "connection-two",
              name: "连接 2",
              protocol: "openai-chat",
              baseUrl: "https://two.example.com/v1",
              apiKey: "synthetic-two-key",
              models: [
                { id: "model-d", modelId: "model-d" },
                { id: "model-e", modelId: "model-e" },
              ],
            },
          ],
        },
      ],
      activeModelId: "model-a",
    });

    await renderApp();
    await clickButton("设置");
    expect(container.textContent).toContain("model-a");
    expect(container.textContent).not.toContain("model-d");

    await clickButton("查看连接 连接 2");
    expect(container.querySelector('[aria-label="模型列表"]')?.textContent).toContain("model-d");
    expect(container.querySelector('[aria-label="模型列表"]')?.textContent).not.toContain("model-a");

    const settingsBefore = loadConnectionSettings();
    await clickButton("收起供应商 中转站 A");
    expect(container.querySelector<HTMLElement>(".connection-tree-children")?.hidden).toBe(true);
    expect(container.querySelector<HTMLInputElement>("#base-url")?.value).toBe("https://two.example.com/v1");
    const interfaceSection = container.querySelector<HTMLDetailsElement>(".connection-interface")!;
    await act(async () => { interfaceSection.open = false; });
    expect(container.querySelector('[aria-label="模型管理"]')?.closest(".connection-interface")).toBeNull();
    expect(container.querySelector('[aria-label="模型列表"]')?.textContent).toContain("model-d");
    expect(loadConnectionSettings()).toEqual(settingsBefore);
    await clickButton("展开供应商 中转站 A");
    await openConnectionMenu("连接 1");
    await clickButtonWithText("重命名");
    const rename = container.querySelector<HTMLInputElement>(".connection-entity-menu input")!;
    expect(rename).toBeInstanceOf(HTMLInputElement);
    expect(document.activeElement).toBe(rename);
    await act(async () => {
      rename.value = "备用线路";
      rename.blur();
    });
    await clickButtonWithText("完成");
    expect(loadConnectionSettings().providers[0]?.connections[0]?.name).toBe("备用线路");
    expect(getButton("查看连接 连接 2").getAttribute("aria-current")).toBe("true");
    await clickButton("编辑模型 model-d");
    const draft = container.querySelector<HTMLInputElement>('.model-edit-form input[name="modelId"]')!;
    draft.value = "unsaved-model";
    const confirmSwitch = vi.fn(() => false);
    Object.assign(window, { confirm: confirmSwitch });
    await clickButton("查看连接 备用线路");
    expect(confirmSwitch).toHaveBeenCalled();
    expect(container.querySelector<HTMLInputElement>('.model-edit-form input[name="modelId"]')?.value).toBe("unsaved-model");
    expect(getButton("查看连接 连接 2").getAttribute("aria-current")).toBe("true");

    await clickButton("聊天");
    expect(container.querySelector('[aria-label="切换模型"]')?.getAttribute("title")).toBe("中转站 A · 备用线路 · model-a");
  });

  it("fetches a per-connection model catalog and adds an explicit selection", async () => {
    saveConnectionSettings({
      version: 3,
      providers: [
        {
          id: "provider-relay",
          name: "中转站 A",
          connections: [
            {
              id: "connection-one",
              name: "连接 1",
              protocol: "openai-responses",
              baseUrl: "https://relay.example.com/v1",
              apiKey: "synthetic-key",
              models: [],
            },
          ],
        },
      ],
      activeModelId: null,
    });
    const list = vi
      .fn()
      .mockResolvedValueOnce([
        { id: "gpt-new", displayName: "GPT New", family: "GPT" },
      ])
      .mockResolvedValueOnce([]);
    runtimeMocks.createRuntimeModelCatalogClient.mockResolvedValue({ list });

    await renderApp();
    await clickButton("设置");
    await clickButtonWithText("获取模型列表");
    await waitFor(() => container.textContent?.includes("gpt-new") === true);

    expect(runtimeMocks.createRuntimeModelCatalogClient).toHaveBeenCalledWith(
      "openai-responses",
    );
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://relay.example.com/v1",
        apiKey: "synthetic-key",
      }),
    );

    await clickButtonWithText("刷新");
    await waitFor(() => list.mock.calls.length === 2);
    expect(getButton("添加模型 gpt-new")).toBeInstanceOf(HTMLButtonElement);

    await clickButton("添加模型 gpt-new");
    expect(getButton("已添加 gpt-new").disabled).toBe(true);
    await clickButton("关闭模型目录");
    expect(container.textContent).toContain("GPT New");
  });

  it("does not let an obsolete catalog cancellation overwrite a newer refresh", async () => {
    saveConnectionSettings({
      version: 3,
      providers: [
        {
          id: "provider-relay",
          name: "中转站 A",
          connections: [
            {
              id: "connection-one",
              name: "连接 1",
              protocol: "openai-chat",
              baseUrl: "https://relay.example.com/v1",
              apiKey: "synthetic-key",
              models: [],
            },
          ],
        },
      ],
      activeModelId: null,
    });
    let resolveSecond: ((models: { id: string }[]) => void) | undefined;
    const list = vi
      .fn()
      .mockImplementationOnce(
        ({ signal }: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) =>
            signal?.addEventListener(
              "abort",
              () => reject(new DOMException("cancelled", "AbortError")),
              { once: true },
            ),
          ),
      )
      .mockImplementationOnce(
        () =>
          new Promise<{ id: string }[]>((resolve) => {
            resolveSecond = resolve;
          }),
      );
    runtimeMocks.createRuntimeModelCatalogClient.mockResolvedValue({ list });

    await renderApp();
    await clickButton("设置");
    await clickButtonWithText("获取模型列表");
    await waitFor(() => list.mock.calls.length === 1);
    await clickButton("关闭模型目录");
    await clickButtonWithText("获取模型列表");
    await waitFor(() => list.mock.calls.length === 2);
    await act(async () => Promise.resolve());

    expect(container.textContent).toContain("正在获取模型列表");
    await act(async () => resolveSecond?.([{ id: "new-result" }]));
    await waitFor(() => container.textContent?.includes("new-result") === true);
  });

  it("does not restore a cancelled test result after its connection changes", async () => {
    saveConnectionSettings({
      version: 3,
      providers: [
        {
          id: "provider-relay",
          name: "中转站 A",
          connections: [
            {
              id: "connection-one",
              name: "连接 1",
              protocol: "openai-chat",
              baseUrl: "https://relay.example.com/v1",
              apiKey: "synthetic-key",
              models: [{ id: "model-one", modelId: "test-model" }],
            },
          ],
        },
      ],
      activeModelId: "model-one",
    });
    Object.assign(window, { confirm: vi.fn(() => true) });
    let observedRequest: ChatRequest | undefined;
    const transport: ChatTransport = {
      async *stream(request) {
        observedRequest = request;
        await new Promise<void>((resolve) =>
          request.signal?.addEventListener("abort", () => resolve(), {
            once: true,
          }),
        );
        yield { type: "aborted" };
      },
    };
    runtimeMocks.createRuntimeChatTransport.mockResolvedValue(transport);

    await renderApp();
    await clickButton("设置");
    await clickButton("测试模型 test-model");
    await waitFor(() => observedRequest !== undefined);

    const baseUrl = container.querySelector<HTMLInputElement>("#base-url");
    expect(baseUrl).toBeInstanceOf(HTMLInputElement);
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(baseUrl, "https://changed.example.com/v1");
      baseUrl?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await waitFor(() => observedRequest?.signal?.aborted === true);
    await act(async () => Promise.resolve());

    expect(container.textContent).not.toContain("测试已取消");
    expect(getButton("测试模型 test-model")).toBeInstanceOf(HTMLButtonElement);
  });

  it("keeps at most one explicit model test running", async () => {
    saveConnectionSettings({
      version: 3,
      providers: [
        {
          id: "provider-relay",
          name: "中转站 A",
          connections: [
            {
              id: "connection-one",
              name: "连接 1",
              protocol: "openai-chat",
              baseUrl: "https://relay.example.com/v1",
              apiKey: "synthetic-key",
              models: [
                { id: "model-one", modelId: "model-one" },
                { id: "model-two", modelId: "model-two" },
              ],
            },
          ],
        },
      ],
      activeModelId: "model-one",
    });
    Object.assign(window, { confirm: vi.fn(() => true) });
    const observedRequests: ChatRequest[] = [];
    const transport: ChatTransport = {
      async *stream(request) {
        observedRequests.push(request);
        await new Promise<void>((resolve) =>
          request.signal?.addEventListener("abort", () => resolve(), {
            once: true,
          }),
        );
        yield { type: "aborted" };
      },
    };
    runtimeMocks.createRuntimeChatTransport.mockResolvedValue(transport);

    await renderApp();
    await clickButton("设置");
    await clickButton("测试模型 model-one");
    await waitFor(() => observedRequests.length === 1);
    await clickButton("测试模型 model-two");
    await waitFor(() => observedRequests.length === 2);

    expect(observedRequests[0]?.signal?.aborted).toBe(true);
    expect(getButton("测试模型 model-one")).toBeInstanceOf(HTMLButtonElement);
    expect(getButton("取消测试 model-two")).toBeInstanceOf(HTMLButtonElement);
    await clickButton("取消测试 model-two");
  });

  it("keeps unsaved model edits in place when the user cancels navigation", async () => {
    saveConnectionSettings({
      version: 3,
      providers: [
        {
          id: "provider-relay",
          name: "中转站 A",
          connections: [
            {
              id: "connection-one",
              name: "连接 1",
              protocol: "openai-chat",
              baseUrl: "https://relay.example.com/v1",
              apiKey: "synthetic-key",
              models: [
                { id: "model-one", modelId: "model-one" },
                { id: "model-two", modelId: "model-two" },
              ],
            },
          ],
        },
      ],
      activeModelId: "model-one",
    });
    const confirm = vi.fn(() => false);
    Object.assign(window, { confirm });

    await renderApp();
    await clickButton("设置");
    await clickButton("编辑模型 model-one");
    const editedId = container.querySelector<HTMLInputElement>(
      '.model-edit-form input[name="modelId"]',
    );
    expect(editedId).toBeInstanceOf(HTMLInputElement);
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(editedId, "unsaved-model-one");
      editedId?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await clickButton("编辑模型 model-two");

    expect(confirm).toHaveBeenCalledWith(
      "当前模型编辑尚未保存。切换后将放弃这些修改，是否继续？",
    );
    expect(
      container.querySelector<HTMLInputElement>(
        '.model-edit-form input[name="modelId"]',
      )?.value,
    ).toBe("unsaved-model-one");
  });

  it("moves keyboard focus to the adjacent connection after deletion", async () => {
    saveConnectionSettings({
      version: 3,
      providers: [
        {
          id: "provider-relay",
          name: "中转站 A",
          connections: [
            {
              id: "connection-one",
              name: "连接 1",
              protocol: "openai-chat",
              baseUrl: "https://one.example.com/v1",
              apiKey: "synthetic-one-key",
              models: [{ id: "model-one", modelId: "model-one" }],
            },
            {
              id: "connection-two",
              name: "连接 2",
              protocol: "openai-chat",
              baseUrl: "https://two.example.com/v1",
              apiKey: "synthetic-two-key",
              models: [{ id: "model-two", modelId: "model-two" }],
            },
          ],
        },
      ],
      activeModelId: "model-one",
    });
    Object.assign(window, { confirm: vi.fn(() => true) });

    await renderApp();
    await clickButton("设置");
    await openConnectionMenu("连接 1");
    await clickButton("删除连接 连接 1");
    await waitFor(
      () => document.activeElement?.getAttribute("aria-label") === "查看连接 连接 2",
    );

    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "查看连接 连接 2",
    );
  });

  it("keeps an invalid conversation model reference instead of silently falling back after deleting its connection", async () => {
    saveConnectionSettings({
      version: 3,
      providers: [
        {
          id: "provider-openai",
          name: "OpenAI Test",
          connections: [
            {
              id: "connection-chat",
              name: "OpenAI 主线路",
              protocol: "openai-chat",
              baseUrl: "https://openai.example.com/v1",
              apiKey: "synthetic-openai-key",
              models: [{ id: "model-openai", modelId: "openai-model" }],
            },
          ],
        },
        {
          id: "provider-gemini",
          name: "Gemini Test",
          connections: [
            {
              id: "connection-gemini",
              name: "Gemini 专线",
              protocol: "gemini-native",
              baseUrl: "https://gemini.example.com",
              apiKey: "synthetic-gemini-key",
              models: [{ id: "model-gemini", modelId: "gemini-model" }],
            },
          ],
        },
      ],
      activeModelId: "model-openai",
    });
    Object.assign(window, { confirm: vi.fn(() => true) });

    await renderApp();
    await clickButton("设置");
    await openConnectionMenu("OpenAI 主线路");
    await clickButton("删除连接 OpenAI 主线路");
    await clickButton("聊天");
    expect(container.textContent).toContain("模型已失效");
    await setDraft("keep this draft");
    await waitFor(() => !getButton("发送").disabled);
    await clickButton("发送");
    expect(getButton("聊天").getAttribute("aria-current")).toBe("page");
    expect(runtimeMocks.createRuntimeChatTransport).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>(".composer-input")?.value).toBe("keep this draft");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "当前会话的模型未选择或已失效",
    );
    await clickButtonWithText("编辑对话");
    expect(container.querySelector<HTMLSelectElement>("#conversation-model")?.value).toBe("model-openai");
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("原模型已失效，请重新选择");
  });

  it("previews the current route and blocks invalid URL actions before runtime requests", async () => {
    saveConnectionSettings({
      version: 3,
      providers: [{
        id: "provider-relay",
        name: "Synthetic Relay",
        connections: [
          {
            id: "connection-chat",
            name: "OpenAI 连接",
            protocol: "openai-chat",
            baseUrl: "https://relay.example.com",
            apiKey: "synthetic-key",
            models: [{ id: "model-chat", modelId: "chat-model" }],
          },
          {
            id: "connection-gemini",
            name: "Gemini 连接",
            protocol: "gemini-native",
            baseUrl: "https://gemini.example.com",
            apiKey: "synthetic-key",
            models: [{ id: "model-gemini", modelId: "model/with space" }],
          },
        ],
      }],
      activeModelId: "model-chat",
    });
    Object.assign(window, { confirm: vi.fn(() => true) });

    await renderApp();
    await clickButton("设置");
    expect(container.querySelector(".endpoint-preview")?.textContent).toContain(
      "https://relay.example.com/v1/chat/completions",
    );

    await setBaseUrl("  https://relay.example.com///  ");
    expect(container.querySelector<HTMLInputElement>("#base-url")?.value).toBe(
      "  https://relay.example.com///  ",
    );
    expect(loadConnectionSettings().providers[0]?.connections[0]?.baseUrl).toBe(
      "  https://relay.example.com///  ",
    );
    expect(container.querySelector(".endpoint-preview")?.textContent).toContain(
      "https://relay.example.com/v1/chat/completions",
    );

    await clickButton("查看连接 Gemini 连接");
    expect(container.querySelector(".endpoint-preview")?.textContent).toContain(
      "https://gemini.example.com",
    );
    expect(container.querySelector(".endpoint-preview")?.textContent).toContain(
      "添加并选择该连接的模型后可预览完整生成端点。",
    );
    expect(container.querySelector(".endpoint-preview")?.textContent).not.toContain(
      ":streamGenerateContent",
    );

    await clickButton("设为助手默认模型 model/with space");
    await waitFor(() => container.querySelector(".endpoint-preview")?.textContent?.includes("models/model%2Fwith%20space") === true);
    expect(container.querySelector(".endpoint-preview")?.textContent).toContain(
      "https://gemini.example.com/v1beta/models/model%2Fwith%20space:streamGenerateContent?alt=sse",
    );

    const protocol = container.querySelector<HTMLSelectElement>(
      "#connection-protocol",
    );
    expect(protocol).toBeInstanceOf(HTMLSelectElement);
    await act(async () => {
      if (protocol) protocol.value = "anthropic-native";
      protocol?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelector(".endpoint-preview")?.textContent).toContain(
      "https://gemini.example.com/v1/messages",
    );
    expect(container.querySelector(".endpoint-preview")?.textContent).not.toContain(
      ":streamGenerateContent",
    );

    await setBaseUrl("https://gemini.example.com/?guess=1");
    expect(container.querySelector("#base-url-hint")?.textContent).toContain(
      "Base URL 不能包含查询参数。",
    );
    expect(container.querySelector("#base-url-hint")?.closest(".connection-request-details")).toBeNull();
    expect(container.querySelector<HTMLDetailsElement>(".connection-request-details")?.open).toBe(false);
    expect(container.querySelector(".endpoint-preview")?.textContent).not.toContain(
      "/v1/messages",
    );
    await clickButtonWithText("获取模型列表");
    await clickButton("测试模型 model/with space");
    expect(runtimeMocks.createRuntimeModelCatalogClient).not.toHaveBeenCalled();
    expect(runtimeMocks.createRuntimeChatTransport).not.toHaveBeenCalled();

    await clickButton("聊天");
    // Assistant defaults no longer retarget an existing conversation.
    // Select the invalid-URL connection in the conversation before testing send.
    await clickButtonWithText("编辑对话");
    await act(async () => {
      const model = container.querySelector<HTMLSelectElement>("#conversation-model")!;
      model.value = "model-gemini";
      model.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await clickButtonWithText("保存对话");
    await waitFor(() => !container.querySelector('[role="dialog"]'));
    await setDraft("must not send");
    await clickButton("发送");
    expect(getButton("设置").getAttribute("aria-current")).toBe("page");
    expect(runtimeMocks.createRuntimeChatTransport).not.toHaveBeenCalled();
    await clickButton("聊天");
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      "must not send",
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Base URL 不能包含查询参数。",
    );
  });
});
