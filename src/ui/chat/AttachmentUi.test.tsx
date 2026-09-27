// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { ChatWorkspace } from "./ChatWorkspace";

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
async function mount(element: React.ReactNode) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
}
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  vi.restoreAllMocks();
});

describe("attachment UI", () => {
  it("shows a compact filename chip before the input without decoding the draft image", async () => {
    const createUrl = vi.spyOn(URL, "createObjectURL");
    const item = { id: "a", name: "broken.png", mimeType: "image/png" as const, size: 3,
      file: new File(["bad"], "broken.png") };
    const props = { draft: "keep this text", isHydrated: true, isGenerating: false,
      onDraftChange: vi.fn(), onSend: vi.fn(), onStop: vi.fn() };
    await mount(<Composer {...props} draftAttachments={[item]} />);
    const chip = container.querySelector('.composer-attachment')!;
    expect(chip.textContent).toBe("broken.png");
    expect(chip.getAttribute("title")).toContain("image/png");
    expect(container.querySelector('.composer-attachments')?.nextElementSibling?.tagName).toBe("TEXTAREA");
    expect(container.querySelector("img")).toBeNull();
    expect(createUrl).not.toHaveBeenCalled();
    expect(container.querySelector("textarea")?.value).toBe("keep this text");
    expect(container.querySelector('[aria-label="移除附件 broken.png"]')).not.toBeNull();
    await act(async () => root!.render(<Composer {...props} draftAttachments={[]} />));
    expect(container.querySelector('.composer-attachments')).toBeNull();
  });

  it("shows a readable sent image decode failure without changing the message", async () => {
    const attachment = { reference: "attachments/id.png", name: "broken.png", mimeType: "image/png" as const, size: 3 };
    const read = vi.fn().mockResolvedValue({ ...attachment, data: "AQID" });
    await mount(<MessageList messages={[{ id: "u", role: "user", content: "message remains", status: "complete",
      attachments: [attachment] }]} onReadAttachment={read} />);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="预览附件 broken.png"]')!.click());
    await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("图片加载失败");
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("message remains");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="关闭预览"]')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="预览附件 broken.png"]')!.click());
    expect(container.querySelector("img")).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("stages a picked file and only sends on explicit Send", async () => {
    const onFiles = vi.fn();
    const onSend = vi.fn();
    const onRemove = vi.fn();
    await mount(<Composer draft="" draftAttachments={[{ id: "a", name: "test.txt", mimeType: "text/plain", size: 4,
      file: new File(["test"], "test.txt") }]}
      isHydrated isGenerating={false} onDraftChange={() => undefined} onFiles={onFiles}
      onRemoveAttachment={onRemove} onSend={onSend} onStop={() => undefined} />);
    const send = container.querySelector<HTMLButtonElement>('[aria-label="发送"]')!;
    expect(send.disabled).toBe(false);
    expect(onSend).not.toHaveBeenCalled();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="移除附件 test.txt"]')!.click());
    expect(onRemove).toHaveBeenCalledWith("a");
    await act(async () => send.click());
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("picker, paste and chat drop add only drafts, never send", async () => {
    const files = vi.fn(); const send = vi.fn();
    await mount(<ChatWorkspace title="test" protocolLabel="synthetic" draft="" draftAttachments={[]}
      isHydrated isGenerating={false} messages={[]} onClear={() => undefined}
      onDraftChange={() => undefined} onFiles={files} onSend={send}
      onStop={() => undefined} />);
    const picker = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(picker.hidden).toBe(true);
    const openPicker = vi.spyOn(picker, "click");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="添加附件"]')!.click());
    expect(openPicker).toHaveBeenCalledTimes(1);
    const sample = new File(["hello"], "note.txt", { type: "text/plain" });
    Object.defineProperty(picker, "files", { configurable: true, value: [sample] });
    await act(async () => picker.dispatchEvent(new Event("change", { bubbles: true })));
    expect(files).toHaveBeenCalledWith([sample]);
    const image = new File(["image"], "pasted.png", { type: "image/png" });
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { files: [image] } });
    await act(async () => container.querySelector("textarea")!.dispatchEvent(paste));
    expect(files).toHaveBeenCalledTimes(2);
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { files: [sample] } });
    await act(async () => container.querySelector(".chat-attachment-surface")!.dispatchEvent(drop));
    expect(files).toHaveBeenCalledTimes(3);
    expect(send).not.toHaveBeenCalled();
    const outside = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(outside, "dataTransfer", { value: { files: [sample], types: ["Files"] } });
    await act(async () => window.dispatchEvent(outside));
    expect(outside.defaultPrevented).toBe(true);
    expect(files).toHaveBeenCalledTimes(3);
  });

  it("previews sent UTF-8 attachment only after the user opens it", async () => {
    const read = vi.fn().mockResolvedValue({ name: "notes.txt", mimeType: "text/plain", size: 5, data: "SGVsbG8=" });
    await mount(<MessageList messages={[{ id: "u", role: "user", content: "", status: "complete",
      attachments: [{ reference: "attachments/id.txt", name: "notes.txt", mimeType: "text/plain", size: 5 }] }]} onReadAttachment={read} />);
    expect(read).not.toHaveBeenCalled();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="预览附件 notes.txt"]')!.click());
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Hello");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("does not retain a sent image preview between openings", async () => {
    const attachment = { reference: "attachments/id.png", name: "view.png", mimeType: "image/png" as const, size: 3 };
    const read = vi.fn().mockResolvedValue({ ...attachment, data: "AQID" });
    await mount(<MessageList messages={[{ id: "u", role: "user", content: "view", status: "complete",
      attachments: [attachment] }]} onReadAttachment={read} />);
    expect(read).not.toHaveBeenCalled();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="预览附件 view.png"]')!.click());
    expect(container.querySelector<HTMLImageElement>(".attachment-preview-image")?.src).toContain("AQID");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="关闭预览"]')!.click());
    expect(container.querySelector(".attachment-preview-image")).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="预览附件 view.png"]')!.click());
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("closes preview when its owning message is cleared", async () => {
    const attachment = { reference: "attachments/id.txt", name: "notes.txt", mimeType: "text/plain" as const, size: 5 };
    const read = vi.fn().mockResolvedValue({ ...attachment, data: "SGVsbG8=" });
    await mount(<MessageList messages={[{ id: "u", role: "user", content: "hi", status: "complete",
      attachments: [attachment] }]} onReadAttachment={read} />);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="预览附件 notes.txt"]')!.click());
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => root!.render(<MessageList messages={[]} onReadAttachment={read} />));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
