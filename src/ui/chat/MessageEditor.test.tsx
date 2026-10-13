// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import * as attachments from "../../chat/attachments";
import type { StoredChatMessage } from "../../chat/repository";
import { MessageEditor, type MessageEditorProps } from "./MessageEditor";
import { MessageList } from "./MessageList";
import { namePastedImages } from "./attachmentInput";

const old = { name: "original.txt", mimeType: "text/plain" as const, size: 5, reference: "old" };
const base: StoredChatMessage = { id: "u", role: "user", content: "original", status: "complete", attachments: [old] };
const mounted: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of mounted.splice(0)) await cleanup(); vi.restoreAllMocks(); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
async function setup(overrides: Partial<MessageEditorProps> = {}, parentDrop = vi.fn(), parentPaste = vi.fn()) {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const onSave = vi.fn<MessageEditorProps["onSave"]>().mockResolvedValue({ status: "notSaved", error: "模拟失败" });
  const onCancel = vi.fn();
  const props: MessageEditorProps = { base, latestRound: true, onSave, onCancel, ...overrides };
  await act(async () => root.render(<div onDrop={parentDrop} onPaste={parentPaste}><MessageEditor {...props} /></div>));
  mounted.push(async () => { await act(async () => root.unmount()); host.remove(); });
  const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === text || item.getAttribute("aria-label") === text)!;
  const click = async (text: string) => act(async () => button(text).click());
  const drop = async (files: File[]) => act(async () => {
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files, types: ["Files"] } });
    host.querySelector(".message-editor")!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
  const key = async (init: KeyboardEventInit) => act(async () => host.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })));
  return { host, root, props, onSave, onCancel, button, click, drop, key, parentDrop, parentPaste };
}
function draft(file: File): attachments.DraftAttachment { return { id: crypto.randomUUID(), file, name: file.name, size: file.size, mimeType: "text/plain" }; }

it("keeps originals in place with removal and undo, and submits only the final ordered list", async () => {
  const second = { ...old, name: "second.txt", reference: "second" };
  const { host, click, onSave } = await setup({ base: { ...base, attachments: [old, second] } });
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="移除附件 original.txt"]')!.click());
  expect(host.querySelectorAll(".message-editor-attachment")).toHaveLength(2);
  expect(host.textContent).toContain("待移除");
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="撤销移除 original.txt"]')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="移除附件 second.txt"]')!.click());
  await click("保存");
  expect(onSave).toHaveBeenCalledWith("original", { base: { ...base, attachments: [old, second] }, attachments: [{ kind: "retained", attachment: old }] }, false);
  expect(host.textContent).toContain("模拟失败");
  expect(host.textContent).toContain("待移除");
});

it("orders concurrent batches by invocation, keeps mixed successes, and removes new files entirely", async () => {
  const first = deferred<attachments.DraftAttachment>();
  const file1 = new File(["first"], "same.txt"), file2 = new File(["second"], "same.txt"), bad = new File(["bad"], "bad.exe");
  vi.spyOn(attachments, "prepareDraftAttachment").mockImplementation((file) => file === file1 ? first.promise : file === bad ? Promise.reject(new Error("不支持")) : Promise.resolve(draft(file)));
  const { host, drop, button, click, onSave, parentDrop } = await setup();
  await drop([file1, bad]); await drop([file2]);
  expect(button("保存").disabled).toBe(true);
  expect(host.querySelectorAll(".message-editor-attachment")).toHaveLength(1);
  await act(async () => first.resolve(draft(file1)));
  expect(button("保存").disabled).toBe(false);
  expect(host.querySelectorAll(".message-editor-attachment")).toHaveLength(3);
  expect(host.textContent).toContain("bad.exe：不支持");
  await click("保存");
  const items = onSave.mock.calls[0][1].attachments!;
  expect(items.map((item) => item.kind === "added" ? item.attachment.file : undefined)).toEqual([undefined, file1, file2]);
  expect(parentDrop).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="移除附件 same.txt"]')!.click());
  expect(host.querySelectorAll(".message-editor-attachment")).toHaveLength(2);
});

it("ignores late reads after cancel and does not accept stale file selector changes", async () => {
  const read = deferred<attachments.DraftAttachment>(), file = new File(["late"], "late.txt");
  vi.spyOn(attachments, "prepareDraftAttachment").mockReturnValue(read.promise);
  const { host, drop, click, onCancel } = await setup();
  await click("添加附件"); await drop([file]); await click("取消");
  expect(onCancel).toHaveBeenCalledOnce();
  await act(async () => read.resolve(draft(file)));
  expect(host.textContent).not.toContain("late.txt");
  const picker = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(picker, "files", { value: [file], configurable: true });
  await act(async () => picker.dispatchEvent(new Event("change", { bubbles: true })));
  expect(attachments.prepareDraftAttachment).toHaveBeenCalledOnce();
});

