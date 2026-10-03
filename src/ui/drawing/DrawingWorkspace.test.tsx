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
  const result = [...host.querySelectorAll("button"), ...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')]
    .find((item) => item.textContent === text || item.getAttribute("aria-label") === text || item.title === text);
  if (!result) throw new Error(`Missing button: ${text}`);
  return result;
}
function field(label: string) { return host.querySelector<HTMLButtonElement>(`.select-field[aria-label="${label}"]`)!; }
function fieldText(label: string) { return field(label).querySelector("span")?.textContent; }
async function choose(label: string, text: string) {
  await act(async () => field(label).click());
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"], .model-picker-option')]
    .find(item => (item.querySelector("strong")?.textContent ?? item.querySelector("span")?.textContent) === text);
  if (!option) throw new Error(`Missing ${label} option: ${text}`);
  await act(async () => option.click());
}
async function inspectChoices(label: string) {
  await act(async () => field(label).click());
  const choices = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
  const result = choices.map(option => ({ label: option.querySelector("span")?.textContent, disabled: option.getAttribute("aria-disabled") === "true" }));
  await act(async () => field(label).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  return result;
}

it("searches full model labels by explicit protocol without changing drafts or dispatching until selection", async () => {
  const options = props();
  const fullLabel = "Synthetic provider / connection / extremely long OpenAI model label kept in full";
  const draft = { ...initialDrawingDraft, prompt: "kept", modelId: "removed", reusedProtocol: "openai-images" as const,
    openai: { size: "1536x1024", quality: "high" } };
  await act(async () => root.render(<DrawingWorkspace {...options} draft={draft} models={[
    ...options.models, { id: "available", label: fullLabel, protocol: "openai-images" },
  ]} />));
  const trigger = field("绘图模型");
  await act(async () => { trigger.focus(); trigger.click(); });
  const search = document.querySelector<HTMLInputElement>('[aria-label="搜索绘图模型"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "OpenAI Images");
    search.dispatchEvent(new Event("input", { bubbles: true }));
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  expect(document.querySelector(".model-picker h3")?.textContent).toBe("OpenAI Images");
  expect(document.querySelector('.model-picker section[aria-label="OpenAI Images"] .model-picker-option strong')?.textContent).toBe(fullLabel);
  expect(document.querySelectorAll(".model-picker-option")).toHaveLength(2);
  expect(options.onDraftChange).not.toHaveBeenCalled();
  expect(options.onGenerate).not.toHaveBeenCalled();
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="关闭绘图模型"]')!.click());
  expect(document.activeElement).toBe(trigger);
  expect(fieldText("画质")).toBe("high");
  await choose("绘图模型", fullLabel);
  expect(options.onDraftChange).toHaveBeenCalledExactlyOnceWith({ ...initialDrawingDraft, prompt: "kept", modelId: "available", openai: draft.openai });
  await act(async () => root.render(<DrawingWorkspace {...options} draft={{ ...draft, modelId: "available" }} models={[
    { id: "available", label: fullLabel, protocol: "openai-images" },
  ]} />));
  await choose("绘图模型", "选择绘图模型");
  expect(options.onDraftChange).toHaveBeenLastCalledWith({ ...initialDrawingDraft, prompt: "kept", modelId: null, openai: draft.openai });
  expect(options.onGenerate).not.toHaveBeenCalled();
});

it("keeps task UUID labels stable across reordering, removal, internal tabs and workspace remount", async () => {
  const options = props();
  const first: DrawingTask = { ...task, id: "a3f91c20-0000-4000-8000-000000000001", status: "completed" };
  const second: DrawingTask = { ...task, id: "b482d591-0000-4000-8000-000000000002", status: "completed", sourceTaskId: first.id };
  const labels = () => [...host.querySelectorAll('.drawing-task-row th[scope="row"]')].map(cell => cell.textContent);
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[second, first]} />));
  expect(labels()).toEqual(["b482d591", "a3f91c20"]);
  expect(host.querySelector('.drawing-task-row th')?.getAttribute("title")).toBe(second.id);
  await act(async () => button("展开任务 b482d591 详情").click());
  expect(host.querySelector(".drawing-task-detail-row:not([hidden])")?.textContent).toContain(`任务 ID：${second.id}`);
  expect(host.textContent).toContain("重新生成自任务 a3f91c20");
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[first, second]} />));
  expect(labels()).toEqual(["a3f91c20", "b482d591"]);
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[second]} />));
  expect(labels()).toEqual(["b482d591"]);
  await act(async () => button("任务日志").click());
  expect(labels()).toEqual(["b482d591"]);
  await act(async () => root.render(<div />));
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[second]} />));
  expect(labels()).toEqual(["b482d591"]);
  expect(options.onGenerate).not.toHaveBeenCalled();
});

it("uses full task identity for actions and confirmations even when short UUID labels match", async () => {
  const options = { ...props(), onCopyTaskPrompt: vi.fn() };
  const first: DrawingTask = { ...task, id: "a3f91c20-0000-4000-8000-000000000001", status: "completed" };
  const second: DrawingTask = { ...first, id: "a3f91c20-0000-4000-8000-000000000002" };
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[first, second]} />));
  const rows = [...host.querySelectorAll(".drawing-task-row")];
  expect(rows.map(row => row.querySelector("th")?.textContent)).toEqual(["a3f91c20", "a3f91c20"]);
  expect(rows.map(row => row.querySelector("th")?.title)).toEqual([first.id, second.id]);
  await act(async () => rows[1].querySelector<HTMLButtonElement>('[title="复制提示词"]')!.click());
  expect(options.onCopyTaskPrompt).toHaveBeenCalledExactlyOnceWith(second.id);
  await act(async () => rows[0].querySelector<HTMLButtonElement>('[title="删除历史"]')!.click());
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[second, first]} />));
  expect(button("确认删除历史").disabled).toBe(false);
  await act(async () => button("确认删除历史").click());
  expect(options.onDeleteTasks).toHaveBeenCalledExactlyOnceWith([first.id]);
});

