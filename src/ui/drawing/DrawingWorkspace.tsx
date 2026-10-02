import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { WindowControls } from "../window/WindowControls";
import type { DrawingDraft, DrawingImageInput, DrawingModelOption, DrawingReferenceSelection, DrawingResult, DrawingTask, DrawingTaskStatus } from "../../drawing/types";
import { DrawingReferences } from "./DrawingReferences";
import { DrawingPresets } from "./DrawingPresets";
import { SettingsHelp } from "../settings/SettingsHelp";
import type { DrawingPresetInput, DrawingPromptPreset } from "../../drawing/presets";
import { DrawingResultThumbnail } from "./DrawingResultThumbnail";
import { DrawingResultPreview } from "./DrawingResultPreview";
import { drawingAspectRatios, drawingResolutions } from "../../drawing/geminiImage";
import { openAIImageQualities, openAIImageSizes } from "../../drawing/openaiImages";
import { geminiSafetyThresholds } from "../../drawing/geminiOptions";
import type { GeminiDrawingOptions, GeminiSafetyThreshold } from "../../drawing/types";
import "./DrawingWorkspace.css";

export { initialDrawingDraft } from "../../drawing/types";
export type { DrawingDraft } from "../../drawing/types";

const recordsPerPage = 50;
const taskLabel = (id: string) => id.slice(0, 8);
const HistoryItem = memo(function HistoryItem({ result, number, selected, onSelect, read }: {
  result: DrawingResult; number: number; selected: boolean;
  onSelect(id: string): void; read?: (reference: string) => Promise<DrawingImageInput>;
}) {
  return <button type="button" className="drawing-button" aria-label={`成果 ${number}`} aria-pressed={selected}
    onClick={() => onSelect(result.id)}><DrawingResultThumbnail reference={result.reference}
      label={`成果 ${number} 缩略图`} read={read} />成果 {number}</button>;
});

function RecordPagination({ page, count, onPage, label }: { page: number; count: number; onPage(page: number): void; label: string }) {
  const pages = Math.ceil(count / recordsPerPage);
  if (pages <= 1) return null;
  return <nav className="drawing-pagination" aria-label={`${label}分页`}>
    <button type="button" className="drawing-button" disabled={page === 0} onClick={() => onPage(page - 1)}>上一页</button>
    <span className="drawing-muted" role="status">第 {page + 1} / {pages} 页 · 共 {count} 项</span>
    <button type="button" className="drawing-button" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>下一页</button>
  </nav>;
}
type TaskConfirmation = {
  kind: "delete" | "regenerate" | "delete-results";
  selected: Array<{ id: string; signature: string }>;
  text: string;
  opener: HTMLButtonElement;
};

function TaskConfirmationDialog({ confirmation, valid, onClose, onConfirm }: {
  confirmation: TaskConfirmation; valid: boolean; onClose(): void; onConfirm(): void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const accepted = useRef(false);
  useEffect(() => {
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { if (confirmation.opener.isConnected) confirmation.opener.focus({ preventScroll: true }); };
  }, [confirmation.opener]);
  return <div className="drawing-reference-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget) onClose();
  }}><section ref={dialog} className="drawing-task-confirm-dialog" role="dialog" aria-modal="true"
    aria-labelledby="drawing-task-confirm-title" aria-describedby="drawing-task-confirm-description"
    onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key !== "Tab") return;
      const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); buttons[buttons.length - 1]?.focus(); }
      else if (!event.shiftKey && (index === buttons.length - 1 || index < 0)) { event.preventDefault(); buttons[0]?.focus(); }
    }}>
    <h2 id="drawing-task-confirm-title">{confirmation.kind === "delete-results" ? "删除绘图成果" : confirmation.kind === "delete" ? "删除任务历史" : "确认重新生成"}</h2>
    <p id="drawing-task-confirm-description" className="drawing-muted drawing-task-recovery">{confirmation.text}</p>
    {!valid && <p className="drawing-error" role="alert">{confirmation.kind === "delete-results" ? "成果状态已变化或正在处理，请取消后重新确认。" : "任务状态已变化或正在处理，请取消后重新确认。"}</p>}
    <div className="drawing-actions">
      <button type="button" className="drawing-button" onClick={onClose}>取消</button>
      <button type="button" className="drawing-button" disabled={!valid} onClick={event => {
        if (event.detail > 1 || accepted.current || !valid) return;
        accepted.current = true;
        onConfirm();
      }}>{confirmation.kind === "delete-results" ? "确认删除成果" : confirmation.kind === "delete" ? "确认删除历史" : "确认新建任务"}</button>
    </div>
  </section></div>;
}

const taskLabels: Record<DrawingTaskStatus, string> = {
  queued: "等待中", preparing: "准备中", dispatching: "正在发送",
  running: "生成中", saving: "正在保存", completed: "已保存", failed: "生成失败",
  cancelled: "已取消", unknown: "结果未知", "save-failed": "保存失败",
};

function cancellable(task: DrawingTask) {
  return task.status === "queued" || task.status === "preparing" || task.status === "dispatching" || task.status === "running";
}

function terminal(task: DrawingTask) {
  return ["completed", "failed", "cancelled", "unknown", "save-failed"].includes(task.status);
}

