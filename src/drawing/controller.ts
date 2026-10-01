import type { ConnectionSettingsState } from "../chat/settings";
import { getDrawingTarget } from "../chat/settings";
import { ImageGenerationError, validateDrawingParameters } from "./geminiImage";
import { validateOpenAIImagesParameters } from "./openaiImages";
import { bytesToBase64 } from "../chat/attachments";
import { drawingExportParameters } from "./exportParameters";
import { validGeminiDrawingOptions } from "./geminiOptions";
import type { DrawingRepository, DrawingSnapshot } from "./repository";
import type { DrawingPresetInput, DrawingPresetRepository, DrawingPromptPreset } from "./presets";
import { initialDrawingDraft, type DrawingDraft, type DrawingTask, type DrawingResult, type DrawingFiles,
  type DrawingImageInput, type ImageGenerationTransport, type DrawingParameters, type DrawingReference, type DrawingRecovery } from "./types";

export interface DrawingState {
  draft: DrawingDraft;
  tasks: DrawingTask[];
  results: DrawingResult[];
  presets: DrawingPromptPreset[];
  presetsBusy: boolean;
  selectedResultId: string | null;
  ready: boolean;
  busy: boolean;
  referencesBusy: boolean;
  closing: boolean;
  error: string | null;
  notice: string | null;
  hasData: boolean;
  submitting: boolean;
  paused: boolean;
  managementBusy: boolean;
  completion: { sequence: number; allSucceeded: boolean };
}
interface DrawingDependencies {
  repository: DrawingRepository;
  presetRepository?: DrawingPresetRepository;
  files: DrawingFiles;
  transport(): Promise<ImageGenerationTransport>;
  now?(): string;
  id?(): string;
}

export class UnsavedDrawingImagesError extends Error {}

interface ActiveDrawing { controller: AbortController; sent: boolean; saving: boolean; references: DrawingReference[] }
const unfinished = (task: DrawingTask) => ["queued", "preparing", "dispatching", "running", "saving"].includes(task.status);

function validateOwnership(saved: DrawingSnapshot): void {
  const reference = (item: DrawingReference | DrawingResult) => {
    if (!item || typeof item.reference !== "string" || !/^drawing\/[^/]+\/[^/]+$/.test(item.reference) ||
      typeof item.id !== "string" || !item.id || !Number.isFinite(item.size) || item.size <= 0 ||
      !Number.isFinite(item.width) || item.width <= 0 || !Number.isFinite(item.height) || item.height <= 0)
      throw new Error("Damaged drawing ownership");
  };
  const parameters = (item: DrawingParameters) => {
    if (!item || !["gemini-image", "openai-images"].includes(item.protocol)) throw new Error("Unknown drawing protocol");
    if (item.protocol === "gemini-image" && item.gemini !== undefined && !validGeminiDrawingOptions(item.gemini)) throw new Error("Invalid Gemini drawing settings");
    item.references?.forEach(reference);
  };
  saved.draft?.references?.forEach(reference);
  for (const task of saved.tasks) {
    if (!task.id || !["queued", "preparing", "dispatching", "running", "saving", "completed", "failed", "cancelled", "unknown", "save-failed"].includes(task.status))
      throw new Error("Unknown drawing task ownership");
    parameters(task.parameters);
  }
  for (const result of saved.results) {
    reference(result); parameters(result.parameters);
    if (!result.taskId || !result.reference.startsWith(`drawing/${result.taskId}/`)) throw new Error("Damaged result provenance");
  }
}