it("keeps the form and preview mounted while task tabs activate and focus from the keyboard", async () => {
  const options = { ...props(), onPreviewActive: vi.fn() };
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[task]} results={[result]}
    selectedResultId={result.id} previewUrl="blob:preview" />));
  const form = host.querySelector("textarea")!;
  const preview = host.querySelector(".drawing-preview-stage img")!;
  const list = button("任务列表"), logs = button("任务日志");
  const panel = host.querySelector('[role="tabpanel"]')!;
  expect(form.closest(".drawing-form")?.parentElement).toBe(host.querySelector(".drawing-task-panel")?.parentElement);
  expect(list.getAttribute("role")).toBe("tab");
  expect(logs.getAttribute("role")).toBe("tab");
  expect(list.tabIndex).toBe(0);
  expect(logs.tabIndex).toBe(-1);
  expect(panel.getAttribute("id")).toBe(list.getAttribute("aria-controls"));
  expect(panel.getAttribute("aria-labelledby")).toBe(list.id);
  list.focus();
  for (const [key, target] of [["ArrowRight", logs], ["ArrowRight", list], ["ArrowLeft", logs], ["Home", list], ["End", logs]] as const) {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    await act(async () => document.activeElement!.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(target);
    expect(target.getAttribute("aria-selected")).toBe("true");
    expect(target.tabIndex).toBe(0);
    expect((target === list ? logs : list).tabIndex).toBe(-1);
    expect(panel.getAttribute("aria-labelledby")).toBe(target.id);
    expect(host.querySelector("textarea")).toBe(form);
    expect(host.querySelector(".drawing-preview-stage img")).toBe(preview);
    expect(host.querySelector(".drawing-task-log") !== null).toBe(target === logs);
  }
  expect(options.onPreviewActive).toHaveBeenCalledExactlyOnceWith(true);
  expect(options.onGenerate).not.toHaveBeenCalled();
  expect(options.onSelectResult).not.toHaveBeenCalled();
});

it("opens the output directory once while pending and reports sanitized failure", async () => {
  let rejectOpen!: (reason: Error) => void;
  const onOpenOutputDirectory = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectOpen = reject; }));
  const options = { ...props(), onOpenOutputDirectory };
  await act(async () => root.render(<DrawingWorkspace {...options} />));
  expect(host.querySelector('[aria-label="绘图视图"]')).toBeNull();
  expect(host.querySelector('textarea')).not.toBeNull();
  expect(host.querySelector('[role="tablist"]')?.textContent).toBe("任务列表任务日志");
  expect(button("任务列表").getAttribute("aria-selected")).toBe("true");
  expect(button("打开输出文件夹").closest("section")?.getAttribute("aria-labelledby")).toBe("drawing-preview-title");
  expect(host.textContent).not.toContain("每个任务独立请求一张图片，生成后自动保存。切换视图不会停止队列。");
  for (const text of ["成果库", "全选成果", "导出所选图片", "删除所选成果"]) expect(host.textContent).not.toContain(text);
  await act(async () => { button("打开输出文件夹").click(); button("打开输出文件夹").click(); });
  expect(onOpenOutputDirectory).toHaveBeenCalledOnce();
  expect(button("打开输出文件夹").disabled).toBe(true);
  await act(async () => rejectOpen(new Error("C:\\private\\machine https://secret.example sk-private-key")));
  expect(button("打开输出文件夹").disabled).toBe(false);
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("无法打开输出文件夹，请稍后重试。");
  for (const text of ["private", "secret.example", "sk-private-key"]) expect(host.textContent).not.toContain(text);
  onOpenOutputDirectory.mockImplementation(async () => undefined);
  await act(async () => button("打开输出文件夹").click());
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(onOpenOutputDirectory).toHaveBeenCalledTimes(2);
  await act(async () => button("打开输出文件夹").dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 })));
  expect(onOpenOutputDirectory).toHaveBeenCalledTimes(2);
  for (const state of [{ ready: false }, { closing: true }]) {
    await act(async () => root.render(<DrawingWorkspace {...options} {...state} />));
    expect(button("打开输出文件夹").disabled).toBe(true);
  }
});

it("shows immutable submitted parameters after draft edits without exposing resource or connection addresses", async () => {
  const options = props();
  const submitted: DrawingTask = { ...task, sourceTaskId: "deleted-source", parameters: { ...parameters, references: [{ ...result, name: "private-reference.png" }] } };
  const original = structuredClone(submitted);
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[submitted]}
    draft={{ ...initialDrawingDraft, prompt: "下一张的新提示词", modelId: "changed-model", aspectRatio: "1:1", resolution: "4K" }} />));
  const taskPanel = host.querySelector('[role="tabpanel"]')!;
  expect(taskPanel.textContent).not.toContain(parameters.modelId);
  expect(button("展开任务 task-one 详情").getAttribute("aria-expanded")).toBe("false");
  await act(async () => button("展开任务 task-one 详情").click());
  expect(button("收起任务 task-one 详情").getAttribute("aria-expanded")).toBe("true");
  expect(host.querySelector('.drawing-task-detail-row td')?.getAttribute("colspan")).toBe("6");
  for (const text of [parameters.prompt, parameters.modelName, parameters.modelId, parameters.protocol, "宽高比：16:9", "分辨率：2K", "参考图 1 张", task.createdAt])
    expect(taskPanel.textContent).toContain(text);
  for (const text of ["下一张的新提示词", "changed-model", "宽高比：1:1", parameters.baseUrl, result.reference, "private-reference.png"])
    expect(taskPanel.textContent).not.toContain(text);
  expect(submitted).toEqual(original);
  expect(taskPanel.textContent).toContain("重新生成的任务（来源历史已删除）");
  await act(async () => button("收起任务 task-one 详情").click());
  expect(host.querySelector<HTMLTableRowElement>(".drawing-task-detail-row")?.hidden).toBe(true);
  expect(taskPanel.querySelector(".drawing-task-parameters")).toBeNull();
  const openaiTask: DrawingTask = { ...task, parameters: { ...parameters, protocol: "openai-images", size: "1536x1024", quality: "high" } };
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[openaiTask]} />));
  await act(async () => button("展开任务 task-one 详情").click());
  expect(host.textContent).toContain("尺寸：1536x1024 · 画质：high");
});

