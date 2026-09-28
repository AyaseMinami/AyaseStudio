// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import { isTextareaVisualBoundary } from "./textareaVisualLine";

vi.mock("./textareaVisualLine", () => ({ isTextareaVisualBoundary: vi.fn(() => true) }));
afterEach(() => { vi.mocked(isTextareaVisualBoundary).mockReset().mockReturnValue(true); });

it("retains the full multiline provider error and status as inert text", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  const error = '<html><script>alert(1)</script></html>\n' + "details ".repeat(1000) + "\nrequest-id: final-line (400)";
  try {
    await act(async () => root.render(<Composer draft="" error={error} isHydrated isGenerating={false}
      onDraftChange={() => {}} onSend={() => {}} onStop={() => {}} />));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(error);
    expect(host.querySelector("script")).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});

it("browses only unmodified boundary arrows and prevents only consumed keys", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  const onBrowseHistory = vi.fn(() => true);
  const render = (isHydrated = true) => root.render(<Composer draft="first\nlast" isHydrated={isHydrated}
    isGenerating={false} onDraftChange={() => {}} onSend={() => {}} onStop={() => {}}
    onBrowseHistory={onBrowseHistory} />);
  try {
    await act(async () => render());
    const textarea = host.querySelector("textarea")!;
    const press = (options: KeyboardEventInit) => {
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...options });
      textarea.dispatchEvent(event);
      return event.defaultPrevented;
    };
    textarea.setSelectionRange(2, 2);
    for (const options of [
      { shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true },
      { repeat: true }, { isComposing: true }, { keyCode: 229 },
    ]) expect(press({ key: "ArrowUp", ...options })).toBe(false);
    textarea.setSelectionRange(0, 2);
    expect(press({ key: "ArrowUp" })).toBe(false);
    textarea.setSelectionRange(2, 2);
    vi.mocked(isTextareaVisualBoundary).mockReturnValue(false);
    expect(press({ key: "ArrowUp" })).toBe(false);
    expect(onBrowseHistory).not.toHaveBeenCalled();
    vi.mocked(isTextareaVisualBoundary).mockReturnValue(true);
    expect(press({ key: "ArrowUp" })).toBe(true);
    expect(onBrowseHistory).toHaveBeenLastCalledWith(-1, { start: 2, end: 2 });
    expect(press({ key: "ArrowDown" })).toBe(true);
    expect(onBrowseHistory).toHaveBeenLastCalledWith(1, { start: 2, end: 2 });
    onBrowseHistory.mockReturnValue(false);
    expect(press({ key: "ArrowUp" })).toBe(false);
    await act(async () => render(false));
    onBrowseHistory.mockClear();
    expect(press({ key: "ArrowUp" })).toBe(false);
    expect(onBrowseHistory).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("reports selection and restores supplied caret or range after draft updates and remounts without focus", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onDraftSelectionChange = vi.fn();
  const render = (key: string, draft: string, start: number, end = start) => root.render(<Composer key={key}
    draft={draft} draftSelection={{ start, end }} onDraftSelectionChange={onDraftSelectionChange}
    isHydrated isGenerating={false} onDraftChange={() => {}} onSend={() => {}} onStop={() => {}} />);
  try {
    await act(async () => render("a", "original draft", 3, 8));
    let textarea = host.querySelector("textarea")!;
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([3, 8]);
    expect(document.activeElement).not.toBe(textarea);
    textarea.focus();
    textarea.setSelectionRange(1, 1);
    textarea.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "ArrowLeft" }));
    expect(onDraftSelectionChange).toHaveBeenLastCalledWith({ start: 1, end: 1 });
    await act(async () => render("a", "history", 0));
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([0, 0]);
    await act(async () => render("a", "original draft", 3, 8));
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([3, 8]);
    await act(async () => render("b", "original draft", 3, 8));
    textarea = host.querySelector("textarea")!;
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([3, 8]);
    expect(document.activeElement).not.toBe(textarea);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("keeps the updated caret when typing at the end or editing the middle of a controlled draft", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  function ControlledComposer() {
    const [draft, setDraft] = useState("draft");
    const [selection, setSelection] = useState({ start: 5, end: 5 });
    return <><Composer draft={draft} draftSelection={selection} onDraftChange={setDraft}
      onDraftSelectionChange={setSelection} isHydrated isGenerating={false}
      onSend={() => {}} onStop={() => {}} /><output>{draft}:{selection.start}</output></>;
  }
  try {
    await act(async () => root.render(<ControlledComposer />));
    const textarea = host.querySelector("textarea")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    const type = async (value: string, caret: number) => {
      await act(async () => {
        setValue.call(textarea, value);
        textarea.setSelectionRange(caret, caret);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(textarea.value).toBe(value);
      expect(host.querySelector("output")?.textContent).toBe(`${value}:${caret}`);
      expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([caret, caret]);
    };
    await type("draft!", 6);
    await type("draXft!", 4);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("ignores an old selection emitted during accepted history navigation", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onSelection = vi.fn();
  function ControlledComposer() {
    const [draft, setDraft] = useState("B草稿");
    const [selection, setSelection] = useState({ start: 3, end: 3 });
    return <><Composer draft={draft} draftSelection={selection} onDraftChange={setDraft}
      onDraftSelectionChange={(next) => { onSelection(next); setSelection(next); }}
      onBrowseHistory={() => { setDraft("B 独立历史"); setSelection({ start: 0, end: 0 }); return true; }}
      isHydrated isGenerating={false} onSend={() => {}} onStop={() => {}} />
      <output>{draft}:{selection.start}</output></>;
  }
  try {
    await act(async () => root.render(<ControlledComposer />));
    const textarea = host.querySelector("textarea")!;
    textarea.focus();
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowUp" }));
    });
    expect(host.querySelector("output")?.textContent).toBe("B 独立历史:0");
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([0, 0]);
    expect(onSelection).not.toHaveBeenCalledWith({ start: 3, end: 3 });
    await act(async () => {
      textarea.setSelectionRange(2, 2);
      textarea.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "ArrowRight" }));
    });
    expect(onSelection).toHaveBeenLastCalledWith({ start: 2, end: 2 });
    expect(host.querySelector("output")?.textContent).toBe("B 独立历史:2");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("passes keyboard and typing affinity to visual measurement and resets it for pointer placement", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Composer draft="wrapped text" isHydrated isGenerating={false}
      onDraftChange={() => {}} onSend={() => {}} onStop={() => {}} onBrowseHistory={() => false} />));
    const textarea = host.querySelector("textarea")!;
    const pressUp = () => textarea.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
    const release = (key: string) => textarea.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key }));
    pressUp();
    expect(isTextareaVisualBoundary).toHaveBeenLastCalledWith(textarea, -1, undefined);
    for (const key of ["End", "ArrowRight"]) {
      release(key);
      pressUp();
      expect(isTextareaVisualBoundary).toHaveBeenLastCalledWith(textarea, -1, "upstream");
    }
    for (const key of ["Home", "ArrowLeft"]) {
      release(key);
      pressUp();
      expect(isTextareaVisualBoundary).toHaveBeenLastCalledWith(textarea, -1, "downstream");
    }
    textarea.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    pressUp();
    expect(isTextareaVisualBoundary).toHaveBeenLastCalledWith(textarea, -1, undefined);
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(textarea, "wrapped text!");
      textarea.setSelectionRange(13, 13);
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    });
    pressUp();
    expect(isTextareaVisualBoundary).toHaveBeenLastCalledWith(textarea, -1, "upstream");
    await act(async () => {
      setValue.call(textarea, "wrapped tex");
      textarea.setSelectionRange(11, 11);
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
    });
    pressUp();
    expect(isTextareaVisualBoundary).toHaveBeenLastCalledWith(textarea, -1, undefined);
    release("ArrowDown");
    pressUp();
    expect(isTextareaVisualBoundary).toHaveBeenLastCalledWith(textarea, -1, undefined);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("sends on Enter or Ctrl+Enter and preserves composition and multiline input", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  const onSend = vi.fn();
  try {
    await act(async () => root.render(<Composer draft="hello" isHydrated isGenerating={false}
      onDraftChange={() => {}} onSend={onSend} onStop={() => {}} />));
    const textarea = host.querySelector("textarea")!;
    const press = (options: KeyboardEventInit) => textarea.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...options }));
    await act(async () => {
      press({ key: "Enter", shiftKey: true });
      press({ key: "Enter", isComposing: true });
      press({ key: "Enter", repeat: true });
      press({ key: "Enter", altKey: true });
      press({ key: "Enter", metaKey: true });
    });
    expect(onSend).not.toHaveBeenCalled();
    await act(async () => { press({ key: "Enter" }); press({ key: "Enter", ctrlKey: true }); });
    expect(onSend).toHaveBeenCalledTimes(2);
    expect(textarea.getAttribute("placeholder")).toContain("Ctrl+Enter");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
