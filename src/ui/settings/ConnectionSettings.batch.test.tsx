// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionSettings, type ConnectionSettingsProps } from "./ConnectionSettings";
import type { ConnectionProfile, ProviderGroup } from "../../chat/settings";

function connection(id: string, name: string, models = 1): ConnectionProfile {
  return { id, name, protocol: "openai-chat", baseUrl: "https://example.invalid/v1", apiKey: "",
    models: Array.from({ length: models }, (_, index) => ({ id: `${id}-model-${index}`, modelId: `${id}-${index}` })) };
}

function makeProps(): ConnectionSettingsProps {
  const providers: ProviderGroup[] = [
    { id: "provider-a", name: "供应商 A", connections: [connection("a", "连接 A"), connection("b", "连接 B", 2)] },
    { id: "provider-b", name: "供应商 B", connections: [connection("c", "连接 C", 0)] },
    { id: "provider-empty", name: "空供应商", connections: [] },
  ];
  return { connectionSettings: { version: 3, activeModelId: null, providers }, isStreaming: false,
    modelCatalogs: {}, modelTests: {}, onAddConnection: vi.fn(() => "new"), onAddModel: vi.fn(() => "new"),
    onAddProvider: vi.fn(() => "new"), onCancelModelCatalogRefresh: vi.fn(), onCancelModelTest: vi.fn(),
    onConnectionChange: vi.fn(), onDeleteConnection: vi.fn(), onDeleteModel: vi.fn(), onDeleteProvider: vi.fn(),
    onDeleteProviders: vi.fn(() => true), onDeleteConnections: vi.fn(() => true), onModelChange: vi.fn(),
    onProviderRename: vi.fn(), onProviderMove: vi.fn(), onConnectionMove: vi.fn(),
    onRefreshModelCatalog: vi.fn(async () => undefined), onRunModelTest: vi.fn(async () => undefined), onSelectModel: vi.fn() };
}