it("shows only known durable log times and allowlisted diagnostics, with independent pagination and persistent preview", async () => {
  const onPreviewActive = vi.fn(), readThumbnail = vi.fn(async () => ({ mime: "image/png", data: "AQ==" }));
  const options = { ...props(), onPreviewActive, readThumbnail };
  const completed: DrawingTask = { ...task, status: "failed", startedAt: "2026-09-30T00:00:10Z", finishedAt: "2026-09-30T00:01:00Z",
    updatedAt: "2026-09-30T00:01:30Z", error: "https://private.example C:\\private\\path sk-private-key",
    diagnostic: { category: "rate-limited", httpStatus: 429 } };
  const tasks = [completed, ...Array.from({ length: 50 }, (_, index) => ({ ...task, id: `log-${index}` }))];
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={tasks} results={[result]} selectedResultId={result.id} previewUrl="blob:preview" />));
  expect(onPreviewActive).toHaveBeenLastCalledWith(true);
  expect(onPreviewActive).toHaveBeenCalledExactlyOnceWith(true);
  expect(host.querySelector('.drawing-preview-stage img')?.getAttribute("src")).toBe("blob:preview");
  await act(async () => button("下一页").click());
  expect(host.querySelectorAll(".drawing-task-row")).toHaveLength(1);
  const thumbnailCalls = readThumbnail.mock.calls.length;
  await act(async () => button("任务日志").click());
  expect(host.querySelectorAll(".drawing-task-row")).toHaveLength(50);
  const firstLog = host.querySelector(".drawing-task-log")!;
  expect([...firstLog.querySelectorAll("time")].map(time => time.dateTime)).toEqual([completed.createdAt, completed.startedAt, completed.finishedAt, completed.updatedAt]);
  expect(firstLog.textContent).toContain(`执行结束：${completed.finishedAt}`);
  expect(firstLog.textContent).toContain(`最近状态 · 生成失败：${completed.updatedAt}`);
  expect(host.querySelectorAll(".drawing-task-log")[1].textContent).toContain("最近状态 · 生成中");
  expect(host.querySelectorAll(".drawing-task-log")[1].textContent).not.toContain("开始执行");
  expect(host.textContent).toContain("显示每次生成的入队、开始、结束或最近状态，以及失败原因。");
  expect(host.textContent).toContain("请求过于频繁 · HTTP 状态 429");
  for (const text of [completed.error!, parameters.baseUrl, result.reference, "rate-limited"]) expect(host.textContent).not.toContain(text);
  expect(host.querySelector('.drawing-preview-stage img')?.getAttribute("src")).toBe("blob:preview");
  expect(onPreviewActive).toHaveBeenCalledExactlyOnceWith(true);
  expect(readThumbnail).toHaveBeenCalledTimes(thumbnailCalls);
  await act(async () => button("下一页").click());
  expect(host.querySelectorAll(".drawing-task-row")).toHaveLength(1);
  await act(async () => button("任务列表").click());
  expect(host.querySelector('[aria-label="任务分页"]')?.textContent).toContain("第 2 / 2 页");
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={tasks.slice(0, 49)} />));
  expect(host.querySelectorAll(".drawing-task-row")).toHaveLength(49);
  await act(async () => button("任务日志").click());
  expect(host.querySelectorAll(".drawing-task-row")).toHaveLength(49);
  expect(host.querySelector('[aria-label="任务日志分页"]')).toBeNull();
  expect(options.onGenerate).not.toHaveBeenCalled();
  await act(async () => root.render(<div />));
  expect(onPreviewActive.mock.calls).toEqual([[true], [false]]);
});

it("keeps retry-save status times distinct from the original execution end through successive failures", async () => {
  const options = props();
  const originalEnd = "2026-09-30T00:01:00Z";
  const failed: DrawingTask = { ...task, status: "save-failed", startedAt: "2026-09-30T00:00:10Z", finishedAt: originalEnd, updatedAt: originalEnd };
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[failed]} />));
  await act(async () => button("任务列表").click());
  await act(async () => button("任务日志").click());
  const log = () => host.querySelector(".drawing-task-log")!;
  expect(log().textContent).toContain(`结束 · 保存失败：${originalEnd}`);

  const retrying: DrawingTask = { ...failed, status: "saving", updatedAt: "2026-09-30T00:05:00Z" };
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[retrying]} />));
  expect(log().textContent).toContain(`执行结束：${originalEnd}`);
  expect(log().textContent).toContain(`最近状态 · 正在保存：${retrying.updatedAt}`);
  expect(log().textContent).not.toContain("结束 · 正在保存");
  expect(button("删除任务 task-one 历史").disabled).toBe(true);
  await act(async () => button("任务列表").click());
  await act(async () => button("展开任务 task-one 详情").click());
  expect(host.textContent).toContain(`最近状态时间：${retrying.updatedAt}`);
  expect(host.textContent).toContain(`执行结束时间：${originalEnd}`);

  const failedAgain: DrawingTask = { ...retrying, status: "save-failed", updatedAt: "2026-09-30T00:05:20Z" };
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[failedAgain]} />));
  expect(host.textContent).toContain(`最近状态时间：${failedAgain.updatedAt}`);
  await act(async () => button("任务日志").click());
  expect(log().textContent).toContain(`执行结束：${originalEnd}`);
  expect(log().textContent).toContain(`最近状态 · 保存失败：${failedAgain.updatedAt}`);
  expect(log().textContent).not.toContain(`结束 · 保存失败：${originalEnd}`);
  expect(button("重试本地保存").disabled).toBe(false);
  expect(options.onGenerate).not.toHaveBeenCalled();
});

it("preserves preview single-result deletion confirmation and both export modes", async () => {
  const options = { ...props(), onDeleteResults: vi.fn(), onExportResults: vi.fn(), onCopyPrompt: vi.fn() };
  await act(async () => root.render(<DrawingWorkspace {...options} results={[result]} selectedResultId={result.id} />));
  await act(async () => button("复制提示词").click());
  expect(options.onCopyPrompt).toHaveBeenCalledExactlyOnceWith(result.id);
  await act(async () => button("导出带参数 PNG").click());
  expect(options.onExportResults).toHaveBeenCalledExactlyOnceWith([result.id], true);
  await act(async () => button("删除成果").click());
  expect(options.onDeleteResults).not.toHaveBeenCalled();
  await act(async () => button("取消").click());
  expect(options.onDeleteResults).not.toHaveBeenCalled();
  await act(async () => button("删除成果").click());
  await act(async () => button("确认删除成果").click());
  expect(options.onDeleteResults).toHaveBeenCalledExactlyOnceWith([result.id]);
});

