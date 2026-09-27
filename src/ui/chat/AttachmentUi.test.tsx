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
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function observeImages() {
  const callbacks: IntersectionObserverCallback[] = [];
  const disconnect = vi.fn();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { callbacks.push(callback); }
    observe() {}
    disconnect() { disconnect(); }
  });
  return { callbacks, disconnect, setVisible(index: number, visible: boolean) {
    callbacks[index]([{ isIntersecting: visible } as IntersectionObserverEntry], {} as IntersectionObserver);
  } };
}

describe("attachment UI", () => {
  it("names generic pasted images by local time and avoids same-second collisions", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 27, 22, 25, 30));
    const files = vi.fn(); const send = vi.fn();
    const named = new File(["original"], "风景.webp", { type: "image/webp" });
    await mount(<Composer draft="" isHydrated isGenerating={false} onDraftChange={vi.fn()}
      onFiles={files} onSend={send} onStop={vi.fn()} />);
    const paste = async (items: File[]) => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: { files: items } });
      await act(async () => container.querySelector("textarea")!.dispatchEvent(event));
    };
    const original = new File(["pixels"], "image.png", { type: "image/png", lastModified: 123 });
    await paste([original, new File(["jpeg"], "", {type:"image/jpeg"}), named]);
    expect(files.mock.calls[0][0].map((file: File) => file.name)).toEqual([
      "粘贴图片-0927-222530.png", "粘贴图片-0927-222530-2.jpg", "风景.webp"]);
    expect(files.mock.calls[0][0][2]).toBe(named);
    expect(await files.mock.calls[0][0][0].text()).toBe("pixels");
    expect(files.mock.calls[0][0][0].type).toBe("image/png");
    expect(files.mock.calls[0][0][0].lastModified).toBe(123);
    await paste([new File(["webp"], "IMAGE.PNG", {type:"image/webp"})]);
    expect(files.mock.calls[1][0][0].name).toBe("粘贴图片-0927-222530-3.webp");
    vi.setSystemTime(new Date(2026, 8, 27, 22, 25, 31));
    await paste([original]);
    expect(files.mock.calls[2][0][0].name).toBe("粘贴图片-0927-222531.png");
    expect(send).not.toHaveBeenCalled();
  });

  it("opens draft images only on demand without sending, and keeps removal separate", async () => {
    const file = new File([new Uint8Array([137,80,78,71,13,10,26,10])], "draft.png");
    const read = vi.spyOn(file, "arrayBuffer");
    const item = { id: "draft", name: file.name, mimeType: "image/png" as const, size: file.size, file };
    const send = vi.fn(); const remove = vi.fn();
    const props = { draft: "keep draft", draftAttachments: [item], isHydrated: true, isGenerating: false,
      onDraftChange: vi.fn(), onSend: send, onStop: vi.fn(), onRemoveAttachment: remove };
    await mount(<Composer {...props} />);
    expect(read).not.toHaveBeenCalled();
    const opener = container.querySelector<HTMLButtonElement>('[aria-label="预览待发送图片 draft.png"]')!;
    await act(async () => { opener.focus(); opener.click(); });
    expect(read).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.attachment-preview-image')).not.toBeNull();
    expect(send).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
    await act(async () => container.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(container.querySelector('textarea')?.value).toBe("keep draft");
    await act(async () => opener.click());
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => root!.render(<Composer {...props} draftAttachments={[]} />));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => root!.render(<Composer {...props} />));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="移除附件 draft.png"]')!.click());
    expect(remove).toHaveBeenCalledWith("draft");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reports draft read failures without sending or removing the image", async () => {
    const file = new File(["x"], "missing.png");
    vi.spyOn(file, "arrayBuffer").mockRejectedValue(new Error("无法读取图片"));
    const send = vi.fn(); const remove = vi.fn();
    await mount(<Composer draft="keep" draftAttachments={[{id:"missing", name:file.name,mimeType:"image/png",size:1,file}]}
      isHydrated isGenerating={false} onDraftChange={vi.fn()} onSend={send} onStop={vi.fn()} onRemoveAttachment={remove} />);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="预览待发送图片 missing.png"]')!.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("无法读取图片");
    expect(send).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });
  it("reads inline images near the viewport and releases them when they leave", async () => {
    const viewport = observeImages();
    const attachment = { reference: "attachments/inline.png", name: "inline.png", mimeType: "image/png" as const, size: 3 };
    const read = vi.fn().mockResolvedValue({ ...attachment, data: "AQID" });
    await mount(<MessageList messages={[{ id: "u", role: "user", content: "hello", status: "complete", attachments: [attachment] }]} onReadAttachment={read} />);
    expect(read).not.toHaveBeenCalled();
    expect(container.querySelector(".sent-image-attachment")).not.toBeNull();
    await act(async () => viewport.setVisible(0, true));
    expect(read).toHaveBeenCalledTimes(1);
    const image = container.querySelector<HTMLImageElement>(".sent-image-attachment img")!;
    expect(image.src).toContain("AQID");
    await act(async () => image.dispatchEvent(new Event("load")));
    expect(container.querySelector<HTMLImageElement>(".sent-image-attachment img")?.style.visibility).toBe("visible");
    await act(async () => viewport.setVisible(0, false));
    expect(container.querySelector(".sent-image-attachment img")).toBeNull();
    expect(viewport.disconnect).not.toHaveBeenCalled();
  });

  it("ignores a stale inline read and shows an inline decode failure", async () => {
    const viewport = observeImages();
    const attachment = { reference: "attachments/inline.png", name: "inline.png", mimeType: "image/png" as const, size: 3 };
    let resolve!: (value: typeof attachment & { data: string }) => void;
    const read = vi.fn().mockImplementationOnce(() => new Promise((done) => { resolve = done; }))
      .mockResolvedValue({ ...attachment, data: "AQID" });
    await mount(<MessageList messages={[{ id: "u", role: "assistant", content: "hello", status: "complete", attachments: [attachment] }]} onReadAttachment={read} />);
    await act(async () => viewport.setVisible(0, true));
    await act(async () => viewport.setVisible(0, false));
    await act(async () => resolve({ ...attachment, data: "OLD" }));
    expect(container.querySelector(".sent-image-attachment img")).toBeNull();
    await act(async () => viewport.setVisible(0, true));
    expect(container.querySelector<HTMLImageElement>(".sent-image-attachment img")?.src).toContain("AQID");
    await act(async () => container.querySelector(".sent-image-attachment img")!.dispatchEvent(new Event("error")));
    expect(container.querySelector(".sent-image-attachment [role=alert]")?.textContent).toContain("图片加载失败");
    expect(container.textContent).toContain("hello");
  });

  it("navigates only images from the same message and restores focus on Escape", async () => {
    const first = { reference: "attachments/first.png", name: "first.png", mimeType: "image/png" as const, size: 3 };
    const second = { reference: "attachments/second.png", name: "second.png", mimeType: "image/png" as const, size: 3 };
    const other = { reference: "attachments/other.png", name: "other.png", mimeType: "image/png" as const, size: 3 };
    const read = vi.fn().mockImplementation(async (item: typeof first) => ({ ...item, data: "AQID" }));
    await mount(<MessageList messages={[
      { id: "u", role: "user", content: "", status: "complete", attachments: [first, second] },
      { id: "a", role: "assistant", content: "", status: "complete", attachments: [other] },
    ]} onReadAttachment={read} />);
    const opener = container.querySelector<HTMLButtonElement>('[aria-label="预览附件 first.png"]')!;
    await act(async () => opener.click());
    expect(container.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toContain("first.png");
    await act(async () => container.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(container.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toContain("second.png");
    expect(container.querySelector(".attachment-preview-navigation")?.textContent).toContain("2 / 2");
    await act(async () => container.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
  it("keeps modal focus on Next when the last image is reached", async () => {
    const first = { reference: "attachments/first.png", name: "first.png", mimeType: "image/png" as const, size: 3 };
    const second = { reference: "attachments/second.png", name: "second.png", mimeType: "image/png" as const, size: 3 };
    const read = vi.fn().mockImplementation(async (item: typeof first) => ({ ...item, data: "AQID" }));
    await mount(<MessageList messages={[{ id: "u", role: "user", content: "", status: "complete", attachments: [first, second] }]} onReadAttachment={read} />);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="预览附件 first.png"]')!.click());
    const next = [...container.querySelectorAll<HTMLButtonElement>(".attachment-preview-navigation button")][1];
    next.focus();
    await act(async () => next.click());
    expect(container.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toContain("second.png");
    expect(next.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(next);
    await act(async () => next.click());
    expect(read).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(next);
    await act(async () => next.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
    expect(document.activeElement).toBe(container.querySelector<HTMLButtonElement>('[aria-label="关闭预览"]'));
  });
  it("keeps Office selectable and blocks sending after switching protocol without losing the draft", async () => {
    const item = { id: "office", name: "report.docx", size: 5,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const,
      file: new File(["PK"], "report.docx") };
    const props = { title: "test", protocolLabel: "test", draft: "", draftAttachments: [item],
      isHydrated: true, isGenerating: false, messages: [], onClear: vi.fn(), onDraftChange: vi.fn(), onSend: vi.fn(), onStop: vi.fn() };
    await mount(<ChatWorkspace {...props} protocol="openai-responses" />);
    expect(container.querySelector<HTMLInputElement>('input[type="file"]')!.accept).toContain(".docx");
    expect(container.querySelector<HTMLButtonElement>('[aria-label="发送"]')!.disabled).toBe(false);
    await act(async () => root!.render(<ChatWorkspace {...props} protocol="anthropic-native" />));
    expect(container.querySelector<HTMLInputElement>('input[type="file"]')!.accept).toContain(".docx");
    expect(container.querySelector<HTMLButtonElement>('[aria-label="发送"]')!.disabled).toBe(true);
    expect(container.textContent).toContain("report.docx");
    expect(container.textContent).toContain("Office 附件仅支持 Responses");
    await act(async () => root!.render(<ChatWorkspace {...props} protocol={undefined} />));
    const accept = container.querySelector<HTMLInputElement>('input[type="file"]')!.accept;
    expect(accept).toContain(".docx");
    expect(accept).toContain(".xlsx");
    expect(accept).toContain(".pptx");
  });

  it("shows Office metadata without reading its binary content for preview", async () => {
    const read = vi.fn();
    await mount(<MessageList messages={[{ id: "u", role: "user", content: "", status: "complete",
      attachments: [{ reference: "attachments/id.xlsx", name: "budget.xlsx", size: 5,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }] }]} onReadAttachment={read} />);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="预览附件 budget.xlsx"]')!.click());
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("不解析或预览 Office 正文");
    expect(read).not.toHaveBeenCalled();
  });
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
