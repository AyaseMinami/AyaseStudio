// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConnectionSettingsState } from "../../chat/settings";
import { ConnectionSettings, type ConnectionSettingsProps } from "./ConnectionSettings";

const connectionSettings: ConnectionSettingsState = {
  version: 3,
  activeModelId: "model-a",
  providers: [{
    id: "provider-a",
    name: "示例供应商",
    connections: [{
      id: "connection-a",
      name: "主线路",
      protocol: "openai-chat",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "synthetic-test-key",
      models: [
        { id: "model-a", modelId: "alpha-model", displayName: "Alpha" },
        { id: "model-b", modelId: "beta-model", displayName: "Beta" },
      ],
    }],
  }],
};

function makeProps(): ConnectionSettingsProps {
  return {
    connectionSettings,
    isStreaming: false,
    modelCatalogs: {},
    modelTests: {},
    onAddConnection: vi.fn(() => "connection-new"),
    onAddModel: vi.fn(() => "model-new"),
    onAddProvider: vi.fn(() => "provider-new"),
    onCancelModelCatalogRefresh: vi.fn(),
    onCancelModelTest: vi.fn(),
    onConnectionChange: vi.fn(),
    onDeleteConnection: vi.fn(),
    onDeleteModel: vi.fn(),
    onDeleteProvider: vi.fn(),
    onModelChange: vi.fn(),
    onProviderRename: vi.fn(),
    onProviderMove: vi.fn(),
    onRefreshModelCatalog: vi.fn(async () => undefined),
    onRunModelTest: vi.fn(async () => undefined),
    onSelectModel: vi.fn(),
  };
}

describe("ConnectionSettings", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function render(props: ConnectionSettingsProps): Promise<void> {
    await act(async () => root.render(<ConnectionSettings {...props} />));
  }

  function button(label: string): HTMLButtonElement {
    const element = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    expect(element).toBeInstanceOf(HTMLButtonElement);
    return element as HTMLButtonElement;
  }

  it("keeps disclosure separate from supplier and connection detail selection", async () => {
    const props = makeProps();
    await render(props);

    await act(async () => button("收起供应商 示例供应商").click());
    expect(container.querySelector("#provider-connections-provider-a")?.hasAttribute("hidden")).toBe(true);
    expect(container.querySelector('[aria-label="供应商列表"]')?.textContent).not.toContain("alpha-model");

    await act(async () => button("示例供应商").click());
    expect(container.textContent).toContain("管理此供应商下的连接渠道");
    expect(container.querySelector("#base-url")).toBeNull();
    expect(props.onSelectModel).not.toHaveBeenCalled();

    await act(async () => button("展开供应商 示例供应商").click());
    await act(async () => button("查看连接 主线路").click());
    expect(container.querySelector("#connection-models-connection-a")).toBeNull();
    expect(container.querySelector("#base-url")).toBeInstanceOf(HTMLInputElement);
    await act(async () => button("查看连接 主线路").click());
    expect(container.querySelector("#connection-models-connection-a")).toBeNull();
  });

  it("keeps models in connection details and retains model actions", async () => {
    const props = makeProps();
    Object.defineProperty(window, "confirm", { configurable: true, value: vi.fn(() => true) });
    await render(props);

    await act(async () => button("查看连接 主线路").click());
    expect(props.onSelectModel).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Beta");
    expect(container.querySelector('[aria-label="设为助手默认模型 beta-model"]')).toBeInstanceOf(HTMLButtonElement);

    await act(async () => button("设为助手默认模型 beta-model").click());
    expect(props.onSelectModel).toHaveBeenCalledWith("model-b");

    await act(async () => button("测试模型 beta-model").click());
    expect(props.onRunModelTest).toHaveBeenCalledWith("connection-a", "model-b");

    await act(async () => button("编辑模型 beta-model").click());
    expect(container.querySelector('[aria-label="保存模型 beta-model"]')).toBeInstanceOf(HTMLButtonElement);
    vi.mocked(window.confirm).mockClear();
    await act(async () => button("示例供应商").click());
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[aria-label="保存模型 beta-model"]')).toBeNull();
    await act(async () => button("查看连接 主线路").click());
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[aria-label="保存模型 beta-model"]')).toBeNull();
  });

  it("returns keyboard focus to the connection after deleting its last model", async () => {
    const props = makeProps();
    props.connectionSettings = structuredClone(connectionSettings);
    props.connectionSettings.providers[0].connections[0].models = [connectionSettings.providers[0].connections[0].models[0]];
    Object.defineProperty(window, "confirm", { configurable: true, value: vi.fn(() => true) });
    await render(props);
    button("删除模型 alpha-model").focus();
    await act(async () => button("删除模型 alpha-model").click());
    props.connectionSettings = structuredClone(props.connectionSettings);
    props.connectionSettings.providers[0].connections[0].models = [];
    await render(props);
    expect(document.activeElement).toBe(button("查看连接 主线路"));
    expect(props.onDeleteModel).toHaveBeenCalledWith("model-a");
  });
});