it("does not change attachments when the selector is canceled", async () => {
  const prepare = vi.spyOn(attachments, "prepareDraftAttachment");
  const { host, click } = await setup();
  await click("添加附件");
  await act(async () => host.querySelector('input[type="file"]')!.dispatchEvent(new Event("change", { bubbles: true })));
  expect(prepare).not.toHaveBeenCalled();
  expect(host.querySelectorAll(".message-editor-attachment")).toHaveLength(1);
});

it("discards reads and old chooser events when switching editor sessions", async () => {
  const read = deferred<attachments.DraftAttachment>(), file = new File(["late"], "late.txt");
  const prepare = vi.spyOn(attachments, "prepareDraftAttachment").mockReturnValue(read.promise);
  const { root, host, props, drop, click } = await setup();
  await click("添加附件");
  const oldPicker = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  await drop([file]);
  await act(async () => root.render(<MessageEditor key="different" {...props} base={{ ...base, id: "different" }} />));
  Object.defineProperty(oldPicker, "files", { value: [file] });
  await act(async () => { oldPicker.dispatchEvent(new Event("change", { bubbles: true })); read.resolve(draft(file)); });
  expect(prepare).toHaveBeenCalledOnce(); expect(host.textContent).not.toContain("late.txt");
  expect(host.querySelector<HTMLTextAreaElement>("textarea")?.id).toBe("message-edit-different");
});

it("previews retained files with local errors, returns focus, and permits removing unreadable originals", async () => {
  const read = vi.fn(async () => { throw new Error("原附件不可读"); });
  const { host, click, onSave } = await setup({ onReadAttachment: read });
  const opener = host.querySelector<HTMLButtonElement>('[aria-label="预览附件 original.txt"]')!;
  await act(async () => opener.click());
  expect(read).toHaveBeenCalledWith(old); expect(host.querySelector('[role="dialog"]')?.textContent).toContain("原附件不可读");
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="关闭预览"]')!.click());
  expect(document.activeElement).toBe(opener);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="移除附件 original.txt"]')!.click());
  await click("保存"); expect(onSave.mock.calls[0][1].attachments).toEqual([]);
});

it("keeps original images as compact labels and reads them only when opening preview", async () => {
  const image = { name: "original.png", mimeType: "image/png" as const, size: 5, reference: "image" };
  const read = vi.fn(async () => { throw new Error("模拟预览失败"); });
  const { host } = await setup({ base: { ...base, attachments: [image] }, onReadAttachment: read });
  expect(read).not.toHaveBeenCalled();
  expect(host.querySelector(".message-editor img")).toBeNull();
  const chip = host.querySelector<HTMLElement>(".message-editor-attachment")!;
  expect(chip.textContent).toBe("original.png");
  expect(chip.title).toContain("original.png · image/png");
  const opener = chip.querySelector<HTMLButtonElement>('[aria-label="预览附件 original.png"]')!;
  await act(async () => opener.click());
  expect(read).toHaveBeenCalledExactlyOnceWith(image);
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain("模拟预览失败");
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="关闭预览"]')!.click());
  expect(document.activeElement).toBe(opener);
});

it("previews added images through File materialization and returns to the editor", async () => {
  const file = new File(["image"], "image.png", { type: "image/png" });
  vi.spyOn(attachments, "prepareDraftAttachment").mockResolvedValue({ ...draft(file), mimeType: "image/png" });
  const materialize = vi.spyOn(attachments, "materializeDraftAttachment").mockResolvedValue({ name: "image.png", mimeType: "image/png", size: 5, data: "aW1hZ2U=" });
  const { host, drop } = await setup();
  await drop([file]);
  const opener = host.querySelector<HTMLButtonElement>('[aria-label="预览新增附件 image.png"]')!;
  await act(async () => opener.click()); expect(materialize).toHaveBeenCalledOnce();
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="关闭预览"]')!.click());
  expect(document.activeElement).toBe(opener); expect(host.querySelector("textarea")).not.toBeNull();
});

it("blocks empty final messages and allows attachment-only messages", async () => {
  const { host, click, onSave } = await setup({ base: { ...base, content: "" } });
  await click("保存"); expect(onSave).toHaveBeenCalledOnce();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="移除附件 original.txt"]')!.click());
  await click("保存"); expect(onSave).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("消息正文和附件不能同时为空");
  expect(document.activeElement).toBe(host.querySelector("textarea"));
});

it("synchronously guards double submits, consumes drops and Escape while submitted, then preserves failed drafts", async () => {
  const saved = deferred<boolean | import("../../chat/messageEditTypes").MessageEditResult>();
  const onSave = vi.fn<MessageEditorProps["onSave"]>().mockReturnValue(saved.promise);
  const prepare = vi.spyOn(attachments, "prepareDraftAttachment");
  const { host, button, drop, key, onCancel, parentDrop } = await setup({ onSave });
  await act(async () => { button("保存").click(); button("保存").click(); });
  expect(onSave).toHaveBeenCalledOnce(); expect(button("取消").disabled).toBe(true);
  await key({ key: "Escape" }); await drop([new File(["x"], "x.txt")]);
  expect(onCancel).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled(); expect(parentDrop).not.toHaveBeenCalled();
  await act(async () => saved.resolve({ status: "notSaved", error: "保存失败" }));
  expect(host.querySelector("textarea")?.value).toBe("original");
  expect(button("保存").disabled).toBe(false); expect(host.textContent).toContain("保存失败");
});

