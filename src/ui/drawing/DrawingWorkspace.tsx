import { useState } from "react";
import { Image } from "lucide-react";
import { WindowControls } from "../window/WindowControls";
import type { DrawingDraft, DrawingImageInput, DrawingModelOption, DrawingResult, DrawingTask, DrawingTaskStatus } from "../../drawing/types";
import { DrawingReferences } from "./DrawingReferences";
import { drawingAspectRatios, drawingResolutions } from "../../drawing/geminiImage";
import { openAIImageQualities, openAIImageSizes } from "../../drawing/openaiImages";
import "./DrawingWorkspace.css";

export { initialDrawingDraft } from "../../drawing/types";
export type { DrawingDraft } from "../../drawing/types";

type DrawingView = "generate" | "tasks" | "library";

const taskLabels: Record<DrawingTaskStatus, string> = {
  running: "生成中", saving: "正在保存", completed: "已保存", failed: "生成失败",
  cancelled: "已取消", unknown: "结果未知", "save-failed": "保存失败",
};

export function DrawingWorkspace({ draft, onDraftChange, onConfigure, models, tasks, results,
  selectedResultId, previewUrl, previewError, ready, busy, error,
  onGenerate, onCancel, onSelectResult, onExport, onRetrySave, onReuse,
  onAddReferences, onRemoveReference, onMoveReference, onUseAsReference, readReference, referencesBusy }: {
  draft: DrawingDraft;
  onDraftChange(draft: DrawingDraft): void;
  onConfigure(): void;
  models: DrawingModelOption[];
  tasks: DrawingTask[];
  results: DrawingResult[];
  selectedResultId: string | null;
  previewUrl: string | null;
  previewError: string | null;
  ready: boolean;
  busy: boolean;
  error: string | null;
  onGenerate(): void;
  onCancel(): void;
  onSelectResult(id: string): void;
  onExport(id: string): void;
  onRetrySave(id: string): void;
  onReuse(id: string): void;
  onAddReferences(files: File[]): void;
  onRemoveReference(id: string): void;
  onMoveReference(id: string, direction: -1 | 1): void;
  onUseAsReference(id: string): void;
  readReference(reference: string): Promise<DrawingImageInput>;
  referencesBusy: boolean;
}) {
  const [view, setView] = useState<DrawingView>("generate");
  const running = tasks.some((task) => task.status === "running");
  const saving = tasks.some((task) => task.status === "saving");
  const selectedResult = results.find((result) => result.id === selectedResultId);
  const openai = models.find(model => model.id === draft.modelId)?.protocol === "openai-images";
  const size = draft.openai?.size ?? "auto", quality = draft.openai?.quality ?? "auto";
  const presetSize = (openAIImageSizes as readonly string[]).includes(size);
  const setOpenAI = (patch: Partial<NonNullable<DrawingDraft["openai"]>>) => onDraftChange({ ...draft, openai: { size, quality, ...patch } });
  const resultNumber = (id: string) => results.length - results.findIndex((result) => result.id === id);
  const canGenerate = ready && models.some(model => model.id === draft.modelId) && Boolean(draft.prompt.trim()) && !busy && !referencesBusy;
  const canEditReferences = ready && !referencesBusy;

  function selectResult(id: string) {
    onSelectResult(id);
    setView("generate");
  }

  function reuseResult(id: string) {
    onReuse(id);
    setView("generate");
  }

  return (
    <div className="drawing-workspace" onDragOver={(event) => {
      if (event.dataTransfer.types.includes("Files")) event.preventDefault();
    }} onDrop={(event) => {
      if (!event.dataTransfer.files.length) return;
      event.preventDefault();
      if (canEditReferences) onAddReferences(Array.from(event.dataTransfer.files));
    }} onPaste={(event) => {
      const files = Array.from(event.clipboardData.items)
        .filter(item => item.kind === "file" && item.type.startsWith("image/"))
        .map(item => item.getAsFile()).filter((file): file is File => file !== null);
      if (!files.length) return;
      event.preventDefault();
      if (canEditReferences) onAddReferences(files);
    }}>
      <header className="drawing-header" data-tauri-drag-region>
        <div data-tauri-drag-region>
          <h1 data-tauri-drag-region>绘图</h1>
        </div>
        <WindowControls />
      </header>

      <div className="drawing-body">
        <nav className="drawing-navigation" aria-label="绘图视图">
          {([
            ["generate", "生成"],
            ["tasks", "任务"],
            ["library", "成果库"],
          ] as const).map(([id, label]) => (
            <button key={id} type="button" aria-current={view === id ? "page" : undefined}
              onClick={() => setView(id)}>{label}</button>
          ))}
        </nav>
        <p className="drawing-notice">{ready ? "单张生成，生成后自动保存。" : "正在加载绘图工作区…"}</p>
        {error && <p className="drawing-error" role="alert">{error}</p>}

        {view === "generate" ? (
          <div className="drawing-layout">
            <section className="drawing-panel drawing-form" aria-label="绘图草稿">
              <div className="drawing-field">
                <label className="drawing-label" htmlFor="drawing-model">绘图模型</label>
                <div className="drawing-model">
                  <select id="drawing-model" value={draft.modelId ?? ""} disabled={!ready}
                    onChange={(event) => onDraftChange({ ...draft, modelId: event.target.value || null })}>
                    <option value="">选择绘图模型</option>
                    {models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                  </select>
                  <button type="button" className="drawing-button" onClick={onConfigure}>前往设置</button>
                </div>
                {ready && models.length === 0 && <p className="drawing-muted">请在设置中添加 Gemini 或 OpenAI 绘图连接和模型。</p>}
              </div>
              <label className="drawing-field">
                <span className="drawing-label">提示词</span>
                <textarea id="drawing-prompt" value={draft.prompt} placeholder="描述想要生成的画面"
                  onChange={(event) => onDraftChange({ ...draft, prompt: event.target.value })} />
              </label>
              <DrawingReferences references={draft.references ?? []} disabled={!canEditReferences}
                busy={referencesBusy} read={readReference} onAdd={onAddReferences}
                onRemove={onRemoveReference} onMove={onMoveReference} />
              {openai ? <>
                <div className="drawing-parameters">
                  <label className="drawing-field">
                    <span className="drawing-label">尺寸</span>
                    <select value={presetSize ? size : "custom"} onChange={event => setOpenAI({ size: event.target.value === "custom" ? "1536x864" : event.target.value })}>
                      {openAIImageSizes.map(value => <option key={value} value={value}>{value === "auto" ? "自动" : value.replace("x", " × ")}</option>)}
                      <option value="custom">自定义尺寸</option>
                    </select>
                  </label>
                  <label className="drawing-field">
                    <span className="drawing-label">画质</span>
                    <select value={quality} onChange={event => setOpenAI({ quality: event.target.value })}>
                      {openAIImageQualities.map(value => <option key={value} value={value}>{value === "auto" ? "自动" : value}</option>)}
                    </select>
                  </label>
                </div>
                {!presetSize && <label className="drawing-field">
                  <span className="drawing-label">自定义尺寸（宽x高）</span>
                  <input type="text" value={size} placeholder="1536x864" onChange={event => setOpenAI({ size: event.target.value })} />
                </label>}
                <p className="drawing-muted">xhigh／max 需 GPT Image 2.5 或服务支持。自定义尺寸需 GPT Image 2／2.5：边长为 16 的倍数且不超过 3840，比例在 1:3 至 3:1，总像素 655360–8294400；高于 2560 × 1440 为实验性尺寸。旧模型和中转支持范围以服务为准。</p>
              </> : <><div className="drawing-parameters">
                <label className="drawing-field">
                  <span className="drawing-label">宽高比</span>
                  <select value={draft.aspectRatio}
                    onChange={(event) => onDraftChange({ ...draft, aspectRatio: event.target.value })}>
                    {drawingAspectRatios.map(value => <option key={value} value={value}>{value === "auto" ? "自动" : value}</option>)}
                  </select>
                </label>
                <label className="drawing-field">
                  <span className="drawing-label">分辨率</span>
                  <select value={draft.resolution}
                    onChange={(event) => onDraftChange({ ...draft, resolution: event.target.value })}>
                    {drawingResolutions.map(value => <option key={value} value={value}>{value === "auto" ? "自动" : value === "512" ? "512（0.5K）" : value}</option>)}
                  </select>
                </label>
              </div>
              <p className="drawing-muted">512 分辨率需 Gemini 3.1 Flash Image；1:4／4:1／1:8／8:1 需 3.1 Flash 或 Flash Lite。Pro 提供 1K／2K／4K，Flash Lite 仅 1K，2.5 Flash Image 不提供分辨率选择。实际像素随比例和模型变化。</p></>}
              <label className="drawing-field">
                <span className="drawing-label">数量 <span className="drawing-muted">· 尚未开放</span></span>
                <input type="number" value={1} disabled />
              </label>
              <div className="drawing-submit">
                <button id="drawing-generate" type="button" className="drawing-button drawing-generate"
                  disabled={!canGenerate} onClick={onGenerate} aria-describedby="drawing-generation-note">
                  {saving ? "正在保存…" : running ? "生成中…" : "生成图片"}
                </button>
                {running && <button type="button" className="drawing-button" onClick={onCancel}>取消生成</button>}
                <p id="drawing-generation-note" className="drawing-muted">每次生成一张图片，批量生成后续开放。</p>
              </div>
            </section>

            <section className="drawing-panel" aria-labelledby="drawing-preview-title">
              <div className="drawing-section-heading">
                <h2 id="drawing-preview-title">图像预览</h2>
                <span className="drawing-muted">{selectedResult ? `成果 ${resultNumber(selectedResult.id)}` : "等待生成"}</span>
              </div>
              <div className="drawing-result-stage drawing-preview-stage" aria-label="生成图像大图预览">
                {previewError ? <div className="drawing-empty"><p role="alert">{previewError}</p></div>
                  : selectedResult && previewUrl ? <img src={previewUrl} alt={`成果 ${resultNumber(selectedResult.id)} · ${selectedResult.parameters.modelName}`} />
                  : <div className="drawing-empty">
                  <Image size={32} strokeWidth={1.5} aria-hidden="true" />
                  <p>{selectedResult ? "正在加载图片…" : "生成后的图片会自动显示在这里"}</p>
                </div>}
              </div>
              {selectedResult && <div className="drawing-preview-details">
                <p className="drawing-muted">{selectedResult.parameters.modelName} · {selectedResult.width} × {selectedResult.height}</p>
                <div className="drawing-actions">
                  <button type="button" className="drawing-button" onClick={() => onExport(selectedResult.id)}>导出图片</button>
                  <button type="button" className="drawing-button" onClick={() => reuseResult(selectedResult.id)}>复用参数</button>
                  <button type="button" className="drawing-button" disabled={!canEditReferences}
                    onClick={() => onUseAsReference(selectedResult.id)}>作为参考图</button>
                </div>
              </div>}
              <h2 className="drawing-history-heading">生成历史</h2>
              <div className="drawing-history" aria-label="生成历史">
                {results.length ? results.map((result) => <button key={result.id} type="button"
                  className="drawing-button" aria-pressed={result.id === selectedResultId}
                  onClick={() => onSelectResult(result.id)}>成果 {resultNumber(result.id)}</button>)
                  : <p className="drawing-muted">暂无生成历史</p>}
              </div>
            </section>
          </div>
        ) : (
          <section className="drawing-panel" aria-labelledby="drawing-view-title">
            <h2 id="drawing-view-title">{view === "tasks" ? "任务" : "成果库"}</h2>
            {view === "tasks" && tasks.length ? <div className="drawing-records">
              {tasks.map((task) => <article className="drawing-record" key={task.id}>
                <div className="drawing-section-heading"><h3>任务 {tasks.length - tasks.findIndex((item) => item.id === task.id)}</h3>
                  <span className="drawing-muted">{taskLabels[task.status]}</span></div>
                <p>{task.parameters.prompt}</p>
                <p className="drawing-muted">{task.parameters.modelName}</p>
                {task.error && <p className="drawing-error" role="alert">{task.error}</p>}
                {task.status === "unknown" && <p className="drawing-muted">请求可能已经发出，不会自动重发。</p>}
                {task.status === "running" && <button type="button" className="drawing-button" onClick={onCancel}>取消生成</button>}
                {task.status === "save-failed" && <button type="button" className="drawing-button" disabled={busy}
                  onClick={() => onRetrySave(task.id)}>重试本地保存</button>}
              </article>)}
            </div> : view === "library" && results.length ? <div className="drawing-library">
              {results.map((result) => <article className="drawing-record" key={result.id}>
                <h3>成果 {resultNumber(result.id)}</h3>
                <p>{result.parameters.prompt}</p>
                <p className="drawing-muted">{result.parameters.modelName} · {result.width} × {result.height}</p>
                <div className="drawing-actions">
                  <button type="button" className="drawing-button" onClick={() => selectResult(result.id)}>查看</button>
                  <button type="button" className="drawing-button" onClick={() => onExport(result.id)}>导出图片</button>
                  <button type="button" className="drawing-button" onClick={() => reuseResult(result.id)}>复用参数</button>
                  <button type="button" className="drawing-button" disabled={!canEditReferences}
                    onClick={() => onUseAsReference(result.id)}>作为参考图</button>
                </div>
              </article>)}
            </div> : <div className="drawing-empty drawing-view-empty">
              <p>{view === "tasks" ? "暂无绘图任务" : "暂无绘图成果"}</p>
            </div>}
          </section>
        )}
      </div>
    </div>
  );
}
