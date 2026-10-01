// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DrawingParameters, DrawingReference, DrawingResult, DrawingTask } from "../../drawing/types";
import { DrawingWorkspace, initialDrawingDraft, type DrawingDraft } from "./DrawingWorkspace";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  let previewNumber = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:synthetic-reference-${++previewNumber}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });

function props() {
  return {
    draft: initialDrawingDraft, onDraftChange: vi.fn(), onConfigure: vi.fn(),
    models: [{ id: "configured-image-model", label: "合成绘图模型", protocol: "gemini-image" as const }],
    tasks: [] as DrawingTask[], results: [] as DrawingResult[], selectedResultId: null,
    previewUrl: null, previewError: null, ready: true, busy: false, error: null,
    onGenerate: vi.fn(), onCancel: vi.fn(), onPause: vi.fn(), onResume: vi.fn(), onSelectResult: vi.fn(), onExport: vi.fn(),
    onRetrySave: vi.fn(), onReuse: vi.fn(), onCancelBatch: vi.fn(), onRegenerate: vi.fn(), onDeleteTasks: vi.fn(),
    onAddReferences: vi.fn(), onRemoveReference: vi.fn(), onMoveReference: vi.fn(), onUseAsReference: vi.fn(),
    readReference: vi.fn(async () => ({ mime: "image/png", data: "AQ==" })), referencesBusy: false,
  };
}
const parameters: DrawingParameters = {
  prompt: "清晨的山谷湖泊", aspectRatio: "16:9", resolution: "2K", providerId: "provider",
  connectionId: "connection", configuredModelId: "configured-image-model", modelId: "synthetic-image-model",
  modelName: "合成绘图模型", baseUrl: "https://private-connection.example.invalid", protocol: "gemini-image",
};
const task: DrawingTask = {
  id: "task-one", createdAt: "2026-09-30T00:00:00Z", updatedAt: "2026-09-30T00:00:00Z",
  status: "running", parameters,
};
const result: DrawingResult = {
  id: "result-one", taskId: "task-one", createdAt: "2026-09-30T00:00:00Z", parameters,
  reference: "drawing/private-synthetic-image.png", mime: "image/png", size: 100, width: 1024, height: 576,
};
function button(text: string) {
  const result = [...host.querySelectorAll("button")].find((item) => item.textContent === text || item.getAttribute("aria-label") === text);
  if (!result) throw new Error(`Missing button: ${text}`);
  return result;
}

it("switches protocol fields, preserves both drafts and offers current sizes/qualities including custom dimensions", async () => {
  const options = props();
  function Harness() {
    const [draft, setDraft] = useState<DrawingDraft>({ ...initialDrawingDraft, modelId: "configured-image-model", prompt: "合成画面" });
    return <DrawingWorkspace {...options} draft={draft} onDraftChange={setDraft}
      models={[...options.models, { id: "openai", label: "OpenAI 合成", protocol: "openai-images" }]} />;
  }
  await act(async () => root.render(<Harness />));
  const change = async (select: HTMLSelectElement, value: string) => { await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); }); };
  await change(host.querySelectorAll("select")[1], "1:8");
  await change(host.querySelectorAll("select")[2], "512");
  await change(host.querySelectorAll("select")[0], "openai");
  expect(host.textContent).not.toContain("宽高比"); expect(host.textContent).toContain("画质");
  expect([...host.querySelectorAll("select")[2].options].map(option => option.value)).toEqual(["auto", "low", "medium", "high", "xhigh", "max"]);
  await change(host.querySelectorAll("select")[1], "custom");
  expect(host.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe("1536x864");
  await change(host.querySelectorAll("select")[2], "max");
  await act(async () => button("任务").click()); await act(async () => button("生成").click());
  expect(host.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe("1536x864");
  await change(host.querySelectorAll("select")[0], "configured-image-model");
  expect([...host.querySelectorAll("select")].map(select => select.value)).toEqual(["configured-image-model", "1:8", "512"]);
  await change(host.querySelectorAll("select")[0], "openai");
  expect([...host.querySelectorAll("select")].map(select => select.value)).toEqual(["openai", "custom", "max"]);
});

