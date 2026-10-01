import type { ConnectionSettingsState } from "../chat/settings";
import { getDrawingTarget } from "../chat/settings";
import { ImageGenerationError, validateDrawingParameters } from "./geminiImage";
import { validateOpenAIImagesParameters } from "./openaiImages";
import { bytesToBase64 } from "../chat/attachments";
import type { DrawingRepository } from "./repository";
import { initialDrawingDraft, type DrawingDraft, type DrawingTask, type DrawingResult, type DrawingFiles,
  type DrawingImageInput, type ImageGenerationTransport, type DrawingParameters, type DrawingReference } from "./types";

export interface DrawingState {
  draft: DrawingDraft;
  tasks: DrawingTask[];
  results: DrawingResult[];
  selectedResultId: string | null;
  ready: boolean;
  busy: boolean;
  referencesBusy: boolean;
  closing: boolean;
  error: string | null;
  hasData: boolean;
}
interface DrawingDependencies {
  repository: DrawingRepository;
  files: DrawingFiles;
  transport(): Promise<ImageGenerationTransport>;
  now?(): string;
  id?(): string;
}

export class UnsavedDrawingImagesError extends Error {}

/** One application-owned task. Page unmounts never own or cancel its request. */
export class DrawingController {
  private state: DrawingState = { draft: initialDrawingDraft, tasks: [], results: [], selectedResultId: null,
    ready: false, busy: false, referencesBusy: false, closing: false, error: null, hasData: false };
  private listeners = new Set<() => void>();
  private initialization?: Promise<void>;
  private draftWrites: Promise<void> = Promise.resolve();
  private draftFailure = false;
  private active?: { controller: AbortController; sent: boolean; saving: boolean; references: DrawingReference[] };
  private referenceOperations: Promise<void> = Promise.resolve();
  private pendingReferenceOperations = 0;
  private operation?: Promise<void>;
  private unsaved = new Map<string, DrawingImageInput[]>();
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
      const saved = await this.dependencies.repository.load();
      let tasks = saved.tasks, results = saved.results;
      // A native manifest proves completed local persistence, never server acceptance.
      for (const task of tasks) {
        if (!["running", "saving", "save-failed"].includes(task.status)) continue;
        let files;
        try { files = await this.dependencies.files.recover(task.id); }
        catch {
          const damaged: DrawingTask = { ...task, status: "save-failed", updatedAt: this.now(), error: "上次成果文件读取失败，已保留任务与文件；未重新请求服务。" };
          await this.dependencies.repository.saveTask(damaged);
          tasks = tasks.map(item => item.id === task.id ? damaged : item);
          continue;
        }
        const updated: DrawingTask = { ...task, updatedAt: this.now(), status: files ? "completed" : task.status === "running" ? "unknown" : "save-failed",
          error: files ? undefined : task.status === "running" ? "上次请求可能已发出，结果未知；不会自动重发。" : "上次图片未完成本地保存；若原始响应已丢失，无法重新保存。" };
        if (files) {
          const recovered = files.map(file => ({ ...file, taskId: task.id, createdAt: task.createdAt, parameters: task.parameters }));
          await this.dependencies.repository.complete(updated, recovered);
          results = [...results.filter(result => result.taskId !== task.id), ...recovered];
        } else await this.dependencies.repository.saveTask(updated);
        tasks = tasks.map(item => item.id === task.id ? updated : item);
      }
      tasks = [...tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      results = [...results].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      this.publish({ draft: saved.draft ?? { ...initialDrawingDraft }, tasks, results,
        selectedResultId: results[0]?.id ?? null, ready: true, error: tasks[0]?.error ?? null,
        hasData: !!saved.draft || tasks.length > 0 || results.length > 0 });
    } catch { this.publish({ error: "绘图数据读取或恢复失败。请重启应用后重试；当前禁止生成，以免覆盖已有数据。", ready: false }); }
  }
  setDraft = (draft: DrawingDraft): void => {
    if (!this.state.ready || this.state.closing) return;
    this.storeDraft(draft);
  };
  private storeDraft(draft: DrawingDraft): void {
    const next = { id: "current" as const, prompt: draft.prompt, aspectRatio: draft.aspectRatio, resolution: draft.resolution, modelId: draft.modelId,
      ...(draft.openai ? { openai: { size: draft.openai.size, quality: draft.openai.quality } } : {}),
      ...(draft.references ? { references: draft.references.map(reference => ({ ...reference })) } : {}) };
    this.publish({ draft: next, hasData: true });
    this.draftWrites = this.draftWrites.then(async () => {
      try { await this.dependencies.repository.saveDraft(next); this.draftFailure = false; }
      catch { this.draftFailure = true; this.publish({ error: "绘图草稿保存失败，请检查本地存储空间。" }); }
    });
  }
  async flush(): Promise<void> {
    await this.referenceOperations;
    await this.draftWrites;
    if (this.draftFailure) throw new Error("绘图草稿尚未保存，暂时不能退出。");
  }
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
    if (this.draftFailure) return;
    const retained = new Set([
      ...(this.state.draft.references ?? []), ...(this.active?.references ?? []),
      ...this.state.tasks.flatMap(task => task.parameters.references ?? []),
      ...this.state.results.flatMap(result => result.parameters.references ?? []),
    ].map(image => image.reference));
    const unused = [...new Set(candidates.map(image => image.reference))]
      .filter(reference => reference.startsWith("drawing/references/") && !retained.has(reference));
    if (unused.length) await this.dependencies.files.removeReferences(unused);
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
  selectResult = (id: string): void => {
    if (this.state.results.some(result => result.id === id)) this.publish({ selectedResultId: id });
  };
  reuse = (id: string): void => {
    const result = this.state.results.find(item => item.id === id);
    if (!result) return;
    const parameters = result.parameters;
    this.setDraft({ ...this.state.draft, prompt: parameters.prompt, modelId: parameters.configuredModelId,
      ...(parameters.protocol === "gemini-image" ? { aspectRatio: parameters.aspectRatio, resolution: parameters.resolution }
        : { openai: { size: parameters.size, quality: parameters.quality } }) });
  };
  private async saveTask(task: DrawingTask): Promise<void> {
    await this.dependencies.repository.saveTask(task);
    this.publish({ tasks: [task, ...this.state.tasks.filter(item => item.id !== task.id)], hasData: true });
  }
  generate(settings: ConnectionSettingsState): Promise<void> {
    if (!this.state.ready || this.state.busy || this.state.referencesBusy || this.state.closing) return Promise.resolve();
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
        ? { protocol: "gemini-image" as const, aspectRatio: draft.aspectRatio, resolution: draft.resolution }
        : { protocol: "openai-images" as const, size: draft.openai?.size ?? "auto", quality: draft.openai?.quality ?? "auto" }),
    };
    try {
      if (parameters.protocol === "gemini-image") validateDrawingParameters(parameters);
      else validateOpenAIImagesParameters(parameters);
      if (!target.connection.apiKey.trim() || /[\u0000-\u001f\u007f]/.test(target.connection.apiKey)) throw new ImageGenerationError("请先在设置中填写有效的绘图 API Key。");
    } catch (error) { this.publish({ error: error instanceof ImageGenerationError ? error.message
      : "请检查绘图连接；需要有效的 HTTPS 地址、模型与 API Key。" }); return Promise.resolve(); }
    // Freeze credentials only in the running closure. Persisted tasks contain none.
    const key = target.connection.apiKey;
    const active = { controller: new AbortController(), sent: false, saving: false, references: parameters.references ?? [] };
    this.active = active;
    this.publish({ busy: true, error: null });
    this.operation = this.run(parameters, key, active);
    return this.operation;
  }
  private async run(parameters: DrawingParameters, key: string, active: NonNullable<DrawingController["active"]>): Promise<void> {
    let task: DrawingTask = { id: this.dependencies.id?.() ?? crypto.randomUUID(), createdAt: this.now(), updatedAt: this.now(), status: "running", parameters };
    let registered = false;
    try {
      await this.flush();
      const transport = await this.dependencies.transport();
      const references: DrawingImageInput[] = [];
      for (const reference of active.references) {
        if (active.controller.signal.aborted) throw new ImageGenerationError("请求尚未发出，已取消。");
        try { references.push(await this.dependencies.files.read(reference.reference)); }
        catch { throw new ImageGenerationError("参考图读取失败，未发起生成请求；请检查或移除不可用图片。"); }
      }
      await this.saveTask(task); registered = true;
      if (active.controller.signal.aborted) throw new ImageGenerationError("请求尚未发出，已取消。");
      active.sent = true;
      const images = references.length ? await transport.generate(parameters, key, active.controller.signal, references)
        : await transport.generate(parameters, key, active.controller.signal);
      if (active.controller.signal.aborted) throw new ImageGenerationError("请求已停止，服务端结果未知。", "unknown");
      active.saving = true;
      this.unsaved.set(task.id, images);
      task = { ...task, status: "saving", updatedAt: this.now() };
      await this.saveTask(task);
      await this.commitImages(task, images);
    } catch (error) {
      if (registered) {
        const status = active.saving ? "save-failed" : active.controller.signal.aborted ? active.sent ? "unknown" : "cancelled"
          : error instanceof ImageGenerationError ? error.outcome : active.sent ? "unknown" : "failed";
        task = { ...task, status, updatedAt: this.now(), error: active.saving ? "图片已返回，但本地保存未完成。可重试保存；不会重新请求服务。"
          : error instanceof ImageGenerationError ? error.message : active.sent ? "请求结果未知；不会自动重发。" : "本地任务登记失败，未发起生成请求。" };
        this.publish({ error: task.error ?? null });
        try { await this.saveTask(task); }
        catch { this.publish({ tasks: [task, ...this.state.tasks.filter(item => item.id !== task.id)], error: "任务状态保存失败；重启后会按已有记录保守恢复。" }); }
      } else this.publish({ error: error instanceof ImageGenerationError ? error.message : "绘图初始化或任务登记失败，未发起生成请求。" });
    } finally {
      this.active = undefined;
      // Preparation can fail after the draft releases its input; registered tasks retain it.
      try { await this.referenceOperations; await this.draftWrites; await this.releaseReferences(active.references); }
      catch { this.publish({ error: "无主参考图临时文件清理失败，文件已保留。" }); }
      this.publish({ busy: false });
    }
  }
  private async commitImages(task: DrawingTask, images: DrawingImageInput[] | null): Promise<void> {
    const files = await this.dependencies.files.recover(task.id) ?? (images ? await this.dependencies.files.save(task.id, images) : null);
    if (!files?.length) throw new Error("No local images");
    const completed: DrawingTask = { ...task, status: "completed", updatedAt: this.now(), error: undefined };
    const results = files.map(file => ({ ...file, taskId: task.id, createdAt: task.createdAt, parameters: task.parameters }));
    await this.dependencies.repository.complete(completed, results);
    this.unsaved.delete(task.id);
    this.publish({ tasks: [completed, ...this.state.tasks.filter(item => item.id !== task.id)],
      results: [...results, ...this.state.results.filter(item => item.taskId !== task.id)], selectedResultId: results[0].id });
  }
  retrySave(id: string): Promise<void> {
    const task = this.state.tasks.find(item => item.id === id);
    if (!this.state.ready || this.state.busy || this.state.closing || task?.status !== "save-failed") return Promise.resolve();
    this.publish({ busy: true, error: null });
    this.operation = (async () => {
      try {
        const saving: DrawingTask = { ...task, status: "saving", updatedAt: this.now(), error: undefined };
        await this.saveTask(saving);
        await this.commitImages(saving, this.unsaved.get(id) ?? null);
      } catch {
        const failed: DrawingTask = { ...task, status: "save-failed", updatedAt: this.now(), error: "本地保存仍未完成；原始响应丢失时无法恢复，未重新请求服务。" };
        this.publish({ error: failed.error ?? null });
        try { await this.saveTask(failed); } catch { this.publish({ error: "任务状态保存失败，请重启后检查。" }); }
      } finally { this.publish({ busy: false }); }
    })();
    return this.operation;
  }
  cancel = (): void => { if (this.active && !this.active.saving) this.active.controller.abort(); };
  hasUnsavedImages(): boolean { return this.unsaved.size > 0; }
  async settleForClose(): Promise<void> {
    this.publish({ closing: true });
    this.cancel(); await this.operation; await this.flush();
    if (this.hasUnsavedImages()) throw new UnsavedDrawingImagesError("有已返回但未保存的图片，退出会丢失原始响应。");
  }
  cancelClose = (): void => { this.publish({ closing: false }); };
  /** Only after explicit user confirmation of losing unpersisted pixels. */
  async discardUnsavedForClose(): Promise<void> { await this.flush(); this.unsaved.clear(); }
  async export(id: string): Promise<void> {
    if (this.state.closing) return;
    const result = this.state.results.find(item => item.id === id);
    if (!result) return;
    try { await this.dependencies.files.export(result.reference); }
    catch { this.publish({ error: "图片导出失败，请检查成果文件和目标位置后重试。" }); }
  }
}