const diagnosisLabels: Record<string, string> = {
  rejected: "服务拒绝请求", "rate-limited": "请求过于频繁", "network-unknown": "网络中断，结果无法确认",
  "invalid-response": "服务返回的图片结果无效", "local-file": "本地图片保存或读取失败",
  "local-state": "本地任务记录保存失败", configuration: "模型或连接配置不可用", cancelled: "任务已取消",
};

function ResultDetails({ result }: { result: DrawingResult }) {
  const parameters = result.parameters;
  return <div className="drawing-result-details">
    <p className="drawing-result-prompt">{parameters.prompt}</p>
    <p className="drawing-muted">模型：{parameters.modelId} · 协议：{parameters.protocol}</p>
    <p className="drawing-muted">{parameters.protocol === "openai-images"
      ? `尺寸：${parameters.size} · 画质：${parameters.quality}`
      : `宽高比：${parameters.aspectRatio} · 分辨率：${parameters.resolution}`}</p>
    <p className="drawing-muted">{parameters.modelName} · {result.width} × {result.height} · 参考图 {parameters.references?.length ?? 0} 张</p>
    <p className="drawing-muted">生成时间：<time dateTime={result.createdAt}>{result.createdAt}</time></p>
  </div>;
}

function TaskParameters({ task }: { task: DrawingTask }) {
  const parameters = task.parameters;
  return <div className="drawing-task-parameters">
    <p className="drawing-task-prompt">{parameters.prompt}</p>
    <p className="drawing-muted">模型：{parameters.modelName}（{parameters.modelId}） · 协议：{parameters.protocol}</p>
    <p className="drawing-muted">{parameters.protocol === "openai-images"
      ? `尺寸：${parameters.size} · 画质：${parameters.quality}`
      : `宽高比：${parameters.aspectRatio} · 分辨率：${parameters.resolution}`}
      {` · 参考图 ${parameters.references?.length ?? 0} 张`}</p>
    {parameters.protocol === "gemini-image" && parameters.gemini && <p className="drawing-muted">
      {`温度：${parameters.gemini.temperature ?? "模型默认"} · 安全阈值：${parameters.gemini.safetyThreshold ?? "服务默认"} · 输出：${parameters.gemini.outputMode === "image" ? "仅图片" : "文字＋图片"}`}
    </p>}
  </div>;
}

function TaskDiagnostic({ task }: { task: DrawingTask }) {
  if (!task.diagnostic) return null;
  return <details className="drawing-task-diagnosis drawing-muted">
    <summary>诊断详情</summary>
    <p>{diagnosisLabels[task.diagnostic.category] ?? "其他错误"}
      {Number.isInteger(task.diagnostic.httpStatus) && task.diagnostic.httpStatus! >= 100 && task.diagnostic.httpStatus! <= 599
        ? ` · HTTP 状态 ${task.diagnostic.httpStatus}` : ""}</p>
  </details>;
}

function recoveryText(task: DrawingTask) {
  const recovery = task.recovery;
  if (!recovery) return "图片恢复状态尚未核实；删除后无法通过此任务重试本地保存。";
  const numbers = (indices: number[]) => indices.map(index => index + 1).join("、");
  return [
    `共 ${recovery.total} 张图片。`,
    recovery.durable.length ? `已暂存图片 ${numbers(recovery.durable)}：可重试本地保存；删除任务后将清理这些暂存图片。` : "",
    recovery.memory.length ? `仅在内存的图片 ${numbers(recovery.memory)}：退出或删除任务后丢失。` : "",
    recovery.lost.length ? `已丢失图片 ${numbers(recovery.lost)}：无法恢复。` : "",
    recovery.unverified ? "暂存图片可用性尚未核实。" : "",
  ].filter(Boolean).join("\n");
}