it("pages generation history, follows a newly selected result and clamps after deletion without dispatching", async () => {
  const options = { ...props(), onExportResults: vi.fn(), onDeleteResults: vi.fn() };
  const results = Array.from({ length: 51 }, (_, index) => ({ ...result, id: `history-${index}` }));
  const original = structuredClone(results);
  await act(async () => root.render(<DrawingWorkspace {...options} results={results} selectedResultId={results[0].id} />));
  expect(host.querySelectorAll(".drawing-history > button")).toHaveLength(50);
  expect(host.querySelector('[aria-label="生成历史分页"]')?.textContent).toContain("第 1 / 2 页 · 共 51 项");
  expect(host.querySelector('.drawing-history [aria-label="成果 51"]')).not.toBeNull();
  expect(host.querySelector('.drawing-history [aria-label="成果 1"]')).toBeNull();
  await act(async () => button("下一页").click());
  expect(host.querySelectorAll(".drawing-history > button")).toHaveLength(1);
  await act(async () => button("成果 1").click());
  expect(options.onSelectResult).toHaveBeenCalledExactlyOnceWith(results[50].id);
  await act(async () => root.render(<DrawingWorkspace {...options} results={results} selectedResultId={results[50].id} />));
  expect(host.querySelector('.drawing-history [aria-label="成果 1"]')?.getAttribute("aria-pressed")).toBe("true");

  const newest = { ...result, id: "newly-completed-history" };
  const grown = [newest, ...results];
  await act(async () => root.render(<DrawingWorkspace {...options} results={grown} selectedResultId={newest.id} />));
  expect(host.querySelector('[aria-label="生成历史分页"]')?.textContent).toContain("第 1 / 2 页 · 共 52 项");
  expect(host.querySelectorAll(".drawing-history > button")).toHaveLength(50);
  expect(host.querySelector('.drawing-history [aria-label="成果 52"]')?.getAttribute("aria-pressed")).toBe("true");
  await act(async () => button("下一页").click());
  expect(host.querySelectorAll(".drawing-history > button")).toHaveLength(2);
  const remaining = grown.slice(0, 50);
  await act(async () => root.render(<DrawingWorkspace {...options} results={remaining} selectedResultId={newest.id} />));
  expect(host.querySelector('[aria-label="生成历史分页"]')).toBeNull();
  expect(host.querySelectorAll(".drawing-history > button")).toHaveLength(50);
  expect(host.querySelector('.drawing-history [aria-label="成果 50"]')?.getAttribute("aria-pressed")).toBe("true");

  expect(host.textContent).not.toContain("成果库");
  expect(host.textContent).not.toContain("全选成果");
  expect(results).toEqual(original);
  expect(grown).toHaveLength(52);
  expect(options.onSelectResult).toHaveBeenCalledOnce();
  expect(options.onGenerate).not.toHaveBeenCalled();
  expect(options.onRegenerate).not.toHaveBeenCalled();
  expect(options.onDeleteResults).not.toHaveBeenCalled();
});

it("pages task display without limiting cleanup candidates or changing task IDs", async () => {
  const options = props();
  const tasks = Array.from({ length: 51 }, (_, index) => ({ ...task, id: `paged-task-${index}`, status: "completed" as const }));
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={tasks} />));
  await act(async () => button("任务列表").click());
  expect(host.querySelectorAll(".drawing-task-row")).toHaveLength(50);
  await act(async () => button("下一页").click());
  expect(host.querySelectorAll(".drawing-task-row")).toHaveLength(1);
  expect(host.querySelector('[aria-label="删除任务 paged-ta 历史"]')).not.toBeNull();
  await act(async () => button("清空已完成历史").click());
  await act(async () => button("确认删除历史").click());
  expect(options.onDeleteTasks).toHaveBeenCalledWith(tasks.map(item => item.id));
});

it("pages tasks, logs and visible result history independently on the same page", async () => {
  const options = props();
  const tasks = Array.from({ length: 51 }, (_, index) => ({ ...task, id: `task-${index}`, status: "completed" as const }));
  const results = Array.from({ length: 51 }, (_, index) => ({ ...result, id: `result-${index}` }));
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={tasks} results={results}
    selectedResultId={results[0].id} previewUrl="blob:preview" />));
  const nextPage = async (label: string) => {
    const pagination = host.querySelector(`[aria-label="${label}分页"]`)!;
    const next = [...pagination.querySelectorAll("button")].find(item => item.textContent === "下一页")!;
    await act(async () => next.click());
  };
  expect(host.querySelectorAll(".drawing-task-row")).toHaveLength(50);
  expect(host.querySelectorAll(".drawing-history > button")).toHaveLength(50);
  await nextPage("任务");
  expect(host.querySelectorAll(".drawing-task-row")).toHaveLength(1);
  expect(host.querySelectorAll(".drawing-history > button")).toHaveLength(50);
  await nextPage("生成历史");
  expect(host.querySelectorAll(".drawing-history > button")).toHaveLength(1);
  await act(async () => button("任务日志").click());
  expect(host.querySelectorAll(".drawing-task-row")).toHaveLength(50);
  expect(host.querySelectorAll(".drawing-history > button")).toHaveLength(1);
  await nextPage("任务日志");
  expect(host.querySelectorAll(".drawing-task-row")).toHaveLength(1);
  await act(async () => button("任务列表").click());
  expect(host.querySelector('[aria-label="任务分页"]')?.textContent).toContain("第 2 / 2 页");
  expect(host.querySelector('[aria-label="生成历史分页"]')?.textContent).toContain("第 2 / 2 页");
  expect(host.querySelector('.drawing-preview-stage img')?.getAttribute("src")).toBe("blob:preview");
  expect(options.onGenerate).not.toHaveBeenCalled();
  expect(options.onSelectResult).not.toHaveBeenCalled();
  expect(options.onDeleteTasks).not.toHaveBeenCalled();
});

it("reports accumulating memory-only failed saves in every view and clears the warning after durable recovery", async () => {
  const options = props();
  const failed = { ...task, status: "save-failed" as const, recovery: { total: 2, durable: [0], memory: [1], lost: [] } };
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[failed]} />));
  expect(host.querySelector('[aria-label="未保存图片内存风险"]')?.textContent).toContain("1 项任务的 1 张图片仅保存在内存");
  expect(host.textContent).toContain("继续生成会增加内存占用");
  await act(async () => button("任务列表").click());
  expect(host.querySelector('[aria-label="未保存图片内存风险"]')).not.toBeNull();
  await act(async () => button("任务日志").click());
  expect(host.querySelector('[aria-label="未保存图片内存风险"]')).not.toBeNull();
  expect(options.onPause).not.toHaveBeenCalled();
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[{ ...failed, recovery: { ...failed.recovery, durable: [0, 1], memory: [] } }]} />));
  expect(host.querySelector('[aria-label="未保存图片内存风险"]')).toBeNull();
});

