// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DrawingResult } from "../../drawing/types";
import { DrawingWorkspace, initialDrawingDraft } from "./DrawingWorkspace";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:thumbnail");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const result: DrawingResult = {
  id: "first", taskId: "task", createdAt: "2026-10-01T00:00:00Z", reference: "drawing/synthetic.png",
  mime: "image/png", size: 50, width: 1600, height: 900,
  parameters: { protocol: "gemini-image", prompt: "测试提示词", modelId: "actual-model", modelName: "模型展示名",
    configuredModelId: "configured", aspectRatio: "16:9", resolution: "2K", providerId: "provider",
    connectionId: "connection", baseUrl: "https://secret.invalid" },
};
const second = { ...result, id: "second", reference: "drawing/second.png" };
function props() {
  return {
    draft: initialDrawingDraft, onDraftChange: vi.fn(), onConfigure: vi.fn(), models: [], tasks: [], results: [result, second],
    selectedResultId: result.id, previewUrl: "blob:original", previewError: null, ready: true, busy: false, error: null,
    onGenerate: vi.fn(), onCancel: vi.fn(), onSelectResult: vi.fn(), onExport: vi.fn(), onRetrySave: vi.fn(), onReuse: vi.fn(),
    onAddReferences: vi.fn(), onRemoveReference: vi.fn(), onMoveReference: vi.fn(), onUseAsReference: vi.fn(),
    readReference: vi.fn(async () => ({ mime: "image/png", data: "AQ==" })), referencesBusy: false,
    readThumbnail: vi.fn(async () => ({ mime: "image/png", data: "AQ==" })), onPreviewActive: vi.fn(),
    onDeleteResults: vi.fn(), onExportResults: vi.fn(), onCopyPrompt: vi.fn(), onClearReferences: vi.fn(),
  };
}
function button(text: string) {
  const found = [...host.querySelectorAll("button")].find(item => item.textContent === text || item.getAttribute("aria-label") === text);
  if (!found) throw new Error(`Missing button ${text}`);
  return found;
}
async function click(text: string) { await act(async () => button(text).click()); }
async function key(element: Element, value: string, shiftKey = false) {
  await act(async () => element.dispatchEvent(new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true })));
}

