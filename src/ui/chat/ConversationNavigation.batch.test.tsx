// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createChatRepository } from "../../chat/repository";
import { defaultSessionConfig } from "../../chat/sessionConfig";
import { emptyConnectionSettings } from "../../chat/settings";
import { useConversationWorkspace } from "../../chat/useConversationWorkspace";
import { ConversationNavigation } from "./ConversationNavigation";
import { createConversationNavigationController } from "./useConversationNavigation";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mounts: Array<{ root: ReturnType<typeof createRoot>; host: HTMLElement; name: string }> = [];
const width = window.innerWidth;
afterEach(async () => {
  for (const { root, host, name } of mounts.splice(0)) { await act(async () => root.unmount()); host.remove(); await Dexie.delete(name); }
  vi.restoreAllMocks(); Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
});
async function wait(predicate: () => boolean) {
  for (let i = 0; i < 120 && !predicate(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  expect(predicate()).toBe(true);
}
async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(item => item.getAttribute("aria-label") === label || item.textContent?.trim() === label);
  expect(button, label).toBeDefined(); expect(button!.disabled).toBe(false);
  await act(async () => { button!.focus(); button!.click(); });
}
async function check(label: string, checked = true) {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  expect(input, label).toBeTruthy(); expect(input.disabled).toBe(false);
  if (input.checked !== checked) await act(async () => input.click());
}
async function mount() {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
  const name = `BatchNavigation-${crypto.randomUUID()}`, repository = createChatRepository(name);
  await repository.initializeWorkspace(null, []);
  for (const [id, label] of [["a", "写作助手"], ["empty", "空助手"]]) await repository.execute({ type: "create-assistant", id,
    input: { name: label, icon: "", defaultModelId: null, defaultConfig: defaultSessionConfig() } });
  for (const id of ["a1", "a2"]) {
    await repository.execute({ type: "create-conversation", id, assistantId: "a" });
    await repository.execute({ type: "rename-conversation", id, title: id });
    await repository.save({ id, updatedAt: 1, messages: [{ id: `${id}-message`, role: "user", content: id, status: "complete" }] });
  }
  await repository.execute({ type: "select", assistantId: "a", conversationId: "a1" });
  const navigation = createConversationNavigationController(1280); navigation.expandAssistant();
  let workspace!: ReturnType<typeof useConversationWorkspace>;
  function Harness({ generating }: { generating: ReadonlySet<string> }) {
    workspace = useConversationWorkspace(repository, null, [], id => generating.has(id));
    return <ConversationNavigation workspace={workspace} settings={emptyConnectionSettings} generatingIds={generating} navigation={navigation}><p>合成正文</p></ConversationNavigation>;
  }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); mounts.push({ root, host, name });
  await act(async () => root.render(<Harness generating={new Set()} />)); await wait(() => workspace.isReady);
  return { repository, host, workspace: () => workspace,
    generating: async (...ids: string[]) => { await act(async () => root.render(<Harness generating={new Set(ids)} />)); },
    settled: () => wait(() => !workspace.busy) };
}

it("requires one confirmation for one empty assistant, with cancel focus and preserved selection", async () => {
  const ui = await mount(), execute = vi.spyOn(ui.repository, "execute");
  await click("批量管理助手"); await check("选择助手 空助手"); await click("删除所选助手");
  expect(document.querySelectorAll("dialog")).toHaveLength(1);
  expect(document.querySelector("dialog")?.textContent).toContain("所选助手均无对话");
  expect(document.activeElement?.textContent).toBe("取消");
  expect(document.querySelector(".batch-delete-treatment")).toBeNull();
  await click("取消"); expect(document.querySelector<HTMLInputElement>('[aria-label="选择助手 空助手"]')?.checked).toBe(true);
  expect(execute.mock.calls.filter(([command]) => command.type === "delete-assistants")).toHaveLength(0);
  await click("删除所选助手"); await click("删除 1 个助手"); await ui.settled();
  expect(execute.mock.calls.filter(([command]) => command.type === "delete-assistants")).toHaveLength(1);
  expect(document.querySelector("dialog")).toBeNull(); expect(ui.host.textContent).toContain("已删除 1 个助手");
  expect(document.activeElement?.getAttribute("aria-label")).toBe("完成助手管理");
  expect(ui.workspace().snapshot?.assistants.some(item => item.id === "empty")).toBe(false);
});

