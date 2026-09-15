// @vitest-environment happy-dom

import "fake-indexeddb/auto";

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
import { createChatRepository } from "./chat/repository";
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
    await createChatRepository().clear("current");
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

  async function clickButtonWithText(text: string): Promise<void> {
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
      "请先添加并选择一个模型。",
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
    await clickButton("Gemini Test");
    await clickButton("设为当前模型 gemini-model");
    await clickButton("聊天");

    expect(container.textContent).toContain(
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
    expect(container.textContent).toContain(
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
    expect(container.textContent).toContain("model-d");
    expect(container.textContent).not.toContain("model-a");

    await clickButton("聊天");
    expect(container.textContent).toContain("中转站 A · 连接 1 · model-a");
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
    await clickButtonWithText("删除连接");
    await waitFor(
      () => document.activeElement?.getAttribute("aria-label") === "查看连接 连接 2",
    );

    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "查看连接 连接 2",
    );
  });

  it("clears the active model instead of silently falling back after deleting its connection", async () => {
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
    const deleteConnectionButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === "删除连接");
    expect(deleteConnectionButton).toBeInstanceOf(HTMLButtonElement);
    await act(async () => deleteConnectionButton?.click());
    await clickButton("聊天");
    expect(container.textContent).toContain("未选择模型");
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

    await clickButton("设为当前模型 model/with space");
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
    expect(container.querySelector(".endpoint-preview")?.textContent).toContain(
      "Base URL 不能包含查询参数。",
    );
    expect(container.querySelector(".endpoint-preview")?.textContent).not.toContain(
      "/v1/messages",
    );
    await clickButtonWithText("获取模型列表");
    await clickButton("测试模型 model/with space");
    expect(runtimeMocks.createRuntimeModelCatalogClient).not.toHaveBeenCalled();
    expect(runtimeMocks.createRuntimeChatTransport).not.toHaveBeenCalled();

    await clickButton("聊天");
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
