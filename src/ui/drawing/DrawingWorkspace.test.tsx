// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DrawingParameters, DrawingResult, DrawingTask } from "../../drawing/types";
import { DrawingWorkspace, initialDrawingDraft, type DrawingDraft } from "./DrawingWorkspace";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

function props() {
  return {
    draft: initialDrawingDraft, onDraftChange: vi.fn(), onConfigure: vi.fn(),
    models: [{ id: "configured-image-model", label: "合成绘图模型", protocol: "gemini-image" as const }],
    tasks: [] as DrawingTask[], results: [] as DrawingResult[], selectedResultId: null,
    previewUrl: null, previewError: null, ready: true, busy: false, error: null,
    onGenerate: vi.fn(), onCancel: vi.fn(), onSelectResult: vi.fn(), onExport: vi.fn(),
    onRetrySave: vi.fn(), onReuse: vi.fn(),
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
  const result = [...host.querySelectorAll("button")].find((item) => item.textContent === text);
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

it("keeps empty previews and unfinished reference/batch actions while connecting settings", async () => {
  const options = props();
  await act(async () => root.render(<DrawingWorkspace {...options} models={[]} />));
  expect(host.querySelector("textarea")?.value).toBe("");
  expect(host.querySelectorAll("img")).toHaveLength(0);
  expect(host.textContent).toContain("生成后的图片会自动显示在这里");
  expect(host.textContent).toContain("暂无生成历史");
  expect(host.textContent).toContain("请在设置中添加 Gemini 或 OpenAI 绘图连接和模型。");
  expect(button("生成图片").disabled).toBe(true);
  expect(button("添加参考图 · 尚未开放").disabled).toBe(true);
  expect(host.querySelector("input")?.disabled).toBe(true);
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

it("only enables a ready idle single-image request with a model and nonblank prompt", async () => {
  const options = props();
  const draft = { ...initialDrawingDraft, prompt: "湖泊", modelId: "configured-image-model" };
  for (const overrides of [
    { ready: false }, { draft: { ...draft, modelId: null } },
    { draft: { ...draft, prompt: " \n " } }, { busy: true },
  ]) {
    await act(async () => root.render(<DrawingWorkspace {...options} draft={draft} {...overrides} />));
    expect(host.querySelector<HTMLButtonElement>("#drawing-generate")?.disabled).toBe(true);
  }
  await act(async () => root.render(<DrawingWorkspace {...options} draft={draft} />));
  expect(button("生成图片").disabled).toBe(false);
  await act(async () => button("生成图片").click());
  expect(options.onGenerate).toHaveBeenCalledOnce();
});

it("offers cancellation only while running and identifies saving without cancellation", async () => {
  const options = props();
  await act(async () => root.render(<DrawingWorkspace {...options} busy tasks={[task]} />));
  expect(button("生成中…").disabled).toBe(true);
  await act(async () => button("取消生成").click());
  expect(options.onCancel).toHaveBeenCalledOnce();
  await act(async () => root.render(<DrawingWorkspace {...options} busy tasks={[{ ...task, status: "saving" }]} />));
  expect(button("正在保存…").disabled).toBe(true);
  expect(host.textContent).not.toContain("取消生成");
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
  await act(async () => button("查看").click());
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
