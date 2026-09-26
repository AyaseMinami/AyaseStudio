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

  it.each(["供应商", "连接"])("only saves %s renames on explicit submit", async (kind) => {
    const props = makeProps();
    await render(props);
    const name = kind === "供应商" ? "示例供应商" : "主线路";
    const callback = kind === "供应商" ? props.onProviderRename : props.onConnectionChange;
    async function openRename() {
      await act(async () => container.querySelector<HTMLElement>(`summary[aria-label="管理${kind} ${name}"]`)!.click());
      await act(async () => [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent === "重命名")!.click());
      const input = container.querySelector<HTMLInputElement>('.connection-entity-menu input')!;
      input.value = "新名称";
      expect(container.querySelector('.connection-entity-menu .danger-icon-button')).toBeNull();
      return input;
    }
    await openRename();
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('.connection-rename-footer button')].find((item) => item.textContent === "取消")!.click());
    expect(callback).not.toHaveBeenCalled();
    await openRename();
    await act(async () => button("查看连接 主线路").focus());
    expect(container.querySelector('.connection-entity-menu')).toBeNull();
    expect(callback).not.toHaveBeenCalled();
    await openRename();
    await act(async () => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(callback).not.toHaveBeenCalled();
    const input = await openRename();
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(callback).not.toHaveBeenCalled();
    await openRename();
    await act(async () => container.querySelector(' .connection-entity-menu form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(callback).toHaveBeenCalledTimes(1);
    if (kind === "供应商") expect(callback).toHaveBeenCalledWith("provider-a", "新名称");
    else expect(callback).toHaveBeenCalledWith("connection-a", "name", "新名称");
  });

  it("reveals and hides the key without saving, and allows selecting visible text", async () => {
    const props = makeProps();
    await render(props);
    const input = container.querySelector<HTMLInputElement>("#api-key")!;
    expect(input.type).toBe("password");
    const toggle = button("显示 API Key");
    toggle.focus();
    expect(document.activeElement).toBe(toggle);
    expect(toggle.type).toBe("button");
    expect(toggle.getAttribute("aria-controls")).toBe(input.id);
    await act(async () => toggle.click());
    expect(input.type).toBe("text");
    expect(input.value).toBe("synthetic-test-key");
    input.select();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    await act(async () => button("隐藏 API Key").click());
    expect(input.type).toBe("password");
    expect(input.value).toBe("synthetic-test-key");
    expect(props.onConnectionChange).not.toHaveBeenCalled();
  });

  it("resets key visibility when switching connections or leaving their details", async () => {
    const props = makeProps();
    props.connectionSettings = structuredClone(connectionSettings);
    props.connectionSettings.providers[0].connections.push({
      ...structuredClone(connectionSettings.providers[0].connections[0]),
      id: "connection-b", name: "备用线路", apiKey: "synthetic-other-key", models: [],
    });
    await render(props);
    await act(async () => button("显示 API Key").click());
    await act(async () => button("查看连接 备用线路").click());
    expect(container.querySelector<HTMLInputElement>("#api-key")!.type).toBe("password");
    await act(async () => button("查看连接 主线路").click());
    expect(container.querySelector<HTMLInputElement>("#api-key")!.type).toBe("password");
    await act(async () => button("显示 API Key").click());
    await act(async () => button("示例供应商").click());
    await act(async () => button("查看连接 主线路").click());
    expect(container.querySelector<HTMLInputElement>("#api-key")!.type).toBe("password");
  });

  it("keeps the key selectable but read-only during generation", async () => {
    await render({ ...makeProps(), isStreaming: true });
    await act(async () => button("显示 API Key").click());
    const input = container.querySelector<HTMLInputElement>("#api-key")!;
    expect(input.readOnly).toBe(true);
    expect(input.disabled).toBe(false);
    input.select();
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it("shows field help on focus and dismisses it with Escape", async () => {
    await render(makeProps());
    expect(container.textContent).not.toContain("密钥以明文保存在本机");
    await act(async () => button("API Key说明").focus());
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("密钥以明文保存在本机");
    await act(async () => button("API Key说明").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("adds models in a dialog, retains duplicate validation, and cancels drafts", async () => {
    const props = makeProps();
    await render(props);
    await act(async () => button("手动添加模型").click());
    const dialog = container.querySelector<HTMLDialogElement>('dialog[aria-labelledby="add-model-title"]')!;
    expect(dialog.open).toBe(true);
    const input = dialog.querySelector<HTMLInputElement>('[name="modelId"]')!;
    input.value = "alpha-model";
    await act(async () => dialog.querySelector('form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(dialog.textContent).toContain("该连接已经添加了这个模型 ID");
    expect(props.onAddModel).not.toHaveBeenCalled();
    await act(async () => dialog.dispatchEvent(new Event("cancel", { cancelable: true })));
    expect(container.querySelector('dialog')).toBeNull();
    await act(async () => button("手动添加模型").click());
    const reopened = container.querySelector('dialog')!;
    expect(reopened.querySelector<HTMLInputElement>('[name="modelId"]')!.value).toBe("");
    reopened.querySelector<HTMLInputElement>('[name="modelId"]')!.value = "new-model";
    reopened.querySelector<HTMLInputElement>('[name="displayName"]')!.value = "新模型";
    await act(async () => reopened.querySelector('form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(props.onAddModel).toHaveBeenCalledWith("connection-a", "new-model", "新模型");
    expect(container.querySelector('dialog')).toBeNull();
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