function awaitImages(request: Promise<DrawingImageInput[]>, signal: AbortSignal): Promise<DrawingImageInput[]> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new ImageGenerationError("请求已停止，服务端结果未知。", "unknown"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    request.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Application-owned durable queue; page unmounts never own requests. */
export class DrawingController {
  private state: DrawingState = { draft: initialDrawingDraft, tasks: [], results: [], presets: [], presetsBusy: false, selectedResultId: null,
    ready: false, busy: false, referencesBusy: false, closing: false, error: null, notice: null, hasData: false,
    submitting: false, paused: false, managementBusy: false, completion: { sequence: 0, allSucceeded: false } };
  private listeners = new Set<() => void>();
  private initialization?: Promise<void>;
  private draftWrites: Promise<void> = Promise.resolve();
  private draftFailure = false;
  private hasSavedDraft = false;
  private presetWrites: Promise<void> = Promise.resolve();
  private pendingPresetWrites = 0;
  private active = new Map<string, ActiveDrawing>();
  private settings?: ConnectionSettingsState;
  private submission?: Promise<void>;
  private submissionCancelled = false;
  private submissionReferences: DrawingReference[] = [];
  private operations = new Set<Promise<void>>();
  private cycle = new Set<string>();
  private cycleHadFailure = false;
  private referenceOperations: Promise<void> = Promise.resolve();
  private pendingReferenceOperations = 0;
  private unsaved = new Map<string, (DrawingImageInput | null)[]>();
  private deleting = new Set<string>();
  private regenerations = new Map<string, Promise<string | undefined>>();
  private managementCount = 0;
  constructor(private readonly dependencies: DrawingDependencies) {}
  getSnapshot = (): DrawingState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<DrawingState>): void {
    this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener());
  }
  private now(): string { return this.dependencies.now?.() ?? new Date().toISOString(); }
  initialize(): Promise<void> {
    return this.initialization ??= this.load();
  }
  private async load(): Promise<void> {
    try {
      const [saved, presets] = await Promise.all([
        this.dependencies.repository.load(), this.dependencies.presetRepository?.load() ?? Promise.resolve([]),
      ]);
      // Validate every newly added option before any restart repair writes or file recovery.
      for (const rows of [saved.tasks, saved.results]) for (const row of rows) {
        if (row.parameters?.protocol === "gemini-image" && row.parameters.gemini !== undefined
          && !validGeminiDrawingOptions(row.parameters.gemini)) throw new Error("Invalid Gemini drawing settings");
      }
      let tasks = saved.tasks, results = saved.results;
      // A native manifest proves completed local persistence, never server acceptance.
      for (const task of tasks) {
        if (task.status === "preparing") {
          const queued: DrawingTask = { ...task, status: "queued", startedAt: undefined, updatedAt: this.now() };
          await this.dependencies.repository.saveTask(queued);
          tasks = tasks.map(item => item.id === task.id ? queued : item);
          continue;
        }
        if (!["dispatching", "running", "saving", "save-failed"].includes(task.status)) continue;
        const possiblySent = task.status === "running" || task.status === "dispatching";
        let files;
        try { files = await this.dependencies.files.recover(task.id); }
        catch {
          const damaged: DrawingTask = { ...task, status: "save-failed", recovery: await this.inspectRecovery(task), diagnostic: { category: "local-file" }, updatedAt: this.now(), error: "上次成果文件读取失败，已保留任务与文件；未重新请求服务。" };
          await this.dependencies.repository.saveTask(damaged);
          tasks = tasks.map(item => item.id === task.id ? damaged : item);
          continue;
        }
        const recovery = files ? undefined : await this.inspectRecovery(task);
        const unknown = possiblySent && !recovery?.total;
        const updated: DrawingTask = { ...task, updatedAt: this.now(), status: files ? "completed" : unknown ? "unknown" : "save-failed",
          recovery: files || unknown ? undefined : recovery,
          diagnostic: files ? undefined : { category: unknown ? "network-unknown" : "local-file" },
          error: files ? undefined : unknown ? "上次请求可能已发出，结果未知；不会自动重发。" : "上次图片未完成本地保存；若原始响应已丢失，无法重新保存。" };
        if (files) {
          const recovered = files.map(file => ({ ...file, taskId: task.id, createdAt: task.createdAt, parameters: task.parameters }));
          await this.dependencies.repository.complete(updated, recovered);
          results = [...results.filter(result => result.taskId !== task.id), ...recovered];
        } else await this.dependencies.repository.saveTask(updated);
        tasks = tasks.map(item => item.id === task.id ? updated : item);
      }
      tasks = [...tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      results = [...results].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      this.hasSavedDraft = !!saved.draft;
      this.publish({ draft: saved.draft ?? { ...initialDrawingDraft }, tasks, results, presets,
        paused: tasks.some(task => task.status === "queued"),
        selectedResultId: results[0]?.id ?? null, ready: true, error: tasks[0]?.error ?? null,
        hasData: !!saved.draft || tasks.length > 0 || results.length > 0 || presets.length > 0 });
    } catch { this.publish({ error: "绘图数据读取或恢复失败。请重启应用后重试；当前禁止生成，以免覆盖已有数据。", ready: false }); }
  }
  setDraft = (draft: DrawingDraft): void => {
    if (!this.state.ready || this.state.closing) return;
    if (draft.gemini !== undefined && !validGeminiDrawingOptions(draft.gemini)) {
      this.publish({ error: "Gemini 高级参数无效，请检查温度、安全阈值和输出模式。" });
      return;
    }
    this.storeDraft(draft.modelId ? { ...draft, reusedProtocol: undefined } : draft);
    this.pump();
  };
  private storeDraft(draft: DrawingDraft): void {
    this.hasSavedDraft = true;
    const next = { id: "current" as const, prompt: draft.prompt, aspectRatio: draft.aspectRatio, resolution: draft.resolution, modelId: draft.modelId,
      count: draft.count ?? 1, concurrency: draft.concurrency ?? 1, completionSound: draft.completionSound ?? true,
      ...(draft.reusedProtocol ? { reusedProtocol: draft.reusedProtocol } : {}),
      ...(draft.openai ? { openai: { size: draft.openai.size, quality: draft.openai.quality } } : {}),
      ...(draft.gemini ? { gemini: structuredClone(draft.gemini) } : {}),
      ...(draft.references ? { references: draft.references.map(reference => ({ ...reference })) } : {}) };
    this.publish({ draft: next, hasData: true });
    this.draftWrites = this.draftWrites.then(async () => {
      try { await this.dependencies.repository.saveDraft(next); this.draftFailure = false; }
      catch { this.draftFailure = true; this.publish({ error: "绘图草稿保存失败，请检查本地存储空间。" }); }
    });
  }
  async flush(): Promise<void> {
    await this.presetWrites;
    await this.referenceOperations;
    await this.draftWrites;
    if (this.draftFailure) throw new Error("绘图草稿尚未保存，暂时不能退出。");
  }
  applyPreset = (id: string): void => {
    if (!this.state.ready || this.state.closing || this.state.presetsBusy) return;
    const preset = this.state.presets.find(item => item.id === id);
    if (!preset) { this.publish({ error: "提示词预设已不存在，请重新选择。" }); return; }
    this.storeDraft({ ...this.state.draft, prompt: preset.content });
    this.publish({ notice: "提示词预设已载入。", error: null });
  };
  private presetCommand(operation: (repository: DrawingPresetRepository) => Promise<void>): Promise<boolean> {
    const repository = this.dependencies.presetRepository;
    if (!this.state.ready || this.state.closing || !repository) return Promise.resolve(false);
    this.pendingPresetWrites++;
    this.publish({ presetsBusy: true, error: null });
    const write = this.presetWrites.then(async () => {
      await operation(repository);
      return true;
    }).catch(() => {
      this.publish({ error: "提示词预设保存或删除失败，请检查本地存储后重试；已保存记录未被替换。" });
      return false;
    }).finally(() => {
      this.pendingPresetWrites--;
      this.publish({ presetsBusy: this.pendingPresetWrites > 0 });
    });
    this.presetWrites = write.then(() => undefined);
    return write;
  }
  createPreset = (input: DrawingPresetInput): Promise<boolean> => {
    const captured = { name: input.name, content: input.content };
    return this.presetCommand(async repository => {
      const preset = await repository.create(captured);
      const presets = [...this.state.presets, preset].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      this.publish({ presets, hasData: true, notice: "提示词预设已保存。" });
    });
  };
  updatePreset = (id: string, input: DrawingPresetInput): Promise<boolean> => {
    const captured = { name: input.name, content: input.content };
    return this.presetCommand(async repository => {
      const preset = await repository.update(id, captured);
      this.publish({ presets: this.state.presets.map(item => item.id === id ? preset : item), notice: "提示词预设已更新。" });
    });
  };
  deletePreset = (id: string): Promise<boolean> => this.presetCommand(async repository => {
    await repository.remove(id);
    const presets = this.state.presets.filter(item => item.id !== id);
    this.publish({ presets, hasData: this.hasSavedDraft || this.state.tasks.length > 0 || this.state.results.length > 0 || presets.length > 0,
      notice: "提示词预设已删除。" });
  });
  private referenceCommand(operation: () => Promise<void>): Promise<void> {
    if (!this.state.ready || this.state.closing) return Promise.resolve();
    this.pendingReferenceOperations++;
    this.publish({ referencesBusy: true, error: null });
    this.referenceOperations = this.referenceOperations.then(operation).catch(error => {
      this.publish({ error: error instanceof ImageGenerationError ? error.message : "参考图读取或保存失败，请检查图片文件和本地存储。" });
    }).finally(() => {
      this.pendingReferenceOperations--;
      this.publish({ referencesBusy: this.pendingReferenceOperations > 0 });
    });
    return this.referenceOperations;
  }
  private async writeReferences(references: DrawingReference[]): Promise<void> {
    const previous = this.state.draft.references ?? [];
    this.storeDraft({ ...this.state.draft, references });
    await this.draftWrites;
    if (this.draftFailure) {
      this.storeDraft({ ...this.state.draft, references: previous });
      await this.draftWrites;
      throw new ImageGenerationError("参考图草稿保存失败，未确认本次修改；请检查本地存储。");
    }
  }
  private async releaseReferences(candidates: DrawingReference[]): Promise<void> {
    // Unknown persisted ownership is never treated as an empty set.
    if (this.draftFailure || !candidates.length) return;
    const saved = await this.dependencies.repository.load();
    validateOwnership(saved);
    validateOwnership({ draft: { ...initialDrawingDraft, references: candidates }, tasks: [], results: [] });
    const retained = new Set([
      ...(this.state.draft.references ?? []), ...this.submissionReferences, ...[...this.active.values()].flatMap(active => active.references),
      ...this.state.tasks.flatMap(task => task.parameters.references ?? []),
      ...this.state.results.flatMap(result => result.parameters.references ?? []),
      ...(saved.draft?.references ?? []), ...saved.tasks.flatMap(task => task.parameters.references ?? []),
      ...saved.results.flatMap(result => result.parameters.references ?? []),
    ].map(image => image.reference));
    const unused = [...new Set(candidates.map(image => image.reference))]
      .filter(reference => reference.startsWith("drawing/references/") && !retained.has(reference));
    if (unused.length) await this.dependencies.files.removeReferences(unused);
    const outputs = candidates.flatMap(image => {
      const match = /^drawing\/([^/]+)\/[^/]+$/.exec(image.reference);
      return match && match[1] !== "references" ? [{ taskId: match[1] }] : [];
    });
    if (outputs.length) await this.releaseResultFiles(outputs);
  }
  private async releaseResultFiles(candidates: Array<{ taskId: string; reference?: string }>, completedOnly = true): Promise<void> {
    await this.draftWrites;
    if (this.draftFailure) throw new Error("Uncertain draft ownership");
    // Re-read durable ownership before any native cleanup. Corrupt/unknown ownership
    // is an error, never an empty inventory. No full-directory orphan scan.
    const saved = await this.dependencies.repository.load();
    validateOwnership(saved);
    if (candidates.some(result => !result.taskId || (result.reference !== undefined && !result.reference.startsWith(`drawing/${result.taskId}/`))))
      throw new Error("Damaged cleanup provenance");
    const references = [
      ...(saved.draft?.references ?? []), ...(this.state.draft.references ?? []),
      ...this.submissionReferences, ...[...this.active.values()].flatMap(active => active.references),
      ...saved.tasks.flatMap(task => task.parameters.references ?? []),
      ...saved.results.flatMap(result => result.parameters.references ?? []),
    ];
    for (const taskId of new Set(candidates.map(result => result.taskId))) {
      const prefix = `drawing/${taskId}/`;
      if (saved.tasks.some(task => task.id === taskId && (unfinished(task) || task.status === "save-failed")) || this.active.has(taskId) ||
        saved.results.some(result => result.taskId === taskId || result.reference.startsWith(prefix)) ||
        references.some(reference => reference.reference.startsWith(prefix))) continue;
      await this.dependencies.files.discardRecovery?.(taskId, completedOnly);
    }
  }
  addReferences = (files: File[]): Promise<void> => this.referenceCommand(async () => {
    const imported: DrawingReference[] = [];
    let duplicate = false;
    try {
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const descriptor = await this.dependencies.files.importReference({ mime: file.type || "image/png", data: bytesToBase64(bytes) });
        imported.push({ ...descriptor, name: file.name });
      }
      const references = [...(this.state.draft.references ?? [])];
      for (const reference of imported) {
        if (references.some(existing => existing.reference === reference.reference || existing.digest === reference.digest)) duplicate = true;
        else references.push(reference);
      }
      await this.writeReferences(references);
      if (duplicate) this.publish({ error: "重复参考图已跳过。" });
    } finally { await this.releaseReferences(imported); }
  });
  removeReference = (id: string): Promise<void> => this.referenceCommand(async () => {
    const previous = this.state.draft.references ?? [];
    await this.writeReferences(previous.filter(image => image.id !== id));
    await this.releaseReferences(previous);
  });
  clearReferences = (): Promise<void> => this.referenceCommand(async () => {
    const previous = this.state.draft.references ?? [];
    await this.writeReferences([]);
    await this.releaseReferences(previous);
  });
  moveReference = (id: string, direction: -1 | 1): Promise<void> => this.referenceCommand(async () => {
    const references = [...(this.state.draft.references ?? [])];
    const index = references.findIndex(image => image.id === id), target = index + direction;
    if (index < 0 || target < 0 || target >= references.length) return;
    [references[index], references[target]] = [references[target], references[index]];
    await this.writeReferences(references);
  });
  useAsReference = (id: string): Promise<void> => this.referenceCommand(async () => {
    const result = this.state.results.find(image => image.id === id);
    if (!result) return;
    const image = await this.dependencies.files.read(result.reference);
    const bytes = Uint8Array.from(atob(image.data), character => character.charCodeAt(0));
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    const references = this.state.draft.references ?? [];
    if (references.some(existing => existing.reference === result.reference || existing.digest === digest)) {
      this.publish({ error: "重复参考图已跳过。" }); return;
    }
    await this.writeReferences([...references, { id: result.id, reference: result.reference, mime: result.mime,
      size: result.size, width: result.width, height: result.height, digest, name: `成果 ${this.state.results.length - this.state.results.findIndex(item => item.id === id)}` }]);
  });
  readReference = (reference: string): Promise<DrawingImageInput> => this.dependencies.files.read(reference);
  readThumbnail = (reference: string): Promise<DrawingImageInput> => {
    if (!this.dependencies.files.thumbnail) return Promise.reject(new Error("Thumbnail unavailable"));
    return this.dependencies.files.thumbnail(reference);
  };
  selectResult = (id: string): void => {
    if (this.state.results.some(result => result.id === id)) this.publish({ selectedResultId: id });
  };
  reuse = (id: string): Promise<void> => this.referenceCommand(async () => {
    const result = this.state.results.find(item => item.id === id);
    if (result) await this.reuseParameters(result.parameters);
  });
  reuseTask = (id: string): Promise<void> => this.referenceCommand(async () => {
    const task = this.state.tasks.find(item => item.id === id);
    if (task) await this.reuseParameters(task.parameters);
  });
  private async reuseParameters(parameters: DrawingParameters): Promise<void> {
    const previous = this.state.draft.references ?? [];
    const references = structuredClone(parameters.references ?? []);
    const missing: number[] = [];
    for (let index = 0; index < references.length; index++) {
      try { await this.dependencies.files.read(references[index].reference); }
      catch { missing.push(index + 1); }
    }
    const target = this.settings ? getDrawingTarget(this.settings, parameters.configuredModelId) : undefined;
    const invalid = !target || target.connection.id !== parameters.connectionId ||
      target.provider.id !== parameters.providerId || target.connection.protocol !== parameters.protocol || target.model.modelId !== parameters.modelId;
    const next = { ...this.state.draft, prompt: parameters.prompt, modelId: invalid ? null : parameters.configuredModelId,
      reusedProtocol: invalid ? parameters.protocol : undefined, references,
      ...(parameters.protocol === "gemini-image" ? { aspectRatio: parameters.aspectRatio, resolution: parameters.resolution,
        gemini: structuredClone(parameters.gemini ?? {}) }
        : { openai: { size: parameters.size, quality: parameters.quality } }) };
    const priorDraft = this.state.draft;
    this.storeDraft(next);
    const reusedDraft = this.state.draft;
    await this.draftWrites;
    if (this.draftFailure) {
      // Editable text/options may have queued a newer write while this snapshot
      // was saving. Roll back only the snapshot this operation still owns.
      if (this.state.draft === reusedDraft) {
        this.storeDraft(priorDraft); await this.draftWrites;
        throw new ImageGenerationError("复用草稿保存失败，未确认本次修改；历史与文件已保留。");
      }
      await this.draftWrites;
      if (this.draftFailure) throw new ImageGenerationError("最新绘图草稿尚未保存；当前编辑与历史文件已保留，请检查本地存储。");
    }
    await this.releaseReferences(previous);
    if (invalid || missing.length) this.publish({ error: [invalid ? "原绘图模型已失效或配置已改变，请重新选择同协议模型；文本、参数与参考图记录已保留。" : "",
      missing.length ? `参考图 ${missing.join("、")} 读取失败，未完整恢复；请补充或移除缺失项。` : ""].filter(Boolean).join(" ") });
  }
  private async saveTask(task: DrawingTask): Promise<void> {
    await this.dependencies.repository.saveTask(task);
    this.publish({ tasks: [task, ...this.state.tasks.filter(item => item.id !== task.id)], hasData: true });
  }
  private managementCommand(operation: () => Promise<void>): Promise<void> {
    if (!this.state.ready || this.state.closing) return Promise.resolve();
    this.managementCount++;
    this.publish({ managementBusy: true });
    return this.referenceCommand(operation).finally(() => {
      this.managementCount--;
      this.publish({ managementBusy: this.managementCount > 0 });
    });
  }
  regenerate = (id: string): Promise<string | undefined> => {
    const pending = this.regenerations.get(id);
    if (pending) return pending;
    if (this.deleting.has(id)) return Promise.resolve(undefined);
    let replacementId: string | undefined;
    const operation = this.managementCommand(async () => {
      const source = this.state.tasks.find(task => task.id === id);
      if (!source || unfinished(source) || this.active.has(id) || this.deleting.has(id)) return;
      const existing = this.state.tasks.find(task => task.sourceTaskId === id && (unfinished(task) || this.active.has(task.id)));
      if (existing) { replacementId = existing.id; return; }
      const next: DrawingTask = { id: this.dependencies.id?.() ?? crypto.randomUUID(), sourceTaskId: id,
        batchId: crypto.randomUUID(), createdAt: this.now(), updatedAt: this.now(), status: "queued", parameters: structuredClone(source.parameters) };
      try {
        const registered = await this.dependencies.repository.enqueue([next]);
        replacementId = next.id;
        this.publish({ tasks: [...registered, ...this.state.tasks], hasData: true });
        this.cycle.add(next.id);
        this.pump();
      } catch { this.publish({ error: "重新生成任务登记失败，未发起请求。" }); }
    }).then(() => replacementId).finally(() => { this.regenerations.delete(id); });
    this.regenerations.set(id, operation);
    return operation;
  };
  /** Call only after the UI has confirmed the exact selected terminal records. */
  deleteTasks = (ids: string[]): Promise<void> => {
    if (!this.state.ready || this.state.closing) return Promise.resolve();
    const unique = [...new Set(ids)];
    if (unique.some(id => this.deleting.has(id))) return Promise.resolve();
    unique.forEach(id => this.deleting.add(id));
    return this.managementCommand(async () => {
      const tasks = this.state.tasks.filter(task => unique.includes(task.id));
      if (tasks.some(task => unfinished(task) || this.active.has(task.id))) {
        this.publish({ error: "任务仍在执行或保存，请结束后再删除历史。" }); return;
      }
      try { validateOwnership({ tasks, results: [] }); await this.dependencies.repository.removeTasks(tasks.map(task => task.id)); }
      catch { this.publish({ error: "历史删除未完成，任务与恢复内容已保留。" }); return; }
      if (tasks.some(task => this.cycle.has(task.id) && task.status !== "completed")) this.cycleHadFailure = true;
      this.publish({ tasks: this.state.tasks.filter(task => !unique.includes(task.id)) });
      for (const task of tasks) {
        this.unsaved.delete(task.id);
      }
      try { await this.releaseResultFiles(tasks.map(task => ({ taskId: task.id })), false); }
      catch { this.publish({ error: "历史已删除，但本地恢复文件清理失败；文件已保留，未删除其他成果。" }); }
      try { await this.draftWrites; await this.releaseReferences(tasks.flatMap(task => task.parameters.references ?? [])); }
      catch { this.publish({ error: "历史已删除，但无主参考图清理失败，文件已保留。" }); }
    }).finally(() => unique.forEach(id => this.deleting.delete(id)));
  };
  /** UI confirms exactly these result records; task history remains independent. */
  deleteResults = (ids: string[]): Promise<void> => this.managementCommand(async () => {
    const unique = new Set(ids);
    const results = this.state.results.filter(result => unique.has(result.id));
    // A save-failed task may still re-register its complete receipt. Keep those
    // records until local recovery settles, rather than silently resurrecting them.
    if (results.some(result => this.active.has(result.taskId) || this.state.tasks.some(task =>
      task.id === result.taskId && (unfinished(task) || task.status === "save-failed")))) {
      this.publish({ error: "成果所属任务仍在保存或等待本地恢复，请先完成恢复或删除该任务历史。" }); return;
    }
    try { await this.dependencies.repository.removeResults(results.map(result => result.id)); }
    catch { this.publish({ error: "成果删除失败，记录与文件已保留。" }); return; }
    const remaining = this.state.results.filter(result => !unique.has(result.id));
    this.publish({ results: remaining, selectedResultId: remaining.some(result => result.id === this.state.selectedResultId)
      ? this.state.selectedResultId : remaining[0]?.id ?? null, notice: `已删除 ${results.length} 项成果。` });
    try {
      validateOwnership({ tasks: [], results });
      await this.releaseResultFiles(results);
      await this.releaseReferences(results.flatMap(result => result.parameters.references ?? []));
    } catch { this.publish({ error: "成果记录已删除，但无主文件清理未完成；文件已保留，未清理仍有引用的资源。" }); }
  });
  cancelBatch = (batchId: string): void => {
    this.state.tasks.filter(task => task.batchId === batchId).forEach(task => this.cancel(task.id));
  };
  generate(settings: ConnectionSettingsState): Promise<void> {
    if (!this.state.ready || this.state.submitting || this.state.referencesBusy || this.state.closing) return Promise.resolve();
    this.settings = settings;
    const target = getDrawingTarget(settings, this.state.draft.modelId);
    if (!target) { this.publish({ error: "请先选择有效的绘图模型。" }); return Promise.resolve(); }
    const draft = this.state.draft;
    const parameters: DrawingParameters = {
      prompt: draft.prompt.trim(),
      providerId: target.provider.id, connectionId: target.connection.id, configuredModelId: target.model.id,
      modelId: target.model.modelId, modelName: target.model.displayName || target.model.modelId,
      baseUrl: target.connection.baseUrl,
      ...(draft.references?.length ? { references: draft.references.map(reference => ({ ...reference })) } : {}),
      ...(target.connection.protocol === "gemini-image"
        ? { protocol: "gemini-image" as const, aspectRatio: draft.aspectRatio, resolution: draft.resolution,
          ...(draft.gemini ? { gemini: structuredClone(draft.gemini) } : {}) }
        : { protocol: "openai-images" as const, size: draft.openai?.size ?? "auto", quality: draft.openai?.quality ?? "auto" }),
    };
    try {
      if (!Number.isInteger(draft.count ?? 1) || (draft.count ?? 1) < 1 || (draft.count ?? 1) > 99)
        throw new ImageGenerationError("每批数量须为 1–99 的整数。");
      if (parameters.protocol === "gemini-image") validateDrawingParameters(parameters);
      else validateOpenAIImagesParameters(parameters);
      if (!target.connection.apiKey.trim() || /[\u0000-\u001f\u007f]/.test(target.connection.apiKey)) throw new ImageGenerationError("请先在设置中填写有效的绘图 API Key。");
    } catch (error) { this.publish({ error: error instanceof ImageGenerationError ? error.message
      : "请检查绘图连接；需要有效的 HTTPS 地址、模型与 API Key。" }); return Promise.resolve(); }
    const batchId = crypto.randomUUID();
    const tasks: DrawingTask[] = Array.from({ length: draft.count ?? 1 }, () => ({
      id: this.dependencies.id?.() ?? crypto.randomUUID(), batchId, createdAt: this.now(), updatedAt: this.now(),
      status: "queued", parameters: structuredClone(parameters),
    }));
    this.submissionCancelled = false;
    this.publish({ submitting: true, error: null });
    // Pin inputs while the atomic registration waits for the draft write.
    this.submissionReferences = parameters.references ?? [];
    this.submission = (async () => {
      try {
        await this.flush();
        const registered = await this.dependencies.repository.enqueue(tasks);
        this.publish({ tasks: [...registered, ...this.state.tasks], hasData: true });
        registered.forEach(task => this.cycle.add(task.id));
        if (this.submissionCancelled) {
          try { for (const task of registered)
            await this.saveTask({ ...task, status: "cancelled", updatedAt: this.now(), finishedAt: this.now() });
          } catch { this.pause(); this.publish({ error: "整批已登记，但取消状态保存失败；队列已暂停，请检查后再继续。" }); }
        }
      } catch { this.publish({ error: "整批任务登记失败，未发起本批生成请求。" }); }
      finally {
        this.submissionReferences = [];
        this.publish({ submitting: false });
        this.pump();
      }
    })();
    // Keep the original imperative API useful to callers awaiting a small batch.
    return this.submission.then(async () => {
      while (this.operations.size && !this.state.paused) await Promise.all([...this.operations]);
    });
  }
  updateSettings = (settings: ConnectionSettingsState): void => { this.settings = settings; this.pump(); };
  pause = (): void => { if (!this.state.closing) this.publish({ paused: true }); };
  resume = (): void => {
    if (!this.state.ready || this.state.closing) return;
    const pending = this.state.tasks.filter(unfinished);
    const batches = new Set(pending.map(task => task.batchId).filter(Boolean));
    // A resumed batch with an unknown/failed sibling must not sound like all-success.
    this.state.tasks.filter(task => unfinished(task) || (task.batchId && batches.has(task.batchId)))
      .forEach(task => this.cycle.add(task.id));
    this.publish({ paused: false }); this.pump();
  };
  private pump(): void {
    if (!this.state.ready || this.state.submitting || this.state.closing || this.state.paused || !this.settings) return;
    const concurrency = Math.min(4, Math.max(1, Math.trunc(this.state.draft.concurrency ?? 1) || 1));
    const queued = this.state.tasks.filter(task => task.status === "queued" && !this.active.has(task.id))
      .sort((a, b) => (a.queueOrder ?? 0) - (b.queueOrder ?? 0));
    while (queued.length && this.active.size < concurrency) {
      const task = queued.shift()!;
      const active: ActiveDrawing = { controller: new AbortController(), sent: false, saving: false, references: task.parameters.references ?? [] };
      this.active.set(task.id, active);
      this.publish({ busy: true });
      const operation = this.run(task, active);
      this.operations.add(operation);
      void operation.finally(() => { this.operations.delete(operation); this.pump(); this.finishCycle(); });
    }
    this.finishCycle();
  }
  private finishCycle(): void {
    if (!this.cycle.size || this.state.submitting || this.operations.size || this.state.tasks.some(unfinished)) return;
    const allSucceeded = !this.cycleHadFailure && this.state.tasks.filter(task => this.cycle.has(task.id)).every(task => task.status === "completed");
    this.cycle.clear();
    this.cycleHadFailure = false;
    this.publish({ completion: { sequence: this.state.completion.sequence + 1, allSucceeded } });
  }
  private async run(initial: DrawingTask, active: ActiveDrawing): Promise<void> {
    let task: DrawingTask = { ...initial, status: "preparing", startedAt: this.now(), updatedAt: this.now(), finishedAt: undefined };
    const parameters = task.parameters;
    try {
      await this.saveTask(task);
      const target = this.settings && getDrawingTarget(this.settings, parameters.configuredModelId);
      if (!target || target.provider.id !== parameters.providerId || target.connection.id !== parameters.connectionId ||
        target.connection.protocol !== parameters.protocol || target.connection.baseUrl !== parameters.baseUrl || target.model.modelId !== parameters.modelId)
        throw new ImageGenerationError("排队时的连接或模型已失效或目标已改变，已阻止请求。请检查设置后明确重新提交。");
      const key = target.connection.apiKey;
      if (!key.trim() || /[\u0000-\u001f\u007f]/.test(key)) throw new ImageGenerationError("绘图 API Key 无效，未发起请求。");
      const transport = await this.dependencies.transport();
      const references: DrawingImageInput[] = [];
      for (const reference of active.references) {
        if (active.controller.signal.aborted) throw new ImageGenerationError("请求尚未发出，已取消。");
        try { references.push(await this.dependencies.files.read(reference.reference)); }
        catch { throw new ImageGenerationError("参考图读取失败，未发起生成请求；请检查或移除不可用图片。"); }
      }
      // Persist possible-send intent before touching the network. A crash here is conservatively unknown.
      task = { ...task, status: "dispatching", updatedAt: this.now() };
      await this.saveTask(task);
      if (active.controller.signal.aborted) throw new ImageGenerationError("请求尚未发出，已取消。");
      active.sent = true;
      task = { ...task, status: "running" };
      // The durable dispatching marker already covers a crash; running is a UI stage.
      this.publish({ tasks: [task, ...this.state.tasks.filter(item => item.id !== task.id)] });
      const images = await awaitImages(references.length ? transport.generate(parameters, key, active.controller.signal, references)
        : transport.generate(parameters, key, active.controller.signal), active.controller.signal);
      if (active.controller.signal.aborted) throw new ImageGenerationError("请求已停止，服务端结果未知。", "unknown");
      active.saving = true;
      this.unsaved.set(task.id, images);
      task = { ...task, status: "saving", updatedAt: this.now(), recovery: { total: images.length, durable: [], memory: images.map((_, index) => index), lost: [] } };
      this.publish({ tasks: [task, ...this.state.tasks.filter(item => item.id !== task.id)] });
      // A DB fault must not prevent durable receipt of already returned pixels.
      try { await this.saveTask(task); } catch { /* dispatching remains conservative on restart */ }
      await this.commitImages(task, images);
    } catch (error) {
        const status = active.saving ? "save-failed" : active.controller.signal.aborted ? active.sent ? "unknown" : "cancelled"
          : error instanceof ImageGenerationError ? error.outcome : active.sent ? "unknown" : "failed";
        task = { ...task, status, updatedAt: this.now(), finishedAt: this.now(),
          recovery: active.saving ? await this.inspectRecovery(task) : undefined,
          diagnostic: { category: active.saving ? "local-file" : active.controller.signal.aborted ? "cancelled"
            : error instanceof ImageGenerationError ? error.category ?? (error.outcome === "unknown" ? "network-unknown" : active.sent ? "invalid-response" : "configuration") : active.sent ? "network-unknown" : "local-state",
            ...(error instanceof ImageGenerationError && error.httpStatus ? { httpStatus: error.httpStatus } : {}) },
          error: active.saving ? "图片已返回，但本地保存未完成。可重试保存；不会重新请求服务。若暂存也失败，图片仅在内存，退出后可能丢失。"
          : error instanceof ImageGenerationError ? error.message : active.sent ? "请求结果未知；不会自动重发。" : "本地任务登记失败，未发起生成请求。" };
        this.publish({ error: task.error ?? null });
        try { await this.saveTask(task); }
        catch { this.publish({ tasks: [task, ...this.state.tasks.filter(item => item.id !== task.id)], error: "任务状态保存失败；重启后会按已有记录保守恢复。" }); }
    } finally {
      this.active.delete(task.id);
      // Preparation can fail after the draft releases its input; registered tasks retain it.
      try { await this.referenceOperations; await this.draftWrites; await this.releaseReferences(active.references); }
      catch { this.publish({ error: "无主参考图临时文件清理失败，文件已保留。" }); }
      this.publish({ busy: this.active.size > 0 });
    }
  }
  private async commitImages(task: DrawingTask, images: (DrawingImageInput | null)[] | null): Promise<void> {
    let files = await this.dependencies.files.recover(task.id);
    if (!files && images) {
      if (images.every((image): image is DrawingImageInput => image !== null)) files = await this.dependencies.files.save(task.id, images);
      else if (this.dependencies.files.resumeRecovery) files = await this.dependencies.files.resumeRecovery(task.id,
        images.flatMap((image, index) => image ? [{ index, image }] : []));
    }
    if (!files?.length) throw new Error("No local images");
    // Native files are durable now; DB failure no longer needs a full response in memory.
    this.unsaved.delete(task.id);
    const completed: DrawingTask = { ...task, status: "completed", updatedAt: this.now(), finishedAt: this.now(), error: undefined, recovery: undefined, diagnostic: undefined };
    const results = files.map(file => ({ ...file, taskId: task.id, createdAt: task.createdAt, parameters: task.parameters }));
    await this.dependencies.repository.complete(completed, results);
    this.unsaved.delete(task.id);
    this.publish({ tasks: [completed, ...this.state.tasks.filter(item => item.id !== task.id)],
      results: [...results, ...this.state.results.filter(item => item.taskId !== task.id)], selectedResultId: results[0].id });
  }
  private async inspectRecovery(task: DrawingTask): Promise<DrawingRecovery> {
    const images = this.unsaved.get(task.id);
    let total = images?.length ?? task.recovery?.total ?? 0;
    try {
      if (!this.dependencies.files.inspectRecovery) throw new Error("Recovery inventory unavailable");
      const inventory = await this.dependencies.files.inspectRecovery(task.id);
      total = Math.max(total, inventory.total);
      const durable = inventory.durable;
      if (total > 0 && durable.length === total) this.unsaved.delete(task.id);
      else if (images && this.dependencies.files.resumeRecovery) this.unsaved.set(task.id, images.map((image, i) => durable.includes(i) ? null : image));
      const memory = images ? Array.from({ length: total }, (_, i) => i).filter(i => !durable.includes(i) && !!images[i]) : [];
      return { total, durable, memory, lost: Array.from({ length: total }, (_, i) => i).filter(i => !durable.includes(i) && !memory.includes(i)) };
    } catch {
      return { total, durable: [], memory: images?.flatMap((image, i) => image ? [i] : []) ?? [], lost: [], unverified: true };
    }
  }
  retrySave(id: string): Promise<void> {
    const task = this.state.tasks.find(item => item.id === id);
    if (!this.state.ready || this.state.busy || this.state.closing || this.deleting.has(id) || task?.status !== "save-failed") return Promise.resolve();
    this.publish({ busy: true, error: null });
    this.active.set(id, { controller: new AbortController(), sent: false, saving: true, references: task.parameters.references ?? [] });
    const operation = (async () => {
      try {
        const saving: DrawingTask = { ...task, status: "saving", updatedAt: this.now(), error: undefined };
        await this.saveTask(saving);
        await this.commitImages(saving, this.unsaved.get(id) ?? null);
      } catch {
        const failed: DrawingTask = { ...task, status: "save-failed", updatedAt: this.now(), recovery: await this.inspectRecovery(task), diagnostic: { category: "local-file" }, error: "本地保存仍未完成；原始响应丢失时无法恢复，未重新请求服务。" };
        this.publish({ error: failed.error ?? null });
        try { await this.saveTask(failed); } catch {
          this.publish({ tasks: [failed, ...this.state.tasks.filter(item => item.id !== id)], error: "任务状态保存失败，请重启后检查。" });
        }
      } finally { this.active.delete(id); this.publish({ busy: this.active.size > 0 }); }
    })();
    this.operations.add(operation);
    void operation.finally(() => { this.operations.delete(operation); this.pump(); });
    return operation;
  }
  cancel = (id?: string): void => {
    if (this.state.closing) return;
    if (!id && this.state.submitting) this.submissionCancelled = true;
    for (const [taskId, active] of this.active) if ((!id || id === taskId) && !active.saving) active.controller.abort();
    for (const task of this.state.tasks.filter(task => (!id || task.id === id) && task.status === "queued" && !this.active.has(task.id))) {
        const id = task.id;
        // Reserve synchronously so a concurrent pump cannot dispatch this item.
        const active: ActiveDrawing = { controller: new AbortController(), sent: false, saving: false, references: task.parameters.references ?? [] };
        this.active.set(id, active);
        const operation = this.saveTask({ ...task, status: "cancelled", updatedAt: this.now(), finishedAt: this.now() })
          .catch(() => { this.pause(); this.publish({ error: "取消状态保存失败，队列已暂停。" }); })
          .finally(() => { this.active.delete(id); this.operations.delete(operation); this.pump(); this.finishCycle(); });
        this.operations.add(operation);
    }
  };
  hasUnsavedImages(): boolean { return this.unsaved.size > 0; }
  private maintenancePaused?: boolean;
  /** Synchronous command fence; queued work stays queued and no request is aborted. */
  async prepareMaintenance(): Promise<void> {
    if (!this.state.ready || this.state.closing || this.active.size) throw new Error("请等待绘图请求和本地保存结束，或先在任务页明确取消请求。");
    this.maintenancePaused = this.state.paused;
    this.publish({ closing: true, paused: true });
    try {
      await this.submission;
      await Promise.all([...this.operations]);
      await this.flush();
      if (this.hasUnsavedImages()) throw new Error("仍有只保存在内存的绘图图片，请先重试本地保存；进入备份会重新加载工作区。");
    } catch (error) { this.cancelMaintenance(); throw error; }
  }
  cancelMaintenance = (): void => {
    if (this.maintenancePaused === undefined) return;
    const paused = this.maintenancePaused; this.maintenancePaused = undefined;
    this.publish({ closing: false, paused }); this.pump();
  };
  async settleForClose(): Promise<void> {
    this.publish({ closing: true, paused: true });
    // In-flight submission remains queued; closing never discards it.
    for (const active of this.active.values()) if (!active.saving) active.controller.abort();
    await this.submission;
    await Promise.all([...this.operations]); await this.flush();
    if (this.hasUnsavedImages()) throw new UnsavedDrawingImagesError("有已返回但未保存的图片，退出会丢失原始响应。");
  }
  cancelClose = (): void => { this.publish({ closing: false }); };
  /** Only after explicit user confirmation of losing unpersisted pixels. */
  async discardUnsavedForClose(): Promise<void> { await this.flush(); this.unsaved.clear(); }
  copyPrompt = async (id: string): Promise<void> => {
    if (!this.state.ready || this.state.closing) return;
    const result = this.state.results.find(item => item.id === id);
    if (!result) return;
    await this.copyPromptText(result.parameters.prompt);
  };
  copyTaskPrompt = async (id: string): Promise<void> => {
    if (!this.state.ready || this.state.closing) return;
    const task = this.state.tasks.find(item => item.id === id);
    if (task) await this.copyPromptText(task.parameters.prompt);
  };
  private async copyPromptText(prompt: string): Promise<void> {
    try { await navigator.clipboard.writeText(prompt); this.publish({ notice: "提示词已复制。", error: null }); }
    catch { this.publish({ error: "提示词复制失败，请检查剪贴板权限。" }); }
  }
  export = (id: string): Promise<void> => this.exportResults([id], false);
  exportResults = (ids: string[], withParameters: boolean): Promise<void> => this.managementCommand(async () => {
    const selected = [...new Set(ids)].map(id => this.state.results.find(result => result.id === id)).filter((result): result is DrawingResult => !!result);
    let succeeded = 0, cancelled = false;
    const failed: number[] = [];
    for (let index = 0; index < selected.length; index++) {
      try {
        const result = selected[index];
        const exported = withParameters
          ? await this.dependencies.files.export(result.reference, drawingExportParameters(result.parameters))
          : await this.dependencies.files.export(result.reference);
        if (!exported) { cancelled = true; break; }
        succeeded++;
      } catch { failed.push(index + 1); }
    }
    this.publish({ notice: `已导出 ${succeeded}／${selected.length} 项${cancelled ? "；已取消，后续项未导出" : ""}。`,
      error: failed.length ? `所选第 ${failed.join("、")} 项导出失败，请检查成果文件和目标位置；已成功项保留。` : null });
  });
}