it("keeps empty previews and queue defaults while connecting settings", async () => {
  const options = props();
  await act(async () => root.render(<DrawingWorkspace {...options} models={[]} />));
  expect(host.querySelector("textarea")?.value).toBe("");
  expect(host.querySelectorAll("img")).toHaveLength(0);
  expect(host.textContent).toContain("生成后的图片会自动显示在这里");
  expect(host.textContent).toContain("暂无生成历史");
  expect(host.textContent).toContain("请在设置中添加 Gemini 或 OpenAI 绘图连接和模型。");
  expect(button("生成图片").disabled).toBe(true);
  expect(button("添加参考图").disabled).toBe(false);
  expect([...host.querySelectorAll<HTMLInputElement>('input[type="number"]')].map(input => input.value)).toEqual(["1", "1"]);
  expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
  expect(host.querySelector("header h1")?.hasAttribute("data-tauri-drag-region")).toBe(true);
  await act(async () => button("前往设置").click());
  expect(options.onConfigure).toHaveBeenCalledOnce();
});

it("updates the independent controlled draft and retains values when switching views", async () => {
  const options = props();
  function Harness() {
    const [draft, setDraft] = useState<DrawingDraft>(initialDrawingDraft);
    return <DrawingWorkspace {...options} draft={draft}
      onDraftChange={(next) => { options.onDraftChange(next); setDraft(next); }} />;
  }
  await act(async () => root.render(<Harness />));
  const textarea = host.querySelector("textarea")!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(textarea, "清晨的山谷湖泊");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const [model, ratio, resolution] = host.querySelectorAll("select");
  for (const [select, value] of [[model, "configured-image-model"], [ratio, "16:9"], [resolution, "2K"]] as const) {
    await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
  }
  expect(options.onDraftChange).toHaveBeenLastCalledWith({
    id: "current", prompt: "清晨的山谷湖泊", aspectRatio: "16:9", resolution: "2K", modelId: "configured-image-model",
  });
  await act(async () => button("任务").click());
  expect(button("任务").getAttribute("aria-current")).toBe("page");
  expect(host.textContent).toContain("暂无绘图任务");
  await act(async () => button("成果库").click());
  expect(host.textContent).toContain("暂无绘图成果");
  await act(async () => button("生成").click());
  expect(host.querySelector("textarea")?.value).toBe("清晨的山谷湖泊");
  expect([...host.querySelectorAll("select")].map((item) => item.value)).toEqual(["configured-image-model", "16:9", "2K"]);
});

it("enables enqueueing while busy and guards submitting, references and invalid drafts", async () => {
  const options = props();
  const draft = { ...initialDrawingDraft, prompt: "湖泊", modelId: "configured-image-model" };
  for (const overrides of [
    { ready: false }, { draft: { ...draft, modelId: null } },
    { draft: { ...draft, prompt: " \n " } }, { submitting: true }, { referencesBusy: true },
  ]) {
    await act(async () => root.render(<DrawingWorkspace {...options} draft={draft} {...overrides} />));
    expect(host.querySelector<HTMLButtonElement>("#drawing-generate")?.disabled).toBe(true);
  }
  await act(async () => root.render(<DrawingWorkspace {...options} draft={draft} />));
  expect(button("生成图片").disabled).toBe(false);
  await act(async () => button("生成图片").click());
  expect(options.onGenerate).toHaveBeenCalledOnce();
  await act(async () => root.render(<DrawingWorkspace {...options} draft={draft} busy tasks={[task]} />));
  expect(button("加入队列").disabled).toBe(false);
  await act(async () => button("加入队列").click());
  expect(options.onGenerate).toHaveBeenCalledTimes(2);
});

