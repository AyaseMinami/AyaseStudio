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
import { emptyProviderProfiles, saveProviderProfiles } from "./chat/settings";
import type { ChatRequest, ChatTransport } from "./chat/types";

const runtimeMocks = vi.hoisted(() => ({
  createRuntimeChatTransport: vi.fn(),
}));

vi.mock("./chat/runtime", () => runtimeMocks);

describe("App navigation", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.clear();
    runtimeMocks.createRuntimeChatTransport.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
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

  async function clickButton(label: string): Promise<void> {
    await act(async () => {
      getButton(label).click();
    });
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
    expect(container.textContent).toContain("API Key");

    await clickButton("外观");
    expect(container.textContent).toContain("主题模式");
    expect(container.textContent).not.toContain("API Key");

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
      "请先填写当前协议的 Base URL、API Key 和 Model。",
    );
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      "需要配置",
    );
  });

  it("keeps one active stream alive and stoppable across page navigation", async () => {
    saveProviderProfiles({
      ...emptyProviderProfiles,
      "openai-chat": {
        baseUrl: "https://relay.example.com/v1",
        apiKey: "test-key",
        model: "test-model",
      },
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
});