it("edits optional Gemini controls, rejects invalid temperature and preserves options across protocol switches", async () => {
  const options = props(), drafts: DrawingDraft[] = [];
  function Harness() {
    const [draft, setDraft] = useState<DrawingDraft>({ ...initialDrawingDraft, modelId: "configured-image-model", prompt: "synthetic" });
    return <DrawingWorkspace {...options} draft={draft} onDraftChange={next => { drafts.push(next); setDraft(next); }}
      models={[...options.models, { id: "openai", label: "OpenAI", protocol: "openai-images" }]} />;
  }
  await act(async () => root.render(<Harness />));
  expect(host.querySelector('[aria-label="Gemini temperature"]')).toBeNull();
  await act(async () => button("Gemini 高级参数").click());
  const input = host.querySelector<HTMLInputElement>('[aria-label="Gemini temperature"]')!;
  const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { setInput.call(input, "0"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await choose("Gemini 安全阈值", "BLOCK_NONE"); await choose("Gemini 输出模式", "仅图片");
  expect(drafts[drafts.length - 1].gemini).toEqual({ temperature: 0, safetyThreshold: "BLOCK_NONE", outputMode: "image" });
  const calls = drafts.length;
  await act(async () => { setInput.call(input, "3"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(drafts).toHaveLength(calls); expect(host.querySelector<HTMLButtonElement>('#drawing-generate')!.disabled).toBe(true);
  expect(input.getAttribute("aria-invalid")).toBe("true");
  await act(async () => button("恢复模型温度").click());
  expect(drafts[drafts.length - 1].gemini).not.toHaveProperty("temperature");
  await choose("绘图模型", "OpenAI");
  expect(host.querySelector('[aria-label="Gemini 安全阈值"]')).toBeNull();
  expect(drafts[drafts.length - 1].gemini).toEqual({ safetyThreshold: "BLOCK_NONE", outputMode: "image" });
  expect(options.onGenerate).not.toHaveBeenCalled();
});

it("shows presets only with complete handlers, allows editing during generation and guards unavailable workspace", async () => {
  const options = props();
  const presets = [{ id: "preset", name: "合成预设", content: "合成内容", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" }];
  const handlers = { onApplyPreset: vi.fn(), onCreatePreset: vi.fn(async () => true), onUpdatePreset: vi.fn(async () => true), onDeletePreset: vi.fn(async () => true) };
  await act(async () => root.render(<DrawingWorkspace {...options} presets={presets} onApplyPreset={handlers.onApplyPreset} />));
  expect(host.querySelector('.drawing-presets')).toBeNull();
  await act(async () => root.render(<DrawingWorkspace {...options} {...handlers} presets={presets} busy tasks={[task]} />));
  expect(button("另存预设").disabled).toBe(false);
  expect(host.querySelector('.drawing-presets')!.previousElementSibling!.querySelector('textarea')).not.toBeNull();
  await choose("提示词预设", "合成预设");
  expect(handlers.onApplyPreset).toHaveBeenCalledExactlyOnceWith("preset");
  expect(options.onGenerate).not.toHaveBeenCalled(); expect(options.onRegenerate).not.toHaveBeenCalled();
  for (const state of [{ ready: false }, { closing: true }, { presetsBusy: true }]) {
    await act(async () => root.render(<DrawingWorkspace {...options} {...handlers} presets={presets} {...state} />));
    expect(button("另存预设").disabled).toBe(true);
  }
  await act(async () => root.render(<DrawingWorkspace {...options} {...handlers} presets={presets} />));
  await act(async () => button("另存预设").click());
  expect(host.querySelector('.drawing-body')!.hasAttribute('inert')).toBe(true);
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="关闭预设弹窗"]')!.click());
  expect(host.querySelector('.drawing-body')!.hasAttribute('inert')).toBe(false);
  expect(document.activeElement).toBe(button("另存预设"));
});

it("copies task prompts and reuses task parameters while keeping generation mounted", async () => {
  const options = props(), onReuseTask = vi.fn(), onCopyTaskPrompt = vi.fn();
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[task]} onReuseTask={onReuseTask} onCopyTaskPrompt={onCopyTaskPrompt} />));
  const form = host.querySelector("textarea");
  const copy = button("复制任务 task-one 提示词"), remove = button("删除任务 task-one 历史");
  expect(copy.title).toBe("复制提示词");
  expect(remove.title).toBe("删除历史");
  expect(copy.textContent).toBe("复制");
  expect(remove.textContent).toBe("删除");
  expect(copy.closest("details")).toBeNull();
  expect(remove.closest("details")).toBeNull();
  const more = button("复用任务 task-one 参数").closest("details")!;
  expect(more.open).toBe(false);
  expect(more.querySelector("summary")?.getAttribute("aria-label")).toBe("任务 task-one 更多操作");
  await act(async () => button("复制任务 task-one 提示词").click());
  expect(onCopyTaskPrompt).toHaveBeenCalledExactlyOnceWith(task.id);
  expect(button("任务列表").getAttribute("aria-selected")).toBe("true");
  await act(async () => button("任务日志").click());
  await act(async () => { button("复用任务 task-one 参数").closest("details")!.open = true; button("复用任务 task-one 参数").click(); });
  expect(onReuseTask).toHaveBeenCalledExactlyOnceWith(task.id);
  expect(button("任务日志").getAttribute("aria-selected")).toBe("true");
  expect(host.querySelector("textarea")).toBe(form);
  expect(options.onGenerate).not.toHaveBeenCalled(); expect(options.onRegenerate).not.toHaveBeenCalled(); expect(options.onReuse).not.toHaveBeenCalled();
});

it("switches protocol fields, preserves both drafts and offers current sizes/qualities including custom dimensions", async () => {
  const options = props();
  function Harness() {
    const [draft, setDraft] = useState<DrawingDraft>({ ...initialDrawingDraft, modelId: "configured-image-model", prompt: "合成画面" });
    return <DrawingWorkspace {...options} draft={draft} onDraftChange={setDraft}
      models={[...options.models, { id: "openai", label: "OpenAI 合成", protocol: "openai-images" }]} />;
  }
  await act(async () => root.render(<Harness />));
  await choose("宽高比", "1:8");
  await choose("分辨率", "512（0.5K）");
  await choose("绘图模型", "OpenAI 合成");
  expect(host.textContent).not.toContain("宽高比"); expect(host.textContent).toContain("画质");
  expect((await inspectChoices("画质")).map(option => option.label)).toEqual(["自动", "low", "medium", "high", "xhigh", "max"]);
  await choose("尺寸", "自定义尺寸");
  expect(host.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe("1536x864");
  await choose("画质", "max");
  await act(async () => button("任务日志").click()); await act(async () => button("任务列表").click());
  expect(host.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe("1536x864");
  await choose("绘图模型", "合成绘图模型");
  expect([fieldText("绘图模型"), fieldText("宽高比"), fieldText("分辨率")]).toEqual(["合成绘图模型", "1:8", "512（0.5K）"]);
  await choose("绘图模型", "OpenAI 合成");
  expect([fieldText("绘图模型"), fieldText("尺寸"), fieldText("画质")]).toEqual(["OpenAI 合成", "自定义尺寸", "max"]);
});

it("preserves all protocol drafts and requires explicit Grok and Seedream version contracts", async () => {
  const options = props();
  let currentDraft: DrawingDraft = initialDrawingDraft;
  function Harness() {
    const [draft, setDraft] = useState<DrawingDraft>({ ...initialDrawingDraft, modelId: "grok", prompt: "synthetic" });
    currentDraft = draft;
    return <DrawingWorkspace {...options} draft={draft} onDraftChange={setDraft} models={[
      ...options.models,
      { id: "grok", label: "Model ID contains 2.0", protocol: "grok-images" },
      { id: "grok-other", label: "Unrelated model ID", protocol: "grok-images" },
      { id: "seedream", label: "Model ID contains 5.0-pro", protocol: "seedream-images" },
      { id: "openai", label: "OpenAI", protocol: "openai-images" },
    ]} />;
  }
  await act(async () => root.render(<Harness />));
  const changeInput = async (element: HTMLInputElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  expect(fieldText("Grok 版本契约")).toBe("legacy");
  expect((await inspectChoices("Grok 画质")).find(option => option.label === "medium")?.disabled).toBe(true);
  expect((await inspectChoices("Grok 宽高比")).filter(option => option.disabled).map(option => option.label)).toEqual(["21:9", "5:2"]);
  await choose("Grok 版本契约", "2.0");
  await choose("Grok 宽高比", "16:9");
  await choose("Grok 分辨率", "2k");
  await choose("Grok 画质", "medium");
  await choose("绘图模型", "Unrelated model ID");
  expect(fieldText("Grok 版本契约")).toBe("2.0");
  expect(fieldText("Grok 画质")).toBe("medium");
  await choose("Grok 版本契约", "legacy");
  expect(fieldText("Grok 画质")).toBe("medium");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("不支持画质参数");
  expect(button("生成图片").disabled).toBe(true);
  await choose("Grok 版本契约", "2.0");
  expect(button("生成图片").disabled).toBe(false);
  await choose("Grok 画质", "自动");
  await choose("Grok 宽高比", "21:9");
  await choose("Grok 版本契约", "legacy");
  expect(fieldText("Grok 宽高比")).toBe("21:9");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("宽高比仅支持 2.0");
  expect(button("生成图片").disabled).toBe(true);
  await choose("Grok 版本契约", "2.0");
  await choose("Grok 宽高比", "16:9");
  await choose("Grok 画质", "medium");
  await choose("绘图模型", "Model ID contains 5.0-pro");
  expect(fieldText("Seedream 版本契约")).toBe("4.5");
  expect((await inspectChoices("Seedream 尺寸")).map(option => option.label)).toEqual(["自动", "2K", "4K", "自定义尺寸"]);
  expect((await inspectChoices("Seedream 输出格式")).find(option => option.label === "PNG")?.disabled).toBe(true);
  await choose("Seedream 版本契约", "5.0-pro");
  expect((await inspectChoices("Seedream 尺寸")).map(option => option.label)).toEqual(["自动", "1K", "1.5K", "2K", "自定义尺寸"]);
  await choose("Seedream 尺寸", "自定义尺寸");
  await changeInput(host.querySelector<HTMLInputElement>('[aria-label="Seedream 自定义尺寸"]')!, "2048x2048");
  await choose("Seedream 输出格式", "JPEG");
  await choose("Seedream 水印", "关闭");
  await choose("Seedream 版本契约", "4.0");
  expect(fieldText("Seedream 输出格式")).toBe("JPEG");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("输出格式仅支持 5.0");
  expect(button("生成图片").disabled).toBe(true);
  await choose("Seedream 版本契约", "5.0-pro");
  for (const label of ["OpenAI", "合成绘图模型", "Model ID contains 2.0"]) await choose("绘图模型", label);
  expect(fieldText("Grok 宽高比")).toBe("16:9");
  expect(fieldText("Grok 分辨率")).toBe("2k");
  expect(fieldText("Grok 画质")).toBe("medium");
  await choose("绘图模型", "Model ID contains 5.0-pro");
  expect(host.querySelector<HTMLInputElement>('[aria-label="Seedream 自定义尺寸"]')?.value).toBe("2048x2048");
  expect(fieldText("Seedream 输出格式")).toBe("JPEG");
  expect(fieldText("Seedream 水印")).toBe("关闭");
  expect(currentDraft.modelId).toBe("seedream");
  expect(currentDraft.grok).toEqual({ modelVersion: "2.0", aspectRatio: "16:9", resolution: "2k", quality: "medium" });
  expect(options.onGenerate).not.toHaveBeenCalled();
});

it.each(["grok-images", "seedream-images"] as const)("shows frozen %s parameters and keeps unavailable model controls", async protocol => {
  const options = props();
  const frozen: DrawingParameters = protocol === "grok-images"
    ? { ...parameters, protocol, modelVersion: "2.0", aspectRatio: "16:9", resolution: "2k", quality: "medium" }
    : { ...parameters, protocol, modelVersion: "5.0-lite", size: "3K", outputFormat: "png", watermark: "off" };
  const expected = protocol === "grok-images" ? "版本：2.0 · 宽高比：16:9 · 分辨率：2k · 画质：medium"
    : "版本：5.0-lite · 尺寸：3K · 输出格式：png · 水印：off";
  await act(async () => root.render(<DrawingWorkspace {...options} models={[]} draft={{ ...initialDrawingDraft, reusedProtocol: protocol }}
    tasks={[{ ...task, parameters: frozen }]} results={[{ ...result, parameters: frozen }]} selectedResultId={result.id} previewUrl="blob:synthetic" />));
  expect(host.textContent).toContain(`已保留 ${protocol === "grok-images" ? "Grok Images" : "Seedream Images"} 协议参数`);
  expect(host.querySelector(".drawing-task-row")?.textContent).toContain(expected);
  await act(async () => button("展开任务 task-one 详情").click());
  expect(host.querySelector(".drawing-task-parameters")?.textContent).toContain(expected);
  expect(host.querySelector(".drawing-result-details")?.textContent).toContain(expected);
  expect(host.textContent).not.toContain(parameters.baseUrl);
  expect(button("生成图片").disabled).toBe(true);
});

it("keeps empty previews and queue defaults while connecting settings", async () => {
  const options = props();
  await act(async () => root.render(<DrawingWorkspace {...options} models={[]} />));
  expect(host.querySelector("textarea")?.value).toBe("");
  expect(host.querySelectorAll("img")).toHaveLength(0);
  expect(host.textContent).toContain("生成后的图片会自动显示在这里");
  expect(host.textContent).toContain("暂无生成历史");
  expect(host.textContent).toContain("请在设置中添加 Gemini、OpenAI、Grok 或 Seedream 绘图连接和模型。");
  expect(button("生成图片").disabled).toBe(true);
  expect(button("添加参考图").disabled).toBe(false);
  expect([...host.querySelectorAll<HTMLInputElement>('input[type="number"]')].map(input => input.value)).toEqual(["1", "1"]);
  expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
  expect(host.querySelector("header")?.hasAttribute("data-tauri-drag-region")).toBe(true);
  expect(host.querySelector("header h1")).toBeNull();
  await act(async () => button("前往设置").click());
  expect(options.onConfigure).toHaveBeenCalledOnce();
});

it("updates the independent controlled draft and retains values when switching task tabs", async () => {
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
  await choose("绘图模型", "合成绘图模型");
  await choose("宽高比", "16:9");
  await choose("分辨率", "2K");
  expect(options.onDraftChange).toHaveBeenLastCalledWith({
    id: "current", prompt: "清晨的山谷湖泊", aspectRatio: "16:9", resolution: "2K", modelId: "configured-image-model",
  });
  await act(async () => button("任务列表").click());
  expect(button("任务列表").getAttribute("aria-selected")).toBe("true");
  expect(host.textContent).toContain("暂无绘图任务");
  await act(async () => button("任务日志").click());
  expect(host.textContent).toContain("暂无任务日志");
  await act(async () => button("任务列表").click());
  expect(host.querySelector("textarea")?.value).toBe("清晨的山谷湖泊");
  expect([fieldText("绘图模型"), fieldText("宽高比"), fieldText("分辨率")]).toEqual(["合成绘图模型", "16:9", "2K"]);
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

it("saves batch count, concurrency and completion sound in the controlled draft across task tabs", async () => {
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
  await act(async () => button("任务日志").click());
  await act(async () => button("任务列表").click());
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
  await act(async () => button("任务列表").click());
  expect(host.querySelectorAll('button[aria-label^="取消任务"]')).toHaveLength(3);
  for (const label of ["取消排队", "取消准备", "取消生成"]) await act(async () => button(label).click());
  expect(options.onCancel.mock.calls).toEqual([["queued"], ["preparing"], [task.id]]);
  expect(button("重试本地保存").disabled).toBe(true);
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={tasks} busy paused />));
  expect(status()).toContain("队列已暂停");
  await act(async () => button("继续队列").click());
  expect(options.onResume).toHaveBeenCalledOnce();
  await act(async () => button("任务日志").click());
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
  await act(async () => button("任务列表").click());
  const times = () => [...host.querySelectorAll(".drawing-task-row td[aria-label]")].map(cell => cell.getAttribute("aria-label"));
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
  await act(async () => button("任务列表").click());
  expect(host.querySelectorAll("img")).toHaveLength(1);
  await act(async () => button("任务日志").click());
  expect(host.querySelectorAll("img")).toHaveLength(1);
});

it("shows unknown and local-save failure states without resubmitting generation", async () => {
  const options = props();
  const unknown = { ...task, id: "task-unknown", status: "unknown" as const };
  const saveFailed = { ...task, id: "task-save", status: "save-failed" as const, error: "本地保存失败 <script>unsafe</script>" };
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[unknown, saveFailed]} />));
  await act(async () => button("任务列表").click());
  expect(host.textContent).toContain("结果未知");
  expect(host.textContent).toContain("请求可能已经发出，不会自动重发。");
  expect(host.querySelector("script")).toBeNull();
  expect(host.textContent).not.toContain(saveFailed.error);
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
  const openMenu = async (number: number) => {
    await act(async () => labeled(`查看参考图 ${number}`).dispatchEvent(new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true })));
  };
  expect(button("添加参考图").disabled).toBe(false);
  await openMenu(1);
  expect(button("前移").disabled).toBe(true);
  await act(async () => button("后移").click());
  expect(options.onMoveReference).toHaveBeenCalledWith(first.id, 1);
  await openMenu(2);
  expect(button("后移").disabled).toBe(true);
  await act(async () => button("前移").click());
  expect(options.onMoveReference).toHaveBeenCalledWith(second.id, -1);
  await act(async () => labeled("查看参考图 1").click());
  expect(host.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("参考图 1 大图预览");
  expect(document.activeElement).toBe(button("关闭参考图预览"));
  await act(async () => button("关闭参考图预览").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(labeled("查看参考图 1"));
  await openMenu(1);
  await act(async () => button("移除").click());
  expect(options.onRemoveReference).toHaveBeenCalledWith(first.id);
  await act(async () => root.render(<DrawingWorkspace {...options} draft={{ ...draft, references: [second] }} />));
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<DrawingWorkspace {...options} draft={{ ...draft, references: [second] }} ready={false} />));
  await openMenu(1);
  expect(button("移除").disabled).toBe(true);
  expect(options.onGenerate).not.toHaveBeenCalled();
  expect(options.onDraftChange).not.toHaveBeenCalled();
});

it("shows cancellable reference preparation while allowing session reference edits and blocking duplicate submission", async () => {
  const options = { ...props(), onCancelPreparation: vi.fn(), onClearReferences: vi.fn(), readThumbnail: vi.fn(async () => ({ mime: "image/png", data: "AQ==" })) };
  const local = { id: "session-reference", name: "session.png", blob: new Blob(["captured"], { type: "image/png" }) };
  const draft = { ...initialDrawingDraft, modelId: options.models[0].id, prompt: "测试准备" };
  await act(async () => root.render(<DrawingWorkspace {...options} draft={draft} references={[local]}
    submitting preparation={{ completed: 1, total: 3 }} />));
  expect(host.querySelector('.drawing-reference-list img')).not.toBeNull();
  expect(host.textContent).toContain("正在准备参考图 1/3…");
  expect(button("正在加入队列…").disabled).toBe(true);
  expect(button("添加参考图").disabled).toBe(false);
  expect(button("清空参考图").disabled).toBe(false);
  await act(async () => { button("取消准备参考图").click(); button("正在加入队列…").click(); });
  expect(options.onCancelPreparation).toHaveBeenCalledExactlyOnceWith();
  expect(options.onCancel).not.toHaveBeenCalled();
  expect(options.onGenerate).not.toHaveBeenCalled();
  const file = new File(["next"], "next.png", { type: "image/png" });
  const picker = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(picker, "files", { configurable: true, value: [file] });
  await act(async () => picker.dispatchEvent(new Event("change", { bubbles: true })));
  const drop = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(drop, "dataTransfer", { value: { files: [file] } });
  await act(async () => host.querySelector("textarea")!.dispatchEvent(drop));
  const paste = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(paste, "clipboardData", { value: { items: [{ kind: "file", type: "image/png", getAsFile: () => file }] } });
  await act(async () => host.querySelector("textarea")!.dispatchEvent(paste));
  expect(options.onAddReferences).toHaveBeenCalledTimes(3);
  expect(options.onAddReferences).toHaveBeenLastCalledWith([file]);
  await act(async () => button("查看参考图 1").dispatchEvent(new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true })));
  expect(button("移除").disabled).toBe(false);
  await act(async () => button("移除").click());
  expect(options.onRemoveReference).toHaveBeenCalledExactlyOnceWith(local.id);
  await act(async () => button("清空参考图").click());
  expect(options.onClearReferences).toHaveBeenCalledOnce();
  expect(options.readReference).not.toHaveBeenCalled();
  expect(options.readThumbnail).not.toHaveBeenCalled();
  await act(async () => root.render(<DrawingWorkspace {...options} draft={draft} references={[]} />));
  expect(host.textContent).not.toContain("正在准备参考图");
  expect(host.textContent).not.toContain("取消准备参考图");
  expect(button("生成图片").disabled).toBe(false);
});

