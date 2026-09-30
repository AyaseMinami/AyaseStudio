import { AyaseDatabase } from "../storage/database";
import type { DrawingDraft, DrawingTask, DrawingResult } from "./types";

export interface DrawingSnapshot { draft?: DrawingDraft; tasks: DrawingTask[]; results: DrawingResult[] }
export interface DrawingRepository {
  load(): Promise<DrawingSnapshot>;
  saveDraft(draft: DrawingDraft): Promise<void>;
  saveTask(task: DrawingTask): Promise<void>;
  complete(task: DrawingTask, results: DrawingResult[]): Promise<void>;
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
  async saveTask(task: DrawingTask): Promise<void> { await this.database.drawingTasks.put(task); }
  async complete(task: DrawingTask, results: DrawingResult[]): Promise<void> {
    const db = this.database;
    await db.transaction("rw", [db.drawingTasks, db.drawingResults], async () => {
      await db.drawingResults.bulkPut(results);
      await db.drawingTasks.put(task);
    });
  }
}
