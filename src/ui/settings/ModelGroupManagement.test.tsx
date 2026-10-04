// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionProfile, ModelGroupCommand } from "../../chat/settings";
import { ModelGroupManagement } from "./ModelGroupManagement";

function fixture(): ConnectionProfile {
  return { id: "connection-a", name: "主线路", protocol: "openai-chat", baseUrl: "", apiKey: "",
    modelGroups: [{ id: "custom", name: "收藏" }, { id: "empty", name: "空组" }],
    models: [
      { id: "a", modelId: "gpt-4.1", displayName: "Alpha", groupId: "custom" },
      { id: "b", modelId: "gemini-2.5-pro", displayName: "Beta" },
    ] };
}

describe("ModelGroupManagement", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let connection: ConnectionProfile;
  let onCommand: ReturnType<typeof vi.fn<(connectionId: string, command: ModelGroupCommand) => boolean>>;
  let search: string;
  let disabled: boolean;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div"); document.body.append(container);
    root = createRoot(container);
    connection = fixture(); onCommand = vi.fn(() => true); search = ""; disabled = false;
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
  async function render() {
    await act(async () => root.render(<ModelGroupManagement key={connection.id} connection={connection}
      search={search} disabled={disabled} onCommand={onCommand} />));
  }
  function button(text: string) {
    return [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find(item => item.textContent === text || item.getAttribute("aria-label") === text)!;
  }
  function checkbox(label: string) { return container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!; }
  async function click(element: HTMLElement) { await act(async () => element.click()); }
  async function inputName(value: string) {
    const input = container.querySelector<HTMLInputElement>("#model-group-name")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function submitName() {
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  }
  async function pickGroup(label: string) {
    await click(button("自动分组"));
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent === label)!;
    await click(option);
  }
  async function answerConfirmation(accepted: boolean) {
    const dialog = document.querySelector<HTMLDialogElement>(".confirmation-dialog")!;
    await click(dialog.querySelectorAll<HTMLButtonElement>("button")[accepted ? 1 : 0]);
  }

  it("creates and renames trimmed names, rejecting blank and case-insensitive duplicates in this connection", async () => {
    await render();
    await inputName("  "); await submitName();
    expect(container.textContent).toContain("请输入分组名称"); expect(onCommand).not.toHaveBeenCalled();
    connection = { ...connection, modelGroups: [...connection.modelGroups!, { id: "work", name: "Work" }] }; await render();
    await inputName(" work "); await submitName();
    expect(container.textContent).toContain("同名分组"); expect(onCommand).not.toHaveBeenCalled();
    await inputName(" 新分组 "); await submitName();
    expect(onCommand).toHaveBeenCalledWith("connection-a", { kind: "create", id: expect.any(String), name: "新分组" });
    const created = onCommand.mock.calls[0][1];
    if (created.kind !== "create") throw new Error("Expected a create command");
    expect(created.id).toMatch(/^[\da-f-]{36}$/i);
    await click(button("重命名分组 收藏"));
    await inputName(" 精选 "); await submitName();
    expect(onCommand).toHaveBeenLastCalledWith("connection-a", { kind: "rename", id: "custom", name: "精选" });
  });

  it("selects visible search results without losing hidden selection and assigns all selected IDs", async () => {
    await render();
    await click(checkbox("选择模型 gpt-4.1"));
    search = "Beta"; await render();
    expect(container.textContent).toContain("已选 1 个（含 1 个隐藏项）");
    await click(checkbox("全选当前搜索结果"));
    expect(container.textContent).toContain("已选 2 个（含 1 个隐藏项）");
    await click(checkbox("全选当前搜索结果"));
    expect(container.textContent).toContain("已选 1 个（含 1 个隐藏项）");
    await click(checkbox("全选当前搜索结果"));
    await pickGroup("收藏"); await click(button("分配到分组"));
    expect(onCommand).toHaveBeenCalledWith("connection-a", { kind: "assign", modelIds: ["a", "b"], groupId: "custom" });
    expect(container.textContent).toContain("已选 0 个");
  });

  it("supports single-model automatic grouping and preserves selections after false or thrown save errors", async () => {
    await render(); await click(checkbox("选择模型 gpt-4.1"));
    onCommand.mockReturnValueOnce(false);
    await click(button("恢复自动分组"));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("未完成");
    expect(checkbox("选择模型 gpt-4.1").checked).toBe(true);
    onCommand.mockImplementationOnce(() => { throw new Error("保存失败"); });
    await click(button("恢复自动分组"));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("保存失败");
    expect(checkbox("选择模型 gpt-4.1").checked).toBe(true);
    await click(button("恢复自动分组"));
    expect(onCommand).toHaveBeenLastCalledWith("connection-a", { kind: "assign", modelIds: ["a"], groupId: null });
    expect(checkbox("选择模型 gpt-4.1").checked).toBe(false);
  });

  it("confirms deletion with explicit model preservation and leaves it unchanged after cancellation", async () => {
    await render(); await click(button("删除分组 收藏"));
    expect(document.querySelector(".confirmation-dialog")?.textContent).toContain("保留所有模型");
    expect(document.querySelector(".confirmation-dialog")?.textContent).toContain("恢复自动分组");
    await answerConfirmation(false); expect(onCommand).not.toHaveBeenCalled();
    await click(button("删除分组 收藏")); await answerConfirmation(true);
    expect(onCommand).toHaveBeenCalledExactlyOnceWith("connection-a", { kind: "delete", id: "custom" });
    expect(connection.models).toHaveLength(2);
  });

  it("blocks commands and selection while disabled, including pending deletion becoming disabled", async () => {
    await render(); await click(checkbox("选择模型 gpt-4.1"));
    await click(button("删除分组 收藏")); disabled = true; await render();
    await answerConfirmation(true); expect(onCommand).not.toHaveBeenCalled();
    expect(button("恢复自动分组").disabled).toBe(true);
    expect(checkbox("选择模型 gpt-4.1").disabled).toBe(true);
    await inputName("阻止提交"); await submitName(); expect(onCommand).not.toHaveBeenCalled();
  });

  it("searches group labels, preserves empty groups, and shows no match for an unrelated query", async () => {
    await render();
    expect([...container.querySelectorAll(".model-list .model-group header strong")].map(item => item.textContent))
      .toEqual(["收藏", "空组", "gemini-2.5"]);
    search = "收藏"; await render(); expect(checkbox("选择模型 gpt-4.1")).not.toBeNull();
    expect(checkbox("选择模型 gemini-2.5-pro")).toBeNull();
    search = "空组"; await render(); expect(container.querySelector(".model-list")?.textContent).toContain("此分组暂无模型");
    search = "no-match"; await render(); expect(container.querySelector(".model-list")?.textContent).toContain("没有匹配的模型");
    expect(container.querySelectorAll(".model-list .model-group")).toHaveLength(0);
  });

  it("clears selection and cancels a pending deletion when the connection changes", async () => {
    await render(); await click(checkbox("选择模型 gpt-4.1")); await click(button("删除分组 收藏"));
    connection = { ...fixture(), id: "connection-b", modelGroups: [] }; await render();
    expect(document.querySelector(".confirmation-dialog")).toBeNull();
    expect(container.textContent).toContain("已选 0 个"); expect(onCommand).not.toHaveBeenCalled();
  });
});