describe("ConnectionSettings batch management", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let props: ConnectionSettingsProps;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div"); document.body.append(container);
    root = createRoot(container); props = makeProps();
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });
  const render = async () => { await act(async () => root.render(<ConnectionSettings {...props} />)); };
  function button(name: string, scope: ParentNode = container): HTMLButtonElement {
    const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(element =>
      element.getAttribute("aria-label") === name || element.textContent === name);
    expect(found, name).toBeDefined(); return found!;
  }
  async function click(name: string, scope: ParentNode = container) { await act(async () => button(name, scope).click()); }
  function checkbox(name: string): HTMLInputElement {
    const found = container.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`);
    expect(found, name).not.toBeNull(); return found!;
  }
  async function check(name: string) { await act(async () => checkbox(name).click()); }
  function dialog(): HTMLDialogElement {
    expect(document.querySelectorAll("dialog")).toHaveLength(1);
    const found = document.querySelector<HTMLDialogElement>("dialog")!;
    expect(found.open).toBe(true); return found;
  }
  function confirmButton(): HTMLButtonElement { return dialog().querySelector<HTMLButtonElement>(".confirmation-accept")!; }
  async function confirm() { await act(async () => confirmButton().click()); }
  function expectBatchCopy(title: string, action: string, impact: string, warning: string) {
    const current = dialog();
    expect(current.querySelector("h3")?.textContent).toBe(title);
    expect(confirmButton().textContent).toBe(action);
    expect(current.querySelector(".batch-delete-impact")?.textContent).toBe(impact);
    expect(current.querySelector(".batch-delete-warning")?.textContent).toBe(warning);
  }
  async function manageProviders() { await render(); await click("管理供应商"); }
  async function manageConnections() { await render(); await click("管理连接"); }

  it.each(["providers", "connections"])("restores the adjacent management entry after completing %s management", async scope => {
    if (scope === "providers") await manageProviders(); else await manageConnections();
    expect(document.activeElement).toBe(button("完成管理"));
    await click("完成管理");
    expect(document.activeElement).toBe(button(scope === "providers" ? "管理供应商" : "管理连接"));
  });

  it("keeps fixtures without bulk callbacks compatible and hides management entries", async () => {
    props.onDeleteProviders = undefined; props.onDeleteConnections = undefined;
    await render();
    expect([...container.querySelectorAll("button")].some(element => element.textContent === "管理供应商")).toBe(false);
    expect([...container.querySelectorAll("button")].some(element => element.textContent === "管理连接")).toBe(false);
  });

  it("requires one confirmation for an empty provider, cancels without writes and retains selection", async () => {
    await manageProviders(); await check("选择供应商 空供应商");
    const opener = button("删除所选供应商"); opener.focus(); await click("删除所选供应商");
    expectBatchCopy("删除 1 个供应商？", "删除 1 个供应商", "所选供应商均无连接。", "此操作无法撤销。");
    expect(dialog().querySelector(".batch-delete-names")?.textContent).toBe("空供应商");
    expect(document.activeElement).toBe(button("取消", dialog()));
    await click("取消", dialog());
    expect(document.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(checkbox("选择供应商 空供应商").checked).toBe(true);
    expect(props.onDeleteProviders).not.toHaveBeenCalled(); expect(props.onDeleteProvider).not.toHaveBeenCalled();
    await click("删除所选供应商"); await confirm();
    expect(props.onDeleteProviders).toHaveBeenCalledExactlyOnceWith([props.connectionSettings.providers[2]]);
    expect(checkbox("选择供应商 空供应商").checked).toBe(false);
  });

  it("deletes several providers with one callback and exact frozen targets and counts", async () => {
    await manageProviders(); await check("选择供应商 供应商 A"); await check("选择供应商 供应商 B");
    button("删除所选供应商").focus();
    await click("删除所选供应商");
    expectBatchCopy("删除 2 个供应商？", "删除 2 个供应商", "同时删除 3 条连接、3 个配置模型。",
      "此操作无法撤销。聊天历史和绘图成果会保留；受影响的模型需重新选择。");
    expect(dialog().querySelector(".batch-delete-names")?.textContent).toBe("供应商 A、供应商 B");
    const frozen = props.connectionSettings.providers.slice(0, 2);
    await confirm();
    expect(props.onDeleteProviders).toHaveBeenCalledExactlyOnceWith(frozen);
    expect(props.onDeleteProvider).not.toHaveBeenCalled(); expect(props.onDeleteConnection).not.toHaveBeenCalled();
    expect(document.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(button("完成管理"));
    expect(container.querySelector('.batch-result-notice[role="status"]')?.textContent).toBe("已删除 2 个供应商。");
  });

  it("offers provider select-all without mixing connection selections and disables an empty selection", async () => {
    await manageProviders(); expect(button("删除所选供应商").disabled).toBe(true);
    await check("全选供应商");
    for (const provider of props.connectionSettings.providers) expect(checkbox(`选择供应商 ${provider.name}`).checked).toBe(true);
    expect(container.querySelector('input[aria-label^="选择连接"]')).toBeNull();
    expect(container.querySelector("#base-url")).toBeNull();
    await check("全选供应商"); expect(button("删除所选供应商").disabled).toBe(true);
    expect(props.onDeleteProviders).not.toHaveBeenCalled();
  });

  it("selects all only within the current provider and uses one connection callback", async () => {
    await manageConnections(); await check("全选供应商 A的连接");
    expect(checkbox("选择连接 连接 A").checked).toBe(true); expect(checkbox("选择连接 连接 B").checked).toBe(true);
    expect(container.querySelector('input[aria-label="选择连接 连接 C"]')).toBeNull();
    button("删除所选供应商 A的连接").focus(); await click("删除所选供应商 A的连接");
    expectBatchCopy("删除 2 条连接？", "删除 2 条连接", "同时删除 3 个配置模型。",
      "此操作无法撤销。聊天历史和绘图成果会保留；受影响的模型需重新选择。");
    await confirm();
    expect(props.onDeleteConnections).toHaveBeenCalledExactlyOnceWith("provider-a", props.connectionSettings.providers[0].connections);
    expect(props.onDeleteConnection).not.toHaveBeenCalled(); expect(checkbox("选择连接 连接 A").checked).toBe(false);
    expect(document.activeElement).toBe(button("完成管理"));
  });

  it("confirms a connection with no configured models and preserves checks after cancelling", async () => {
    await manageConnections(); await click("供应商 B"); await check("选择连接 连接 C"); await click("删除所选供应商 B的连接");
    expectBatchCopy("删除 1 条连接？", "删除 1 条连接", "所选连接均无配置模型。", "此操作无法撤销。");
    await click("取消", dialog()); expect(checkbox("选择连接 连接 C").checked).toBe(true);
    expect(props.onDeleteConnections).not.toHaveBeenCalled();
  });

  it.each(["replace", "disappear", "new-child"])("blocks changed provider targets: %s", async change => {
    await manageProviders(); await check("选择供应商 供应商 A"); await click("删除所选供应商");
    const provider = props.connectionSettings.providers[0];
    props.connectionSettings = { ...props.connectionSettings, providers: change === "disappear"
      ? props.connectionSettings.providers.slice(1)
      : [{ ...provider, connections: change === "new-child" ? [...provider.connections, connection("new", "新连接")] : provider.connections }, ...props.connectionSettings.providers.slice(1)] };
    await render(); expect(confirmButton().disabled).toBe(true);
    await confirm(); expect(props.onDeleteProviders).not.toHaveBeenCalled();
    expect(dialog().textContent).toMatch(/已改变|范围已改变/);
  });

  it("blocks changed connection children, keeping the original count until reconfirmation", async () => {
    await manageConnections(); await check("选择连接 连接 A"); await click("删除所选供应商 A的连接");
    const provider = props.connectionSettings.providers[0];
    const changed = { ...provider.connections[0], models: [...provider.connections[0].models, { id: "new-model", modelId: "new" }] };
    props.connectionSettings = { ...props.connectionSettings, providers: [{ ...provider, connections: [changed, provider.connections[1]] }, ...props.connectionSettings.providers.slice(1)] };
    await render(); expect(confirmButton().disabled).toBe(true); expect(dialog().textContent).toContain("同时删除 1 个配置模型。");
    await confirm(); expect(props.onDeleteConnections).not.toHaveBeenCalled();
    await click("取消", dialog()); expect(checkbox("选择连接 连接 A").checked).toBe(true);
    await click("删除所选供应商 A的连接"); expect(dialog().textContent).toContain("同时删除 2 个配置模型。");
  });

  it("clears selection and confirmation when the provider scope changes", async () => {
    await manageConnections(); await check("选择连接 连接 A"); await click("删除所选供应商 A的连接");
    await click("供应商 B"); expect(document.querySelector("dialog")).toBeNull();
    expect(checkbox("选择连接 连接 C").checked).toBe(false);
    await click("供应商 A"); expect(checkbox("选择连接 连接 A").checked).toBe(false);
    expect(props.onDeleteConnections).not.toHaveBeenCalled();
  });

  it("blocks entry and pending submit during generation", async () => {
    props.isStreaming = true; await render(); expect(button("管理供应商").disabled).toBe(true); expect(button("管理连接").disabled).toBe(true);
    props.isStreaming = false; await render(); await click("管理供应商"); await check("选择供应商 空供应商"); await click("删除所选供应商");
    props.isStreaming = true; await render(); expect(confirmButton().disabled).toBe(true);
    await confirm(); expect(props.onDeleteProviders).not.toHaveBeenCalled();
  });

  it("allows cancellation after generation begins without losing the selected connection", async () => {
    await manageConnections(); await check("选择连接 连接 A"); await click("删除所选供应商 A的连接");
    props.isStreaming = true; await render();
    expect(confirmButton().disabled).toBe(true); expect(button("取消", dialog()).disabled).toBe(false);
    await click("取消", dialog());
    expect(document.querySelector("dialog")).toBeNull(); expect(checkbox("选择连接 连接 A").checked).toBe(true);
    expect(props.onDeleteConnections).not.toHaveBeenCalled();
  });

  it.each(["false", "throw"])("retains dialog and selection on save failure: %s", async failure => {
    props.onDeleteConnections = vi.fn(() => { if (failure === "throw") throw new Error("本地保存失败"); return false; });
    await manageConnections(); await check("选择连接 连接 A"); await click("删除所选供应商 A的连接"); await confirm();
    expect(dialog().textContent).toMatch(/操作未完成|本地保存失败/); expect(checkbox("选择连接 连接 A").checked).toBe(true);
    expect(props.onDeleteConnections).toHaveBeenCalledTimes(1);
  });

  it("suppresses duplicate confirmation clicks and exits with cleared checks", async () => {
    await manageProviders(); await check("选择供应商 空供应商"); await click("删除所选供应商");
    const submit = confirmButton(); await act(async () => { submit.click(); submit.click(); });
    expect(props.onDeleteProviders).toHaveBeenCalledTimes(1); expect(document.querySelector("dialog")).toBeNull();
    await click("完成管理"); await click("管理供应商"); expect(checkbox("选择供应商 空供应商").checked).toBe(false);
  });

  it("shows one success notice for 3.5 seconds without inserting header status text", async () => {
    await manageProviders(); await check("选择供应商 空供应商"); await click("删除所选供应商");
    vi.useFakeTimers(); await confirm();
    expect(container.querySelectorAll(".batch-result-notice")).toHaveLength(1);
    expect(container.querySelector(".connection-batch-status")).toBeNull();
    await act(async () => vi.advanceTimersByTime(3499)); expect(container.querySelector(".batch-result-notice")).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(1)); expect(container.querySelector(".batch-result-notice")).toBeNull();
  });

  it("discards a model draft before management and opens only the batch delete dialog afterwards", async () => {
    await render(); await click("编辑模型 a-0"); await click("管理连接");
    expect(dialog().textContent).toContain("放弃模型修改"); await click("放弃修改", dialog());
    await check("选择连接 连接 A"); await click("删除所选供应商 A的连接");
    expect(dialog().querySelector("h3")?.textContent).toBe("删除 1 条连接？"); expect(dialog().textContent).not.toContain("放弃模型修改");
    expect(container.querySelector(".model-edit-form")).toBeNull();
  });
});
