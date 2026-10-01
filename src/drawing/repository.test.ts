import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { AyaseDatabase } from "../storage/database";
import { DexieDrawingRepository } from "./repository";
import { initialDrawingDraft, type DrawingTask } from "./types";
import { BackupRepository } from "../backup/repository";
import { connectionSettingsStorageKey } from "../chat/settings";

describe("durable drawing repository and backup maintenance gate", () => {
  const queuedTask = (id: string): DrawingTask => ({
    id, batchId: "batch", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", status: "queued",
    parameters: { protocol: "gemini-image", prompt: "synthetic", aspectRatio: "auto", resolution: "auto", providerId: "p",
      connectionId: "c", configuredModelId: "m", modelId: "synthetic-image", modelName: "synthetic", baseUrl: "https://example.test" },
  });
  it("removes terminal history only, preserves results and rejects late writes after deletion", async () => {
    const db = new AyaseDatabase(`drawing-delete-${crypto.randomUUID()}`), repository = new DexieDrawingRepository(db);
    const task = { ...queuedTask("finished"), status: "completed" as const };
    await repository.enqueue([task, queuedTask("active")]);
    const result = { id: "r", taskId: task.id, createdAt: task.createdAt, parameters: task.parameters,
      reference: "drawing/finished/r.png", mime: "image/png", size: 1, width: 1, height: 1 };
    await repository.complete(task, [result]);
    await expect(repository.removeTasks(["finished", "active"])).rejects.toThrow();
    expect((await repository.load()).tasks).toHaveLength(2);
    await repository.removeTasks(["finished"]);
    await expect(repository.saveTask(task)).rejects.toThrow();
    await expect(repository.complete(task, [result])).rejects.toThrow();
    expect((await repository.load()).results).toEqual([result]);
    expect((await repository.load()).tasks.map(item => item.id)).toEqual(["active"]);
    await db.delete();
  });
  it("deletes only selected results and persists independently of task history and draft references", async () => {
    const name = `drawing-result-delete-${crypto.randomUUID()}`, db = new AyaseDatabase(name), repository = new DexieDrawingRepository(db);
    const task = { ...queuedTask("finished"), status: "completed" as const };
    const result = { id: "r", taskId: task.id, createdAt: task.createdAt, parameters: task.parameters,
      reference: "drawing/finished/r.png", mime: "image/png", size: 1, width: 1, height: 1 };
    const draft = { ...initialDrawingDraft, references: [{ id: "r", reference: "drawing/01234567-89ab-4cde-8fab-0123456789ab/11234567-89ab-4cde-8fab-0123456789ab.png", mime: "image/png", size: 1, width: 1, height: 1, name: "synthetic.png" }] };
    await repository.saveDraft(draft); await repository.enqueue([task]);
    await repository.complete(task, [result, { ...result, id: "keep" }]);
    await repository.removeResults(["r", "missing"]); db.close();
    const reopened = new AyaseDatabase(name), saved = await new DexieDrawingRepository(reopened).load();
    expect(saved.results.map(result => result.id)).toEqual(["keep"]);
    expect(saved.tasks).toEqual([expect.objectContaining(task)]); expect(saved.draft).toMatchObject(draft);
    await reopened.delete();
  });
  it("assigns durable FIFO order atomically across batches, concurrent submissions and reopen", async () => {
    const name = `drawing-queue-${crypto.randomUUID()}`, db = new AyaseDatabase(name);
    const repository = new DexieDrawingRepository(db);
    await db.drawingTasks.add({ ...queuedTask("legacy"), status: "completed" });
    const batch = [queuedTask("first"), queuedTask("second")];
    expect((await repository.enqueue(batch)).map(task => task.queueOrder)).toEqual([1, 2]);
    expect(batch.every(task => task.queueOrder === undefined)).toBe(true);
    const concurrent = await Promise.all([repository.enqueue([queuedTask("third")]), repository.enqueue([queuedTask("fourth")])]);
    expect(concurrent.flat().map(task => task.queueOrder).sort()).toEqual([3, 4]);
    db.close();
    const reopened = new AyaseDatabase(name), restored = new DexieDrawingRepository(reopened);
    expect((await restored.enqueue([queuedTask("fifth")]))[0].queueOrder).toBe(5);
    expect((await restored.load()).tasks.filter(task => task.queueOrder).map(task => task.queueOrder).sort()).toEqual([1, 2, 3, 4, 5]);
    await reopened.delete();
  });
  it("rolls back the whole batch after a duplicate ID and does not consume FIFO order", async () => {
    const db = new AyaseDatabase(`drawing-queue-rollback-${crypto.randomUUID()}`), repository = new DexieDrawingRepository(db);
    await repository.enqueue([queuedTask("existing")]);
    await expect(repository.enqueue([queuedTask("new"), queuedTask("existing")])).rejects.toThrow();
    expect((await repository.load()).tasks.map(task => task.id)).toEqual(["existing"]);
    expect((await repository.enqueue([queuedTask("after-failure")]))[0].queueOrder).toBe(2);
    await db.delete();
  });
  it("upgrades existing v6 data, saves task/results atomically and reloads an independent draft", async () => {
    const name = `drawing-test-${crypto.randomUUID()}`, legacy = new Dexie(name);
    legacy.version(6).stores({ chats: "id,updatedAt", assistants: "id,sortOrder", conversations: "id,assistantId,updatedAt",
      workspace: "id", legacyConversationConfigs: "id", avatarLibrary: "id", userAvatar: "id", cherryImports: "id", backupJournal: "id" });
    await legacy.table("chats").put({ id: "preserved", updatedAt: 1, messages: [] });
    legacy.close();
    const old = new AyaseDatabase(name), repository = new DexieDrawingRepository(old);
    const draft = { ...initialDrawingDraft, prompt: "synthetic drawing", modelId: "drawing-model", openai: { size: "3840x2160", quality: "max" } };
    await repository.saveDraft(draft);
    const task: DrawingTask = { id: "t", createdAt: "2026-10-01", updatedAt: "2026-10-01", status: "completed",
      parameters: { prompt: draft.prompt, size: "3840x2160", quality: "max", protocol: "openai-images", modelId: "test", modelName: "test",
        providerId: "p", connectionId: "c", configuredModelId: "drawing-model", baseUrl: "https://example.test" } };
    await repository.enqueue([task]);
    await repository.complete(task, [{ id: "r", taskId: "t", createdAt: task.createdAt, parameters: task.parameters,
      reference: "drawing/t/r.png", mime: "image/png", size: 10, width: 1, height: 1 }]);
    old.close();
    const reopened = new AyaseDatabase(name);
    expect(await new DexieDrawingRepository(reopened).load()).toMatchObject({ draft, tasks: [task], results: [{ id: "r" }] });
    expect(await reopened.chats.get("preserved")).toBeDefined();
    await reopened.delete();
  });
  it.each(["draft", "task", "result", "configuration", "openai-configuration"])("captures drawing %s without exporting raw drawing rows", async category => {
    const db = new AyaseDatabase(`drawing-backup-${crypto.randomUUID()}`), values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
    if (category === "draft") await db.drawingDrafts.put(initialDrawingDraft);
    if (category === "task") await db.drawingTasks.put({ ...queuedTask("t"), status: "completed" });
    if (category === "result") await db.drawingResults.put({ id: "r", taskId: "t", parameters: queuedTask("t").parameters, createdAt: "2026-10-01", reference: "drawing/t/r.png", mime: "image/png", size: 1, width: 1, height: 1 });
    if (category === "configuration") values.set(connectionSettingsStorageKey, JSON.stringify({ providers: [{ connections: [{ protocol: "gemini-image" }] }] }));
    if (category === "openai-configuration") values.set(connectionSettingsStorageKey, JSON.stringify({ providers: [{ connections: [{ protocol: "openai-images" }] }] }));
    const repository = new BackupRepository(db, storage);
    const snapshot = await repository.snapshot();
    expect(snapshot.drawing).toBeDefined();
    expect(snapshot.rows).not.toHaveProperty("drawingTasks");
    expect(snapshot.rows).not.toHaveProperty("drawingResults");
    expect(await db.backupJournal.count()).toBe(0);
    await db.delete();
  });
});
