import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AyaseDatabase } from "../storage/database";
import { DexieDrawingPresetRepository } from "./presets";
import { initialDrawingDraft, type DrawingResult, type DrawingTask } from "./types";

const databases: Dexie[] = [];
afterEach(async () => {
  vi.restoreAllMocks(); vi.useRealTimers();
  for (const db of databases.splice(0)) await db.delete();
});
function setup() {
  const db = new AyaseDatabase(`drawing-presets-${crypto.randomUUID()}`); databases.push(db);
  return { db, repository: new DexieDrawingPresetRepository(db) };
}

describe("pure-text drawing preset persistence", () => {
  it("creates, updates and removes independent presets durably across reopen", async () => {
    const { db, repository } = setup();
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-01T01:00:00Z"));
    const created = await repository.create({ name: "  风景  ", content: "  山峰\n\n云雾  " });
    expect(created).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), name: "风景", content: "  山峰\n\n云雾  ",
      createdAt: "2026-10-01T01:00:00.000Z", updatedAt: "2026-10-01T01:00:00.000Z" });
    vi.setSystemTime(new Date("2026-10-01T02:00:00Z"));
    const updated = await repository.update(created.id, { name: " 新风景 ", content: "\n雪山\n" });
    expect(updated).toEqual({ ...created, name: "新风景", content: "\n雪山\n", updatedAt: "2026-10-01T02:00:00.000Z" });
    const duplicate = await repository.create({ name: "新风景", content: "同名独立预设" });
    expect(duplicate.id).not.toBe(created.id);
    db.close();
    const reopened = new AyaseDatabase(db.name); databases.push(reopened);
    const restored = new DexieDrawingPresetRepository(reopened);
    expect(await restored.load()).toEqual([updated, duplicate]);
    await restored.remove(updated.id); await restored.remove("already-missing"); reopened.close();
    const final = new AyaseDatabase(db.name); databases.push(final);
    expect(await new DexieDrawingPresetRepository(final).load()).toEqual([duplicate]);
  });

  it("persists only the five approved fields even when callers pass binding or credential fields", async () => {
    const { db, repository } = setup();
    const input = { name: "名称", content: "文本", id: "injected", createdAt: "injected", updatedAt: "injected",
      modelId: "model", providerId: "provider", connectionId: "connection", apiKey: "synthetic-key",
      parameters: { size: "large" }, references: ["synthetic.png"] };
    const created = await repository.create(input);
    expect(Object.keys(created).sort()).toEqual(["content", "createdAt", "id", "name", "updatedAt"]);
    expect(created.id).not.toBe(input.id);
    expect(await db.drawingPromptPresets.get(created.id)).toEqual(created);
    const updated = await repository.update(created.id, { ...input, name: "更新" });
    expect(Object.keys(updated).sort()).toEqual(["content", "createdAt", "id", "name", "updatedAt"]);
    expect(await db.drawingPromptPresets.get(created.id)).toEqual(updated);
    expect(await db.drawingDrafts.count()).toBe(0);
    expect(await db.drawingTasks.count()).toBe(0);
    expect(await db.drawingResults.count()).toBe(0);
  });

  it.each([{ name: " \n\t", content: "text" }, { name: "name", content: " \n\t" }])(
    "rejects blank names or contents without changing records", async input => {
      const { repository } = setup(), created = await repository.create({ name: "before", content: "before" });
      await expect(repository.create(input)).rejects.toThrow();
      await expect(repository.update(created.id, input)).rejects.toThrow();
      expect(await repository.load()).toEqual([created]);
    },
  );

  it("rejects updating a missing or deleted preset instead of recreating it", async () => {
    const { repository } = setup();
    await expect(repository.update("missing", { name: "name", content: "text" })).rejects.toThrow("不存在");
    const created = await repository.create({ name: "name", content: "text" });
    await repository.remove(created.id);
    await expect(repository.update(created.id, { name: "name", content: "text" })).rejects.toThrow("不存在");
    expect(await repository.load()).toEqual([]);
  });

  it("propagates CRUD failures and preserves the prior state after failed writes", async () => {
    const { db, repository } = setup(), failure = new Error("synthetic storage failure");
    vi.spyOn(db.drawingPromptPresets, "add").mockRejectedValueOnce(failure);
    await expect(repository.create({ name: "name", content: "text" })).rejects.toBe(failure);
    expect(await repository.load()).toEqual([]);
    const created = await repository.create({ name: "name", content: "text" });
    vi.spyOn(db.drawingPromptPresets, "put").mockRejectedValueOnce(failure);
    await expect(repository.update(created.id, { name: "changed", content: "changed" })).rejects.toBe(failure);
    vi.spyOn(db.drawingPromptPresets, "delete").mockRejectedValueOnce(failure);
    await expect(repository.remove(created.id)).rejects.toBe(failure);
    expect(await repository.load()).toEqual([created]);
    vi.spyOn(db.drawingPromptPresets, "toArray").mockRejectedValueOnce(failure);
    await expect(repository.load()).rejects.toBe(failure);
  });

  it("uses creation time and then ID for deterministic load order", async () => {
    const { db, repository } = setup();
    const row = { name: "name", content: "text", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" };
    await db.drawingPromptPresets.bulkAdd([{ ...row, id: "z" }, { ...row, id: "b", createdAt: "2026-09-30T00:00:00.000Z" }, { ...row, id: "a" }]);
    expect((await repository.load()).map(item => item.id)).toEqual(["b", "a", "z"]);
    expect((await repository.load()).map(item => item.id)).toEqual(["b", "a", "z"]);
  });

  it("adds v8 presets while preserving every v7 table, including prior chat and drawing records", async () => {
    const name = `drawing-v7-${crypto.randomUUID()}`, legacy = new Dexie(name); databases.push(legacy);
    const schema = { chats: "id,updatedAt", assistants: "id,sortOrder", conversations: "id,assistantId,updatedAt", workspace: "id",
      legacyConversationConfigs: "id", avatarLibrary: "id", userAvatar: "id", cherryImports: "id", backupJournal: "id",
      drawingDrafts: "id", drawingTasks: "id,createdAt", drawingResults: "id,taskId,createdAt" };
    legacy.version(7).stores(schema);
    const task: DrawingTask = { id: "task", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", status: "completed",
      parameters: { protocol: "gemini-image", prompt: "saved", aspectRatio: "auto", resolution: "auto", providerId: "p", connectionId: "c",
        configuredModelId: "configured", modelId: "model", modelName: "model", baseUrl: "https://example.invalid" } };
    const result: DrawingResult = { id: "result", taskId: task.id, createdAt: task.createdAt, parameters: task.parameters,
      reference: "drawing/task/result.png", mime: "image/png", size: 1, width: 1, height: 1 };
    const rows: Record<string, object> = Object.fromEntries(Object.keys(schema).map(table => [table, { id: `${table}-preserved`, marker: table }]));
    rows.chats = { id: "chat", updatedAt: 1, messages: [{ id: "user", role: "user", content: "saved chat", status: "complete" }] };
    rows.drawingDrafts = { ...initialDrawingDraft, prompt: "saved draft" }; rows.drawingTasks = task; rows.drawingResults = result;
    for (const [table, row] of Object.entries(rows)) await legacy.table(table).put(row);
    legacy.close();
    const db = new AyaseDatabase(name); databases.push(db);
    const repository = new DexieDrawingPresetRepository(db);
    expect(await repository.load()).toEqual([]); expect(db.verno).toBe(8);
    for (const [table, row] of Object.entries(rows)) expect(await db.table(table).toArray()).toEqual([row]);
    await repository.create({ name: "new preset", content: "text" });
    for (const [table, row] of Object.entries(rows)) expect(await db.table(table).toArray()).toEqual([row]);
  });
});
