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

  function menuItem(label: string): HTMLButtonElement {
    const element = [...document.querySelectorAll<HTMLButtonElement>('.action-menu [role="menuitem"]')]
      .find((item) => item.getAttribute("aria-label") === label || item.textContent === label);
    expect(element).toBeInstanceOf(HTMLButtonElement);
    return element!;
  }

  function withSecondaryConnection(): ConnectionSettingsProps {
    const props = makeProps();
    props.connectionSettings = structuredClone(connectionSettings);
    props.connectionSettings.providers[0].connections.push({
      id: "connection-secondary", name: "备用线路", protocol: "anthropic-native",
      baseUrl: "https://secondary.example.com", apiKey: "", models: [],
    });
    return props;
  }

  async function rightClick(element: HTMLElement): Promise<void> {
    await act(async () => element.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, clientX: 120, clientY: 160,
    })));
  }

  it.each(["right-click", "keyboard", "management button"])("closes supplier templates when %s opens an entity menu", async (entry) => {
    await render(makeProps());
    const templates = container.querySelector<HTMLDetailsElement>(".provider-create-menu")!;
    await act(async () => { templates.open = true; });
    expect(templates.open).toBe(true);
    if (entry === "right-click") await rightClick(button("示例供应商"));
    else if (entry === "keyboard") await act(async () => button("示例供应商").dispatchEvent(new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true })));
    else await act(async () => button("管理供应商 示例供应商").click());
    expect(templates.open).toBe(false);
    expect(document.querySelector('.action-menu')?.getAttribute("aria-label")).toBe("示例供应商的管理菜单");
    expect(button("查看连接 主线路").getAttribute("aria-current")).toBe("true");
  });

  it("renames the right-clicked unselected tree connection without selecting it", async () => {
    const props = withSecondaryConnection();
    await render(props);
    await rightClick(button("查看连接 备用线路").closest<HTMLElement>(".connection-tree-row")!);
    expect(document.querySelector('.action-menu')?.getAttribute("aria-label")).toBe("备用线路的管理菜单");
    expect(container.querySelector<HTMLInputElement>("#base-url")?.value).toBe("https://relay.example.com/v1");
    await act(async () => menuItem("重命名").click());
    document.querySelector<HTMLInputElement>('.connection-rename-form input')!.value = "备用线路改名";
    await act(async () => document.querySelector('.connection-rename-form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(props.onConnectionChange).toHaveBeenCalledExactlyOnceWith("connection-secondary", "name", "备用线路改名");
    expect(button("查看连接 主线路").getAttribute("aria-current")).toBe("true");
    expect(props.onSelectModel).not.toHaveBeenCalled();
  });

  it("keeps the rename dialog and unsaved draft on Tab before saving the target connection", async () => {
    const props = withSecondaryConnection();
    await render(props);
    await rightClick(button("查看连接 备用线路"));
    await act(async () => menuItem("重命名").click());
    const input = document.querySelector<HTMLInputElement>('.connection-rename-form input')!;
    input.value = "键盘重命名备用线路";
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    await act(async () => input.dispatchEvent(tab));
    expect(tab.defaultPrevented).toBe(false);
    expect(document.querySelector('.action-menu[role="dialog"]')).not.toBeNull();
    expect(document.querySelector<HTMLInputElement>('.connection-rename-form input')).toBe(input);
    expect(input.value).toBe("键盘重命名备用线路");
    expect(props.onConnectionChange).not.toHaveBeenCalled();
    await act(async () => document.querySelector('.connection-rename-form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(props.onConnectionChange).toHaveBeenCalledExactlyOnceWith("connection-secondary", "name", "键盘重命名备用线路");
    expect(document.querySelector('.action-menu')).toBeNull();
    expect(button("查看连接 主线路").getAttribute("aria-current")).toBe("true");
  });

  it.each([
    { key: "ContextMenu", shiftKey: false },
    { key: "F10", shiftKey: true },
  ])("opens the focused connection with $key and restores focus without selection", async (keys) => {
    const props = withSecondaryConnection();
    await render(props);
    const row = button("查看连接 备用线路");
    await act(async () => {
      row.focus();
      row.dispatchEvent(new KeyboardEvent("keydown", { ...keys, bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(menuItem("编辑连接 备用线路"));
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('.action-menu')).toBeNull();
    expect(document.activeElement).toBe(row);
    expect(button("查看连接 主线路").getAttribute("aria-current")).toBe("true");
    expect(props.onSelectModel).not.toHaveBeenCalled();
  });

  it("opens overview rows without navigating and reuses their edit and delete actions", async () => {
    const props = withSecondaryConnection();
    const confirm = vi.fn(() => false);
    Object.defineProperty(window, "confirm", { configurable: true, value: confirm });
    await render(props);
    await act(async () => button("示例供应商").click());
    const row = container.querySelectorAll<HTMLElement>(".provider-connection-row")[1];
    await rightClick(row);
    expect(container.querySelectorAll(".provider-connection-row")).toHaveLength(2);
    expect(container.querySelector("#base-url")).toBeNull();
    await act(async () => menuItem("删除连接 备用线路").click());
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("https://secondary.example.com"));
    expect(props.onDeleteConnection).not.toHaveBeenCalled();
    await act(async () => {
      row.querySelector<HTMLElement>(".provider-connection-link")!.focus();
      row.querySelector<HTMLElement>(".provider-connection-link")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true }));
    });
    await act(async () => menuItem("编辑连接 备用线路").click());
    expect(container.querySelector<HTMLInputElement>("#base-url")?.value).toBe("https://secondary.example.com");
    expect(props.onSelectModel).not.toHaveBeenCalled();
  });

  it("uses the unselected provider and latest row data for move and deletion", async () => {
    const props = withSecondaryConnection();
    props.connectionSettings.providers.push({ id: "provider-b", name: "另一供应商", connections: [] });
    const confirm = vi.fn(() => true);
    Object.defineProperty(window, "confirm", { configurable: true, value: confirm });
    await render(props);
    await rightClick(button("另一供应商"));
    expect(menuItem("下移供应商 另一供应商").disabled).toBe(true);
    await act(async () => menuItem("上移供应商 另一供应商").click());
    expect(props.onProviderMove).toHaveBeenCalledExactlyOnceWith("provider-b", "provider-a", "before");
    expect(button("查看连接 主线路").getAttribute("aria-current")).toBe("true");
    await rightClick(button("另一供应商"));
    props.connectionSettings = structuredClone(props.connectionSettings);
    props.connectionSettings.providers[1].name = "最新供应商名称";
    props.connectionSettings.providers[1].connections = [structuredClone(connectionSettings.providers[0].connections[0])];
    await render(props);
    await act(async () => menuItem("删除供应商 最新供应商名称").click());
    expect(confirm).toHaveBeenCalledWith("删除供应商“最新供应商名称”以及其中 1 条连接、2 个模型？");
    expect(props.onDeleteProvider).toHaveBeenCalledExactlyOnceWith("provider-b");
    expect(button("查看连接 主线路").getAttribute("aria-current")).toBe("true");
  });

  it("keeps context actions disabled when generation starts while the menu is open", async () => {
    const props = withSecondaryConnection();
    const confirm = vi.fn(() => true);
    Object.defineProperty(window, "confirm", { configurable: true, value: confirm });
    await render(props);
    await rightClick(button("查看连接 备用线路"));
    props.isStreaming = true;
    await render(props);
    const items = document.querySelectorAll<HTMLButtonElement>('.action-menu [role="menuitem"]');
    expect(items).toHaveLength(3);
    expect([...items].every((item) => item.disabled)).toBe(true);
    await act(async () => menuItem("删除连接 备用线路").click());
    expect(confirm).not.toHaveBeenCalled();
    expect(props.onDeleteConnection).not.toHaveBeenCalled();
    expect(props.onConnectionChange).not.toHaveBeenCalled();
  });

  it("closes when its target disappears, is hidden, selection changes, or a dialog opens", async () => {
    const props = withSecondaryConnection();
    await render(props);
    await rightClick(button("查看连接 备用线路"));
    props.connectionSettings = structuredClone(props.connectionSettings);
    props.connectionSettings.providers[0].connections.pop();
    await render(props);
    expect(document.querySelector('.action-menu')).toBeNull();
    await rightClick(button("查看连接 主线路"));
    await act(async () => button("收起供应商 示例供应商").click());
    expect(document.querySelector('.action-menu')).toBeNull();
    await rightClick(button("示例供应商"));
    await act(async () => button("示例供应商").click());
    expect(document.querySelector('.action-menu')).toBeNull();
    await act(async () => button("查看连接 主线路").click());
    await rightClick(button("示例供应商"));
    await act(async () => button("手动添加模型").click());
    expect(document.querySelector('.action-menu')).toBeNull();
    expect(container.querySelector("dialog")?.open).toBe(true);
  });

  it("uses the existing unsaved-model confirmation when a menu edits another connection", async () => {
    const props = withSecondaryConnection();
    const confirm = vi.fn(() => false);
    Object.defineProperty(window, "confirm", { configurable: true, value: confirm });
    await render(props);
    await act(async () => button("编辑模型 beta-model").click());
    await rightClick(button("查看连接 备用线路"));
    await act(async () => menuItem("编辑连接 备用线路").click());
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[aria-label="保存模型 beta-model"]')).not.toBeNull();
    expect(button("查看连接 主线路").getAttribute("aria-current")).toBe("true");
    confirm.mockReturnValue(true);
    await rightClick(button("查看连接 备用线路"));
    await act(async () => menuItem("编辑连接 备用线路").click());
    expect(container.querySelector<HTMLInputElement>("#base-url")?.value).toBe("https://secondary.example.com");
    expect(props.onSelectModel).not.toHaveBeenCalled();
  });

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

  it("lists connections and returns to the supplier without changing the selected model", async () => {
    const props = makeProps();
    props.connectionSettings = structuredClone(connectionSettings);
    props.connectionSettings.providers[0].connections.push({
      id: "connection-secondary", name: "备用线路", protocol: "anthropic-native",
      baseUrl: "https://secondary.example.com", apiKey: "", models: [],
    });
    const confirm = vi.fn(() => false);
    Object.defineProperty(window, "confirm", { configurable: true, value: confirm });
    await render(props);
    await act(async () => button("示例供应商").click());
    const rows = container.querySelectorAll(".provider-connection-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("https://relay.example.com/v1");
    expect(rows[1].textContent).toContain("Anthropic Native");
    expect(rows[1].textContent).toContain("https://secondary.example.com");
    await act(async () => rows[1].querySelector<HTMLButtonElement>(".provider-connection-link")!.click());
    expect(container.querySelector<HTMLInputElement>("#base-url")?.value).toBe("https://secondary.example.com");
    await act(async () => container.querySelector<HTMLButtonElement>(".connection-back-button")!.click());
    expect(container.querySelectorAll(".provider-connection-row")).toHaveLength(2);
    await act(async () => container.querySelector<HTMLButtonElement>(".provider-connection-link")!.click());
    await act(async () => button("编辑模型 beta-model").click());
    await act(async () => container.querySelector<HTMLButtonElement>(".connection-back-button")!.click());
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[aria-label="保存模型 beta-model"]')).not.toBeNull();
    confirm.mockReturnValue(true);
    await act(async () => container.querySelector<HTMLButtonElement>(".connection-back-button")!.click());
    expect(container.querySelectorAll(".provider-connection-row")).toHaveLength(2);
    expect(props.onSelectModel).not.toHaveBeenCalled();
  });

  it("confirms list deletion, respects generation protection, and shows the empty state", async () => {
    const props = makeProps();
    props.connectionSettings = structuredClone(connectionSettings);
    const confirm = vi.fn(() => false);
    Object.defineProperty(window, "confirm", { configurable: true, value: confirm });
    await render(props);
    await act(async () => button("示例供应商").click());
    await act(async () => button("删除连接 主线路").click());
    expect(props.onDeleteConnection).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("https://relay.example.com/v1"));
    props.isStreaming = true;
    await render(props);
    expect(button("删除连接 主线路").disabled).toBe(true);
    props.isStreaming = false;
    await render(props);
    confirm.mockReturnValue(true);
    await act(async () => button("删除连接 主线路").click());
    expect(props.onDeleteConnection).toHaveBeenCalledExactlyOnceWith("connection-a");
    expect(document.activeElement?.textContent).toContain("添加连接");
    props.connectionSettings = { version: 3, activeModelId: null,
      providers: [{ id: "provider-a", name: "示例供应商", connections: [] }] };
    await render(props);
    expect(container.textContent).toContain("还没有连接");
    expect(container.querySelector(".provider-connection-list")).toBeNull();
    expect(document.activeElement?.textContent).toContain("添加连接");
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
      await act(async () => button(`管理${kind} ${name}`).click());
      await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.action-menu [role="menuitem"]')].find((item) => item.textContent === "重命名")!.click());
      const input = document.querySelector<HTMLInputElement>('.connection-rename-form input')!;
      input.value = "新名称";
      expect(document.querySelector('.action-menu [role="menuitem"]')).toBeNull();
      return input;
    }
    await openRename();
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.connection-rename-footer button')].find((item) => item.textContent === "取消")!.click());
    expect(callback).not.toHaveBeenCalled();
    await openRename();
    await act(async () => button("查看连接 主线路").focus());
    expect(document.querySelector('.action-menu')).toBeNull();
    expect(callback).not.toHaveBeenCalled();
    await openRename();
    await act(async () => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(callback).not.toHaveBeenCalled();
    const input = await openRename();
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(callback).not.toHaveBeenCalled();
    await openRename();
    await act(async () => document.querySelector('.connection-rename-form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
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
