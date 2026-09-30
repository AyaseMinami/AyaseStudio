import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { AyaseDatabase } from "../storage/database";
import { DexieDrawingRepository } from "./repository";
import { initialDrawingDraft, type DrawingTask } from "./types";
import { BackupRepository, drawingBackupBlockedMessage } from "../backup/repository";
import { connectionSettingsStorageKey } from "../chat/settings";

describe("durable drawing repository and backup maintenance gate", () => {
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
    await repository.complete(task, [{ id: "r", taskId: "t", createdAt: task.createdAt, parameters: task.parameters,
      reference: "drawing/t/r.png", mime: "image/png", size: 10, width: 1, height: 1 }]);
    old.close();
    const reopened = new AyaseDatabase(name);
    expect(await new DexieDrawingRepository(reopened).load()).toMatchObject({ draft, tasks: [task], results: [{ id: "r" }] });
    expect(await reopened.chats.get("preserved")).toBeDefined();
    await reopened.delete();
  });
  it.each(["draft", "task", "result", "configuration", "openai-configuration"])("blocks legacy backup with drawing %s even through the direct backup API", async category => {
    const db = new AyaseDatabase(`drawing-backup-${crypto.randomUUID()}`), values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
    if (category === "draft") await db.drawingDrafts.put(initialDrawingDraft);
    if (category === "task") await db.table("drawingTasks").put({ id: "t" });
    if (category === "result") await db.table("drawingResults").put({ id: "r" });
    if (category === "configuration") values.set(connectionSettingsStorageKey, JSON.stringify({ providers: [{ connections: [{ protocol: "gemini-image" }] }] }));
    if (category === "openai-configuration") values.set(connectionSettingsStorageKey, JSON.stringify({ providers: [{ connections: [{ protocol: "openai-images" }] }] }));
    const repository = new BackupRepository(db, storage);
    await expect(repository.snapshot()).rejects.toThrow(drawingBackupBlockedMessage);
    expect(await db.backupJournal.count()).toBe(0);
    await db.delete();
  });
});