it("suppresses the second browser double-click while permitting later separate clicks", async () => {
  const options = props();
  const draft = { ...initialDrawingDraft, prompt: "湖泊", modelId: "configured-image-model" };
  await act(async () => root.render(<DrawingWorkspace {...options} draft={draft} submitting={false} />));
  const generate = button("生成图片");
  for (const detail of [1, 2]) await act(async () => generate.dispatchEvent(new MouseEvent("click", { bubbles: true, detail })));
  expect(options.onGenerate).toHaveBeenCalledOnce();
  await act(async () => generate.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
  expect(options.onGenerate).toHaveBeenCalledTimes(2);
  await act(async () => generate.click());
  expect(options.onGenerate).toHaveBeenCalledTimes(3);
});

it("cancels all pending tasks but leaves saving tasks without cancellation", async () => {
  const options = props();
  await act(async () => root.render(<DrawingWorkspace {...options} busy tasks={[task]} />));
  await act(async () => button("取消全部待处理任务").click());
  expect(options.onCancel).toHaveBeenCalledExactlyOnceWith();
  expect(host.textContent).toContain("服务端仍可能继续生成并计费");
  await act(async () => root.render(<DrawingWorkspace {...options} busy tasks={[{ ...task, status: "saving" }]} />));
  expect(host.querySelector('[aria-label="绘图队列状态"]')?.textContent).toContain("保存 1");
  expect(host.textContent).not.toContain("取消全部待处理任务");
});

it("saves batch count, concurrency and completion sound in the controlled draft across views", async () => {
  const options = props();
  function Harness() {
    const [draft, setDraft] = useState<DrawingDraft>(initialDrawingDraft);
    return <DrawingWorkspace {...options} draft={draft}
      onDraftChange={next => { options.onDraftChange(next); setDraft(next); }} />;
  }
  await act(async () => root.render(<Harness />));
  const [count, concurrency] = host.querySelectorAll<HTMLInputElement>('input[type="number"]');
  expect([count.min, count.max, concurrency.min, concurrency.max]).toEqual(["1", "99", "1", "4"]);
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  const change = async (input: HTMLInputElement, value: string) => act(async () => {
    setValue.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await change(count, "100");
  expect(count.value).toBe("99");
  await change(count, "0");
  expect(count.value).toBe("1");
  await change(count, "3");
  await change(concurrency, "5");
  expect(concurrency.value).toBe("4");
  await change(concurrency, "0");
  expect(concurrency.value).toBe("1");
  await change(concurrency, "2");
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  expect(options.onDraftChange).toHaveBeenLastCalledWith({ ...initialDrawingDraft, count: 3, concurrency: 2, completionSound: false });
  await act(async () => button("任务").click());
  await act(async () => button("生成").click());
  expect([...host.querySelectorAll<HTMLInputElement>('input[type="number"]')].map(input => input.value)).toEqual(["3", "2"]);
  expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
  expect(button("加入 3 个任务")).toBeDefined();
  expect(host.textContent).toContain("独立单图请求数");
});

it("keeps queue controls and counts across views, and targets cancellation by task id", async () => {
  const options = props();
  const tasks: DrawingTask[] = [
    { ...task, id: "queued", status: "queued" }, { ...task, id: "preparing", status: "preparing" },
    task, { ...task, id: "saving", status: "saving" }, { ...task, id: "completed", status: "completed" },
    { ...task, id: "failed", status: "failed" }, { ...task, id: "cancelled", status: "cancelled" },
    { ...task, id: "unknown", status: "unknown" }, { ...task, id: "save-failed", status: "save-failed" },
  ];
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={tasks} busy />));
  const status = () => host.querySelector('[aria-label="绘图队列状态"]')!.textContent;
  expect(status()).toBe("队列运行中 · 等待 1 · 准备 1 · 生成 1 · 保存 1 · 已结束 5");
  await act(async () => button("暂停队列").click());
  expect(options.onPause).toHaveBeenCalledOnce();
  await act(async () => button("任务").click());
  expect(host.querySelectorAll('button[aria-label^="取消任务"]')).toHaveLength(3);
  for (const label of ["取消排队", "取消准备", "取消生成"]) await act(async () => button(label).click());
  expect(options.onCancel.mock.calls).toEqual([["queued"], ["preparing"], [task.id]]);
  expect(button("重试本地保存").disabled).toBe(true);
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={tasks} busy paused />));
  expect(status()).toContain("队列已暂停");
  await act(async () => button("继续队列").click());
  expect(options.onResume).toHaveBeenCalledOnce();
  await act(async () => button("成果库").click());
  expect(status()).toContain("已结束 5");
  expect(button("继续队列")).toBeDefined();
});

