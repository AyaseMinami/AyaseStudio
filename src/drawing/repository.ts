import { AyaseDatabase } from "../storage/database";
import type { DrawingDraft, DrawingTask, DrawingResult } from "./types";

export interface DrawingSnapshot { draft?: DrawingDraft; tasks: DrawingTask[]; results: DrawingResult[] }
export interface DrawingRepository {
  load(): Promise<DrawingSnapshot>;
  saveDraft(draft: DrawingDraft): Promise<void>;
  saveTask(task: DrawingTask): Promise<void>;
  enqueue(tasks: DrawingTask[]): Promise<DrawingTask[]>;
  complete(task: DrawingTask, results: DrawingResult[]): Promise<void>;
  removeTasks(ids: string[]): Promise<void>;
}

export class DexieDrawingRepository implements DrawingRepository {
  constructor(private readonly database = new AyaseDatabase("AyaseStudio")) {}
  load(): Promise<DrawingSnapshot> {
    const db = this.database;
    return db.transaction("r", [db.drawingDrafts, db.drawingTasks, db.drawingResults], async () => ({
      draft: await db.drawingDrafts.get("current"), tasks: await db.drawingTasks.toArray(),
      results: await db.drawingResults.toArray(),
    }));
  }
  async saveDraft(draft: DrawingDraft): Promise<void> { await this.database.drawingDrafts.put(draft); }
  async saveTask(task: DrawingTask): Promise<void> {
    await this.database.transaction("rw", this.database.drawingTasks, async () => {
      if (!await this.database.drawingTasks.get(task.id)) throw new Error("Drawing task no longer exists");
      await this.database.drawingTasks.put(task);
    });
  }
  async removeTasks(ids: string[]): Promise<void> {
    const db = this.database;
    await db.transaction("rw", db.drawingTasks, async () => {
      const tasks = await db.drawingTasks.bulkGet(ids);
      if (tasks.some(task => task && ["queued", "preparing", "dispatching", "running", "saving"].includes(task.status)))
        throw new Error("Only terminal drawing history can be removed");
      await db.drawingTasks.bulkDelete(ids);
    });
  }
  async enqueue(tasks: DrawingTask[]): Promise<DrawingTask[]> {
    const db = this.database;
    return db.transaction("rw", db.drawingTasks, async () => {
      const existing = await db.drawingTasks.toArray();
      const last = existing.reduce((max, task) => Math.max(max, task.queueOrder ?? 0), 0);
      const ordered = tasks.map((task, index) => ({ ...task, queueOrder: last + index + 1 }));
      await db.drawingTasks.bulkAdd(ordered);
      return ordered;
    });
  }
  async complete(task: DrawingTask, results: DrawingResult[]): Promise<void> {
    const db = this.database;
    await db.transaction("rw", [db.drawingTasks, db.drawingResults], async () => {
      if (!await db.drawingTasks.get(task.id)) throw new Error("Drawing task no longer exists");
      await db.drawingResults.bulkPut(results);
      await db.drawingTasks.put(task);
    });
  }
}