function elapsed(task: DrawingTask, now: number) {
  const start = task.startedAt ? Date.parse(task.startedAt) : NaN;
  const end = task.finishedAt ? Date.parse(task.finishedAt) : terminal(task) ? NaN : now;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "—";
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function DrawingWorkspace({ draft, references = draft.references ?? [], preparation, onDraftChange, onConfigure, models, tasks, results,
  selectedResultId, previewUrl, previewError, ready, busy, submitting = false, paused = false, error,
  onGenerate, onCancel, onCancelPreparation, onCancelBatch, onRegenerate, onDeleteTasks, managementBusy = false,
  onPause, onResume, onSelectResult, onExport, onRetrySave, onReuse,
  onAddReferences, onRemoveReference, onMoveReference, onUseAsReference, readReference, referencesBusy,
  onClearReferences, readThumbnail, onDeleteResults, onExportResults, onCopyPrompt, onPreviewActive,
  presets = [], presetsBusy = false, onApplyPreset, onCreatePreset, onUpdatePreset, onDeletePreset,
  onReuseTask, onCopyTaskPrompt, onOpenOutputDirectory,
  closing = false, notice }: {
  draft: DrawingDraft;
  references?: DrawingReferenceSelection[];
  preparation?: { completed: number; total: number };
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
  submitting?: boolean;
  paused?: boolean;
  error: string | null;
  onGenerate(): void;
  onCancel(id?: string): void;
  onCancelPreparation?(): void;
  onCancelBatch?(batchId: string): void;
  onRegenerate?(id: string): void;
  onDeleteTasks?(ids: string[]): void;
  managementBusy?: boolean;
  onPause?(): void;
  onResume?(): void;
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
  onClearReferences?(): void;
  readThumbnail?(reference: string): Promise<DrawingImageInput>;
  onDeleteResults?(ids: string[]): void;
  onExportResults?(ids: string[], withParameters: boolean): void;
  onCopyPrompt?(id: string): void;
  onPreviewActive?(active: boolean): void;
  presets?: DrawingPromptPreset[];
  presetsBusy?: boolean;
  onApplyPreset?(id: string): void;
  onCreatePreset?(input: DrawingPresetInput): Promise<boolean>;
  onUpdatePreset?(id: string, input: DrawingPresetInput): Promise<boolean>;
  onDeletePreset?(id: string): Promise<boolean>;
  onReuseTask?(id: string): void;
  onCopyTaskPrompt?(id: string): void;
  onOpenOutputDirectory?(): Promise<void>;
  closing?: boolean;
  notice?: string | null;
}) {
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(() => new Set());
  const [taskSubview, setTaskSubview] = useState<"list" | "logs">("list");
  const [taskPage, setTaskPage] = useState(0), [logPage, setLogPage] = useState(0), [historyPage, setHistoryPage] = useState(0);
  const activeTaskPage = Math.min(taskPage, Math.max(0, Math.ceil(tasks.length / recordsPerPage) - 1));
  const activeLogPage = Math.min(logPage, Math.max(0, Math.ceil(tasks.length / recordsPerPage) - 1));
  const activeHistoryPage = Math.min(historyPage, Math.max(0, Math.ceil(results.length / recordsPerPage) - 1));
  useEffect(() => { setTaskPage(activeTaskPage); }, [activeTaskPage]);
  useEffect(() => { setLogPage(activeLogPage); }, [activeLogPage]);
  useEffect(() => { setHistoryPage(activeHistoryPage); }, [activeHistoryPage]);
  const resultNumbers = useMemo(() => new Map(results.map((result, index) => [result.id, results.length - index])), [results]);
  const selectedHistoryPage = Math.floor(Math.max(0, results.length - (resultNumbers.get(selectedResultId ?? "") ?? results.length)) / recordsPerPage);
  useEffect(() => { if (selectedResultId) setHistoryPage(selectedHistoryPage); }, [selectedResultId, selectedHistoryPage]);
  const memoryTasks = tasks.filter(task => task.status === "save-failed" && (task.recovery?.memory.length ?? 0) > 0);
  const memoryImages = memoryTasks.reduce((total, task) => total + (task.recovery?.memory.length ?? 0), 0);
  const [confirmation, setConfirmation] = useState<TaskConfirmation | null>(null);
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [temperatureError, setTemperatureError] = useState(false);
  useEffect(() => { setTemperatureError(false); }, [draft.modelId, draft.gemini]);
  const [openingDirectory, setOpeningDirectory] = useState(false);
  const openingDirectoryRef = useRef(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  useEffect(() => {
    onPreviewActive?.(true);
    return () => onPreviewActive?.(false);
  }, [onPreviewActive]);
  const [now, setNow] = useState(Date.now);
  const liveElapsed = tasks.some(task => task.startedAt && !task.finishedAt && !terminal(task));
  useEffect(() => {
    if (!liveElapsed) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [liveElapsed]);
  const hasCancellable = tasks.some(cancellable);
  const count = draft.count ?? 1;
  const concurrency = draft.concurrency ?? 1;
  const selectedResult = results.find((result) => result.id === selectedResultId);
  const selectedModel = models.find(model => model.id === draft.modelId);
  const reusedProtocol = !selectedModel ? draft.reusedProtocol : undefined;
  const openai = (selectedModel?.protocol ?? reusedProtocol) === "openai-images";
  const size = draft.openai?.size ?? "auto", quality = draft.openai?.quality ?? "auto";
  const presetSize = (openAIImageSizes as readonly string[]).includes(size);
  const setOpenAI = (patch: Partial<NonNullable<DrawingDraft["openai"]>>) => onDraftChange({ ...draft, openai: { size, quality, ...patch } });
  const setGemini = (patch: Partial<GeminiDrawingOptions>) => {
    const next = { ...draft.gemini, ...patch };
    for (const key of Object.keys(next) as (keyof GeminiDrawingOptions)[]) if (next[key] === undefined) delete next[key];
    onDraftChange({ ...draft, gemini: next });
  };
  const resultNumber = (id: string) => resultNumbers.get(id) ?? 0;
  const canGenerate = ready && !closing && !presetDialogOpen && models.some(model => model.id === draft.modelId) && Boolean(draft.prompt.trim()) && !submitting && !referencesBusy && (openai || !temperatureError);
  const canEditReferences = ready && !closing && !referencesBusy && !managementBusy && !confirmation && !presetDialogOpen;
  const managementAllowed = ready && !closing && !submitting && !managementBusy;
  const canManage = managementAllowed && !confirmation && !presetDialogOpen;
  const completedTasks = tasks.filter(task => task.status === "completed");
  const failedTasks = tasks.filter(task => terminal(task) && task.status !== "completed");
  const taskSignature = (task: DrawingTask) => JSON.stringify(task);
  const confirmationValid = Boolean(confirmation && managementAllowed
    && (confirmation.kind === "delete-results" ? onDeleteResults : confirmation.kind === "delete" ? onDeleteTasks : onRegenerate)
    && confirmation.selected.every(selected => {
      if (confirmation.kind === "delete-results") {
        const current = results.find(result => result.id === selected.id);
        return current && JSON.stringify(current) === selected.signature;
      }
      const current = tasks.find(task => task.id === selected.id);
      return current && terminal(current) && taskSignature(current) === selected.signature;
    }));

  function deleteTasks(selected: DrawingTask[], opener: HTMLButtonElement) {
    if (!canManage || !onDeleteTasks || !selected.length || selected.some(task => !terminal(task))) return;
    const warnings = selected.flatMap(task => {
      if (task.status === "unknown") return [`任务 ${taskLabel(task.id)}：结果未知，删除历史不会取消远端生成或计费。`];
      if (task.status === "save-failed") return [`任务 ${taskLabel(task.id)}：保存失败。\n${recoveryText(task)}`];
      return [];
    });
    setConfirmation({ kind: "delete", opener, selected: selected.map(task => ({ id: task.id, signature: taskSignature(task) })),
      text: [`删除 ${selected.length} 条任务历史？此操作无法撤销，已保存成果始终保留。`, ...warnings].join("\n\n") });
  }

  function regenerate(task: DrawingTask, opener: HTMLButtonElement) {
    if (!canManage || !onRegenerate || !terminal(task)) return;
    if (task.status === "unknown") {
      setConfirmation({ kind: "regenerate", opener, selected: [{ id: task.id, signature: taskSignature(task) }],
        text: "原任务结果未知，服务端可能仍在生成并计费。重新生成将新建任务，可能造成重复生成和重复计费。是否继续？" });
      return;
    }
    onRegenerate(task.id);
  }

  function confirmTaskAction() {
    if (!confirmation || !confirmationValid) return;
    setConfirmation(null);
    if (confirmation.kind === "delete-results") {
      const ids = confirmation.selected.map(result => result.id);
      onDeleteResults?.(ids);
    } else if (confirmation.kind === "delete") onDeleteTasks?.(confirmation.selected.map(task => task.id));
    else onRegenerate?.(confirmation.selected[0].id);
  }

  function deleteResults(ids: string[], opener: HTMLButtonElement) {
    if (!canManage || !onDeleteResults || !ids.length) return;
    const selected = ids.map(id => results.find(result => result.id === id)).filter((result): result is DrawingResult => Boolean(result));
    if (selected.length !== ids.length) return;
    setConfirmation({ kind: "delete-results", opener,
      selected: selected.map(result => ({ id: result.id, signature: JSON.stringify(result) })),
      text: `删除 ${selected.length} 张绘图成果（${selected.map(result => `成果 ${resultNumber(result.id)}`).join("、")}）？此操作无法撤销；已被草稿或任务引用的参考图仍会保留。` });
  }

  function resultActions(result: DrawingResult) {
    return <div className="drawing-actions">
      <button type="button" className="drawing-button" disabled={!canManage} onClick={() => onExport(result.id)}>导出图片</button>
      {onExportResults && <button type="button" className="drawing-button" disabled={!canManage}
        onClick={() => onExportResults([result.id], true)}>导出带参数 PNG</button>}
      {onCopyPrompt && <button type="button" className="drawing-button" disabled={!canManage}
        onClick={() => onCopyPrompt(result.id)}>复制提示词</button>}
      <button type="button" className="drawing-button" disabled={!canManage || referencesBusy}
        onClick={() => reuseResult(result.id)}>复用参数</button>
      <button type="button" className="drawing-button" disabled={!canEditReferences}
        onClick={() => onUseAsReference(result.id)}>作为参考图</button>
      {onDeleteResults && <button type="button" className="drawing-button" disabled={!canManage}
        aria-label={`删除成果 ${resultNumber(result.id)}`} onClick={event => deleteResults([result.id], event.currentTarget)}>删除成果</button>}
    </div>;
  }

  function reuseResult(id: string) {
    onReuse(id);
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
      <header className="drawing-header" data-tauri-drag-region inert={Boolean(confirmation) || presetDialogOpen}>
        <WindowControls />
      </header>

      <div className="drawing-body" inert={Boolean(confirmation) || presetDialogOpen}>
        {!ready && <p className="drawing-notice">正在加载绘图工作区…</p>}
        {error && <p className="drawing-error" role="alert">{error}</p>}
        {memoryTasks.length > 0 && <p className="drawing-error" role="alert" aria-label="未保存图片内存风险">
          {memoryTasks.length} 项任务的 {memoryImages} 张图片仅保存在内存。保存失败时继续生成会增加内存占用，建议暂停队列并重试本地保存；退出可能丢失这些图片。
        </p>}
        {notice && <p className="drawing-muted" role="status">{notice}</p>}

          <div className="drawing-layout">
            <div className="drawing-left-column">
            <section className="drawing-panel drawing-form" aria-label="绘图草稿">
              <div className="drawing-field">
                <label className="drawing-label" htmlFor="drawing-model">绘图模型</label>
                <div className="drawing-model">
                  <select id="drawing-model" value={draft.modelId ?? ""} disabled={!ready}
                    onChange={(event) => {
                      const next = { ...draft, modelId: event.target.value || null };
                      delete next.reusedProtocol;
                      onDraftChange(next);
                    }}>
                    <option value="">{reusedProtocol ? `选择绘图模型（已复用 ${reusedProtocol === "openai-images" ? "OpenAI" : "Gemini"} 参数）` : "选择绘图模型"}</option>
                    {models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                  </select>
                  <button type="button" className="drawing-button" onClick={onConfigure}>前往设置</button>
                </div>
                {reusedProtocol && <p className="drawing-muted" role="status">原模型不可用，请重新选择绘图模型。已保留 {reusedProtocol === "openai-images" ? "OpenAI Images" : "Gemini Image"} 协议参数。</p>}
                {ready && models.length === 0 && <p className="drawing-muted">请在设置中添加 Gemini 或 OpenAI 绘图连接和模型。</p>}
              </div>
              <label className="drawing-field">
                <span className="drawing-label">提示词</span>
                <textarea id="drawing-prompt" value={draft.prompt} placeholder="描述想要生成的画面"
                  onChange={(event) => onDraftChange({ ...draft, prompt: event.target.value })} />
              </label>
              {onApplyPreset && onCreatePreset && onUpdatePreset && onDeletePreset && <DrawingPresets
                presets={presets} prompt={draft.prompt} disabled={!ready || closing || presetsBusy || Boolean(confirmation)}
                onApply={onApplyPreset} onCreate={onCreatePreset} onUpdate={onUpdatePreset} onDelete={onDeletePreset}
                onDialogChange={setPresetDialogOpen} />}
              <div className="drawing-input-layout">
              <div className="drawing-compact-parameters">
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
              </>}
              <div className="drawing-parameters">
                <label className="drawing-field">
                  <span className="drawing-label">数量</span>
                  <input type="number" min={1} max={99} step={1} value={count} disabled={!ready || submitting}
                    onChange={event => onDraftChange({ ...draft, count: Math.min(99, Math.max(1, Math.trunc(Number(event.target.value)) || 1)) })} />
                </label>
                <label className="drawing-field">
                  <span className="drawing-label">并发</span>
                  <input type="number" min={1} max={4} step={1} value={concurrency} disabled={!ready || submitting}
                    onChange={event => onDraftChange({ ...draft, concurrency: Math.min(4, Math.max(1, Math.trunc(Number(event.target.value)) || 1)) })} />
                </label>
              </div>
              <div className="drawing-parameter-extra drawing-parameter-tools">
                {!openai && <button type="button" className="drawing-button" aria-expanded={advancedOpen}
                  aria-controls="drawing-gemini-advanced" onClick={() => setAdvancedOpen(!advancedOpen)}>Gemini 高级参数</button>}
                <SettingsHelp label="参数">{openai
                  ? "xhigh／max 需 GPT Image 2.5 或服务支持。自定义尺寸需 GPT Image 2／2.5：边长为 16 的倍数且不超过 3840，比例在 1:3 至 3:1，总像素 655360–8294400；高于 2560 × 1440 为实验性尺寸。旧模型和中转支持范围以服务为准。"
                  : "512 分辨率需 Gemini 3.1 Flash Image；1:4／4:1／1:8／8:1 需 3.1 Flash 或 Flash Lite。Pro 提供 1K／2K／4K，Flash Lite 仅 1K，2.5 Flash Image 不提供分辨率选择。实际像素随比例和模型变化。"}</SettingsHelp>
              <label className="drawing-label drawing-sound">
                <input type="checkbox" checked={draft.completionSound ?? true} disabled={!ready || submitting}
                  onChange={event => onDraftChange({ ...draft, completionSound: event.target.checked })} /> 完成提示音
              </label>
              </div>
              </div>
              <DrawingReferences references={references} disabled={!canEditReferences}
                busy={referencesBusy} read={readReference} readThumbnail={readThumbnail} onAdd={onAddReferences}
                onRemove={onRemoveReference} onMove={onMoveReference} onClear={onClearReferences} />
              </div>
              {openai ? <>
                {!presetSize && <label className="drawing-field drawing-parameter-extra">
                  <span className="drawing-label">自定义尺寸（宽x高）</span>
                  <input type="text" value={size} placeholder="1536x864" onChange={event => setOpenAI({ size: event.target.value })} />
                </label>}
              </> : <>
              {advancedOpen && <div id="drawing-gemini-advanced" className="drawing-parameter-extra">
                <div className="drawing-advanced-columns">
                <div className="drawing-field">
                <div className="drawing-temperature-row">
                <div className="drawing-field drawing-advanced-inline">
                  <label className="drawing-label" htmlFor="drawing-gemini-temperature">温度（0–2）</label>
                  <SettingsHelp label="温度">默认跟随模型，不发送 temperature。Gemini 3 官方建议保持默认 1.0。</SettingsHelp>
                  <input id="drawing-gemini-temperature" type="number" min="0" max="2" step="any" placeholder="跟随模型" disabled={!ready || closing}
                    aria-label="Gemini temperature" aria-invalid={temperatureError} value={draft.gemini?.temperature ?? ""}
                    onChange={event => {
                      const text = event.target.value, value = event.target.valueAsNumber;
                      const invalid = text !== "" && (!Number.isFinite(value) || value < 0 || value > 2);
                      setTemperatureError(invalid);
                      if (!invalid) setGemini({ temperature: text === "" ? undefined : value });
                    }} />
                </div>
                <button type="button" className="drawing-button drawing-temperature-reset" disabled={!ready || closing}
                  aria-label="恢复模型温度" title="恢复模型温度"
                  onClick={() => { setTemperatureError(false); setGemini({ temperature: undefined }); }}><RotateCcw size={16} aria-hidden="true" /></button>
                </div>
                {temperatureError && <p className="drawing-error" role="alert">Temperature 须为 0–2 的有限数。</p>}
                </div>
                <div className="drawing-field">
                <div className="drawing-temperature-row">
                <div className="drawing-field drawing-advanced-inline">
                  <label className="drawing-label" htmlFor="drawing-gemini-safety">安全阈值</label>
                  <SettingsHelp label="安全阈值">适用于骚扰、仇恨、色情和危险内容四类；服务端仍可能拒绝内容或参数，支持范围以模型和中转为准。</SettingsHelp>
                  <select id="drawing-gemini-safety" aria-label="Gemini 安全阈值" value={draft.gemini?.safetyThreshold ?? "auto"} disabled={!ready || closing}
                    onChange={event => setGemini({ safetyThreshold: event.target.value === "auto" ? undefined : event.target.value as GeminiSafetyThreshold })}>
                    <option value="auto">服务默认</option>
                    {geminiSafetyThresholds.map(value => <option key={value} value={value}>{value}</option>)}
                  </select>
                </div>
                </div>
                </div>
                </div>
                <label className="drawing-field"><span className="drawing-label">输出模式</span>
                  <select aria-label="Gemini 输出模式" value={draft.gemini?.outputMode ?? "text-image"} disabled={!ready || closing}
                    onChange={event => setGemini({ outputMode: event.target.value as "text-image" | "image" })}>
                    <option value="text-image">文字＋图片</option><option value="image">仅图片</option>
                  </select>
                </label>
              </div>}</>}
              <div className="drawing-submit">
                {preparation && <>
                  <p className="drawing-muted" role="status">正在准备参考图 {preparation.completed}/{preparation.total}…</p>
                  <button type="button" className="drawing-button" disabled={!ready || closing || !onCancelPreparation}
                    onClick={event => { if (event.detail <= 1) onCancelPreparation?.(); }}>取消准备参考图</button>
                </>}
                <button id="drawing-generate" type="button" className="drawing-button drawing-generate"
                  disabled={!canGenerate} onClick={event => { if (event.detail <= 1) onGenerate(); }} aria-describedby="drawing-generation-note">
                  {submitting ? "正在加入队列…" : count > 1 ? `加入 ${count} 个任务` : busy || paused ? "加入队列" : "生成图片"}
                </button>
                <details className="drawing-generation-help drawing-parameter-help"><summary>队列说明</summary><p id="drawing-generation-note" className="drawing-muted">数量为独立单图请求数，同一批使用提交时的草稿快照。暂停只阻止新任务开始，正在执行的任务继续完成。</p></details>
              </div>
            </section>

            <section className="drawing-panel drawing-task-panel" aria-label="绘图任务">
              <div className="drawing-task-header">
                <div className="drawing-task-subviews" role="tablist" aria-label="任务子视图">
                  {(["list", "logs"] as const).map((id, index) => <button key={id} id={`drawing-task-tab-${id}`}
                    type="button" role="tab" aria-selected={taskSubview === id} tabIndex={taskSubview === id ? 0 : -1}
                    aria-controls="drawing-task-content" onClick={() => setTaskSubview(id)}
                    onKeyDown={event => {
                      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                      event.preventDefault();
                      const target = event.key === "Home" ? "list" : event.key === "End" ? "logs" : index === 0 ? "logs" : "list";
                      setTaskSubview(target);
                      document.getElementById(`drawing-task-tab-${target}`)?.focus();
                    }}>{id === "list" ? "任务列表" : "任务日志"}</button>)}
                </div>
        <div className="drawing-queue-summary">
          <p className="drawing-muted" role="status" aria-label="绘图队列状态">
            {paused ? "队列已暂停" : "队列运行中"} · 等待 {tasks.filter(task => task.status === "queued").length}
            {` · 准备 ${tasks.filter(task => task.status === "preparing").length} · 生成 ${tasks.filter(task => task.status === "dispatching" || task.status === "running").length} · 保存 ${tasks.filter(task => task.status === "saving").length} · 已结束 ${tasks.filter(terminal).length}`}
          </p>
          <div className="drawing-actions">
            {paused ? onResume && <button type="button" className="drawing-button" disabled={!ready || submitting} onClick={onResume}>继续队列</button>
              : onPause && <button type="button" className="drawing-button" disabled={!ready || submitting} onClick={onPause}>暂停队列</button>}
            {hasCancellable && <button type="button" className="drawing-button" disabled={!canManage}
              onClick={event => { if (event.detail <= 1) onCancel(); }}>取消全部待处理任务</button>}
          </div>
          {hasCancellable && <p className="drawing-muted">已发出的请求取消后，服务端仍可能继续生成并计费。</p>}
        </div>

              </div>
              <div className="drawing-task-toolbar">
                <RecordPagination page={taskSubview === "list" ? activeTaskPage : activeLogPage} count={tasks.length}
                  onPage={taskSubview === "list" ? setTaskPage : setLogPage} label={taskSubview === "list" ? "任务" : "任务日志"} />
                {onDeleteTasks && <div className="drawing-actions">
                  <button type="button" className="drawing-button" disabled={!canManage || !completedTasks.length}
                    onClick={event => { if (event.detail <= 1) deleteTasks(completedTasks, event.currentTarget); }}>清空已完成历史</button>
                  <button type="button" className="drawing-button" disabled={!canManage || !failedTasks.length}
                    onClick={event => { if (event.detail <= 1) deleteTasks(failedTasks, event.currentTarget); }}>清空失败历史</button>
                </div>}
              </div>
              <div id="drawing-task-content" className="drawing-task-content" role="tabpanel"
                aria-labelledby={`drawing-task-tab-${taskSubview}`} tabIndex={0}>
                {taskSubview === "logs" && <p className="drawing-log-note drawing-muted">显示每次生成的入队、开始、结束或最近状态，以及失败原因。</p>}
                {tasks.length ? <table className="drawing-task-table" aria-label={taskSubview === "list" ? "任务列表" : "任务日志"}>
                  <colgroup><col className="drawing-task-id-column" /><col className="drawing-task-status-column" />
                    <col className="drawing-task-parameter-column" /><col className="drawing-task-time-column" /><col /><col className="drawing-task-action-column" /></colgroup>
                  <thead><tr><th scope="col">ID</th><th scope="col">状态</th><th scope="col">参数</th><th scope="col">耗时</th>
                    <th scope="col">{taskSubview === "list" ? "提示词" : "任务日志"}</th><th scope="col">操作</th></tr></thead>
                  <tbody>{tasks.slice((taskSubview === "list" ? activeTaskPage : activeLogPage) * recordsPerPage,
                    ((taskSubview === "list" ? activeTaskPage : activeLogPage) + 1) * recordsPerPage).map(task => {
                    const expanded = expandedTasks.has(task.id);
                    const parameters = task.parameters;
                    const summary = parameters.protocol === "openai-images" ? `${parameters.size} · ${parameters.quality}`
                      : `${parameters.aspectRatio} · ${parameters.resolution}`;
                    return <Fragment key={task.id}>
                      <tr className="drawing-task-row" data-status={task.status}>
                        <th scope="row" title={task.id}><span className="drawing-task-id">{taskLabel(task.id)}</span></th>
                        <td>{taskLabels[task.status]}</td>
                        <td><span className="drawing-task-truncate" title={summary}>{summary}</span></td>
                        <td aria-label={`执行耗时 ${elapsed(task, now)}`}>{elapsed(task, now)}</td>
                        <td>{taskSubview === "list" ? <button type="button" className="drawing-task-expand"
                          aria-label={`${expanded ? "收起" : "展开"}任务 ${taskLabel(task.id)} 详情`} aria-expanded={expanded}
                          aria-controls={`drawing-task-detail-${task.id}`} title={parameters.prompt}
                          onClick={() => setExpandedTasks(current => {
                            const next = new Set(current);
                            if (next.has(task.id)) next.delete(task.id); else next.add(task.id);
                            return next;
                          })}><span className="drawing-task-truncate">{parameters.prompt}</span>
                            <span className="drawing-muted">{expanded ? "收起" : "详情"}</span></button> : <ol className="drawing-task-log drawing-muted">
                  <li>入队：<time dateTime={task.createdAt}>{task.createdAt}</time></li>
                  {task.startedAt && <li>开始执行：<time dateTime={task.startedAt}>{task.startedAt}</time></li>}
                  {task.finishedAt && <li>{terminal(task) && task.finishedAt === task.updatedAt ? `结束 · ${taskLabels[task.status]}` : "执行结束"}：<time dateTime={task.finishedAt}>{task.finishedAt}</time></li>}
                  {(!terminal(task) || !task.finishedAt || task.finishedAt !== task.updatedAt)
                    && <li>最近状态 · {taskLabels[task.status]}：<time dateTime={task.updatedAt}>{task.updatedAt}</time></li>}
                </ol>}</td>
                        <td><div className="drawing-task-row-actions">

                {onCopyTaskPrompt && <button type="button" className="drawing-button drawing-task-text-action" disabled={!canManage}
                  aria-label={`复制任务 ${taskLabel(task.id)} 提示词`} onClick={() => onCopyTaskPrompt(task.id)} title="复制提示词">复制</button>}
                {onDeleteTasks && <button type="button" className="drawing-button drawing-task-text-action" disabled={!canManage || !terminal(task)}
                  aria-label={`删除任务 ${taskLabel(task.id)} 历史`}
                  onClick={event => { if (event.detail <= 1) deleteTasks([task], event.currentTarget); }} title="删除历史">删除</button>}
                          <details className="drawing-task-more"><summary aria-label={`任务 ${taskLabel(task.id)} 更多操作`}>更多</summary>
                            <div className="drawing-actions">
                {onReuseTask && <button type="button" className="drawing-button" disabled={!canManage || referencesBusy}
                  aria-label={`复用任务 ${taskLabel(task.id)} 参数`} onClick={() => { onReuseTask(task.id); }}>复用参数</button>}
                {task.batchId && onCancelBatch && tasks.find(item => item.batchId === task.batchId)?.id === task.id && <button type="button"
                  className="drawing-button" disabled={!canManage || !tasks.some(item => item.batchId === task.batchId && cancellable(item))}
                  aria-label={`取消任务 ${taskLabel(task.id)} 所在批次`}
                  onClick={event => { if (event.detail <= 1) onCancelBatch(task.batchId!); }}>取消本批待处理任务</button>}
                {cancellable(task) && <button type="button" className="drawing-button" disabled={!canManage}
                  aria-label={`取消任务 ${taskLabel(task.id)}`}
                  onClick={event => { if (event.detail <= 1) onCancel(task.id); }}>{task.status === "queued" ? "取消排队" : task.status === "preparing" ? "取消准备" : "取消生成"}</button>}
                {task.status === "save-failed" && <button type="button" className="drawing-button" disabled={busy || !canManage}
                  onClick={event => { if (event.detail <= 1) onRetrySave(task.id); }}>重试本地保存</button>}
                {onRegenerate && terminal(task) && <button type="button" className="drawing-button" disabled={!canManage}
                  aria-label={`重新生成任务 ${taskLabel(task.id)}`}
                  onClick={event => { if (event.detail <= 1) regenerate(task, event.currentTarget); }}>重新生成</button>}

                            </div>
                          </details>
                        </div></td>
                      </tr>
                      <tr id={`drawing-task-detail-${task.id}`} className="drawing-task-detail-row"
                        hidden={!expanded && !task.error && !task.diagnostic && task.status !== "unknown" && task.status !== "save-failed"}>
                        <td colSpan={6}>
                          {expanded && <><p className="drawing-muted">任务 ID：{task.id}</p><TaskParameters task={task} />
                {task.sourceTaskId && <p className="drawing-muted">{tasks.some(source => source.id === task.sourceTaskId)
                  ? `重新生成自任务 ${taskLabel(task.sourceTaskId)}` : "重新生成的任务（来源历史已删除）"}</p>}
                {<p className="drawing-muted">入队时间：<time dateTime={task.createdAt}>{task.createdAt}</time>
                  {" · 最近状态时间："}<time dateTime={task.updatedAt}>{task.updatedAt}</time>
                  {task.finishedAt && <> · 执行结束时间：<time dateTime={task.finishedAt}>{task.finishedAt}</time></>}</p>}

                          </>}
                {(task.error || task.diagnostic) && <div className="drawing-task-failure">
                  {task.error && <p className="drawing-error" role="alert">{task.diagnostic ? diagnosisLabels[task.diagnostic.category] ?? "任务处理失败，请查看状态并重试适用操作。" : "任务处理失败，请查看状态并重试适用操作。"}</p>}
                  <TaskDiagnostic task={task} />
                </div>}
                {task.status === "unknown" && <p className="drawing-muted">请求可能已经发出，不会自动重发。</p>}
                {task.status === "save-failed" && <p className="drawing-muted drawing-task-recovery">{recoveryText(task)}</p>}

                        </td>
                      </tr>
                    </Fragment>;
                  })}</tbody>
                </table> : <div className="drawing-empty"><p>{taskSubview === "list" ? "暂无绘图任务" : "暂无任务日志"}</p></div>}
              </div>
            </section>
            </div>
            <section className="drawing-panel" aria-labelledby="drawing-preview-title">
              <div className="drawing-section-heading">
                <h2 id="drawing-preview-title">图像预览</h2>
                <span className="drawing-muted">{selectedResult ? `成果 ${resultNumber(selectedResult.id)}` : "等待生成"}</span>
              </div>
              <DrawingResultPreview id={selectedResult?.id ?? null} url={selectedResult ? previewUrl : null} error={previewError}
                width={selectedResult?.width} height={selectedResult?.height} />
              {selectedResult && <div className="drawing-preview-details">
                <ResultDetails result={selectedResult} />
                {resultActions(selectedResult)}
                {onExportResults && <p className="drawing-muted">带参数 PNG 含提示词等生成参数，不含参考图原件，不保证可确定复现；分享前请确认内容。</p>}
              </div>}
              <h2 className="drawing-history-heading">生成历史</h2>
              <RecordPagination page={activeHistoryPage} count={results.length} onPage={setHistoryPage} label="生成历史" />
              <div className="drawing-history" aria-label="生成历史">
                {results.length ? results.slice(activeHistoryPage * recordsPerPage, (activeHistoryPage + 1) * recordsPerPage).map((result) => <HistoryItem key={result.id} result={result} number={resultNumber(result.id)}
                  selected={result.id === selectedResultId} onSelect={onSelectResult} read={readThumbnail} />)
                  : <p className="drawing-muted">暂无生成历史</p>}
              </div>
              <div className="drawing-preview-footer">
                {onOpenOutputDirectory && <button type="button" className="drawing-button" disabled={!ready || closing || openingDirectory}
                  onClick={async event => {
                    if (event.detail > 1 || !ready || closing || openingDirectoryRef.current) return;
                    openingDirectoryRef.current = true;
                    setOpeningDirectory(true);
                    setDirectoryError(null);
                    try { await onOpenOutputDirectory(); }
                    catch { setDirectoryError("无法打开输出文件夹，请稍后重试。"); }
                    finally { openingDirectoryRef.current = false; setOpeningDirectory(false); }
                  }}>打开输出文件夹</button>}
                {directoryError && <p className="drawing-error" role="alert">{directoryError}</p>}
              </div>
            </section>
          </div>

      </div>
      {confirmation && <TaskConfirmationDialog confirmation={confirmation} valid={confirmationValid}
        onClose={() => setConfirmation(null)} onConfirm={confirmTaskAction} />}
    </div>
  );
}