it("measures elapsed execution from start time and freezes it at each terminal finish", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-01T00:02:05Z"));
  const options = props();
  const running: DrawingTask = { ...task, startedAt: "2026-10-01T00:02:00Z" };
  const completed: DrawingTask = { ...task, id: "finished", status: "completed", startedAt: "2026-10-01T00:00:00Z", finishedAt: "2026-10-01T00:01:03Z" };
  const queued: DrawingTask = { ...task, id: "queued", status: "queued" };
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[running, completed, queued]} />));
  await act(async () => button("任务").click());
  const times = () => [...host.querySelectorAll(".drawing-record")].map(record => record.textContent);
  expect(times()[0]).toContain("执行耗时 0:05");
  expect(times()[1]).toContain("执行耗时 1:03");
  expect(times()[2]).toContain("执行耗时 —");
  await act(async () => vi.advanceTimersByTime(3000));
  expect(times()[0]).toContain("执行耗时 0:08");
  expect(times()[1]).toContain("执行耗时 1:03");
  const cancelled: DrawingTask = { ...running, status: "cancelled", finishedAt: "2026-10-01T00:02:08Z" };
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[cancelled, completed]} />));
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => vi.advanceTimersByTime(10000));
  expect(times()[0]).toContain("执行耗时 0:08");
  expect(times()[1]).toContain("执行耗时 1:03");
});

it("renders one controlled large preview and routes history, export and reuse callbacks", async () => {
  const options = props();
  const second = { ...result, id: "result-two" };
  await act(async () => root.render(<DrawingWorkspace {...options} results={[second, result]}
    selectedResultId={result.id} previewUrl="blob:https://synthetic.example/preview-one" />));
  expect(host.querySelectorAll("img")).toHaveLength(1);
  expect(host.querySelector(".drawing-preview-stage img")?.getAttribute("src")).toBe("blob:https://synthetic.example/preview-one");
  expect(host.textContent).not.toContain(parameters.baseUrl);
  expect(host.textContent).not.toContain(result.reference);
  await act(async () => button("成果 2").click());
  expect(options.onSelectResult).toHaveBeenCalledWith(second.id);
  await act(async () => button("导出图片").click());
  expect(options.onExport).toHaveBeenCalledWith(result.id);
  await act(async () => button("复用参数").click());
  expect(options.onReuse).toHaveBeenCalledWith(result.id);
  await act(async () => button("成果库").click());
  expect(host.querySelectorAll("img")).toHaveLength(0);
  await act(async () => button("查看成果 2").click());
  expect(options.onSelectResult).toHaveBeenLastCalledWith(second.id);
  expect(button("生成").getAttribute("aria-current")).toBe("page");
});

it("shows unknown and local-save failure states without resubmitting generation", async () => {
  const options = props();
  const unknown = { ...task, id: "task-unknown", status: "unknown" as const };
  const saveFailed = { ...task, id: "task-save", status: "save-failed" as const, error: "本地保存失败 <script>unsafe</script>" };
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[unknown, saveFailed]} />));
  await act(async () => button("任务").click());
  expect(host.textContent).toContain("结果未知");
  expect(host.textContent).toContain("请求可能已经发出，不会自动重发。");
  expect(host.querySelector("script")).toBeNull();
  expect(host.textContent).toContain(saveFailed.error);
  await act(async () => button("重试本地保存").click());
  expect(options.onRetrySave).toHaveBeenCalledWith(saveFailed.id);
  expect(options.onGenerate).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("取消生成");
});