it("loads only visible thumbnails and releases URLs when hidden, changed or unmounted", async () => {
  const observed: Array<{ element: Element; callback: IntersectionObserverCallback; disconnect: ReturnType<typeof vi.fn> }> = [];
  vi.stubGlobal("IntersectionObserver", class {
    callback: IntersectionObserverCallback;
    disconnect = vi.fn();
    constructor(callback: IntersectionObserverCallback) { this.callback = callback; }
    observe(element: Element) { observed.push({ element, callback: this.callback, disconnect: this.disconnect }); }
  });
  const options = props();
  await act(async () => root.render(<DrawingWorkspace {...options} />));
  expect(options.readThumbnail).not.toHaveBeenCalled();
  const entry = observed[0];
  const visibility = async (isIntersecting: boolean) => act(async () => entry.callback(
    [{ target: entry.element, isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver));
  await visibility(true);
  expect(options.readThumbnail).toHaveBeenCalledExactlyOnceWith(result.reference);
  expect(options.readReference).not.toHaveBeenCalled();
  expect(host.querySelectorAll("img")).toHaveLength(2);
  await visibility(false);
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:thumbnail");
  expect(host.querySelectorAll("img")).toHaveLength(1);
  await visibility(true);
  await click("任务");
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  expect(entry.disconnect).toHaveBeenCalledOnce();
});

it("falls back without IntersectionObserver and distinguishes thumbnail and original decode errors", async () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  const options = props();
  await act(async () => root.render(<DrawingWorkspace {...options} />));
  expect(options.readThumbnail).toHaveBeenCalledTimes(2);
  const thumbnail = host.querySelector(".drawing-result-thumbnail img")!;
  await act(async () => thumbnail.dispatchEvent(new Event("error")));
  expect(host.textContent).toContain("缩略图读取失败");
  expect(host.querySelector(".drawing-preview-stage img")).not.toBeNull();
  await act(async () => host.querySelector(".drawing-preview-stage img")!.dispatchEvent(new Event("error")));
  expect(host.querySelector(".drawing-preview-stage")?.textContent).toContain("原图解码失败");
  await act(async () => root.render(<DrawingWorkspace {...options} selectedResultId={second.id} previewUrl="blob:second" />));
  expect(host.querySelector(".drawing-preview-stage img")?.getAttribute("src")).toBe("blob:second");
});

it("releases late thumbnail reads without creating a URL after leaving the view", async () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  let resolve!: (value: { mime: string; data: string }) => void;
  const pending = new Promise<{ mime: string; data: string }>(done => { resolve = done; });
  const options = props();
  await act(async () => root.render(<DrawingWorkspace {...options} results={[result]} readThumbnail={() => pending} />));
  await click("任务");
  await act(async () => resolve({ mime: "image/png", data: "AQ==" }));
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it("zooms, pans, fits and resets on result change while preventing wheel page scroll", async () => {
  const options = props();
  await act(async () => root.render(<DrawingWorkspace {...options} />));
  const stage = host.querySelector<HTMLDivElement>(".drawing-preview-stage")!;
  vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({ width: 600, height: 400 } as DOMRect);
  const transform = () => host.querySelector<HTMLImageElement>(".drawing-preview-stage img")!.style.transform;
  expect(transform()).toBe("translate(0px, 0px) scale(1)");
  const wheel = new WheelEvent("wheel", { deltaY: -50, bubbles: true, cancelable: true });
  await act(async () => stage.dispatchEvent(wheel));
  expect(wheel.defaultPrevented).toBe(true);
  expect(transform()).toContain("scale(1.2)");
  await key(stage, "ArrowRight");
  expect(transform()).toContain("translate(40px, 0px)");
  await key(stage, "+");
  expect(transform()).toContain("scale(1.44)");
  await key(stage, "0");
  expect(transform()).toBe("translate(0px, 0px) scale(1)");
  await key(stage, "+");
  await act(async () => stage.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, button: 0, clientX: 100, clientY: 100, bubbles: true })));
  await act(async () => stage.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 120, clientY: 110, bubbles: true })));
  expect(transform()).toBe("translate(20px, 2.5px) scale(1.2)");
  await click("适应窗口");
  expect(transform()).toBe("translate(0px, 0px) scale(1)");
  await key(stage, "+");
  await act(async () => root.render(<DrawingWorkspace {...options} selectedResultId={second.id} />));
  expect(transform()).toBe("translate(0px, 0px) scale(1)");
});

it("activates the root preview only on the generate view and releases it on unmount", async () => {
  const options = props();
  await act(async () => root.render(<DrawingWorkspace {...options} />));
  expect(options.onPreviewActive).toHaveBeenLastCalledWith(true);
  await click("成果库"); expect(options.onPreviewActive).toHaveBeenLastCalledWith(false);
  await click("生成"); expect(options.onPreviewActive).toHaveBeenLastCalledWith(true);
  await act(async () => root.render(<div />)); expect(options.onPreviewActive).toHaveBeenLastCalledWith(false);
});

it("shows safe snapshot details and explicit parameter export while keeping plain export separate", async () => {
  const options = props();
  await act(async () => root.render(<DrawingWorkspace {...options} />));
  for (const detail of ["测试提示词", "actual-model", "gemini-image", "16:9", "2K", "1600 × 900", result.createdAt]) expect(host.textContent).toContain(detail);
  for (const secret of [result.parameters.baseUrl, result.reference, "configured", "provider"]) expect(host.textContent).not.toContain(secret);
  expect(host.textContent).toContain("含提示词"); expect(host.textContent).toContain("不保证可确定复现");
  await click("导出图片"); expect(options.onExport).toHaveBeenCalledExactlyOnceWith(result.id);
  expect(options.onExportResults).not.toHaveBeenCalled();
  await click("导出带参数 PNG"); expect(options.onExportResults).toHaveBeenCalledExactlyOnceWith([result.id], true);
  await click("复制提示词"); expect(options.onCopyPrompt).toHaveBeenCalledExactlyOnceWith(result.id);
});

