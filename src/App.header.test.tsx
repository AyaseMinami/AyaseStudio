// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import App from "./App";
import { createChatRepository } from "./chat/repository";
import { getWindowController } from "./ui/window/windowController";

vi.mock("./ui/window/windowController", () => ({ getWindowController: vi.fn() }));

it("retains the actual App titlebar and native subscription when switching conversations", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  const repo = createChatRepository();
  await repo.load("current");
  const database = new Dexie("AyaseStudio"); await database.open();
  await Promise.all(database.tables.map(table => table.clear())); database.close();
  await repo.initializeWorkspace(null, []);
  await repo.execute({ type: "rename-conversation", id: "current", title: "合成对话 A" });
  await repo.execute({ type: "create-conversation", id: "b", assistantId: "default" });
  await repo.execute({ type: "rename-conversation", id: "b", title: "合成对话 B" });
  await repo.execute({ type: "select", assistantId: "default", conversationId: "current" });
  const stop = vi.fn();
  const controller = { isDecorated: vi.fn(async () => false), isMaximized: vi.fn(async () => true),
    onResize: vi.fn(async () => stop), minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() };
  vi.mocked(getWindowController).mockReturnValue(controller);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  async function wait(predicate: () => boolean) {
    for (let i = 0; i < 100 && !predicate(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(predicate()).toBe(true);
  }
  try {
    await act(async () => root.render(<App />));
    await wait(() => host.querySelector<HTMLTextAreaElement>(".composer-input")?.disabled === false && !!host.querySelector('[aria-label="还原窗口"]'));
    const nodes = [host.querySelector('.chat-header'), host.querySelector('.chat-layout-button'), host.querySelector('.clear-button'), ...host.querySelectorAll('.window-controls button')];
    for (const title of ["合成对话 B", "合成对话 A"]) {
      await act(async () => host.querySelector<HTMLButtonElement>(`.conversation-leaf-select[title="${title}"]`)!.click());
      await wait(() => host.querySelector('.workspace-conversation-title')?.textContent === title && host.querySelector<HTMLTextAreaElement>(".composer-input")?.disabled === false);
      const current = [host.querySelector('.chat-header'), host.querySelector('.chat-layout-button'), host.querySelector('.clear-button'), ...host.querySelectorAll('.window-controls button')];
      current.forEach((node, index) => expect(node).toBe(nodes[index]));
      expect(host.querySelector('[aria-label="还原窗口"]')).toBe(nodes[4]);
      expect(controller.isDecorated).toHaveBeenCalledOnce();
      expect(controller.onResize).toHaveBeenCalledOnce();
      expect(controller.isMaximized).toHaveBeenCalledOnce();
      expect(stop).not.toHaveBeenCalled();
    }
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks();
  }
  expect(stop).toHaveBeenCalledOnce();
});