it("displays escaped workspace and preview errors while keeping the preview region", async () => {
  await act(async () => root.render(<DrawingWorkspace {...props()} error="操作失败 <script>bad</script>"
    results={[result]} selectedResultId={result.id} previewError="无法读取图片" />));
  expect(host.querySelector("script")).toBeNull();
  expect(host.querySelector(".drawing-preview-stage")?.textContent).toContain("无法读取图片");
  expect(host.querySelectorAll('[role="alert"]')).toHaveLength(2);
});

it("batches picker, drop and clipboard image imports while preserving text paste and guarding loading", async () => {
  const options = props();
  await act(async () => root.render(<DrawingWorkspace {...options} />));
  const first = new File(["one"], "one.png", { type: "image/png" });
  const second = new File(["two"], "two.bmp", { type: "image/bmp" });
  const picker = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  expect(picker.multiple).toBe(true);
  expect(picker.accept).toContain(".bmp");
  Object.defineProperty(picker, "files", { configurable: true, value: [first, second] });
  await act(async () => picker.dispatchEvent(new Event("change", { bubbles: true })));
  expect(options.onAddReferences).toHaveBeenCalledExactlyOnceWith([first, second]);
  expect(picker.value).toBe("");
  const drop = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(drop, "dataTransfer", { value: { files: [second, first] } });
  await act(async () => host.querySelector("textarea")!.dispatchEvent(drop));
  expect(drop.defaultPrevented).toBe(true);
  expect(options.onAddReferences).toHaveBeenLastCalledWith([second, first]);
  const paste = (items: Array<{ kind: string; type: string; getAsFile?(): File }>) => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { items } });
    return event;
  };
  const textPaste = paste([{ kind: "string", type: "text/plain" }]);
  await act(async () => host.querySelector("textarea")!.dispatchEvent(textPaste));
  expect(textPaste.defaultPrevented).toBe(false);
  expect(options.onAddReferences).toHaveBeenCalledTimes(2);
  const imagePaste = paste([{ kind: "file", type: "image/png", getAsFile: () => first }]);
  await act(async () => host.querySelector("textarea")!.dispatchEvent(imagePaste));
  expect(imagePaste.defaultPrevented).toBe(true);
  expect(options.onAddReferences).toHaveBeenLastCalledWith([first]);
  await act(async () => root.render(<DrawingWorkspace {...options} ready={false} />));
  expect(button("添加参考图").disabled).toBe(true);
  const blockedDrop = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(blockedDrop, "dataTransfer", { value: { files: [first] } });
  await act(async () => host.querySelector("textarea")!.dispatchEvent(blockedDrop));
  expect(blockedDrop.defaultPrevented).toBe(true);
  expect(options.onAddReferences).toHaveBeenCalledTimes(3);
  await act(async () => root.render(<DrawingWorkspace {...options} referencesBusy />));
  expect(button("添加参考图").disabled).toBe(true);
  expect([...host.querySelectorAll('[role="status"]')].some(status => status.textContent?.includes("正在添加参考图"))).toBe(true);
});

