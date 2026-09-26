// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import type { StoredChatMessage } from "../../chat/repository";
import { MessageList, type MessageActions } from "./MessageList";
import "fake-indexeddb/auto";
import { createChatRepository } from "../../chat/repository";

const messages: StoredChatMessage[] = [
  { id: "user", role: "user", content: "**raw markdown**", status: "complete", replyToId: null },
  { id: "answer", role: "assistant", content: "Answer", status: "complete", replyToId: "user" },
];

it("restores raw math and renders user, summary and streamed assistant consistently", async () => {
  const name = `MathMessages-${crypto.randomUUID()}`;
  const source = String.raw`**公式** $\frac{x_1}{2}$`;
  const original: StoredChatMessage[] = [
    { id: "u", role: "user", content: source, status: "complete" },
    { id: "a", role: "assistant", content: source, thinkingSummary: source, status: "complete", replyToId: "u" },
  ];
  await createChatRepository(name).save({ id: "current", updatedAt: 1, messages: original });
  const restored = (await createChatRepository(name).load("current"))!.messages;
  expect(restored).toEqual(original);
  const { host, root } = setup();
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  try {
    await act(async () => root.render(<MessageList messages={restored} />));
    await act(async () => host.querySelector<HTMLButtonElement>(".thinking-summary-heading")!.click());
    expect(host.querySelectorAll(".katex")).toHaveLength(3);
    expect(host.querySelector(".user-message strong")?.textContent).toBe("公式");
    await act(async () => host.querySelector<HTMLButtonElement>("article:first-child [aria-label='复制']")!.click());
    expect(writeText).toHaveBeenCalledWith(source);
    const stream = String.raw`$\frac{x}{2}$`;
    for (let end = 0; end <= stream.length; end++) {
      await act(async () => root.render(<MessageList messages={[{ ...original[1], content: stream.slice(0, end), status: "streaming" }]} />));
    }
    expect(host.querySelector(".assistant-message > p .katex")).not.toBeNull();
    expect(restored).toEqual(original);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

function setup(actions: Partial<MessageActions> = {}, actionsDisabled = false, onKeyDown?: () => void) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Element.prototype.scrollIntoView = () => {};
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const handlers: MessageActions = {
    edit: vi.fn(async () => true), editAndSend: vi.fn(async () => true), delete: vi.fn(async () => true), retry: vi.fn(async () => {}), branch: vi.fn(async () => true), ...actions,
  };
  const render = () => root.render(<div onKeyDown={onKeyDown}><MessageList messages={messages} actions={handlers} actionsDisabled={actionsDisabled} /></div>);
  return { host, root, handlers, render };
}

it("copies raw Markdown without rendering it first", async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const { host, root, render } = setup();
  try {
    await act(async () => render());
    const copyButton = host.querySelector<HTMLButtonElement>("article:first-child [aria-label='复制']")!;
    expect(copyButton.title).toBe("复制");
    expect(copyButton.textContent).toBe("");
    expect(copyButton.querySelector("svg")).not.toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>("article:first-child [aria-label='复制']")!.click());
    expect(writeText).toHaveBeenCalledWith("**raw markdown**");
    expect(host.textContent).toContain("已复制原始消息");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("cancels an edit, then saves without a destructive confirmation", async () => {
  const { host, root, handlers, render } = setup();
  try {
    await act(async () => render());
    const edit = () => host.querySelector<HTMLButtonElement>("article:first-child [aria-label='编辑']")!;
    await act(async () => edit().click());
    expect(host.querySelector("textarea")?.value).toBe("**raw markdown**");
    await act(async () => host.querySelector<HTMLButtonElement>(".message-editor button")!.click());
    expect(handlers.edit).not.toHaveBeenCalled();
    await act(async () => edit().click());
    await act(async () => {
      const textarea = host.querySelector<HTMLTextAreaElement>("textarea")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "changed");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => host.querySelector<HTMLButtonElement>(".message-editor .settings-button")!.click());
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(handlers.edit).toHaveBeenCalledWith("user", "changed");
    expect(handlers.editAndSend).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("confirms deletion and retries from the linked user message", async () => {
  const { host, root, handlers, render } = setup();
  try {
    await act(async () => render());
    await act(async () => host.querySelector<HTMLButtonElement>("article:first-child [aria-label='删除']")!.click());
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("永久删除");
    await act(async () => host.querySelector<HTMLButtonElement>(".message-confirm-dialog .settings-button")!.click());
    expect(handlers.delete).toHaveBeenCalledWith("user");
    await act(async () => host.querySelector<HTMLButtonElement>("article:nth-child(2) [aria-label='重新生成']")!.click());
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("1 条消息");
    await act(async () => host.querySelector<HTMLButtonElement>(".message-confirm-dialog .settings-button")!.click());
    expect(handlers.retry).toHaveBeenCalledWith("user");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("closes the retry confirmation before a long-running retry resolves", async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  let finish: (() => void) | undefined;
  const retry = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  const { host, root, render } = setup({ retry });
  try {
    await act(async () => render());
    await act(async () => host.querySelector<HTMLButtonElement>("article:nth-child(2) [aria-label='重新生成']")!.click());
    await act(async () => host.querySelector<HTMLButtonElement>(".message-confirm-dialog .settings-button")!.click());
    expect(retry).toHaveBeenCalledWith("user");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>("article:first-child [aria-label='复制']")!.click());
    expect(writeText).toHaveBeenCalledWith("**raw markdown**");
    await act(async () => finish?.());
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("keeps the edit draft open when saving reports no change", async () => {
  const edit = vi.fn(async () => false);
  const { host, root, render } = setup({ edit });
  try {
    await act(async () => render());
    await act(async () => host.querySelector<HTMLButtonElement>("article:first-child [aria-label='编辑']")!.click());
    await act(async () => host.querySelector<HTMLButtonElement>(".message-editor .settings-button")!.click());
    expect(edit).toHaveBeenCalledWith("user", "**raw markdown**");
    expect(host.querySelector("textarea")?.value).toBe("**raw markdown**");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("confirms edit and send only for user messages and supports cancelling the confirmation", async () => {
  const { host, root, handlers, render } = setup();
  try {
    await act(async () => render());
    await act(async () => host.querySelector<HTMLButtonElement>("article:first-child [aria-label='编辑']")!.click());
    await act(async () => host.querySelector<HTMLButtonElement>(".message-editor-send")!.click());
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("1 条消息");
    await act(async () => host.querySelector<HTMLButtonElement>(".message-confirm-actions button")!.click());
    expect(handlers.editAndSend).not.toHaveBeenCalled();
    expect(host.querySelector("textarea")).not.toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>(".message-editor-send")!.click());
    await act(async () => host.querySelector<HTMLButtonElement>(".message-confirm-dialog .settings-button")!.click());
    expect(handlers.editAndSend).toHaveBeenCalledWith("user", "**raw markdown**");
    expect(handlers.edit).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLButtonElement>("article:nth-child(2) [aria-label='编辑']")!.click());
    expect(host.querySelector(".message-editor-send")).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("keeps copy available while mutation controls are disabled", async () => {
  const { host, root, render } = setup({}, true);
  try {
    await act(async () => render());
    for (const label of ["编辑", "删除", "重新生成", "分支"]) {
      expect(host.querySelector<HTMLButtonElement>(`article:first-child [aria-label='${label}']`)?.disabled).toBe(true);
    }
    expect(host.querySelector<HTMLButtonElement>("article:first-child [aria-label='复制']")?.disabled).toBe(false);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("contains Escape inside message confirmation instead of closing the conversation sidebar", async () => {
  const parentEscape = vi.fn();
  const { host, root, render } = setup({}, false, parentEscape);
  try {
    await act(async () => render());
    await act(async () => host.querySelector<HTMLButtonElement>("article:first-child [aria-label='删除']")!.click());
    await act(async () => host.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(parentEscape).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