it.each([true, { status: "saved" }, { status: "savedNeedsReload" }] as const)("closes on committed result %j", async (result) => {
  const onSave = vi.fn<MessageEditorProps["onSave"]>().mockResolvedValue(result);
  const { click, onCancel } = await setup({ onSave });
  await click("保存"); expect(onCancel).toHaveBeenCalledOnce();
});

it("keeps recovery errors visible and disables blind retry", async () => {
  const onSave = vi.fn<MessageEditorProps["onSave"]>().mockResolvedValue({ status: "recoveryRequired", error: "重新加载并核对" });
  const { host, click, button, onCancel } = await setup({ onSave });
  await click("保存"); expect(button("保存").disabled).toBe(true);
  expect(host.querySelector("textarea")?.disabled).toBe(true); expect(host.textContent).toContain("重新加载并核对");
  expect(onCancel).not.toHaveBeenCalled();
});

it("rejects assistant file input without affecting text editing or attachment display", async () => {
  const { host, drop, click, onSave, parentDrop, parentPaste } = await setup({ base: { ...base, role: "assistant" } });
  expect(host.querySelector('input[type="file"]')).toBeNull(); expect(host.querySelector(".message-editor-send")).toBeNull();
  await drop([new File(["x"], "x.txt")]);
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { files: [new File(["image"], "image.png", { type: "image/png" })] } });
  await act(async () => host.querySelector("textarea")!.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true); expect(parentDrop).not.toHaveBeenCalled(); expect(parentPaste).not.toHaveBeenCalled();
  expect(host.textContent).toContain("仅用户消息支持附件编辑");
  await click("保存"); expect(onSave).toHaveBeenCalledWith("original", { base: { ...base, role: "assistant" } }, false);
});

it("uses keyboard shortcuts while ignoring IME, repeat and modifiers", async () => {
  const { key, onSave, onCancel } = await setup();
  for (const init of [{ shiftKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { repeat: true }]) await key({ key: "Enter", ...init });
  expect(onSave).not.toHaveBeenCalled();
  await key({ key: "Enter" }); await key({ key: "Enter", ctrlKey: true });
  expect(onSave.mock.calls.map((call) => call[2])).toEqual([false, true]);
  await key({ key: "Escape", isComposing: true }); expect(onCancel).not.toHaveBeenCalled();
  await key({ key: "Escape" }); expect(onCancel).toHaveBeenCalledOnce();
});

it("names pasted images uniquely within a second and leaves normal text paste intact", async () => {
  const prepare = vi.spyOn(attachments, "prepareDraftAttachment").mockImplementation(async (file) => ({ ...draft(file), mimeType: "image/png" }));
  const { host, parentPaste } = await setup();
  const paste = (files: File[]) => { const event = new Event("paste", { bubbles: true, cancelable: true }); Object.defineProperty(event, "clipboardData", { value: { files } }); return event; };
  const text = paste([]);
  await act(async () => host.querySelector("textarea")!.dispatchEvent(text));
  expect(text.defaultPrevented).toBe(false); expect(parentPaste).toHaveBeenCalledOnce();
  const image = new File(["image"], "image.png", { type: "image/png" });
  const event = paste([image, image]);
  await act(async () => host.querySelector("textarea")!.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true); expect(parentPaste).toHaveBeenCalledOnce();
  expect(new Set(prepare.mock.calls.map(([file]) => file.name)).size).toBe(2);
  const sequence = { stamp: "", count: 0 }, now = new Date(2026, 9, 13, 10, 0, 0);
  const first = namePastedImages([image], [], sequence, now)[0];
  const second = namePastedImages([image], [first.name], sequence, now)[0];
  expect(second.name).not.toBe(first.name);
});

it("freezes the edit base across rerenders and blocks system edit entry", async () => {
  const { root, host } = await setup();
  const edit = vi.fn(async () => false), actions = { edit, editAndSend: edit, delete: vi.fn(async () => true), retry: vi.fn(async () => {}), branch: vi.fn(async () => true) };
  await act(async () => root.render(<MessageList messages={[base]} actions={actions} />));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="编辑"]')!.click());
  await act(async () => root.render(<MessageList messages={[{ ...base, content: "changed elsewhere" }]} actions={actions} />));
  await act(async () => host.querySelector<HTMLButtonElement>(".message-editor-actions .settings-button")!.click());
  expect(edit).toHaveBeenCalledWith("u", "original", { base, attachments: [{ kind: "retained", attachment: old }] });
  await act(async () => root.render(<MessageList messages={[{ ...base, id: "s", role: "system" }]} actions={actions} />));
  expect(host.querySelector('[aria-label="编辑"]')).toBeNull();
});