it("numbers references and allows view, reorder and removal during generation with preview URL cleanup", async () => {
  const options = props();
  const first: DrawingReference = { ...result, id: "reference-one", name: "first.png" };
  const second: DrawingReference = { ...result, id: "reference-two", name: "second.png", reference: "drawing/private-second.png" };
  const draft = { ...initialDrawingDraft, references: [first, second] };
  await act(async () => root.render(<DrawingWorkspace {...options} draft={draft} busy tasks={[task]} />));
  const labeled = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  expect(labeled("上移参考图 1").disabled).toBe(true);
  expect(labeled("下移参考图 2").disabled).toBe(true);
  expect(button("添加参考图").disabled).toBe(false);
  await act(async () => labeled("下移参考图 1").click());
  expect(options.onMoveReference).toHaveBeenCalledWith(first.id, 1);
  await act(async () => labeled("上移参考图 2").click());
  expect(options.onMoveReference).toHaveBeenCalledWith(second.id, -1);
  await act(async () => labeled("查看参考图 1").click());
  expect(host.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("参考图 1 大图预览");
  expect(document.activeElement).toBe(button("关闭参考图预览"));
  await act(async () => button("关闭参考图预览").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(labeled("查看参考图 1"));
  await act(async () => labeled("移除参考图 1").click());
  expect(options.onRemoveReference).toHaveBeenCalledWith(first.id);
  await act(async () => root.render(<DrawingWorkspace {...options} draft={{ ...draft, references: [second] }} />));
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<DrawingWorkspace {...options} draft={{ ...draft, references: [second] }} ready={false} />));
  expect(labeled("移除参考图 1").disabled).toBe(true);
  expect(options.onGenerate).not.toHaveBeenCalled();
  expect(options.onDraftChange).not.toHaveBeenCalled();
});

it("routes preview and library reference actions without changing draft options or automatically generating", async () => {
  const options = props();
  await act(async () => root.render(<DrawingWorkspace {...options} results={[result]} selectedResultId={result.id}
    previewUrl="blob:synthetic-result" busy tasks={[task]} />));
  await act(async () => button("作为参考图").click());
  expect(options.onUseAsReference).toHaveBeenCalledExactlyOnceWith(result.id);
  await act(async () => button("成果库").click());
  await act(async () => button("作为参考图").click());
  expect(options.onUseAsReference).toHaveBeenCalledTimes(2);
  expect(button("成果库").getAttribute("aria-current")).toBe("page");
  expect(options.onGenerate).not.toHaveBeenCalled();
  expect(options.onDraftChange).not.toHaveBeenCalled();
  expect(options.onReuse).not.toHaveBeenCalled();
});

it("cancels history deletion without changing tasks, saved results or the controlled draft", async () => {
  const options = props();
  const completed: DrawingTask = { ...task, status: "completed" };
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[completed]} results={[result]} />));
  await act(async () => button("任务").click());
  await act(async () => button("删除历史").click());
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain("已保存成果始终保留");
  await act(async () => button("取消").click());
  expect(options.onDeleteTasks).not.toHaveBeenCalled();
  expect(options.onDraftChange).not.toHaveBeenCalled();
  expect(host.querySelectorAll(".drawing-record")).toHaveLength(1);
  await act(async () => button("删除历史").click());
  await act(async () => button("确认删除历史").click());
  expect(options.onDeleteTasks).toHaveBeenCalledExactlyOnceWith([completed.id]);
  await act(async () => button("成果库").click());
  expect(host.textContent).toContain("成果 1");
});

it("aggregates unknown and save-failed warnings for bulk history clearing with exact image numbers", async () => {
  const options = props();
  const tasks: DrawingTask[] = [
    { ...task, id: "unknown", status: "unknown" },
    { ...task, id: "save", status: "save-failed", recovery: { total: 4, durable: [0, 2], memory: [1], lost: [3], unverified: true } },
    { ...task, id: "failed", status: "failed" }, { ...task, id: "cancelled", status: "cancelled" },
    { ...task, id: "completed", status: "completed" }, { ...task, id: "saving", status: "saving" },
  ];
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={tasks} />));
  await act(async () => button("任务").click());
  await act(async () => button("清空失败历史").click());
  const warning = host.querySelector('[role="dialog"]')!.textContent!;
  for (const text of ["删除 4 条", "不会取消远端生成或计费", "已暂存图片 1、3", "仅在内存的图片 2", "已丢失图片 4", "无法恢复", "可用性尚未核实", "已保存成果始终保留"])
    expect(warning).toContain(text);
  expect(options.onDeleteTasks).not.toHaveBeenCalled();
  await act(async () => button("取消").click());
  await act(async () => button("清空失败历史").click());
  await act(async () => button("确认删除历史").click());
  expect(options.onDeleteTasks).toHaveBeenCalledExactlyOnceWith(["unknown", "save", "failed", "cancelled"]);
  await act(async () => button("清空已完成历史").click());
  await act(async () => button("确认删除历史").click());
  expect(options.onDeleteTasks).toHaveBeenLastCalledWith(["completed"]);
});

