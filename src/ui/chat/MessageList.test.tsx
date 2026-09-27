// @vitest-environment happy-dom
import { act, useLayoutEffect } from "react";
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

it("keeps both action bars and copy feedback outside message bodies", async () => {
  const { host, root, render } = setup();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async () => {}) } });
  try {
    await act(async () => render());
    for (const group of host.querySelectorAll(".user-message-group, .assistant-message-group")) {
      const body = group.querySelector(".markdown")!;
      expect(body.querySelector(".message-actions")).toBeNull();
      expect(body.nextElementSibling?.className).toBe("message-actions");
      await act(async () => group.querySelector<HTMLButtonElement>("[aria-label='复制']")!.click());
      expect(group.querySelector(".message-copy-feedback")?.parentElement).toBe(group);
    }
  } finally { await act(async () => root.unmount()); host.remove(); }
});

// happy-dom has no layout; model the scroll container's measured geometry and
// browser clamping while exercising the real component events and updates.
async function setupScrolling(withAttachment = false) {
  const { host, root } = setup();
  let chunk = 0;
  const attachment = { reference: "attachments/notes.txt", name: "notes.txt", mimeType: "text/plain" as const, size: 5 };
  const readAttachment = async () => ({ ...attachment, data: "SGVsbG8=" });
  const render = (key = "conversation", empty = false) => root.render(<MessageList key={key}
    onReadAttachment={readAttachment}
    messages={empty ? [] : [{ ...messages[1], content: `chunk ${++chunk}`, status: "streaming",
      attachments: withAttachment ? [attachment] : undefined }]} />);
  await act(async () => render());
  const region = host.querySelector<HTMLDivElement>(".message-scroll-region")!;
  let height = 1000;
  let top = 0;
  Object.defineProperties(region, {
    clientHeight: { configurable: true, get: () => 400 },
    scrollHeight: { configurable: true, get: () => height },
    scrollTop: { configurable: true, get: () => top, set: (value: number) => { top = Math.max(0, Math.min(value, height - 400)); } },
  });
  const scroll = async (value: number) => act(async () => {
    region.scrollTop = value;
    region.dispatchEvent(new Event("scroll"));
  });
  const wheelUp = async () => act(async () => {
    region.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -20 }));
  });
  const grow = async () => { height += 100; await act(async () => render()); };
  await act(async () => render());
  return { host, root, region, scroll, wheelUp, grow, render };
}

