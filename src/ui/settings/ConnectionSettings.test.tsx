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
    onConnectionMove: vi.fn(),
    onRefreshModelCatalog: vi.fn(async () => undefined),
    onRunModelTest: vi.fn(async () => undefined),
    onSelectModel: vi.fn(),
  };
}

describe("ConnectionSettings", () => {
  it("selects both image protocols and previews Grok edits and Seedream reference requests", async () => {
    const props = makeProps();
    props.connectionSettings = structuredClone(connectionSettings);
    const connection = props.connectionSettings.providers[0].connections[0];
    Object.defineProperty(window, "confirm", { configurable: true, value: vi.fn(() => true) });
    await render(props);
    const select = container.querySelector<HTMLSelectElement>("#connection-protocol")!;
    expect([...select.options].map(option => option.value)).toEqual(expect.arrayContaining(["grok-images", "seedream-images"]));
    for (const protocol of ["grok-images", "seedream-images"] as const) {
      await act(async () => { select.value = protocol; select.dispatchEvent(new Event("change", { bubbles: true })); });
      expect(props.onConnectionChange).toHaveBeenLastCalledWith(connection.id, "protocol", protocol);
      connection.protocol = protocol;
      connection.baseUrl = protocol === "grok-images" ? "https://api.x.ai" : "https://ark.example.invalid";
      await render(props);
      const codes = [...container.querySelectorAll(".endpoint-preview code")].map(code => code.textContent);
      expect(codes).toEqual(protocol === "grok-images"
        ? ["https://api.x.ai/v1", "https://api.x.ai/v1/images/generations", "https://api.x.ai/v1/images/edits"]
        : ["https://ark.example.invalid/api/v3", "https://ark.example.invalid/api/v3/images/generations", "https://ark.example.invalid/api/v3/images/generations"]);
      expect(container.textContent).toContain("参考图编辑端点");
      expect(container.querySelector('button[aria-label="测试模型 alpha-model"]')).toBeNull();
      expect(container.querySelector('button[aria-label="选择模型 alpha-model"]')).toBeNull();
      if (protocol === "grok-images") {
        await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent?.includes("获取模型列表"))!.click());
        expect(container.querySelector(".model-catalog-dialog")).not.toBeNull();
      } else {
        expect(container.querySelector(".model-catalog-dialog")).toBeNull();
      }
    }
    expect(props.onRefreshModelCatalog).toHaveBeenCalledExactlyOnceWith(connection.id);
    expect(props.onRunModelTest).not.toHaveBeenCalled();
  });

  it("disables the unsupported Seedream model catalog and permits manual model IDs", async () => {
    const props = makeProps();
    props.connectionSettings = structuredClone(connectionSettings);
    props.connectionSettings.providers[0].connections[0].protocol = "seedream-images";
    await render(props);
    const catalog = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("获取模型列表"))!;
    expect(catalog.disabled).toBe(true);
    expect(catalog.getAttribute("aria-describedby")).toBe("seedream-catalog-hint");
    expect(container.querySelector("#seedream-catalog-hint")?.textContent).toContain("请手动添加模型 ID");
    await act(async () => catalog.click());
    expect(container.querySelector(".model-catalog-dialog")).toBeNull();
    expect(props.onRefreshModelCatalog).not.toHaveBeenCalled();
    await act(async () => button("手动添加模型").click());
    const form = container.querySelector<HTMLInputElement>('input[name="modelId"]')!.form!;
    await act(async () => {
      form.querySelector<HTMLInputElement>('input[name="modelId"]')!.value = "custom-seedream-model";
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(props.onAddModel).toHaveBeenCalledExactlyOnceWith("connection-a", "custom-seedream-model", undefined);
    expect(props.onRefreshModelCatalog).not.toHaveBeenCalled();
  });

  it("previews Images generations and keeps its models away from chat actions", async () => {
    const props = makeProps();
    props.connectionSettings = structuredClone(connectionSettings);
    const connection = props.connectionSettings.providers[0].connections[0];
    connection.protocol = "openai-images";
    connection.models = [{ id: "image", modelId: "gpt-image-2.5-flare" }];
    await render(props);
    expect(container.textContent).toContain("OpenAI 绘图");
    expect(container.textContent).toContain("https://relay.example.com/v1/images/generations");
    expect(container.textContent).not.toContain("/chat/completions");
    expect(container.querySelector('button[aria-label="测试模型 gpt-image-2.5-flare"]')).toBeNull();
    expect(container.querySelector('button[aria-label="选择模型 gpt-image-2.5-flare"]')).toBeNull();
    expect(props.onRunModelTest).not.toHaveBeenCalled();
    connection.baseUrl = "http://relay.example.com/v1";
    await render(props);
    expect(container.textContent).toContain("只支持 HTTPS");
  });
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
    vi.useRealTimers();
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

  function pointer(target: EventTarget, type: string, y = 110, pointerId = 1): void {
    target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, button: 0, buttons: type === "pointerup" ? 0 : 1,
      pointerId, isPrimary: true, clientX: 30, clientY: y,
    }));
  }

  function hitRow(element: HTMLElement | null): void {
    vi.spyOn(document, "elementFromPoint").mockReturnValue(element);
    if (element) vi.spyOn(element, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 100, 200, 40));
  }

  it.each(["handle", "name"])("drags a provider from its %s at six pixels without waiting, selecting or collapsing it", async (entry) => {
    const props = withSecondaryConnection();
    props.connectionSettings.providers.push({ id: "provider-b", name: "另一供应商", connections: [] });
    await render(props);
    hitRow(button("示例供应商"));
    vi.spyOn(button("示例供应商").closest(".connection-provider-row")!, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, 100, 200, 40));
    const source = button(entry === "handle" ? "拖动排序 另一供应商" : "另一供应商");
    await act(async () => {
      pointer(source, "pointerdown", 170);
      pointer(window, "pointermove", 165);
    });
    expect(container.querySelector('[data-sorting="true"]')).toBeNull();
    await act(async () => pointer(window, "pointermove", 164));
    expect(container.querySelector('[data-sorting="true"]')).not.toBeNull();
    expect(props.onProviderMove).not.toHaveBeenCalled();
    await act(async () => {
      pointer(window, "pointermove");
    });
    expect(container.querySelector('[data-sort-provider="provider-a"]')?.getAttribute("data-drop")).toBe("before");
    await act(async () => {
      pointer(window, "pointerup");
      source.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    });
    expect(props.onProviderMove).toHaveBeenCalledExactlyOnceWith("provider-b", "provider-a", "before");
    expect(button("查看连接 主线路").getAttribute("aria-current")).toBe("true");
    expect(button("收起供应商 示例供应商").getAttribute("aria-expanded")).toBe("true");
  });

  it.each(["handle", "name"])("drags a connection from its %s at six pixels without waiting and suppresses its release click", async (entry) => {
    const props = withSecondaryConnection();
    await render(props);
    hitRow(button("查看连接 主线路").closest<HTMLElement>("[data-sort-connection]"));
    const source = button(entry === "handle" ? "拖动排序连接 备用线路" : "查看连接 备用线路");
    await act(async () => {
      pointer(source, "pointerdown", 170);
      pointer(window, "pointermove", 165);
    });
    expect(container.querySelector('[data-sorting="true"]')).toBeNull();
    await act(async () => pointer(window, "pointermove", 164));
    expect(container.querySelector('[data-sorting="true"]')).not.toBeNull();
    expect(props.onConnectionMove).not.toHaveBeenCalled();
    await act(async () => {
      pointer(window, "pointermove");
      pointer(window, "pointerup");
      source.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    });
    expect(props.onConnectionMove).toHaveBeenCalledExactlyOnceWith("connection-secondary", "connection-a", "before");
    expect(button("查看连接 主线路").getAttribute("aria-current")).toBe("true");
    expect(container.querySelector('[data-sorting="true"]')).toBeNull();
  });

  it.each([
    { kind: "provider", elapsed: 100, movement: 0 },
    { kind: "provider", elapsed: 1000, movement: 0 },
    { kind: "provider", elapsed: 1000, movement: 5 },
    { kind: "connection", elapsed: 100, movement: 0 },
    { kind: "connection", elapsed: 1000, movement: 0 },
    { kind: "connection", elapsed: 1000, movement: 5 },
  ])("keeps a $kind name press of $elapsed ms with $movement px movement as a click", async ({ kind, elapsed, movement }) => {
    vi.useFakeTimers();
    const props = withSecondaryConnection();
    await render(props);
    const source = button(kind === "provider" ? "示例供应商" : "查看连接 备用线路");
    await act(async () => {
      pointer(source, "pointerdown");
      pointer(window, "pointermove", 110 + movement);
      vi.advanceTimersByTime(elapsed);
    });
    expect(container.querySelector('[data-sorting="true"]')).toBeNull();
    await act(async () => {
      pointer(window, "pointerup", 110 + movement);
      source.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    });
    expect(container.querySelector('[data-sorting="true"]')).toBeNull();
    expect(props.onProviderMove).not.toHaveBeenCalled();
    expect(props.onConnectionMove).not.toHaveBeenCalled();
    expect(source.getAttribute("aria-current")).toBe("true");
  });

  it.each(["escape", "blur", "pointercancel"])("cancels an active drag on %s without selecting a row", async (reason) => {
    vi.useFakeTimers();
    const props = withSecondaryConnection();
    await render(props);
    hitRow(button("查看连接 主线路").closest<HTMLElement>("[data-sort-connection]"));
    const source = button("查看连接 备用线路");
    await act(async () => {
      pointer(source, "pointerdown", 170);
      pointer(window, "pointermove");
      if (reason === "escape") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      else if (reason === "blur") window.dispatchEvent(new Event("blur"));
      else pointer(window, "pointercancel");
      pointer(window, "pointerup");
      if (reason !== "pointercancel") source.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    });
    expect(props.onConnectionMove).not.toHaveBeenCalled();
    expect(button("查看连接 主线路").getAttribute("aria-current")).toBe("true");
    expect(container.querySelector('[data-sorting="true"]')).toBeNull();
  });

  it.each(["pending", "active"])("cancels a %s gesture when generation starts", async (phase) => {
    vi.useFakeTimers();
    const props = withSecondaryConnection();
    await render(props);
    hitRow(button("查看连接 主线路").closest<HTMLElement>("[data-sort-connection]"));
    await act(async () => {
      pointer(button("查看连接 备用线路"), "pointerdown", 170);
      if (phase === "active") pointer(window, "pointermove");
    });
    expect(container.querySelector('[data-sorting="true"]') !== null).toBe(phase === "active");
    props.isStreaming = true;
    await render(props);
    await act(async () => { vi.advanceTimersByTime(500); pointer(window, "pointermove"); pointer(window, "pointerup"); });
    expect(props.onConnectionMove).not.toHaveBeenCalled();
    expect(container.querySelector('[data-sorting="true"]')).toBeNull();
    expect(button("拖动排序连接 备用线路").disabled).toBe(true);
  });

  it("keeps unrelated buttons usable after blur and a release outside the WebView", async () => {
    vi.useFakeTimers();
    const props = withSecondaryConnection();
    await render(props);
    await act(async () => {
      pointer(button("查看连接 备用线路"), "pointerdown");
      pointer(window, "pointermove", 116);
      window.dispatchEvent(new Event("blur"));
    });
    const disclosure = button("收起供应商 示例供应商");
    await act(async () => {
      pointer(disclosure, "pointerdown");
      pointer(window, "pointerup");
      disclosure.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(props.onConnectionMove).not.toHaveBeenCalled();
  });

  it("does not open a connection after Escape cancels a pending name gesture", async () => {
    vi.useFakeTimers();
    const props = withSecondaryConnection();
    await render(props);
    const source = button("查看连接 备用线路");
    await act(async () => {
      pointer(source, "pointerdown");
      vi.advanceTimersByTime(100);
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      pointer(window, "pointerup");
      source.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    });
    expect(button("查看连接 主线路").getAttribute("aria-current")).toBe("true");
    expect(props.onConnectionMove).not.toHaveBeenCalled();
  });

  it("rejects another provider, the source itself and drops outside the tree", async () => {
    const props = withSecondaryConnection();
    props.connectionSettings.providers.push({ id: "provider-b", name: "另一供应商", connections: [{
      ...structuredClone(props.connectionSettings.providers[0].connections[0]), id: "other", name: "其他线路",
    }] });
    await render(props);
    const hit = vi.spyOn(document, "elementFromPoint");
    const source = button("拖动排序连接 备用线路");
    for (const target of [button("查看连接 其他线路"), button("查看连接 备用线路"), null]) {
      hit.mockReturnValue(target);
      await act(async () => { pointer(source, "pointerdown", 170); pointer(window, "pointermove"); pointer(window, "pointerup"); });
      expect(container.querySelector("[data-drop]")).toBeNull();
    }
    expect(props.onConnectionMove).not.toHaveBeenCalled();
    expect(props.onProviderMove).not.toHaveBeenCalled();
  });

  it("allows connections to move by keyboard menu without changing the selected connection", async () => {
    const props = withSecondaryConnection();
    await render(props);
    await rightClick(button("查看连接 备用线路"));
    expect(menuItem("下移连接 备用线路").disabled).toBe(true);
    await act(async () => menuItem("上移连接 备用线路").click());
    expect(props.onConnectionMove).toHaveBeenCalledExactlyOnceWith("connection-secondary", "connection-a", "before");
    expect(button("查看连接 主线路").getAttribute("aria-current")).toBe("true");
  });

  it("scrolls near the tree edge during drag and stops after release", async () => {
    vi.useFakeTimers();
    const props = withSecondaryConnection();
    await render(props);
    const tree = container.querySelector<HTMLElement>(".connection-tree")!;
    vi.spyOn(tree, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 100, 200, 80));
    hitRow(button("查看连接 主线路").closest<HTMLElement>("[data-sort-connection]"));
    await act(async () => { pointer(button("拖动排序连接 备用线路"), "pointerdown", 120); pointer(window, "pointermove", 179); vi.advanceTimersByTime(50); });
    expect(tree.scrollTop).toBeGreaterThan(0);
    await act(async () => pointer(window, "pointerup", 179));
    const top = tree.scrollTop;
    await act(async () => vi.advanceTimersByTime(100));
    expect(tree.scrollTop).toBe(top);
  });

  it("shows a real drawing model endpoint and keeps it out of assistant defaults and chat tests", async () => {
    const props = makeProps();
    props.connectionSettings = structuredClone(connectionSettings);
    props.connectionSettings.activeModelId = null;
    const connection = props.connectionSettings.providers[0].connections[0];
    connection.protocol = "gemini-image";
    connection.models = [{ id: "image", modelId: "image/model example", displayName: "Image" }];
    await render(props);
    expect(container.textContent).toContain("Gemini 绘图");
    expect(container.textContent).toContain("https://relay.example.com/v1/v1beta/models/image%2Fmodel%20example:generateContent");
    expect(container.textContent).toContain("绘图模型仅用于绘图页，请生成图片验证。");
    expect(container.querySelector('button[aria-label="设为助手默认模型 image/model example"]')).toBeNull();
    expect(container.querySelector('button[aria-label="测试模型 image/model example"]')).toBeNull();
    expect(container.textContent).not.toContain("streamGenerateContent");
    await act(async () => button("编辑模型 image/model example").click());
    container.querySelector<HTMLInputElement>('.model-edit-form input[name="modelId"]')!.value = "new-image-model";
    await act(async () => container.querySelector('.model-edit-form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(props.onModelChange).toHaveBeenCalledWith("image", "modelId", "new-image-model");
    expect(props.onSelectModel).not.toHaveBeenCalled();
    expect(props.onRunModelTest).not.toHaveBeenCalled();
  });

  it("keeps an empty drawing connection preview free of placeholder model endpoints", async () => {
    const props = makeProps();
    props.connectionSettings = structuredClone(connectionSettings);
    props.connectionSettings.activeModelId = null;
    props.connectionSettings.providers[0].connections[0].protocol = "gemini-image";
    props.connectionSettings.providers[0].connections[0].models = [];
    await render(props);
    expect(container.textContent).toContain("添加模型后可预览绘图生成端点");
    expect(container.textContent).not.toContain("generateContent");
  });

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
    expect(items).toHaveLength(5);
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