it("keeps deletion disabled for active tasks and blocks all management while busy", async () => {
  const options = props();
  const tasks: DrawingTask[] = ["queued", "preparing", "dispatching", "running", "saving"].map((status, index) => ({
    ...task, id: `active-${index}`, status: status as DrawingTask["status"],
  }));
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={tasks} />));
  await act(async () => button("任务").click());
  const deleteButtons = [...host.querySelectorAll<HTMLButtonElement>('button[aria-label^="删除任务"]')];
  expect(deleteButtons).toHaveLength(5);
  expect(deleteButtons.every(button => button.disabled)).toBe(true);
  for (const deleteButton of deleteButtons) await act(async () => deleteButton.click());
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(options.onDeleteTasks).not.toHaveBeenCalled();
  expect(host.querySelectorAll('button[aria-label^="重新生成任务"]')).toHaveLength(0);
  expect(host.querySelectorAll('button[aria-label^="取消任务"]')).toHaveLength(4);
  const terminalTasks: DrawingTask[] = [{ ...task, status: "completed", batchId: "batch" }, { ...task, id: "queued", status: "queued", batchId: "batch" }];
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={terminalTasks} managementBusy />));
  for (const text of ["清空已完成历史", "删除历史", "重新生成", "取消本批待处理任务", "取消排队", "取消全部待处理任务"])
    expect(button(text).disabled).toBe(true);
});

it("offers batch cancellation once per batch and ignores repeat double-click actions", async () => {
  const options = props();
  const tasks: DrawingTask[] = [
    { ...task, id: "done", status: "completed", batchId: "batch-one" },
    { ...task, batchId: "batch-one" }, { ...task, id: "saving", status: "saving", batchId: "batch-two" },
  ];
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={tasks} />));
  await act(async () => button("任务").click());
  const batches = [...host.querySelectorAll<HTMLButtonElement>('button[aria-label$="所在批次"]')];
  expect(batches).toHaveLength(2);
  expect(batches[0].disabled).toBe(false);
  expect(batches[1].disabled).toBe(true);
  const click = async (target: HTMLButtonElement, detail: number) => act(async () => target.dispatchEvent(new MouseEvent("click", { bubbles: true, detail })));
  for (const detail of [1, 2]) await click(batches[0], detail);
  expect(options.onCancelBatch).toHaveBeenCalledExactlyOnceWith("batch-one");
  for (const detail of [1, 2]) await click(button("重新生成"), detail);
  expect(options.onRegenerate).toHaveBeenCalledExactlyOnceWith("done");
  for (const detail of [1, 2]) await click(button("删除历史"), detail);
  expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  const confirmDelete = button("确认删除历史");
  for (const detail of [1, 2]) await click(confirmDelete, detail);
  expect(options.onDeleteTasks).toHaveBeenCalledExactlyOnceWith(["done"]);
  for (const detail of [1, 2]) await click(button("取消生成"), detail);
  expect(options.onCancel).toHaveBeenCalledExactlyOnceWith(task.id);
});

it("requires duplicate billing confirmation for unknown regeneration without resubmitting after cancellation", async () => {
  const options = props();
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[{ ...task, status: "unknown" }]} />));
  await act(async () => button("任务").click());
  await act(async () => button("重新生成").click());
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain("重复计费");
  await act(async () => button("取消").click());
  expect(options.onRegenerate).not.toHaveBeenCalled();
  for (const detail of [1, 2]) await act(async () => button("重新生成").dispatchEvent(new MouseEvent("click", { bubbles: true, detail })));
  expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  await act(async () => button("确认新建任务").click());
  expect(options.onRegenerate).toHaveBeenCalledExactlyOnceWith(task.id);
  expect(options.onGenerate).not.toHaveBeenCalled();
});