it("exports exact selected results in both modes and clears selection", async () => {
  const options = props();
  await act(async () => root.render(<DrawingWorkspace {...options} />)); await click("成果库");
  await act(async () => host.querySelector<HTMLInputElement>('[aria-label="选择成果 1"]')!.click());
  await click("导出所选图片"); expect(options.onExportResults).toHaveBeenLastCalledWith([second.id], false);
  expect(host.textContent).toContain("已选择 0 张");
  await click("全选成果"); await click("导出所选带参数 PNG");
  expect(options.onExportResults).toHaveBeenLastCalledWith([result.id, second.id], true);
  expect(host.textContent).toContain("已选择 0 张");
});

it("confirms exact result deletion, supports cancellation and traps focus", async () => {
  const options = props();
  await act(async () => root.render(<DrawingWorkspace {...options} />)); await click("成果库"); await click("全选成果");
  const opener = button("删除所选成果"); await click("删除所选成果");
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain("删除 2 张");
  expect(document.activeElement).toBe(button("取消"));
  await key(button("取消"), "Tab", true); expect(document.activeElement).toBe(button("确认删除成果"));
  await key(button("确认删除成果"), "Tab"); expect(document.activeElement).toBe(button("取消"));
  await key(button("取消"), "Escape"); expect(options.onDeleteResults).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(opener); expect(host.textContent).toContain("已选择 2 张");
  await click("删除所选成果"); await click("确认删除成果");
  expect(options.onDeleteResults).toHaveBeenCalledExactlyOnceWith([result.id, second.id]);
  expect(host.textContent).toContain("已选择 0 张");
  await click("删除成果 2"); await click("取消");
  expect(options.onDeleteResults).toHaveBeenCalledOnce();
});

it("invalidates an open delete confirmation on changed result data and disables operations while closing", async () => {
  const options = props();
  await act(async () => root.render(<DrawingWorkspace {...options} />)); await click("删除成果 2");
  await act(async () => root.render(<DrawingWorkspace {...options} results={[{ ...result, width: 1700 }, second]} />));
  expect(button("确认删除成果").disabled).toBe(true); await click("取消");
  await act(async () => root.render(<DrawingWorkspace {...options} closing />));
  for (const label of ["导出图片", "导出带参数 PNG", "复制提示词", "复用参数", "作为参考图", "删除成果 2"]) expect(button(label).disabled).toBe(true);
});

it("clears references with one callback while preserving the draft and prunes removed result selection", async () => {
  const options = props();
  const reference = { ...result, id: "ref", name: "input.png" };
  const draft = { ...initialDrawingDraft, prompt: "下一幅图", references: [reference] };
  await act(async () => root.render(<DrawingWorkspace {...options} draft={draft} />)); await click("清空参考图");
  expect(options.onClearReferences).toHaveBeenCalledOnce(); expect(options.onDraftChange).not.toHaveBeenCalled();
  await click("成果库"); await click("全选成果");
  await act(async () => root.render(<DrawingWorkspace {...options} results={[second]} />));
  expect(host.textContent).toContain("已选择 1 张"); await click("导出所选图片");
  expect(options.onExportResults).toHaveBeenLastCalledWith([second.id], false);
});

it("preserves unavailable reused OpenAI controls until an explicit model selection", async () => {
  const options = props();
  const draft = { ...initialDrawingDraft, prompt: "复用画面", reusedProtocol: "openai-images" as const,
    openai: { size: "1536x1024", quality: "high" } };
  await act(async () => root.render(<DrawingWorkspace {...options} draft={draft}
    models={[{ id: "gemini", label: "Gemini 可用模型", protocol: "gemini-image" }]} />));
  expect(host.textContent).toContain("原模型不可用，请重新选择绘图模型");
  expect(host.textContent).toContain("已保留 OpenAI Images 协议参数");
  expect(host.textContent).toContain("画质");
  expect(host.querySelector(".drawing-form")?.textContent).not.toContain("宽高比");
  expect(host.querySelector(".drawing-form")?.textContent).not.toContain("分辨率");
  expect([...host.querySelectorAll("select")].map(select => select.value)).toEqual(["", "1536x1024", "high"]);
  expect(button("生成图片").disabled).toBe(true);
  const model = host.querySelector<HTMLSelectElement>("#drawing-model")!;
  await act(async () => { model.value = "gemini"; model.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(options.onDraftChange).toHaveBeenCalledWith({ ...initialDrawingDraft, prompt: "复用画面", modelId: "gemini",
    openai: { size: "1536x1024", quality: "high" } });
});
