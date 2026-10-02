import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSettingsState } from "../chat/settings";
import { AyaseDatabase } from "../storage/database";
import { DrawingController } from "./controller";
import { DexieDrawingRepository } from "./repository";
import type { DrawingFile, DrawingFiles, DrawingImageInput, DrawingParameters, ImageGenerationTransport } from "./types";

const pixels: DrawingImageInput[] = [{ mime: "image/png", data: "AQID" }];
const databases: AyaseDatabase[] = [];
afterEach(async () => {
  databases.forEach(database => database.close());
  await Promise.all([...new Set(databases.map(database => database.name))].map(name => Dexie.delete(name)));
  databases.length = 0;
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function fixture(name = `drawing-acceptance-${crypto.randomUUID()}`, durable = new Map<string, DrawingFile[]>()) {
  const database = new AyaseDatabase(name);
  databases.push(database);
  const repository = new DexieDrawingRepository(database);
  const settings: ConnectionSettingsState = {
    version: 3, activeModelId: "chat-model", providers: [{ id: "provider", name: "synthetic", connections: [
      { id: "gemini", name: "Gemini drawing", protocol: "gemini-image", baseUrl: "https://gemini.example.test",
        apiKey: "synthetic-gemini-key", models: [{ id: "gemini-model", modelId: "synthetic-gemini" }] },
      { id: "openai", name: "OpenAI drawing", protocol: "openai-images", baseUrl: "https://openai.example.test",
        apiKey: "synthetic-openai-key", models: [{ id: "openai-model", modelId: "synthetic-openai" }] },
      { id: "chat", name: "Chat", protocol: "openai-chat", baseUrl: "https://chat.example.test",
        apiKey: "synthetic-chat-key", models: [{ id: "chat-model", modelId: "synthetic-chat" }] },
    ] }],
  };
  const files: DrawingFiles = {
    save: vi.fn(async taskId => {
      const result = [{ id: `result-${taskId}`, reference: `drawing/${taskId}/result.png`, mime: "image/png", size: 3, width: 1, height: 1 }];
      durable.set(taskId, result);
      return structuredClone(result);
    }),
    recover: vi.fn(async taskId => durable.has(taskId) ? structuredClone(durable.get(taskId)!) : null),
    inspectRecovery: vi.fn(async taskId => ({ total: durable.get(taskId)?.length ?? 0,
      durable: (durable.get(taskId) ?? []).map((_, index) => index) })),
    discardRecovery: vi.fn(async taskId => { durable.delete(taskId); }),
    read: vi.fn(async () => pixels[0]), export: vi.fn(async () => true),
    importReference: vi.fn(async () => { throw new Error("Reference import is outside this queue fixture"); }),
    removeReferences: vi.fn(async () => undefined),
  };
  const dispatches: { taskId: string; parameters: DrawingParameters; signal: AbortSignal }[] = [];
  const held: ReturnType<typeof deferred<DrawingImageInput[]>>[] = [];
  let hold = false;
  const transport: ImageGenerationTransport = { generate: vi.fn(async (parameters, key, signal) => {
    const task = controller.getSnapshot().tasks.find(item => item.parameters === parameters && item.status === "running");
    expect(task).toBeDefined();
    dispatches.push({ taskId: task!.id, parameters: structuredClone(parameters), signal });
    const response = deferred<DrawingImageInput[]>();
    held.push(response);
    // A real repository read checks the durable possible-send marker at every invocation.
    expect(await database.drawingTasks.get(task!.id)).toMatchObject({ status: "dispatching", parameters });
    expect(key).toBe(parameters.protocol === "gemini-image" ? "synthetic-gemini-key" : "synthetic-openai-key");
    return hold ? response.promise : pixels;
  }) };
  const factory = vi.fn(async () => transport);
  const controller = new DrawingController({ repository, files, transport: factory });
  return { database, repository, settings, files, durable, controller, transport, factory, dispatches, held,
    hold: (value: boolean) => { hold = value; } };
}

async function prepare(f: ReturnType<typeof fixture>) {
  await f.controller.initialize();
  f.controller.setDraft({ ...f.controller.getSnapshot().draft, modelId: "gemini-model", prompt: "single Gemini", count: 1,
    concurrency: 1, aspectRatio: "1:1", resolution: "2K", gemini: { temperature: 0.5, outputMode: "image" },
    openai: { size: "1024x1024", quality: "high" } });
  f.controller.pause();
}

const waitFor = (assertion: () => void) => vi.waitFor(assertion, { timeout: 15_000, interval: 5 });

describe("drawing integration acceptance #94 with isolated durable storage", () => {
  it("drains reopened mixed 1/99/99 batches exactly once in FIFO order through concurrency 1→4→1", async () => {
    const original = fixture();
    await prepare(original);
    await original.controller.generate(original.settings);
    original.controller.setDraft({ ...original.controller.getSnapshot().draft, modelId: "openai-model", prompt: "99 OpenAI", count: 99 });
    await original.controller.generate(original.settings);
    original.controller.setDraft({ ...original.controller.getSnapshot().draft, modelId: "gemini-model", prompt: "99 Gemini", count: 99 });
    await original.controller.generate(original.settings);
    const planned = (await original.repository.load()).tasks.sort((a, b) => a.queueOrder! - b.queueOrder!);
    expect(planned).toHaveLength(199);
    expect(new Set(planned.map(task => task.batchId)).size).toBe(3);
    expect(planned.map(task => task.queueOrder)).toEqual(Array.from({ length: 199 }, (_, index) => index + 1));
    expect(planned.every(task => task.status === "queued")).toBe(true);
    expect(original.transport.generate).not.toHaveBeenCalled();
    await original.controller.settleForClose();
    original.database.close();

    const f = fixture(original.database.name, original.durable);
    await f.controller.initialize();
    f.hold(true);
    f.controller.updateSettings(f.settings);
    f.controller.setDraft({ ...f.controller.getSnapshot().draft, prompt: "edited after restart" });
    await f.controller.flush();
    expect(f.controller.getSnapshot()).toMatchObject({ paused: true, completion: { sequence: 0 } });
    expect(f.transport.generate).not.toHaveBeenCalled();
    f.controller.resume();
    await waitFor(() => expect(f.dispatches).toHaveLength(1));
    f.controller.setDraft({ ...f.controller.getSnapshot().draft, concurrency: 4 });
    await waitFor(() => expect(f.dispatches).toHaveLength(4));
    f.controller.setDraft({ ...f.controller.getSnapshot().draft, concurrency: 1 });
    for (let index = 0; index < 3; index++) {
      f.held[index].resolve(pixels);
      await waitFor(() => expect(f.controller.getSnapshot().tasks.find(task => task.id === planned[index].id)?.status).toBe("completed"));
      expect(f.dispatches).toHaveLength(4);
      expect(f.dispatches.every(dispatch => !dispatch.signal.aborted)).toBe(true);
    }
    f.hold(false);
    f.held[3].resolve(pixels);
    await waitFor(() => expect(f.controller.getSnapshot().completion).toEqual({ sequence: 1, allSucceeded: true }));
    expect(f.dispatches.map(dispatch => dispatch.taskId)).toEqual(planned.map(task => task.id));
    expect(f.dispatches.map(dispatch => dispatch.parameters)).toEqual(planned.map(task => task.parameters));
    expect(f.transport.generate).toHaveBeenCalledTimes(199);
    expect(f.factory).toHaveBeenCalledTimes(199);
    expect(f.files.save).toHaveBeenCalledTimes(199);
    expect(f.files.read).not.toHaveBeenCalled();
    const saved = await f.repository.load();
    expect(saved.tasks.every(task => task.status === "completed")).toBe(true);
    expect(saved.results).toHaveLength(199);
    const resultsByTask = new Map(saved.results.map(result => [result.taskId, result]));
    expect(resultsByTask.size).toBe(199);
    for (const task of planned) expect(resultsByTask.get(task.id)).toMatchObject({
      reference: `drawing/${task.id}/result.png`, parameters: task.parameters,
    });
    expect(saved.draft).toMatchObject({ prompt: "edited after restart", count: 99, concurrency: 1 });
    expect(JSON.stringify(saved)).not.toContain("synthetic-gemini-key");
    expect(JSON.stringify(saved)).not.toContain("synthetic-openai-key");
    expect(f.settings.activeModelId).toBe("chat-model");
    await f.controller.settleForClose();
    f.database.close();
    const reopened = fixture(f.database.name, f.durable);
    await reopened.controller.initialize();
    reopened.controller.updateSettings(reopened.settings);
    reopened.controller.resume();
    expect(reopened.controller.getSnapshot().results).toHaveLength(199);
    expect(reopened.controller.getSnapshot().completion.sequence).toBe(0);
    expect(reopened.transport.generate).not.toHaveBeenCalled();
  }, 25_000);

  it("continues after a durable-file/DB-commit failure, retries locally, and protects retry ownership from deletion", async () => {
    const f = fixture();
    await prepare(f);
    f.controller.setDraft({ ...f.controller.getSnapshot().draft, count: 2 });
    await f.controller.generate(f.settings);
    f.controller.setDraft({ ...f.controller.getSnapshot().draft, modelId: "openai-model", prompt: "OpenAI siblings" });
    await f.controller.generate(f.settings);
    const planned = (await f.repository.load()).tasks.sort((a, b) => a.queueOrder! - b.queueOrder!);
    const complete = f.repository.complete.bind(f.repository);
    vi.spyOn(f.repository, "complete").mockRejectedValueOnce(new Error("synthetic DB commit failure"));
    f.controller.resume();
    await waitFor(() => expect(f.controller.getSnapshot().completion).toEqual({ sequence: 1, allSucceeded: false }));
    const failed = planned[0];
    expect(await f.database.drawingTasks.get(failed.id)).toMatchObject({ status: "save-failed", recovery: { durable: [0], memory: [] } });
    expect(f.controller.hasUnsavedImages()).toBe(false);
    expect(await f.database.drawingResults.count()).toBe(3);
    expect(f.transport.generate).toHaveBeenCalledTimes(4);
    expect(f.files.save).toHaveBeenCalledTimes(4);

    const committing = deferred<void>();
    vi.mocked(f.repository.complete).mockImplementationOnce(async (task, results) => { await committing.promise; await complete(task, results); });
    const retry = f.controller.retrySave(failed.id);
    await waitFor(() => expect(f.repository.complete).toHaveBeenCalledTimes(5));
    await f.controller.deleteTasks([failed.id]);
    expect(await f.database.drawingTasks.get(failed.id)).toMatchObject({ status: "saving" });
    expect(f.controller.getSnapshot().error).toContain("任务仍在执行或保存");
    committing.resolve();
    await retry;
    expect(await f.database.drawingTasks.get(failed.id)).toMatchObject({ status: "completed" });
    expect(await f.database.drawingResults.count()).toBe(4);
    expect(f.transport.generate).toHaveBeenCalledTimes(4);
    expect(f.files.save).toHaveBeenCalledTimes(4);
    expect(f.controller.getSnapshot().completion).toEqual({ sequence: 1, allSucceeded: false });
    await f.controller.deleteTasks([failed.id]);
    expect(await f.database.drawingTasks.get(failed.id)).toBeUndefined();
    expect(await f.database.drawingResults.get(`result-${failed.id}`)).toMatchObject({ taskId: failed.id, parameters: failed.parameters });
    expect(f.files.discardRecovery).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"] as const)("ignores a late %s after cancelling and deleting one request while its sibling continues", async outcome => {
    const f = fixture();
    await prepare(f);
    f.controller.setDraft({ ...f.controller.getSnapshot().draft, count: 3, concurrency: 2 });
    await f.controller.generate(f.settings);
    const planned = (await f.repository.load()).tasks.sort((a, b) => a.queueOrder! - b.queueOrder!);
    f.hold(true);
    f.controller.resume();
    await waitFor(() => expect(f.dispatches).toHaveLength(2));
    f.controller.pause();
    f.controller.cancel(planned[0].id);
    await waitFor(() => expect(f.controller.getSnapshot().tasks.find(task => task.id === planned[0].id)?.status).toBe("unknown"));
    await waitFor(() => expect(f.controller.getSnapshot().tasks.find(task => task.id === planned[1].id)?.status).toBe("running"));
    await f.controller.deleteTasks([planned[0].id]);
    if (outcome === "resolve") f.held[0].resolve(pixels);
    else f.held[0].reject(new Error("synthetic late provider failure"));
    f.held[1].resolve(pixels);
    await waitFor(() => expect(f.controller.getSnapshot().busy).toBe(false));
    expect(await f.database.drawingTasks.get(planned[0].id)).toBeUndefined();
    expect(await f.database.drawingResults.where("taskId").equals(planned[0].id).count()).toBe(0);
    expect(f.files.save).toHaveBeenCalledOnce();
    expect(f.dispatches[1].signal.aborted).toBe(false);
    expect(await f.database.drawingTasks.get(planned[2].id)).toMatchObject({ status: "queued" });
    expect(f.controller.getSnapshot().completion.sequence).toBe(0);
    f.hold(false);
    f.controller.resume();
    await waitFor(() => expect(f.controller.getSnapshot().completion).toEqual({ sequence: 1, allSucceeded: false }));
    expect(f.dispatches.map(dispatch => dispatch.taskId)).toEqual(planned.map(task => task.id));
    expect(f.transport.generate).toHaveBeenCalledTimes(3);
    expect(await f.database.drawingResults.count()).toBe(2);
  });
});