it("shows safe human diagnostic details and recovery options without exposing raw category or request addresses", async () => {
  const options = props();
  const tasks: DrawingTask[] = [
    { ...task, status: "failed", diagnostic: { category: "rate-limited", httpStatus: 429 } },
    { ...task, id: "configuration", status: "failed", diagnostic: { category: "configuration", httpStatus: 999 } },
    { ...task, id: "save", status: "save-failed", recovery: { total: 3, durable: [0], memory: [1], lost: [2] } },
  ];
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={tasks} />));
  await act(async () => button("任务").click());
  expect(host.querySelectorAll("details summary")).toHaveLength(2);
  for (const text of ["请求过于频繁", "HTTP 状态 429", "模型或连接配置不可用", "可重试本地保存", "退出或删除任务后丢失", "无法恢复"])
    expect(host.textContent).toContain(text);
  expect(host.textContent).not.toContain(parameters.baseUrl);
  expect(host.textContent).not.toContain("rate-limited");
  expect(host.textContent).not.toContain("HTTP 状态 999");
});

it("contains keyboard focus in the confirmation and restores its opener after Escape", async () => {
  const options = props();
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[{ ...task, status: "completed" }]} />));
  await act(async () => button("任务").click());
  const opener = button("删除历史");
  opener.focus();
  await act(async () => opener.click());
  expect(document.activeElement).toBe(button("取消"));
  expect(host.querySelector(".drawing-body")?.hasAttribute("inert")).toBe(true);
  const key = async (value: string, shiftKey = false) => act(async () => document.activeElement!.dispatchEvent(
    new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true }),
  ));
  await key("Tab", true);
  expect(document.activeElement).toBe(button("确认删除历史"));
  await key("Tab");
  expect(document.activeElement).toBe(button("取消"));
  const outerKey = vi.fn();
  document.addEventListener("keydown", outerKey);
  await key("Escape");
  document.removeEventListener("keydown", outerKey);
  expect(outerKey).not.toHaveBeenCalled();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(host.querySelector(".drawing-body")?.hasAttribute("inert")).toBe(false);
  expect(document.activeElement).toBe(opener);
  expect(options.onDeleteTasks).not.toHaveBeenCalled();
});

it("invalidates deletion confirmation when selected recovery data or task eligibility changes", async () => {
  const options = props();
  const original: DrawingTask = { ...task, status: "save-failed", recovery: { total: 1, durable: [0], memory: [], lost: [] } };
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[original]} />));
  await act(async () => button("任务").click());
  await act(async () => button("清空失败历史").click());
  expect(button("确认删除历史").disabled).toBe(false);
  const changed = { ...original, recovery: { total: 1, durable: [], memory: [], lost: [0] } };
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[changed]} />));
  expect(button("确认删除历史").disabled).toBe(true);
  expect(host.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain("任务状态已变化");
  await act(async () => button("确认删除历史").click());
  expect(options.onDeleteTasks).not.toHaveBeenCalled();
  await act(async () => button("取消").click());
  await act(async () => button("删除历史").click());
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain("已丢失图片 1");
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[{ ...changed, status: "saving" }]} />));
  expect(button("确认删除历史").disabled).toBe(true);
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[]} />));
  expect(button("确认删除历史").disabled).toBe(true);
  expect(options.onDeleteTasks).not.toHaveBeenCalled();
});

it("blocks unknown regeneration confirmation if its selected task changes or management becomes busy", async () => {
  const options = props();
  const unknown: DrawingTask = { ...task, status: "unknown" };
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[unknown]} />));
  await act(async () => button("任务").click());
  await act(async () => button("重新生成").click());
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[unknown]} managementBusy />));
  expect(button("确认新建任务").disabled).toBe(true);
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[{ ...unknown, status: "completed" }]} />));
  expect(button("确认新建任务").disabled).toBe(true);
  await act(async () => button("确认新建任务").click());
  expect(options.onRegenerate).not.toHaveBeenCalled();
});
