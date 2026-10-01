import { describe, expect, it, vi } from "vitest";
import type { ConnectionSettingsState } from "../chat/settings";
import { DrawingController } from "./controller";
import type { DrawingPresetRepository, DrawingPromptPreset } from "./presets";
import type { DrawingRepository, DrawingSnapshot } from "./repository";
import type { DrawingFiles, DrawingImageInput, DrawingParameters, DrawingTask, ImageGenerationTransport } from "./types";

const images: DrawingImageInput[] = [{ mime: "image/png", data: "AQID" }];
const file = { id: "file-1", reference: "drawing/task-1/file.png", mime: "image/png", size: 3, width: 1, height: 1 };
const settings: ConnectionSettingsState = {
  version: 3, activeModelId: null, providers: [{ id: "p", name: "synthetic", connections: [{
    id: "image", name: "drawing", protocol: "gemini-image", baseUrl: "https://example.test", apiKey: "synthetic-secret",
    models: [{ id: "image-model", modelId: "test-image" }],
  }] }],
};
const parameters: DrawingParameters = {
  protocol: "gemini-image", prompt: "synthetic prompt", aspectRatio: "1:1", resolution: "2K",
  providerId: "p", connectionId: "image", configuredModelId: "image-model", modelId: "test-image",
  modelName: "test-image", baseUrl: "https://example.test",
};
const queued: DrawingTask = {
  id: "queued", batchId: "batch", queueOrder: 1, createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z", status: "queued", parameters,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
function fixture(snapshot: DrawingSnapshot = { tasks: [], results: [] }) {
  const saved = structuredClone(snapshot);
  let presets: DrawingPromptPreset[] = [];
  const repository: DrawingRepository = {
    load: vi.fn(async () => structuredClone(saved)),
    saveDraft: vi.fn(async draft => { saved.draft = structuredClone(draft); }),
    saveTask: vi.fn(async task => { saved.tasks = [structuredClone(task), ...saved.tasks.filter(item => item.id !== task.id)]; }),
    enqueue: vi.fn(async (tasks: DrawingTask[]) => {
      const registered = tasks.map((task, index) => ({ ...structuredClone(task), queueOrder: index + 1 }));
      saved.tasks = [...registered, ...saved.tasks]; return structuredClone(registered);
    }),
    complete: vi.fn(async (task, results) => {
      saved.tasks = [structuredClone(task), ...saved.tasks.filter(item => item.id !== task.id)];
      saved.results = [...structuredClone(results), ...saved.results.filter(item => item.taskId !== task.id)];
    }),
    removeTasks: vi.fn(async ids => { saved.tasks = saved.tasks.filter(task => !ids.includes(task.id)); }),
    removeResults: vi.fn(async ids => { saved.results = saved.results.filter(result => !ids.includes(result.id)); }),
  };
  const presetRepository: DrawingPresetRepository = {
    load: vi.fn(async () => structuredClone(presets)),
    create: vi.fn(async input => {
      const preset = { ...input, id: "preset", createdAt: queued.createdAt, updatedAt: queued.updatedAt };
      presets = [...presets, preset]; return preset;
    }),
    update: vi.fn(async (id, input) => {
      const preset = { ...input, id, createdAt: queued.createdAt, updatedAt: queued.updatedAt };
      presets = presets.map(item => item.id === id ? preset : item); return preset;
    }),
    remove: vi.fn(async id => { presets = presets.filter(item => item.id !== id); }),
  };
  const files: DrawingFiles = {
    save: vi.fn(async () => [file]), recover: vi.fn(async () => null),
    importReference: vi.fn(async image => ({ ...file, id: "ref", reference: "drawing/references/ref.png", digest: image.data })),
    removeReferences: vi.fn(async () => undefined), discardRecovery: vi.fn(async () => undefined),
    read: vi.fn(async () => images[0]), export: vi.fn(async () => true),
  };
  const transport: ImageGenerationTransport = { generate: vi.fn(async () => images) };
  let sequence = 0;
  const controller = new DrawingController({ repository, presetRepository, files, transport: vi.fn(async () => transport),
    id: () => `task-${++sequence}`, now: () => queued.createdAt });
  const discard = vi.spyOn(controller, "discardUnsavedForClose");
  const close = vi.spyOn(controller, "settleForClose");
  return { controller, repository, presetRepository, files, transport, saved, discard, close };
}
async function prepare(f: ReturnType<typeof fixture>) {
  await f.controller.initialize();
  f.controller.setDraft({ ...f.controller.getSnapshot().draft, modelId: "image-model", prompt: "synthetic prompt", aspectRatio: "1:1", resolution: "2K" });
  await f.controller.flush();
}
function expectNoMaintenanceCleanup(f: ReturnType<typeof fixture>) {
  expect(f.discard).not.toHaveBeenCalled();
  expect(f.close).not.toHaveBeenCalled();
  expect(f.files.discardRecovery).not.toHaveBeenCalled();
  expect(f.files.removeReferences).not.toHaveBeenCalled();
}

describe("drawing maintenance preparation", () => {
  it("fences commands synchronously, waits for the accepted draft write and stays locked until cancellation", async () => {
    const f = fixture(); await prepare(f);
    const saving = deferred<void>();
    const originalSave = vi.mocked(f.repository.saveDraft).getMockImplementation()!;
    vi.mocked(f.repository.saveDraft).mockImplementationOnce(async draft => { await saving.promise; await originalSave(draft); });
    f.controller.setDraft({ ...f.controller.getSnapshot().draft, prompt: "accepted pending edit" });
    let settled = false;
    const maintenance = f.controller.prepareMaintenance().then(() => { settled = true; });
    expect(f.controller.getSnapshot()).toMatchObject({ closing: true, paused: true });
    f.controller.setDraft({ ...f.controller.getSnapshot().draft, prompt: "blocked edit" });
    await f.controller.createPreset({ name: "blocked", content: "blocked" });
    await f.controller.addReferences([new File(["synthetic"], "blocked.png")]);
    await f.controller.generate(settings);
    f.controller.resume();
    expect(f.controller.getSnapshot().draft.prompt).toBe("accepted pending edit");
    expect(f.controller.getSnapshot().paused).toBe(true);
    expect(f.presetRepository.create).not.toHaveBeenCalled();
    expect(f.files.importReference).not.toHaveBeenCalled();
    expect(f.repository.enqueue).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(f.repository.saveDraft).toHaveBeenCalledTimes(2));
    expect(settled).toBe(false);
    saving.resolve(); await maintenance;
    expect(f.saved.draft?.prompt).toBe("accepted pending edit");
    expect(f.controller.getSnapshot()).toMatchObject({ closing: true, paused: true });
    f.controller.setDraft({ ...f.controller.getSnapshot().draft, prompt: "still blocked" });
    expect(f.controller.getSnapshot().draft.prompt).toBe("accepted pending edit");
    expectNoMaintenanceCleanup(f);
    f.controller.cancelMaintenance();
    expect(f.controller.getSnapshot()).toMatchObject({ closing: false, paused: false });
    f.controller.setDraft({ ...f.controller.getSnapshot().draft, prompt: "after cancel" });
    await f.controller.flush(); expect(f.saved.draft?.prompt).toBe("after cancel");
  });

  it("preserves queued jobs and refuses cancellation while maintenance holds the command gate", async () => {
    const f = fixture({ tasks: [queued], results: [] }); await prepare(f);
    f.controller.updateSettings(settings);
    const before = structuredClone(f.saved.tasks);
    await f.controller.prepareMaintenance();
    f.controller.resume();
    f.controller.cancel("queued");
    f.controller.cancelBatch("batch");
    await f.controller.generate(settings);
    await f.controller.deleteTasks(["queued"]);
    await f.controller.flush();
    expect(f.saved.tasks).toEqual(before);
    expect(f.controller.getSnapshot().tasks).toEqual(before);
    expect(f.controller.getSnapshot()).toMatchObject({ closing: true, paused: true });
    expect(f.transport.generate).not.toHaveBeenCalled();
    expectNoMaintenanceCleanup(f);
    f.controller.cancelMaintenance();
    expect(f.controller.getSnapshot()).toMatchObject({ closing: false, paused: true });
    expect(f.saved.tasks).toEqual(before);
  });

  it("waits for already accepted queue registration and preserves new jobs without dispatch", async () => {
    const f = fixture(); await prepare(f);
    const registering = deferred<void>();
    const original = vi.mocked(f.repository.enqueue).getMockImplementation()!;
    vi.mocked(f.repository.enqueue).mockImplementationOnce(async tasks => { await registering.promise; return original(tasks); });
    const generation = f.controller.generate(settings);
    await vi.waitFor(() => expect(f.repository.enqueue).toHaveBeenCalledOnce());
    const maintenance = f.controller.prepareMaintenance();
    expect(f.controller.getSnapshot()).toMatchObject({ closing: true, paused: true, submitting: true });
    registering.resolve(); await generation; await maintenance;
    expect(f.saved.tasks).toEqual([expect.objectContaining({ status: "queued" })]);
    expect(f.transport.generate).not.toHaveBeenCalled();
    expectNoMaintenanceCleanup(f);
  });

  it("waits for preset persistence already in progress", async () => {
    const f = fixture(); await prepare(f);
    const writing = deferred<void>();
    const original = vi.mocked(f.presetRepository.create).getMockImplementation()!;
    vi.mocked(f.presetRepository.create).mockImplementationOnce(async input => { await writing.promise; return original(input); });
    const create = f.controller.createPreset({ name: "accepted", content: "preserved text" });
    await vi.waitFor(() => expect(f.presetRepository.create).toHaveBeenCalledOnce());
    let settled = false;
    const maintenance = f.controller.prepareMaintenance().then(() => { settled = true; });
    expect(f.controller.getSnapshot()).toMatchObject({ closing: true, paused: true, presetsBusy: true });
    await f.controller.deletePreset("preset");
    expect(f.presetRepository.remove).not.toHaveBeenCalled(); expect(settled).toBe(false);
    writing.resolve(); expect(await create).toBe(true); await maintenance;
    expect(f.controller.getSnapshot().presets).toEqual([expect.objectContaining({ name: "accepted", content: "preserved text" })]);
    expect(f.controller.getSnapshot()).toMatchObject({ closing: true, presetsBusy: false });
    expectNoMaintenanceCleanup(f);
  });

  it("waits for reference import and its resulting draft persistence", async () => {
    const f = fixture(); await prepare(f);
    const importing = deferred<void>();
    const original = vi.mocked(f.files.importReference).getMockImplementation()!;
    vi.mocked(f.files.importReference).mockImplementationOnce(async input => { await importing.promise; return original(input); });
    const imported = f.controller.addReferences([new File(["synthetic"], "accepted.png", { type: "image/png" })]);
    await vi.waitFor(() => expect(f.files.importReference).toHaveBeenCalledOnce());
    let settled = false;
    const maintenance = f.controller.prepareMaintenance().then(() => { settled = true; });
    expect(f.controller.getSnapshot()).toMatchObject({ closing: true, referencesBusy: true });
    await f.controller.clearReferences(); expect(settled).toBe(false);
    importing.resolve(); await imported; await maintenance;
    expect(f.saved.draft?.references).toEqual([expect.objectContaining({ id: "ref", name: "accepted.png" })]);
    expect(f.controller.getSnapshot()).toMatchObject({ closing: true, referencesBusy: false });
    expect(f.transport.generate).not.toHaveBeenCalled(); expectNoMaintenanceCleanup(f);
  });

  it("waits for accepted management registration and locks its replacement queue", async () => {
    const source = { ...queued, id: "source", status: "failed" as const };
    const f = fixture({ tasks: [source], results: [] }); await prepare(f); f.controller.updateSettings(settings);
    const registering = deferred<void>();
    const original = vi.mocked(f.repository.enqueue).getMockImplementation()!;
    vi.mocked(f.repository.enqueue).mockImplementationOnce(async tasks => { await registering.promise; return original(tasks); });
    const regeneration = f.controller.regenerate("source");
    await vi.waitFor(() => expect(f.repository.enqueue).toHaveBeenCalledOnce());
    let settled = false;
    const maintenance = f.controller.prepareMaintenance().then(() => { settled = true; });
    expect(f.controller.getSnapshot()).toMatchObject({ closing: true, paused: true, managementBusy: true });
    await f.controller.deleteTasks(["source"]); expect(f.repository.removeTasks).not.toHaveBeenCalled();
    expect(settled).toBe(false);
    registering.resolve(); expect(await regeneration).toBe("task-1"); await maintenance;
    expect(f.saved.tasks).toEqual([expect.objectContaining({ id: "task-1", sourceTaskId: "source", status: "queued" }), source]);
    expect(f.controller.getSnapshot()).toMatchObject({ closing: true, managementBusy: false });
    expect(f.transport.generate).not.toHaveBeenCalled(); expectNoMaintenanceCleanup(f);
  });

  it.each([false, true])("restores prior paused=%s after draft persistence failure and retains the edit", async paused => {
    const f = fixture(); await prepare(f);
    if (paused) f.controller.pause();
    const writing = deferred<void>();
    vi.mocked(f.repository.saveDraft).mockImplementationOnce(() => writing.promise);
    f.controller.setDraft({ ...f.controller.getSnapshot().draft, prompt: "retained unsaved edit" });
    const maintenance = f.controller.prepareMaintenance();
    const rejected = expect(maintenance).rejects.toThrow("草稿尚未保存");
    expect(f.controller.getSnapshot()).toMatchObject({ closing: true, paused: true });
    writing.reject(new Error("synthetic disk failure")); await rejected;
    expect(f.controller.getSnapshot()).toMatchObject({ closing: false, paused });
    expect(f.controller.getSnapshot().draft.prompt).toBe("retained unsaved edit");
    expect(f.saved.draft?.prompt).toBe("synthetic prompt");
    expectNoMaintenanceCleanup(f);
    f.controller.setDraft({ ...f.controller.getSnapshot().draft, prompt: "explicit retry edit" });
    await f.controller.flush(); expect(f.saved.draft?.prompt).toBe("explicit retry edit");
  });

  it("refuses an active provider request without aborting it or adding another request", async () => {
    const f = fixture(); await prepare(f);
    const response = deferred<DrawingImageInput[]>();
    vi.mocked(f.transport.generate).mockReturnValueOnce(response.promise);
    const generation = f.controller.generate(settings);
    await vi.waitFor(() => expect(f.transport.generate).toHaveBeenCalledOnce());
    const signal = vi.mocked(f.transport.generate).mock.calls[0][2];
    const abort = vi.fn(); signal.addEventListener("abort", abort);
    await expect(f.controller.prepareMaintenance()).rejects.toThrow("请等待绘图请求");
    expect(f.controller.getSnapshot()).toMatchObject({ closing: false, paused: false, busy: true });
    expect(signal.aborted).toBe(false); expect(abort).not.toHaveBeenCalled();
    expect(f.transport.generate).toHaveBeenCalledOnce(); expectNoMaintenanceCleanup(f);
    response.resolve(images); await generation;
    expect(f.saved.tasks[0].status).toBe("completed");
    expect(f.transport.generate).toHaveBeenCalledOnce();
  });

  it("refuses memory-only returned images and retains the pixels for explicit save retry", async () => {
    const f = fixture(); await prepare(f);
    vi.mocked(f.files.save).mockRejectedValueOnce(new Error("synthetic disk failure"));
    f.files.inspectRecovery = vi.fn(async () => ({ total: 0, durable: [] }));
    await f.controller.generate(settings);
    expect(f.controller.hasUnsavedImages()).toBe(true);
    const before = structuredClone(f.saved);
    await expect(f.controller.prepareMaintenance()).rejects.toThrow("只保存在内存");
    expect(f.controller.getSnapshot()).toMatchObject({ closing: false, paused: false });
    expect(f.saved).toEqual(before); expect(f.controller.hasUnsavedImages()).toBe(true);
    expectNoMaintenanceCleanup(f);
    await f.controller.retrySave("task-1");
    expect(f.files.save).toHaveBeenLastCalledWith("task-1", images);
    expect(f.saved.tasks[0].status).toBe("completed");
    expect(f.controller.hasUnsavedImages()).toBe(false); expect(f.transport.generate).toHaveBeenCalledOnce();
  });

  it("allows durable pending recovery logs and preserves them through preparation and reload", async () => {
    const f = fixture(); await prepare(f);
    vi.mocked(f.files.save).mockRejectedValueOnce(new Error("synthetic manifest failure"));
    f.files.inspectRecovery = vi.fn(async () => ({ total: 1, durable: [0] }));
    await f.controller.generate(settings);
    expect(f.controller.hasUnsavedImages()).toBe(false);
    expect(f.saved.tasks[0]).toMatchObject({ status: "save-failed", recovery: { total: 1, durable: [0], memory: [], lost: [] } });
    const before = structuredClone(f.saved);
    await f.controller.prepareMaintenance();
    expect(f.saved).toEqual(before); expect(f.controller.getSnapshot().closing).toBe(true);
    expectNoMaintenanceCleanup(f);
    const reopened = fixture(f.saved); reopened.files.inspectRecovery = vi.fn(async () => ({ total: 1, durable: [0] }));
    await reopened.controller.initialize();
    expect(reopened.saved.tasks[0]).toMatchObject({ status: "save-failed", recovery: { total: 1, durable: [0], memory: [], lost: [] } });
    await reopened.controller.prepareMaintenance();
    expect(reopened.controller.getSnapshot().closing).toBe(true);
    expect(reopened.transport.generate).not.toHaveBeenCalled(); expectNoMaintenanceCleanup(reopened);
    expect(f.transport.generate).toHaveBeenCalledOnce();
  });
});
