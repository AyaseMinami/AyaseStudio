import { describe, expect, it, vi } from "vitest";
import type { ConnectionSettingsState } from "../chat/settings";
import { DrawingController } from "./controller";
import { ImageGenerationError } from "./geminiImage";
import type { DrawingRepository, DrawingSnapshot } from "./repository";
import type { DrawingFiles, DrawingImageInput, DrawingTask, ImageGenerationTransport } from "./types";

const pixels: DrawingImageInput[] = [{ mime: "image/png", data: "AQID" }];
const reference = { id: "ref", name: "synthetic.png", reference: "drawing/references/ref.png", mime: "image/png", size: 3, width: 1, height: 1 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(snapshot: DrawingSnapshot = { tasks: [], results: [] }) {
  let saved = structuredClone(snapshot), sequence = 0, time = "2026-10-01T00:00:00.000Z";
  const settings: ConnectionSettingsState = { version: 3, activeModelId: null, providers: [{ id: "p", name: "synthetic", connections: [
    { id: "c", name: "drawing", protocol: "gemini-image", baseUrl: "https://example.test", apiKey: "synthetic-key",
      models: [{ id: "m", modelId: "synthetic-image" }] },
  ] }] };
  const repository: DrawingRepository = {
    removeResults: vi.fn(async ids => { saved.results = saved.results.filter(result => !ids.includes(result.id)); }),
    removeTasks: vi.fn(async ids => { saved.tasks = saved.tasks.filter(task => !ids.includes(task.id)); }),
    load: vi.fn(async () => structuredClone(saved)),
    saveDraft: vi.fn(async draft => { saved.draft = structuredClone(draft); }),
    saveTask: vi.fn(async task => { saved.tasks = [structuredClone(task), ...saved.tasks.filter(item => item.id !== task.id)]; }),
    enqueue: vi.fn(async (tasks: DrawingTask[]) => {
      const last = Math.max(0, ...saved.tasks.map(task => task.queueOrder ?? 0));
      const ordered = tasks.map((task, index) => ({ ...structuredClone(task), queueOrder: last + index + 1 }));
      saved.tasks = [...ordered, ...saved.tasks]; return structuredClone(ordered);
    }),
    complete: vi.fn(async (task, results) => {
      saved.tasks = [structuredClone(task), ...saved.tasks.filter(item => item.id !== task.id)];
      saved.results = [...structuredClone(results), ...saved.results.filter(item => item.taskId !== task.id)];
    }),
  };
  const files: DrawingFiles = {
    save: vi.fn(async id => [{ ...reference, id: `result-${id}`, reference: `drawing/${id}/result.png` }]),
    recover: vi.fn(async () => null), read: vi.fn(async () => pixels[0]), export: vi.fn(async () => true),
    importReference: vi.fn(async () => ({ ...reference, digest: "synthetic-digest" })), removeReferences: vi.fn(async () => undefined),
  };
  const transport: ImageGenerationTransport = { generate: vi.fn(async () => pixels) };
  const controller = new DrawingController({ repository, files, transport: async () => transport,
    id: () => `task-${++sequence}`, now: () => time });
  return { controller, settings, repository, files, transport, saved: () => saved, setTime: (next: string) => { time = next; } };
}
async function prepare(f: ReturnType<typeof fixture>, count?: number, concurrency?: number) {
  await f.controller.initialize();
  f.controller.setDraft({ ...f.controller.getSnapshot().draft, modelId: "m", prompt: "first", count, concurrency });
}
const taskById = (f: ReturnType<typeof fixture>, id: string) => f.saved().tasks.find(task => task.id === id)!;

describe("task lifecycle and history ownership #88", () => {
  it("reuses one active replacement, permits later deliberate regeneration, and retains frozen inputs", async () => {
    const f = fixture(); await prepare(f); await f.controller.generate(f.settings);
    f.controller.pause(); f.controller.setDraft({ ...f.controller.getSnapshot().draft, prompt: "new draft" });
    const [a, b] = await Promise.all([f.controller.regenerate("task-1"), f.controller.regenerate("task-1")]);
    expect(a).toBe(b); expect(a).toBe("task-2");
    expect(await f.controller.regenerate("task-1")).toBe(a);
    expect(taskById(f, a!)).toMatchObject({ sourceTaskId: "task-1", parameters: { prompt: "first" } });
    f.controller.resume(); await vi.waitFor(() => expect(taskById(f, a!).status).toBe("completed"));
    await vi.waitFor(() => expect(f.controller.getSnapshot().busy).toBe(false));
    f.controller.pause(); expect(await f.controller.regenerate("task-1")).toBe("task-3");
  });
  it("deleting a source preserves a queued replacement and independent results with all input references", async () => {
    const f = fixture(); await prepare(f);
    f.controller.setDraft({ ...f.controller.getSnapshot().draft, references: [reference] });
    await f.controller.generate(f.settings); f.controller.pause();
    await f.controller.regenerate("task-1");
    const discard = f.files.discardRecovery = vi.fn(async () => undefined);
    await f.controller.deleteTasks(["task-1"]);
    expect(f.saved().tasks.map(task => task.id)).toEqual(["task-2"]);
    expect(f.saved().results).toHaveLength(1); expect(discard).not.toHaveBeenCalled();
    expect(f.files.removeReferences).not.toHaveBeenCalled();
    f.controller.resume(); await vi.waitFor(() => expect(taskById(f, "task-2").status).toBe("completed"));
    expect(f.saved().tasks).toHaveLength(1); expect(f.saved().results).toHaveLength(2);
  });
  it("settles ignored abort promptly and a late provider result cannot resurrect deleted unknown history", async () => {
    const f = fixture(); await prepare(f);
    const late = deferred<DrawingImageInput[]>(); vi.mocked(f.transport.generate).mockReturnValue(late.promise);
    const generation = f.controller.generate(f.settings);
    await vi.waitFor(() => expect(f.transport.generate).toHaveBeenCalledOnce());
    f.controller.cancel("task-1"); await generation;
    expect(taskById(f, "task-1").status).toBe("unknown");
    await f.controller.deleteTasks(["task-1"]); late.resolve(pixels); await Promise.resolve();
    expect(f.saved().tasks).toHaveLength(0); expect(f.saved().results).toHaveLength(0); expect(f.files.save).not.toHaveBeenCalled();
  });
  it("rejects active history removal and cancels only the selected batch without dispatching queued siblings", async () => {
    const f = fixture(); await prepare(f, 2); f.controller.pause();
    await f.controller.generate(f.settings); await f.controller.generate(f.settings);
    const batch = taskById(f, "task-1").batchId!;
    await f.controller.deleteTasks(["task-1"]); expect(f.repository.removeTasks).not.toHaveBeenCalled();
    f.controller.cancelBatch(batch);
    await vi.waitFor(() => expect(taskById(f, "task-2").status).toBe("cancelled"));
    expect(taskById(f, "task-3").status).toBe("queued"); expect(f.transport.generate).not.toHaveBeenCalled();
  });
  it("deletion reserves the task against local retry and regeneration, and DB failure preserves recovery", async () => {
    const f = fixture(); await prepare(f); vi.mocked(f.files.save).mockRejectedValue(new Error("disk full"));
    await f.controller.generate(f.settings);
    const removed = deferred<void>(); vi.mocked(f.repository.removeTasks).mockReturnValueOnce(removed.promise);
    const deletion = f.controller.deleteTasks(["task-1"]);
    await vi.waitFor(() => expect(f.repository.removeTasks).toHaveBeenCalledOnce());
    await f.controller.retrySave("task-1"); expect(await f.controller.regenerate("task-1")).toBeUndefined();
    expect(f.files.save).toHaveBeenCalledOnce();
    removed.reject(new Error("DB")); await deletion;
    expect(f.controller.hasUnsavedImages()).toBe(true); expect(taskById(f, "task-1").status).toBe("save-failed");
  });
  it("a local retry that wins the race cannot have its record deleted mid-save", async () => {
    const f = fixture(); await prepare(f); vi.mocked(f.files.save).mockRejectedValueOnce(new Error("disk"));
    await f.controller.generate(f.settings);
    const saving = deferred<Awaited<ReturnType<DrawingFiles["save"]>>>(); vi.mocked(f.files.save).mockReturnValueOnce(saving.promise);
    const retry = f.controller.retrySave("task-1");
    await f.controller.deleteTasks(["task-1"]); expect(f.repository.removeTasks).not.toHaveBeenCalled();
    saving.resolve([{ ...reference, id: "result" }]); await retry;
    expect(taskById(f, "task-1").status).toBe("completed"); expect(f.transport.generate).toHaveBeenCalledOnce();
  });
  it("writes pixels even when the saving-state DB update fails", async () => {
    const f = fixture(); await prepare(f);
    vi.mocked(f.repository.saveTask).mockImplementation(async task => {
      if (task.status === "saving") throw new Error("DB");
      f.saved().tasks = [structuredClone(task), ...f.saved().tasks.filter(item => item.id !== task.id)];
    });
    await f.controller.generate(f.settings);
    expect(f.files.save).toHaveBeenCalledOnce(); expect(taskById(f, "task-1").status).toBe("completed");
  });
  it("releases all response memory when every original is durable despite manifest failure", async () => {
    const f = fixture(); await prepare(f, 2);
    vi.mocked(f.files.save).mockRejectedValue(new Error("manifest disk failure"));
    f.files.inspectRecovery = vi.fn(async () => ({ total: 1, durable: [0] }));
    await f.controller.generate(f.settings);
    expect(f.transport.generate).toHaveBeenCalledTimes(2); expect(f.controller.hasUnsavedImages()).toBe(false);
    expect(f.saved().tasks.every(task => task.recovery?.durable.length === 1 && task.recovery.memory.length === 0)).toBe(true);
  });
  it("reports exactly which images are durable, memory-only and lost after restart", async () => {
    const f = fixture(); await prepare(f); vi.mocked(f.transport.generate).mockResolvedValue([pixels[0], pixels[0]]);
    vi.mocked(f.files.save).mockRejectedValue(new Error("partial disk failure"));
    f.files.inspectRecovery = vi.fn(async () => ({ total: 2, durable: [0] }));
    await f.controller.generate(f.settings);
    expect(taskById(f, "task-1").recovery).toEqual({ total: 2, durable: [0], memory: [1], lost: [] });
    const reopened = fixture(f.saved()); reopened.files.inspectRecovery = f.files.inspectRecovery;
    await reopened.controller.initialize();
    expect(taskById(reopened, "task-1").recovery).toEqual({ total: 2, durable: [0], memory: [], lost: [1] });
    expect(reopened.transport.generate).not.toHaveBeenCalled();
    await f.controller.deleteTasks(["task-1"]); expect(f.controller.hasUnsavedImages()).toBe(false);
  });
  it("retries only missing pixels after partial durability and releases durable payloads", async () => {
    const f = fixture(); await prepare(f); vi.mocked(f.transport.generate).mockResolvedValue([pixels[0], { ...pixels[0], data: "BAUG" }]);
    vi.mocked(f.files.save).mockRejectedValue(new Error("partial disk failure"));
    f.files.inspectRecovery = vi.fn(async () => ({ total: 2, durable: [0] }));
    f.files.resumeRecovery = vi.fn(async () => [{ ...reference, id: "result-1" }, { ...reference, id: "result-2" }]);
    await f.controller.generate(f.settings);
    await f.controller.retrySave("task-1");
    expect(f.files.resumeRecovery).toHaveBeenCalledWith("task-1", [{ index: 1, image: { ...pixels[0], data: "BAUG" } }]);
    expect(f.transport.generate).toHaveBeenCalledOnce(); expect(f.controller.hasUnsavedImages()).toBe(false);
    expect(taskById(f, "task-1").status).toBe("completed");
  });
  it("recovers an interrupted dispatch marker with partial durable pixels as save-failed, never resends", async () => {
    const f = fixture(); await prepare(f); f.controller.pause(); await f.controller.generate(f.settings);
    f.saved().tasks[0].status = "dispatching";
    const reopened = fixture(f.saved()); reopened.files.inspectRecovery = vi.fn(async () => ({ total: 2, durable: [0] }));
    await reopened.controller.initialize(); reopened.controller.updateSettings(f.settings); reopened.controller.resume();
    expect(taskById(reopened, "task-1")).toMatchObject({ status: "save-failed", recovery: { lost: [1] } });
    expect(reopened.transport.generate).not.toHaveBeenCalled();
  });
  it("continues a sequence of total disk failures and releases retained responses only on explicit deletion", async () => {
    const f = fixture(); await prepare(f, 12);
    f.files.inspectRecovery = vi.fn(async () => ({ total: 0, durable: [] }));
    f.files.discardRecovery = vi.fn(async () => undefined);
    vi.mocked(f.files.save).mockRejectedValue(new Error("disk full"));
    await f.controller.generate(f.settings);
    expect(f.transport.generate).toHaveBeenCalledTimes(12); expect(f.controller.getSnapshot().paused).toBe(false);
    expect(f.saved().tasks.every(task => task.recovery?.memory.join() === "0")).toBe(true);
    await f.controller.deleteTasks(f.saved().tasks.map(task => task.id));
    expect(f.controller.hasUnsavedImages()).toBe(false); expect(f.files.discardRecovery).toHaveBeenCalledTimes(12);
  });
});

describe("durable drawing queue", () => {
  it("defaults to one task and one occupied slot and persists queue preferences", async () => {
    const f = fixture(); await prepare(f);
    await f.controller.generate(f.settings);
    expect(f.transport.generate).toHaveBeenCalledOnce();
    expect(f.saved().draft).toMatchObject({ count: 1, concurrency: 1, completionSound: true });
    expect(taskById(f, "task-1")).toMatchObject({ queueOrder: 1, batchId: expect.any(String), status: "completed" });
    f.controller.setDraft({ ...f.controller.getSnapshot().draft, count: 99, concurrency: 4, completionSound: false });
    await f.controller.flush();
    const restored = fixture(f.saved()); await restored.controller.initialize();
    expect(restored.controller.getSnapshot().draft).toMatchObject({ count: 99, concurrency: 4, completionSound: false });
    expect(restored.transport.generate).not.toHaveBeenCalled();
  });

  it("atomically appends batches of 99 with more than 100 waiting tasks and no network while paused", async () => {
    const f = fixture(); await prepare(f, 99); f.controller.pause();
    await f.controller.generate(f.settings); await f.controller.generate(f.settings);
    const tasks = f.saved().tasks;
    expect(tasks).toHaveLength(198);
    expect(new Set(tasks.map(task => task.batchId)).size).toBe(2);
    expect(tasks.map(task => task.queueOrder).sort((a, b) => a! - b!)).toEqual(Array.from({ length: 198 }, (_, index) => index + 1));
    expect(tasks.every(task => task.status === "queued" && !task.startedAt && !task.finishedAt)).toBe(true);
    expect(f.transport.generate).not.toHaveBeenCalled();
  });

  it("keeps a batch serial when the old draft has no concurrency preference", async () => {
    const f = fixture(); await prepare(f, 2);
    const first = deferred<DrawingImageInput[]>(); vi.mocked(f.transport.generate).mockReturnValueOnce(first.promise);
    const submitted = f.controller.generate(f.settings);
    await vi.waitFor(() => expect(f.transport.generate).toHaveBeenCalledOnce());
    expect(taskById(f, "task-2").status).toBe("queued");
    first.resolve(pixels); await submitted; expect(f.transport.generate).toHaveBeenCalledTimes(2);
  });

  it.each([0, -1, 100, 1.5, NaN, Infinity])("rejects batch count %s before registration", async count => {
    const f = fixture(); await prepare(f, count); await f.controller.generate(f.settings);
    expect(f.repository.enqueue).not.toHaveBeenCalled(); expect(f.transport.generate).not.toHaveBeenCalled();
    expect(f.saved().tasks).toEqual([]); expect(f.controller.getSnapshot().error).toContain("1–99");
  });

  it("does not dispatch any task while atomic registration is pending or after it fails", async () => {
    const f = fixture(); await prepare(f, 4, 4);
    const registration = deferred<DrawingTask[]>(); vi.mocked(f.repository.enqueue).mockReturnValueOnce(registration.promise);
    const submitted = f.controller.generate(f.settings); await f.controller.generate(f.settings);
    await vi.waitFor(() => expect(f.repository.enqueue).toHaveBeenCalledOnce());
    expect(f.controller.getSnapshot().submitting).toBe(true);
    expect(f.controller.getSnapshot().tasks).toEqual([]); expect(f.transport.generate).not.toHaveBeenCalled();
    registration.reject(new Error("synthetic disk failure")); await submitted;
    expect(f.controller.getSnapshot()).toMatchObject({ submitting: false, tasks: [] });
    expect(f.transport.generate).not.toHaveBeenCalled(); expect(f.controller.getSnapshot().error).toContain("整批");
  });

  it("blocks dispatch through queue controls while a cancelled submission waits for durable cancellation", async () => {
    const f = fixture(); await prepare(f, 3, 4);
    const registration = deferred<void>(), cancellation = deferred<void>();
    const enqueue = vi.mocked(f.repository.enqueue).getMockImplementation()!;
    const saveTask = vi.mocked(f.repository.saveTask).getMockImplementation()!;
    vi.mocked(f.repository.enqueue).mockImplementationOnce(async tasks => { await registration.promise; return enqueue(tasks); });
    vi.mocked(f.repository.saveTask).mockImplementationOnce(async task => { await cancellation.promise; await saveTask(task); });
    const submitted = f.controller.generate(f.settings);
    await vi.waitFor(() => expect(f.repository.enqueue).toHaveBeenCalledOnce());
    f.controller.cancel(); registration.resolve();
    await vi.waitFor(() => expect(f.repository.saveTask).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled" })));
    expect(f.controller.getSnapshot()).toMatchObject({ submitting: true, tasks: expect.any(Array) });
    expect(f.controller.getSnapshot().tasks).toHaveLength(3);
    f.controller.setDraft({ ...f.controller.getSnapshot().draft, prompt: "edited during cancellation", concurrency: 4 });
    f.controller.updateSettings(f.settings); f.controller.resume(); await f.controller.flush();
    expect(f.repository.saveTask).toHaveBeenCalledOnce();
    expect(f.controller.getSnapshot().tasks.every(task => task.status === "queued")).toBe(true);
    expect(f.transport.generate).not.toHaveBeenCalled();
    cancellation.resolve(); await submitted;
    expect(f.saved().tasks.every(task => task.status === "cancelled")).toBe(true);
    expect(f.transport.generate).not.toHaveBeenCalled();
    expect(f.controller.getSnapshot()).toMatchObject({ submitting: false, completion: { sequence: 1, allSucceeded: false } });
  });

  it("dispatches FIFO across appended batches while preserving the earlier task snapshots", async () => {
    const f = fixture(); await prepare(f, 2);
    const requests = Array.from({ length: 3 }, () => deferred<DrawingImageInput[]>());
    let index = 0; vi.mocked(f.transport.generate).mockImplementation(() => requests[index++].promise);
    const first = f.controller.generate(f.settings);
    await vi.waitFor(() => expect(f.transport.generate).toHaveBeenCalledTimes(1));
    f.controller.setDraft({ ...f.controller.getSnapshot().draft, count: 1, prompt: "appended" });
    const second = f.controller.generate(f.settings);
    await vi.waitFor(() => expect(f.saved().tasks).toHaveLength(3));
    expect(f.transport.generate).toHaveBeenCalledTimes(1);
    requests[0].resolve(pixels); await vi.waitFor(() => expect(f.transport.generate).toHaveBeenCalledTimes(2));
    expect(vi.mocked(f.transport.generate).mock.calls[1][0].prompt).toBe("first");
    requests[1].resolve(pixels); await vi.waitFor(() => expect(f.transport.generate).toHaveBeenCalledTimes(3));
    expect(vi.mocked(f.transport.generate).mock.calls[2][0].prompt).toBe("appended");
    requests[2].resolve(pixels); await Promise.all([first, second]);
    expect(f.controller.getSnapshot().completion).toEqual({ sequence: 1, allSucceeded: true });
  });

  it("increases concurrency immediately up to four and decreases it without cancelling active requests", async () => {
    const f = fixture(); await prepare(f, 6);
    const requests = Array.from({ length: 6 }, () => deferred<DrawingImageInput[]>());
    let index = 0; vi.mocked(f.transport.generate).mockImplementation(() => requests[index++].promise);
    const submitted = f.controller.generate(f.settings);
    await vi.waitFor(() => expect(f.transport.generate).toHaveBeenCalledTimes(1));
    f.controller.setDraft({ ...f.controller.getSnapshot().draft, concurrency: 99 });
    await vi.waitFor(() => expect(f.transport.generate).toHaveBeenCalledTimes(4));
    f.controller.setDraft({ ...f.controller.getSnapshot().draft, concurrency: 1 });
    expect(vi.mocked(f.transport.generate).mock.calls.every(call => !call[2].aborted)).toBe(true);
    for (let i = 0; i < 3; i++) {
      requests[i].resolve(pixels);
      await vi.waitFor(() => expect(taskById(f, `task-${i + 1}`).status).toBe("completed"));
      expect(f.transport.generate).toHaveBeenCalledTimes(4);
    }
    requests[3].resolve(pixels); await vi.waitFor(() => expect(f.transport.generate).toHaveBeenCalledTimes(5));
    requests[4].resolve(pixels); await vi.waitFor(() => expect(f.transport.generate).toHaveBeenCalledTimes(6));
    requests[5].resolve(pixels); await submitted;
    expect(f.saved().tasks.every(task => task.status === "completed")).toBe(true);
  });

  it("counts reference preparation and local file/database saving as occupied concurrency slots", async () => {
    const f = fixture(); await prepare(f, 2);
    f.controller.setDraft({ ...f.controller.getSnapshot().draft, references: [reference] });
    const reading = deferred<DrawingImageInput>(), saving = deferred<Awaited<ReturnType<DrawingFiles["save"]>>>(), committing = deferred<void>();
    vi.mocked(f.files.read).mockReturnValueOnce(reading.promise);
    vi.mocked(f.files.save).mockReturnValueOnce(saving.promise);
    const complete = vi.mocked(f.repository.complete).getMockImplementation()!;
    vi.mocked(f.repository.complete).mockImplementationOnce(async (task, results) => { await committing.promise; await complete(task, results); });
    const submitted = f.controller.generate(f.settings);
    await vi.waitFor(() => expect(taskById(f, "task-1").status).toBe("preparing"));
    expect(f.files.read).toHaveBeenCalledOnce(); expect(taskById(f, "task-2").status).toBe("queued");
    expect(f.transport.generate).not.toHaveBeenCalled();
    reading.resolve(pixels[0]); await vi.waitFor(() => expect(f.files.save).toHaveBeenCalledOnce());
    expect(taskById(f, "task-1").status).toBe("saving"); expect(f.transport.generate).toHaveBeenCalledOnce();
    saving.resolve([{ ...reference, id: "result-1" }]); await vi.waitFor(() => expect(f.repository.complete).toHaveBeenCalledOnce());
    expect(f.transport.generate).toHaveBeenCalledOnce();
    committing.resolve(); await submitted; expect(f.transport.generate).toHaveBeenCalledTimes(2);
  });

  it("pauses new work while allowing active requests to finish and cancels a queued item without sending it", async () => {
    const f = fixture(); await prepare(f, 3);
    const request = deferred<DrawingImageInput[]>(); vi.mocked(f.transport.generate).mockReturnValueOnce(request.promise);
    const submitted = f.controller.generate(f.settings); await vi.waitFor(() => expect(f.transport.generate).toHaveBeenCalledOnce());
    f.controller.pause(); f.controller.cancel("task-2");
    await vi.waitFor(() => expect(taskById(f, "task-2").status).toBe("cancelled"));
    expect(taskById(f, "task-2").startedAt).toBeUndefined();
    request.resolve(pixels); await submitted;
    expect(f.transport.generate).toHaveBeenCalledOnce(); expect(taskById(f, "task-3").status).toBe("queued");
    expect(f.controller.getSnapshot().completion.sequence).toBe(0);
    f.controller.resume(); await vi.waitFor(() => expect(taskById(f, "task-3").status).toBe("completed"));
    await vi.waitFor(() => expect(f.controller.getSnapshot().completion).toEqual({ sequence: 1, allSucceeded: false }));
    expect(f.transport.generate).toHaveBeenCalledTimes(2);
  });

  it("cancels one active request as unknown while siblings and later tasks continue without replay", async () => {
    const f = fixture(); await prepare(f, 3, 2);
    const sibling = deferred<DrawingImageInput[]>();
    vi.mocked(f.transport.generate).mockImplementationOnce(async (_, __, signal) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("synthetic aborted request")), { once: true });
    })).mockReturnValueOnce(sibling.promise);
    const submitted = f.controller.generate(f.settings);
    await vi.waitFor(() => expect(f.transport.generate).toHaveBeenCalledTimes(2));
    f.controller.cancel("task-1");
    await vi.waitFor(() => expect(taskById(f, "task-1").status).toBe("unknown"));
    expect(vi.mocked(f.transport.generate).mock.calls[1][2].aborted).toBe(false);
    await vi.waitFor(() => expect(f.transport.generate).toHaveBeenCalledTimes(3));
    sibling.resolve(pixels); await submitted;
    expect(taskById(f, "task-2").status).toBe("completed"); expect(taskById(f, "task-3").status).toBe("completed");
    expect(f.controller.getSnapshot().completion).toEqual({ sequence: 1, allSucceeded: false });
  });

  it("cancels preparation without sending, then releases the slot for the next task", async () => {
    const f = fixture(); await prepare(f, 2);
    f.controller.setDraft({ ...f.controller.getSnapshot().draft, references: [reference] });
    const reading = deferred<DrawingImageInput>(); vi.mocked(f.files.read).mockReturnValueOnce(reading.promise);
    const submitted = f.controller.generate(f.settings);
    await vi.waitFor(() => expect(f.files.read).toHaveBeenCalledOnce());
    f.controller.cancel("task-1"); reading.resolve(pixels[0]); await submitted;
    expect(taskById(f, "task-1").status).toBe("cancelled"); expect(taskById(f, "task-2").status).toBe("completed");
    expect(f.transport.generate).toHaveBeenCalledOnce();
  });

  it("emits one completion for each drained cycle and none for idle queue controls or history load", async () => {
    const f = fixture(); await prepare(f, 2); await f.controller.generate(f.settings);
    expect(f.controller.getSnapshot().completion).toEqual({ sequence: 1, allSucceeded: true });
    f.controller.pause(); f.controller.resume(); f.controller.updateSettings(f.settings);
    f.controller.setDraft({ ...f.controller.getSnapshot().draft, count: 1, completionSound: false }); await f.controller.flush();
    expect(f.controller.getSnapshot().completion.sequence).toBe(1);
    await f.controller.generate(f.settings);
    expect(f.controller.getSnapshot().completion).toEqual({ sequence: 2, allSucceeded: true });
    const restored = fixture(f.saved()); await restored.controller.initialize(); restored.controller.updateSettings(restored.settings); restored.controller.resume();
    expect(restored.controller.getSnapshot().completion.sequence).toBe(0);
  });

  it("freezes draft/reference snapshots and active keys, while later queued tasks use the current key", async () => {
    const f = fixture(); await prepare(f, 2);
    const refs = [{ ...reference }]; f.controller.setDraft({ ...f.controller.getSnapshot().draft, references: refs });
    const request = deferred<DrawingImageInput[]>(); vi.mocked(f.transport.generate).mockReturnValueOnce(request.promise);
    const submitted = f.controller.generate(f.settings); await vi.waitFor(() => expect(f.transport.generate).toHaveBeenCalledOnce());
    refs[0].name = "mutated outside";
    f.settings.providers[0].connections[0].apiKey = "rotated-key"; f.controller.updateSettings(f.settings);
    f.controller.setDraft({ ...f.controller.getSnapshot().draft, prompt: "next draft", references: [] });
    expect(vi.mocked(f.transport.generate).mock.calls[0]).toEqual([
      expect.objectContaining({ prompt: "first", references: [{ ...reference }] }), "synthetic-key", expect.any(AbortSignal), pixels,
    ]);
    request.resolve(pixels); await submitted;
    expect(vi.mocked(f.transport.generate).mock.calls[1][1]).toBe("rotated-key");
    expect(f.saved().tasks.every(task => task.parameters.prompt === "first" && task.parameters.references?.[0].name === "synthetic.png")).toBe(true);
    expect(f.files.removeReferences).not.toHaveBeenCalled();
    expect(JSON.stringify(f.saved())).not.toContain("synthetic-key"); expect(JSON.stringify(f.saved())).not.toContain("rotated-key");
    expect(f.saved().draft).toMatchObject({ prompt: "next draft", references: [] });
  });

  it.each(["missing", "address", "protocol", "model"])("blocks a queued task after its target %s changes", async change => {
    const f = fixture(); await prepare(f); f.controller.pause(); await f.controller.generate(f.settings);
    const connection = f.settings.providers[0].connections[0];
    if (change === "missing") connection.models = [];
    if (change === "address") connection.baseUrl = "https://changed.test";
    if (change === "protocol") connection.protocol = "openai-images";
    if (change === "model") connection.models[0].modelId = "changed-image";
    f.controller.updateSettings(f.settings); f.controller.resume();
    await vi.waitFor(() => expect(taskById(f, "task-1").status).toBe("failed"));
    expect(f.transport.generate).not.toHaveBeenCalled(); expect(taskById(f, "task-1").error).toContain("已阻止请求");
  });

  it("restores queued/preparing work paused, marks sent work unknown and resumes only unsent work in durable FIFO order", async () => {
    const original = fixture(); await prepare(original, 3); original.controller.pause(); await original.controller.generate(original.settings);
    const tasks = original.saved().tasks.map((task, index): DrawingTask => ({ ...task,
      status: index === 1 ? "preparing" : index === 2 ? "running" : "queued", startedAt: index ? "2026-10-01T00:00:01.000Z" : undefined }));
    const f = fixture({ ...original.saved(), tasks: tasks.reverse() }); await f.controller.initialize();
    f.controller.updateSettings(f.settings);
    expect(f.controller.getSnapshot()).toMatchObject({ paused: true, completion: { sequence: 0 } });
    expect(taskById(f, "task-2")).toMatchObject({ status: "queued", startedAt: undefined });
    expect(taskById(f, "task-3").status).toBe("unknown"); expect(f.transport.generate).not.toHaveBeenCalled();
    f.controller.resume(); await vi.waitFor(() => expect(f.controller.getSnapshot().completion.sequence).toBe(1));
    expect(f.files.save).toHaveBeenNthCalledWith(1, "task-1", pixels); expect(f.files.save).toHaveBeenNthCalledWith(2, "task-2", pixels);
    expect(f.transport.generate).toHaveBeenCalledTimes(2); expect(taskById(f, "task-3").status).toBe("unknown");
    expect(f.controller.getSnapshot().completion).toEqual({ sequence: 1, allSucceeded: false });
  });

  it("continues after provider and local-save failures, and local retry never sends or emits a second completion", async () => {
    const f = fixture(); await prepare(f, 4);
    vi.mocked(f.transport.generate).mockRejectedValueOnce(new ImageGenerationError("synthetic provider failure"));
    vi.mocked(f.files.save).mockRejectedValueOnce(new Error("synthetic disk failure"));
    await f.controller.generate(f.settings);
    expect(taskById(f, "task-1").status).toBe("failed"); expect(taskById(f, "task-2").status).toBe("save-failed");
    expect(taskById(f, "task-3").status).toBe("completed"); expect(taskById(f, "task-4").status).toBe("completed");
    expect(f.controller.getSnapshot().completion).toEqual({ sequence: 1, allSucceeded: false });
    await f.controller.retrySave("task-2");
    expect(taskById(f, "task-2").status).toBe("completed"); expect(f.transport.generate).toHaveBeenCalledTimes(4);
    expect(f.controller.getSnapshot().completion).toEqual({ sequence: 1, allSucceeded: false });
    const restored = fixture(f.saved()); await restored.controller.initialize();
    expect(restored.controller.getSnapshot().completion.sequence).toBe(0); expect(restored.transport.generate).not.toHaveBeenCalled();
  });

  it("measures elapsed time from preparation through saving and freezes terminal timestamps", async () => {
    const f = fixture(); await prepare(f); f.controller.pause(); await f.controller.generate(f.settings);
    expect(taskById(f, "task-1").createdAt).toBe("2026-10-01T00:00:00.000Z");
    const request = deferred<DrawingImageInput[]>(), saving = deferred<Awaited<ReturnType<DrawingFiles["save"]>>>();
    vi.mocked(f.transport.generate).mockReturnValueOnce(request.promise); vi.mocked(f.files.save).mockReturnValueOnce(saving.promise);
    f.setTime("2026-10-01T00:00:10.000Z"); f.controller.resume(); await vi.waitFor(() => expect(f.transport.generate).toHaveBeenCalledOnce());
    f.setTime("2026-10-01T00:00:20.000Z"); request.resolve(pixels); await vi.waitFor(() => expect(f.files.save).toHaveBeenCalledOnce());
    expect(taskById(f, "task-1")).toMatchObject({ startedAt: "2026-10-01T00:00:10.000Z", status: "saving", finishedAt: undefined });
    f.setTime("2026-10-01T00:00:30.000Z"); saving.resolve([{ ...reference, id: "result-1" }]);
    await vi.waitFor(() => expect(taskById(f, "task-1").status).toBe("completed"));
    expect(taskById(f, "task-1").finishedAt).toBe("2026-10-01T00:00:30.000Z");
    f.setTime("2026-10-01T00:01:00.000Z"); f.controller.setDraft({ ...f.controller.getSnapshot().draft, prompt: "later" }); await f.controller.flush();
    expect(taskById(f, "task-1").finishedAt).toBe("2026-10-01T00:00:30.000Z");
  });
});