it("selects all deletable assistants, switches cascade treatment inside the same dialog and keeps the default", async () => {
  const ui = await mount();
  await click("批量管理助手"); await check("全选助手");
  expect(document.querySelector<HTMLInputElement>('[aria-label="选择助手 默认助手"]')?.disabled).toBe(true);
  await click("删除所选助手");
  expect(document.querySelector("dialog")?.textContent).toContain("2 个对话将移至默认助手");
  const dialog = document.querySelector("dialog");
  await act(async () => [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')][1].click());
  expect(document.querySelector("dialog")).toBe(dialog); expect(document.querySelectorAll("dialog")).toHaveLength(1);
  expect(dialog?.textContent).toContain("同时删除 2 个对话及全部消息");
  await click("删除助手及对话"); await ui.settled();
  expect(ui.workspace().snapshot?.assistants.map(item => item.id)).toEqual(["default"]);
  expect(await ui.repository.load("a1")).toBeUndefined(); expect(await ui.repository.load("a2")).toBeUndefined();
  expect(await ui.repository.load("current")).toBeDefined();
});

it("defaults to preserving messages when deleting an assistant and permits later conversation deletion", async () => {
  const ui = await mount();
  await click("批量管理助手"); await check("选择助手 写作助手"); await click("删除所选助手"); await click("删除 1 个助手"); await ui.settled();
  expect(ui.workspace().snapshot?.conversations.filter(item => ["a1", "a2"].includes(item.id)).every(item => item.assistantId === "default")).toBe(true);
  expect((await ui.repository.load("a1"))?.messages[0].content).toBe("a1");
  await click("批量管理对话"); await check("选择对话 a1"); await click("删除所选对话");
  expect(document.querySelector("dialog")?.textContent).toContain("全部消息");
  await click("删除 1 个对话"); await ui.settled(); expect(await ui.repository.load("a1")).toBeUndefined();
  expect(document.activeElement?.getAttribute("aria-label")).toBe("完成对话管理");
  expect(await ui.repository.load("a2")).toBeDefined(); expect(await ui.repository.load("current")).toBeDefined();
});

it("blocks the entire batch if generation starts after confirmation opens", async () => {
  const ui = await mount(); await click("批量管理对话"); await check("全选对话"); await click("删除所选对话");
  await ui.generating("a2");
  expect(document.querySelector<HTMLButtonElement>(".confirmation-accept")?.disabled).toBe(true);
  expect(document.querySelector("dialog")?.textContent).toContain("请先停止所选对话");
  await click("取消");
  expect(document.querySelector<HTMLButtonElement>('[aria-label="删除所选对话"]')?.disabled).toBe(true);
  expect(ui.workspace().snapshot?.conversations.filter(item => item.assistantId === "a")).toHaveLength(2);
});

it("blocks a stale child scope and lets cancel reopen with the new total", async () => {
  const ui = await mount(); await click("批量管理助手"); await check("选择助手 写作助手"); await click("删除所选助手");
  await act(async () => { await ui.workspace().execute({ type: "create-conversation", id: "new", assistantId: "a" }); });
  expect(document.querySelector<HTMLButtonElement>(".confirmation-accept")?.disabled).toBe(true);
  expect(document.querySelector("dialog")?.textContent).toContain("删除范围已变化");
  await click("取消"); await click("删除所选助手");
  expect(document.querySelector("dialog")?.textContent).toContain("3 个对话将移至默认助手");
});

it("clears conversation selection when changing assistants", async () => {
  const ui = await mount(); await click("批量管理对话"); await check("全选对话"); await click("默认助手"); await ui.settled();
  await wait(() => !document.querySelector('[aria-label="全选对话"]'));
  await click("写作助手"); await ui.settled(); await click("批量管理对话");
  expect(document.querySelector<HTMLInputElement>('[aria-label="全选对话"]')?.checked).toBe(false);
  expect(document.querySelector<HTMLButtonElement>('[aria-label="删除所选对话"]')?.disabled).toBe(true);
});

it("keeps selection and the confirmation after a storage failure, then retries one whole command", async () => {
  const ui = await mount(); await click("批量管理对话"); await check("全选对话"); await click("删除所选对话");
  vi.spyOn(ui.repository, "execute").mockRejectedValueOnce(new Error("synthetic storage failure"));
  await click("删除 2 个对话"); await ui.settled();
  expect(document.querySelector("dialog")?.textContent).toContain("synthetic storage failure");
  expect(document.querySelectorAll('input[aria-label^="选择对话"]:checked')).toHaveLength(2);
  await click("删除 2 个对话"); await ui.settled();
  expect(ui.workspace().snapshot?.conversations.filter(item => item.assistantId === "a")).toHaveLength(0);
});