it("routes preview reference actions without changing draft options or automatically generating", async () => {
  const options = props();
  await act(async () => root.render(<DrawingWorkspace {...options} results={[result]} selectedResultId={result.id}
    previewUrl="blob:synthetic-result" busy tasks={[task]} />));
  await act(async () => button("作为参考图").click());
  expect(options.onUseAsReference).toHaveBeenCalledExactlyOnceWith(result.id);
  await act(async () => button("任务列表").click());
  await act(async () => button("任务日志").click());
  expect(host.querySelector('button[aria-label^="查看成果"]')).toBeNull();
  expect(options.onUseAsReference).toHaveBeenCalledOnce();
  expect(options.onGenerate).not.toHaveBeenCalled();
  expect(options.onDraftChange).not.toHaveBeenCalled();
  expect(options.onReuse).not.toHaveBeenCalled();
});

it("cancels history deletion without changing tasks, saved results or the controlled draft", async () => {
  const options = props();
  const completed: DrawingTask = { ...task, status: "completed" };
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[completed]} results={[result]} />));
  await act(async () => button("任务列表").click());
  await act(async () => button("删除历史").click());
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain("已保存成果始终保留");
  await act(async () => button("取消").click());
  expect(options.onDeleteTasks).not.toHaveBeenCalled();
  expect(options.onDraftChange).not.toHaveBeenCalled();
  expect(host.querySelectorAll(".drawing-task-row")).toHaveLength(1);
  await act(async () => button("删除历史").click());
  await act(async () => button("确认删除历史").click());
  expect(options.onDeleteTasks).toHaveBeenCalledExactlyOnceWith([completed.id]);
  await act(async () => button("任务列表").click());
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
  await act(async () => button("任务列表").click());
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
  await act(async () => button("任务列表").click());
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
  await act(async () => button("任务列表").click());
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
  await act(async () => button("任务列表").click());
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
    { ...task, status: "failed", error: "https://private.example/sk-private", diagnostic: { category: "rate-limited", httpStatus: 429 } },
    { ...task, id: "configuration", status: "failed", diagnostic: { category: "configuration", httpStatus: 999 } },
    { ...task, id: "save", status: "save-failed", recovery: { total: 3, durable: [0], memory: [1], lost: [2] } },
    { ...task, id: "unknown", status: "unknown" },
  ];
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={tasks} />));
  await act(async () => button("任务列表").click());
  expect(host.querySelectorAll(".drawing-task-diagnosis summary")).toHaveLength(2);
  expect([...host.querySelectorAll<HTMLTableRowElement>(".drawing-task-detail-row")].every(row => !row.hidden)).toBe(true);
  expect(host.querySelectorAll(".drawing-task-parameters")).toHaveLength(0);
  expect([...host.querySelectorAll('[aria-expanded]')].filter(item => item.getAttribute("aria-expanded") === "true")).toHaveLength(0);
  expect(host.querySelector(".drawing-task-detail-row [role=alert]")?.textContent).toBe("请求过于频繁");
  const failure = host.querySelector(".drawing-task-failure")!;
  expect(failure.querySelector("[role=alert]")?.textContent).toBe("请求过于频繁");
  expect(failure.querySelector("summary")?.textContent).toBe("诊断详情");
  expect(host.textContent).toContain("请求可能已经发出，不会自动重发。");
  for (const text of ["请求过于频繁", "HTTP 状态 429", "模型或连接配置不可用", "可重试本地保存", "退出或删除任务后丢失", "无法恢复"])
    expect(host.textContent).toContain(text);
  expect(host.textContent).not.toContain(parameters.baseUrl);
  expect(host.textContent).not.toContain("rate-limited");
  expect(host.textContent).not.toContain("HTTP 状态 999");
  expect(host.textContent).not.toContain(tasks[0].error!);
});

it("contains keyboard focus in the confirmation and restores its opener after Escape", async () => {
  const options = props();
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[{ ...task, status: "completed" }]} />));
  await act(async () => button("任务列表").click());
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
  await act(async () => button("任务列表").click());
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
  await act(async () => button("任务列表").click());
  await act(async () => button("重新生成").click());
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[unknown]} managementBusy />));
  expect(button("确认新建任务").disabled).toBe(true);
  await act(async () => root.render(<DrawingWorkspace {...options} tasks={[{ ...unknown, status: "completed" }]} />));
  expect(button("确认新建任务").disabled).toBe(true);
  await act(async () => button("确认新建任务").click());
  expect(options.onRegenerate).not.toHaveBeenCalled();
});
