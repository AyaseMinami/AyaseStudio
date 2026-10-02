// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatRepository } from "../../chat/repository";
import { emptyConnectionSettings } from "../../chat/settings";
import { useConversationWorkspace } from "../../chat/useConversationWorkspace";
import { ConversationNavigation } from "./ConversationNavigation";

const rowIconRender = vi.hoisted(() => vi.fn());
vi.mock("lucide-react", async () => {
  const icons = await vi.importActual<typeof import("lucide-react")>("lucide-react");
  return { ...icons, MessageSquare: (props: React.ComponentProps<typeof icons.MessageSquare>) => {
    rowIconRender();
    return createElement(icons.MessageSquare, props);
  } };
});

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
type Workspace = ReturnType<typeof useConversationWorkspace>;
const mounted: Array<{ root: ReturnType<typeof createRoot>; host: HTMLDivElement; databaseName: string }> = [];
const originalWidth = window.innerWidth;
afterEach(async () => {
  for (const { root, host, databaseName } of mounted.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
    await Dexie.delete(databaseName);
  }
  vi.restoreAllMocks();
  rowIconRender.mockClear();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
});

async function click(element: Element) {
  await act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, detail: 1 })));
}
async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 100 && !predicate(); i++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  }
  expect(predicate()).toBe(true);
}
async function mount() {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
  const databaseName = `ConversationNavigation-performance-${crypto.randomUUID()}`;
  const repository = createChatRepository(databaseName);
  await repository.initializeWorkspace(null, []);
  await repository.execute({ type: "rename-conversation", id: "current", title: "对话一" });
  await repository.execute({ type: "create-conversation", id: "second", assistantId: "default" });
  await repository.execute({ type: "rename-conversation", id: "second", title: "对话二" });
  await repository.execute({ type: "select", assistantId: "default", conversationId: "current" });
  let workspace!: Workspace;
  let setExecute!: React.Dispatch<React.SetStateAction<Workspace["execute"] | undefined>>;
  let setBusy!: React.Dispatch<React.SetStateAction<boolean>>;
  let setGenerating!: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
  function Harness() {
    const [execute, updateExecute] = useState<Workspace["execute"]>();
    const [busy, updateBusy] = useState(false);
    const [generating, updateGenerating] = useState<ReadonlySet<string>>(new Set());
    setExecute = updateExecute; setBusy = updateBusy; setGenerating = updateGenerating;
    workspace = useConversationWorkspace(repository, null, [], id => generating.has(id));
    return <ConversationNavigation workspace={{ ...workspace, execute: execute ?? workspace.execute, busy: busy || workspace.busy }}
      settings={emptyConnectionSettings} generatingIds={generating}><p>正文</p></ConversationNavigation>;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted.push({ root, host, databaseName });
  await act(async () => root.render(<Harness />));
  await waitFor(() => workspace.isReady);
  const button = (label: string) => {
    const result = [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find(item => item.getAttribute("aria-label") === label || item.textContent === label);
    expect(result, `button ${label}`).toBeDefined();
    return result!;
  };
  return { host, button, repository, workspace: () => workspace, setExecute, setBusy, setGenerating,
    settled: () => waitFor(() => !workspace.busy) };
}

describe("conversation navigation list render isolation", () => {
  it("keeps unchanged row icons mounted without rendering on navigation visibility changes", async () => {
    const ui = await mount();
    const row = ui.host.querySelector<HTMLLIElement>('[data-conversation-id="second"]')!;
    const icon = row.querySelector(".lucide-message-square");
    const list = row.closest<HTMLUListElement>("ul")!;
    list.scrollTop = 120;
    const count = rowIconRender.mock.calls.length;
    expect(count).toBeGreaterThan(0);
    await click(ui.button("默认助手"));
    await click(ui.button("收起对话栏"));
    await click(ui.button("展开对话列表"));
    await click(ui.button("助手与对话"));
    await click(ui.button("助手与对话"));
    expect(rowIconRender).toHaveBeenCalledTimes(count);
    expect(ui.host.querySelector('[data-conversation-id="second"]')).toBe(row);
    expect(row.querySelector(".lucide-message-square")).toBe(icon);
    expect(list.scrollTop).toBe(120);
  });

  it("uses the latest committed execute for selection and pending deletion without rerendering unchanged rows", async () => {
    const ui = await mount();
    const firstExecute = vi.fn((command: Parameters<Workspace["execute"]>[0]) => ui.workspace().execute(command));
    await act(async () => ui.setExecute(() => firstExecute));
    await click(ui.button("对话二"));
    await ui.settled();
    expect(firstExecute).toHaveBeenCalledWith({ type: "select", assistantId: "default", conversationId: "second" });
    expect(ui.button("对话二").getAttribute("aria-pressed")).toBe("true");
    expect(ui.button("对话一").getAttribute("aria-pressed")).toBe("false");
    const secondExecute = vi.fn((command: Parameters<Workspace["execute"]>[0]) => ui.workspace().execute(command));
    const count = rowIconRender.mock.calls.length;
    await act(async () => ui.setExecute(() => secondExecute));
    expect(rowIconRender).toHaveBeenCalledTimes(count);
    await click(ui.button("对话一"));
    await ui.settled();
    expect(secondExecute).toHaveBeenCalledWith({ type: "select", assistantId: "default", conversationId: "current" });
    expect(ui.button("对话一").getAttribute("aria-pressed")).toBe("true");
    await click(ui.button("删除对话 对话二"));
    const thirdExecute = vi.fn((command: Parameters<Workspace["execute"]>[0]) => ui.workspace().execute(command));
    const pendingCount = rowIconRender.mock.calls.length;
    await act(async () => ui.setExecute(() => thirdExecute));
    expect(rowIconRender).toHaveBeenCalledTimes(pendingCount);
    await click(ui.button("确认删除对话 对话二"));
    await ui.settled();
    expect(thirdExecute).toHaveBeenCalledWith({ type: "delete-conversation", id: "second" });
    expect(firstExecute).toHaveBeenCalledTimes(1);
    expect(secondExecute).toHaveBeenCalledTimes(1);
    expect(ui.host.querySelector('[data-conversation-id="second"]')).toBeNull();
  });

  it("updates generation labels and deletion guards when the generating set changes", async () => {
    const ui = await mount();
    const row = ui.host.querySelector('[data-conversation-id="second"]')!;
    await act(async () => ui.setGenerating(new Set(["second"])));
    expect(ui.button("对话二 · 生成中").title).toBe("对话二 · 生成中");
    expect(ui.button("删除对话 对话二").disabled).toBe(true);
    expect(ui.button("删除对话 对话二").dataset.busyOnly).toBe("false");
    await click(ui.button("删除对话 对话二"));
    expect(row.querySelector('[data-pending="true"]')).toBeNull();
    await act(async () => ui.setGenerating(new Set()));
    expect(ui.button("对话二").title).toBe("对话二");
    expect(ui.button("删除对话 对话二").disabled).toBe(false);
    expect(ui.host.querySelector('[data-conversation-id="second"]')).toBe(row);
  });

  it("uses current busy and dialog guards for context menus and clears hidden pending deletion", async () => {
    const ui = await mount();
    const row = ui.host.querySelector('[data-conversation-id="second"]')!;
    const context = () => act(async () => row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    await act(async () => ui.setBusy(true));
    expect(ui.button("对话二").disabled).toBe(true);
    expect(ui.button("拖动对话 对话二").disabled).toBe(true);
    await context();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await act(async () => ui.setBusy(false));
    await context();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    await act(async () => document.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })));
    await click(ui.button("新建助手"));
    expect(ui.button("拖动对话 对话二").disabled).toBe(true);
    await context();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await click(ui.button("取消"));
    expect(ui.button("拖动对话 对话二").disabled).toBe(false);
    await click(ui.button("删除对话 对话二"));
    await click(ui.button("收起对话栏"));
    expect(row.querySelector('[data-pending="true"]')).toBeNull();
    await click(ui.button("展开对话列表"));
    expect(ui.button("删除对话 对话二")).toBeDefined();
    await click(ui.button("删除对话 对话二"));
    await click(ui.button("取消删除对话 对话二"));
    expect(document.activeElement).toBe(ui.button("删除对话 对话二"));
    expect(row.querySelector('[data-pending="true"]')).toBeNull();
  });

  it("renders conversation drag/drop attributes and saves the same reorder command", async () => {
    const ui = await mount();
    const execute = vi.spyOn(ui.repository, "execute");
    const handle = ui.button("拖动对话 对话一");
    const target = ui.button("对话二");
    vi.spyOn(document, "elementFromPoint").mockReturnValue(target);
    await act(async () => {
      handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, isPrimary: true, pointerId: 1, clientX: 10, clientY: 10 }));
      window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 30, clientY: 30 }));
    });
    expect(ui.host.querySelector('[data-conversation-id="current"]')?.getAttribute("data-dragging")).toBe("true");
    expect(ui.host.querySelector('[data-conversation-id="second"]')?.getAttribute("data-drop-placement")).toBe("after");
    await act(async () => window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 30, clientY: 30 })));
    await ui.settled();
    expect(execute).toHaveBeenCalledWith({ type: "reorder-conversation", id: "current", targetId: "second", placement: "after" });
    expect(ui.host.querySelector('[data-dragging="true"]')).toBeNull();
    expect([...ui.host.querySelectorAll<HTMLElement>("[data-conversation-id]")].map(row => row.dataset.conversationId)).toEqual(["second", "current"]);
  });
});