it("keeps following stream growth without user scrolling", async () => {
  const { host, root, region, grow } = await setupScrolling();
  try {
    expect(region.scrollTop).toBe(600);
    await grow();
    expect(region.scrollTop).toBe(700);
    await grow();
    expect(region.scrollTop).toBe(800);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("pauses on upward wheel input before the scroll event and stays paused even near the bottom", async () => {
  const { host, root, region, grow, scroll, wheelUp } = await setupScrolling();
  try {
    await wheelUp();
    await grow();
    expect(region.scrollTop).toBe(600);
    await scroll(580);
    await grow();
    expect(region.scrollTop).toBe(580);
    await scroll(760); // Within 48px of the current bottom: resume.
    await grow();
    expect(region.scrollTop).toBe(900);
    await wheelUp();
    await scroll(880); // Still near the bottom, but moving upward must pause.
    await grow();
    expect(region.scrollTop).toBe(880);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("supports scrollbar scrolling and resumes only after returning near the bottom", async () => {
  const { host, root, region, grow, scroll } = await setupScrolling();
  try {
    await scroll(200);
    await grow();
    expect(region.scrollTop).toBe(200);
    await scroll(400);
    await grow();
    expect(region.scrollTop).toBe(400);
    await scroll(752); // Exactly 48px from the bottom.
    await grow();
    expect(region.scrollTop).toBe(900);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("does not pause transcript following when scrolling upward inside attachment preview", async () => {
  const { host, root, region, grow } = await setupScrolling(true);
  try {
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="预览附件 notes.txt"]')!.click());
    await act(async () => host.querySelector(".attachment-preview-text")!.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, deltaY: -20 }),
    ));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="关闭预览"]')!.click());
    await grow();
    expect(region.scrollTop).toBe(700);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("resets following when messages are cleared or a different conversation is mounted", async () => {
  const { host, root, region, grow, scroll, render } = await setupScrolling();
  try {
    await scroll(200);
    await act(async () => render("conversation", true));
    await grow();
    expect(region.scrollTop).toBe(700);
    await scroll(200);
    await act(async () => render("other-conversation"));
    const other = host.querySelector<HTMLDivElement>(".message-scroll-region")!;
    expect(other).not.toBe(region);
    Object.defineProperties(other, {
      scrollHeight: { configurable: true, value: 1200 },
      clientHeight: { configurable: true, value: 400 },
    });
    await act(async () => render("other-conversation"));
    expect(other.scrollTop).toBeGreaterThan(0);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it.each([false, true])("positions conversation history before paint (delayed load: %s)", async (delayed) => {
  const { host, root } = setup();
  const positions = new WeakMap<HTMLElement, number>();
  const height = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.querySelectorAll("article").length * 500;
  });
  const viewport = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
  const readTop = vi.spyOn(HTMLElement.prototype, "scrollTop", "get").mockImplementation(function (this: HTMLElement) {
    return positions.get(this) ?? 0;
  });
  const writeTop = vi.spyOn(HTMLElement.prototype, "scrollTop", "set").mockImplementation(function (this: HTMLElement, value: number) {
    positions.set(this, Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)));
  });
  const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
  let beforePaint = -1;
  function Screen({ id, history }: { id: string; history: StoredChatMessage[] }) {
    // Parent layout effects observe the child after its layout effects but before
    // passive effects. An after-paint useEffect scroll cannot satisfy this check.
    useLayoutEffect(() => {
      beforePaint = host.querySelector<HTMLDivElement>(".message-scroll-region")!.scrollTop;
    });
    return <MessageList key={id} messages={history} />;
  }
  try {
    await act(async () => root.render(<Screen id="first" history={messages} />));
    expect(beforePaint).toBe(600);
    const first = host.querySelector<HTMLDivElement>(".message-scroll-region")!;
    await act(async () => {
      first.scrollTop = 100;
      first.dispatchEvent(new Event("scroll"));
    });
    if (delayed) {
      await act(async () => root.render(<Screen id="second" history={[]} />));
      expect(beforePaint).toBe(0);
    }
    const history = [...messages, { ...messages[1], id: "latest", content: "Latest saved reply" }];
    await act(async () => root.render(<Screen id="second" history={history} />));
    expect(beforePaint).toBe(1100);
    expect(host.textContent).toContain("Latest saved reply");
    await act(async () => root.render(<Screen id="first" history={messages} />));
    expect(beforePaint).toBe(600);
    await act(async () => root.render(<Screen id="new" history={[]} />));
    expect(beforePaint).toBe(0);
    expect(host.querySelector(".empty-state")).not.toBeNull();
    expect(scrollIntoView).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount()); host.remove();
    height.mockRestore(); viewport.mockRestore(); readTop.mockRestore(); writeTop.mockRestore(); scrollIntoView.mockRestore();
  }
});

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

it("confirms deletion and retries directly from the linked user message", async () => {
  const { host, root, handlers, render } = setup();
  try {
    await act(async () => render());
    await act(async () => host.querySelector<HTMLButtonElement>("article:first-child [aria-label='删除']")!.click());
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("永久删除");
    await act(async () => host.querySelector<HTMLButtonElement>(".message-confirm-dialog .settings-button")!.click());
    expect(handlers.delete).toHaveBeenCalledWith("user");
    await act(async () => host.querySelector<HTMLButtonElement>("article:nth-child(2) [aria-label='重新生成']")!.click());
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(handlers.retry).toHaveBeenCalledWith("user");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("keeps copy available while a direct retry is pending", async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  let finish: (() => void) | undefined;
  const retry = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  const { host, root, render } = setup({ retry });
  try {
    await act(async () => render());
    await act(async () => host.querySelector<HTMLButtonElement>("article:nth-child(2) [aria-label='重新生成']")!.click());
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

it("runs edit and send directly only for user messages", async () => {
  const { host, root, handlers, render } = setup();
  try {
    await act(async () => render());
    await act(async () => host.querySelector<HTMLButtonElement>("article:first-child [aria-label='编辑']")!.click());
    await act(async () => host.querySelector<HTMLButtonElement>(".message-editor-send")!.click());
    expect(host.querySelector('[role="dialog"]')).toBeNull();
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

it("pages only the latest assistant round and respects boundaries and disabled state", async () => {
  const selectVersion = vi.fn(async () => true);
  const { host, root, handlers } = setup({ selectVersion });
  const history: StoredChatMessage[] = [
    { ...messages[0], roundVersions: { selected: 1, pairs: [
      [messages[0], messages[1]], [messages[0], messages[1]], [messages[0], messages[1]],
    ] } }, messages[1],
  ];
  try {
    await act(async () => root.render(<MessageList messages={history} actions={handlers} />));
    expect(host.querySelector("article:first-child .message-version-pager")).toBeNull();
    const pager = host.querySelector("article:last-child .message-version-pager")!;
    expect(pager.textContent).toContain("2/3");
    await act(async () => pager.querySelector<HTMLButtonElement>('[aria-label="上一版问答"]')!.click());
    expect(selectVersion).toHaveBeenCalledWith(0);
    await act(async () => pager.querySelector<HTMLButtonElement>('[aria-label="下一版问答"]')!.click());
    expect(selectVersion).toHaveBeenCalledWith(2);
    await act(async () => root.render(<MessageList messages={[{ ...history[0], roundVersions: { ...history[0].roundVersions!, selected: 2 } }, history[1]]}
      actions={handlers} actionsDisabled />));
    expect(host.querySelector<HTMLButtonElement>('[aria-label="下一版问答"]')?.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="上一版问答"]')?.disabled).toBe(true);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("supports editor shortcuts without submitting composition, repeated or modified keys", async () => {
  const { host, root, handlers, render } = setup();
  const press = async (options: KeyboardEventInit) => act(async () => {
    host.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...options }));
  });
  try {
    await act(async () => render());
    await act(async () => host.querySelector<HTMLButtonElement>("article:first-child [aria-label='编辑']")!.click());
    await press({ key: "Enter", shiftKey: true });
    await press({ key: "Enter", isComposing: true });
    await press({ key: "Enter", repeat: true });
    await press({ key: "Enter", altKey: true });
    expect(handlers.edit).not.toHaveBeenCalled();
    await press({ key: "Enter" });
    expect(handlers.edit).toHaveBeenCalledOnce();
    await act(async () => host.querySelector<HTMLButtonElement>("article:first-child [aria-label='编辑']")!.click());
    await press({ key: "Enter", ctrlKey: true });
    expect(handlers.editAndSend).toHaveBeenCalledOnce();
    await act(async () => host.querySelector<HTMLButtonElement>("article:first-child [aria-label='编辑']")!.click());
    await press({ key: "Escape" });
    expect(host.querySelector("textarea")).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
