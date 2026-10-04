// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionSettings, type ConnectionSettingsProps } from "./ConnectionSettings";

function makeProps(): ConnectionSettingsProps {
  return {
    connectionSettings: { version: 3, activeModelId: "a", providers: [{ id: "p", name: "供应商", connections: [
      { id: "one", name: "主线路", protocol: "openai-chat", baseUrl: "", apiKey: "", modelGroups: [{ id: "custom", name: "收藏" }, { id: "empty", name: "空组" }],
        models: [{ id: "a", modelId: "gpt-4.1", groupId: "custom" }, { id: "b", modelId: "gemini-2.5-pro" }] },
      { id: "two", name: "备用线路", protocol: "openai-chat", baseUrl: "", apiKey: "", models: [{ id: "c", modelId: "gpt-5" }] },
    ] }] }, isStreaming: false, modelCatalogs: {}, modelTests: {},
    onAddConnection: vi.fn(() => "new"), onAddModel: vi.fn(() => "new"), onAddProvider: vi.fn(() => "new"),
    onCancelModelCatalogRefresh: vi.fn(), onCancelModelTest: vi.fn(), onConnectionChange: vi.fn(),
    onDeleteConnection: vi.fn(), onDeleteModel: vi.fn(), onDeleteProvider: vi.fn(), onModelChange: vi.fn(),
    onProviderRename: vi.fn(), onProviderMove: vi.fn(), onConnectionMove: vi.fn(),
    onRefreshModelCatalog: vi.fn(async () => undefined), onRunModelTest: vi.fn(async () => undefined), onSelectModel: vi.fn(),
    onModelGroupCommand: vi.fn(() => true), onDeleteProviders: vi.fn(() => true), onDeleteConnections: vi.fn(() => true),
  };
}

describe("ConnectionSettings custom groups", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let props: ConnectionSettingsProps;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container); props = makeProps();
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
  async function render() { await act(async () => root.render(<ConnectionSettings {...props} />)); }
  async function click(element: HTMLElement) { await act(async () => element.click()); }
  function button(label: string) {
    return [...container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === label || item.getAttribute("aria-label") === label)!;
  }
  async function search(value: string) {
    const input = container.querySelector<HTMLInputElement>(".model-toolbar input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("shows custom and automatic groups in the regular list, searching group names and keeping no matches clear", async () => {
    await render();
    expect([...container.querySelectorAll('.model-list .model-group header strong')].map(item => item.textContent)).toEqual(["收藏", "空组", "gemini-2.5"]);
    await search("收藏"); expect(container.querySelector('.model-list')?.textContent).toContain("gpt-4.1");
    expect(container.querySelector('.model-list')?.textContent).not.toContain("gemini-2.5-pro");
    await search("missing"); expect(container.querySelector('.model-list')?.textContent).toContain("没有匹配的模型");
    expect(container.querySelectorAll('.model-list .model-group')).toHaveLength(0);
  });

  it("clears group management and selected models on connection switching and entity management", async () => {
    await render(); await click(button("管理分组"));
    await click(container.querySelector<HTMLInputElement>('input[aria-label="选择模型 gpt-4.1"]')!);
    expect(container.textContent).toContain("已选 1 个");
    await click([...container.querySelectorAll<HTMLButtonElement>('.connection-tree-link')].find(item => item.textContent === "备用线路")!);
    expect(container.querySelector('.model-group-management')).toBeNull();
    await click(button("管理分组")); expect(container.textContent).toContain("已选 0 个");
    await click(button("管理供应商")); expect(container.querySelector('.model-group-management')).toBeNull();
    expect(props.onModelGroupCommand).not.toHaveBeenCalled();
  });

  it("blocks entry while loading or streaming and disables open management when generation starts", async () => {
    props.modelCatalogs = { one: { status: "loading", models: [] } }; await render();
    expect(button("管理分组").disabled).toBe(true);
    props.modelCatalogs = {}; props.isStreaming = true; await render(); expect(button("管理分组").disabled).toBe(true);
    props.isStreaming = false; await render(); await click(button("管理分组"));
    await click(container.querySelector<HTMLInputElement>('input[aria-label="选择模型 gpt-4.1"]')!);
    props.isStreaming = true; await render(); expect(button("恢复自动分组").disabled).toBe(true);
    await click(button("恢复自动分组")); expect(props.onModelGroupCommand).not.toHaveBeenCalled();
    await click(button("完成分组")); expect(container.querySelector('.model-group-management')).toBeNull();
  });

  it("keeps unsaved model edits when group entry confirmation is cancelled", async () => {
    await render(); await click(button("编辑模型 gpt-4.1")); await click(button("管理分组"));
    const dialog = document.querySelector<HTMLDialogElement>('.confirmation-dialog')!;
    expect(dialog.textContent).toContain("放弃模型修改");
    await click(dialog.querySelectorAll<HTMLButtonElement>("button")[0]);
    expect(container.querySelector('.model-edit-form')).not.toBeNull(); expect(container.querySelector('.model-group-management')).toBeNull();
    await click(button("管理分组"));
    await click(document.querySelector('.confirmation-dialog')!.querySelectorAll<HTMLButtonElement>("button")[1]);
    expect(container.querySelector('.model-edit-form')).toBeNull(); expect(container.querySelector('.model-group-management')).not.toBeNull();
  });
});
