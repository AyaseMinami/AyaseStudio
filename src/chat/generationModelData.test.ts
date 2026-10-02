import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AyaseDatabase } from "../storage/database";
import { readMessageGenerationMetrics } from "./generationMetricsData";
import { createChatRepository, type StoredChatMessage } from "./repository";

const databases: AyaseDatabase[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const db of databases.splice(0)) await db.delete(); });
const user = (): StoredChatMessage => ({ id: "u", role: "user", content: "question", status: "complete" });
const answer = (): StoredChatMessage => ({ id: "a", role: "assistant", replyToId: "u", content: "reply", status: "complete", generationModel: "  requested/model-id  " });
function snapshot() {
  return { id: "c", updatedAt: 1, messages: [
    { ...user(), roundVersions: { selected: 0, pairs: [[user(), answer()]] as [StoredChatMessage, StoredChatMessage][] } }, answer(),
  ] };
}

describe("historical reply model data", () => {
  it("clones recursively and idempotently without normalizing the exact model ID", () => {
    const input = snapshot().messages[0], before = structuredClone(input);
    const result = readMessageGenerationMetrics(input);
    expect(result).toEqual(before); expect(result).not.toBe(input);
    expect(result.roundVersions).not.toBe(input.roundVersions);
    expect(readMessageGenerationMetrics(result)).toEqual(before);
    expect(result.roundVersions!.pairs[0][1].generationModel).toBe("  requested/model-id  ");
    expect(input).toEqual(before);
  });
  it("leaves missing and explicitly undefined legacy values uninferred", () => {
    const old = answer(); delete old.generationModel;
    expect(readMessageGenerationMetrics(old)).not.toHaveProperty("generationModel");
    expect(readMessageGenerationMetrics({ ...user(), generationModel: undefined })).toEqual({ ...user(), generationModel: undefined });
  });
  it("preserves snapshots and absence after saving and reopening the database", async () => {
    const db = new AyaseDatabase(`model-data-${crypto.randomUUID()}`); databases.push(db);
    const repo = createChatRepository(db.name), input = snapshot();
    delete input.messages[1].generationModel;
    await repo.save(input);
    expect(await createChatRepository(db.name).load("c")).toEqual(input);
    expect((await repo.load("c"))!.messages[1]).not.toHaveProperty("generationModel");
  });
  it.each([null, "", " \t\n", 12, {}, []])("rejects invalid nested model %# before local writes and retains originals", async value => {
    const db = new AyaseDatabase(`model-invalid-${crypto.randomUUID()}`); databases.push(db);
    const repo = createChatRepository(db.name), input = snapshot(); await repo.save(input);
    Object.assign(input.messages[0].roundVersions!.pairs[0][1], { generationModel: value });
    const original = structuredClone(input), saved = await db.chats.toArray();
    const write = vi.spyOn(db.chats, "put");
    await expect(repo.save(input)).rejects.toThrow();
    expect(write).not.toHaveBeenCalled(); expect(input).toEqual(original); expect(await db.chats.toArray()).toEqual(saved);
    await db.chats.put(input);
    write.mockClear();
    const assistantWrite = vi.spyOn(db.assistants, "put"), conversationWrite = vi.spyOn(db.conversations, "put"), workspaceWrite = vi.spyOn(db.workspace, "put");
    await expect(repo.load("c")).rejects.toThrow();
    await expect(repo.initializeWorkspace(null, [])).rejects.toThrow();
    expect(write).not.toHaveBeenCalled(); expect(assistantWrite).not.toHaveBeenCalled();
    expect(conversationWrite).not.toHaveBeenCalled(); expect(workspaceWrite).not.toHaveBeenCalled();
    expect(await db.chats.get("c")).toEqual(original);
    expect(await db.assistants.count()).toBe(0); expect(await db.conversations.count()).toBe(0); expect(await db.workspace.count()).toBe(0);
  });
  it.each(["user", "system"])("rejects a model snapshot owned by %s", role => {
    const raw = { ...answer(), role }, original = structuredClone(raw);
    expect(() => readMessageGenerationMetrics(raw)).toThrow(); expect(raw).toEqual(original);
  });
});
