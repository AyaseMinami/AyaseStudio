import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AyaseDatabase } from "../storage/database";
import { createChatRepository } from "./repository";
import { defaultSessionConfig } from "./sessionConfig";
import { selectedConversation, workspaceDeletionFingerprint } from "./workspace";
import { deleteConnections, deleteProviders, type ConnectionSettingsState } from "./settings";

const databases: string[] = [];
const opened = new Map<string, AyaseDatabase>();
const open = AyaseDatabase.prototype.open;
beforeEach(() => { vi.spyOn(AyaseDatabase.prototype, "open").mockImplementation(function (this: AyaseDatabase) { opened.set(this.name, this); return open.call(this); }); });
afterEach(async () => { for (const name of databases.splice(0)) { opened.get(name)?.close(); await Dexie.delete(name); } opened.clear(); vi.restoreAllMocks(); });
async function setup() {
  const name = `Batch118-${crypto.randomUUID()}`; databases.push(name);
  const repo = createChatRepository(name);
  await repo.initializeWorkspace(null, []);
  for (const id of ["a", "b", "empty"]) await repo.execute({ type: "create-assistant", id,
    input: { name: id, icon: "", defaultModelId: null, defaultConfig: defaultSessionConfig() } });
  for (const [id, assistantId] of [["a1", "a"], ["a2", "a"], ["b1", "b"]]) {
    await repo.execute({ type: "create-conversation", id, assistantId });
    await repo.save({ id, updatedAt: 1, messages: [{ id: `${id}-message`, role: "user", content: `synthetic-${id}`, status: "complete" }] });
  }
  const snapshot = await repo.execute({ type: "select", assistantId: "a", conversationId: "a1" });
  const db = opened.get(name)!;
  return { repo, snapshot, db };
}

describe("atomic workspace batch deletion", () => {
  it("deletes selected conversations and legacy records together, repairing selection to a surviving sibling", async () => {
    const { repo, snapshot, db } = await setup();
    await db.table("legacyConversationConfigs").put({ id: "a1", generationConfig: defaultSessionConfig() });
    const next = await repo.execute({ type: "delete-conversations", ids: ["a1"], assistantId: "a",
      expected: workspaceDeletionFingerprint(snapshot, "conversations", ["a1"]) });
    expect(selectedConversation(next)?.id).toBe("a2");
    expect(await repo.load("a1")).toBeUndefined();
    expect(await db.table("legacyConversationConfigs").get("a1")).toBeUndefined();
    expect(await repo.load("b1")).toMatchObject({ messages: [{ content: "synthetic-b1" }] });
  });

  it("moves all conversations from multiple assistants without changing independent settings or messages", async () => {
    const { repo, snapshot } = await setup(), before = snapshot.conversations.find(item => item.id === "a1")!;
    const messages = await repo.load("a1");
    const next = await repo.execute({ type: "delete-assistants", ids: ["a", "b", "empty"], mode: "move",
      expected: workspaceDeletionFingerprint(snapshot, "assistants", ["a", "b", "empty"]) });
    expect(next.assistants.map(item => item.id)).toEqual(["default"]);
    expect(next.conversations.filter(item => ["a1", "a2", "b1"].includes(item.id)).every(item => item.assistantId === "default")).toBe(true);
    expect(next.conversations.find(item => item.id === "a1")?.settings).toEqual(before.settings);
    expect(await repo.load("a1")).toEqual(messages);
    expect(selectedConversation(next)?.id).toBe("a1");
  });

  it("permanently removes all selected assistant children while retaining the default assistant and unrelated history", async () => {
    const { repo, snapshot } = await setup();
    const next = await repo.execute({ type: "delete-assistants", ids: ["a", "b"], mode: "delete",
      expected: workspaceDeletionFingerprint(snapshot, "assistants", ["a", "b"]) });
    expect(next.assistants.map(item => item.id)).toEqual(["default", "empty"]);
    expect(next.conversations.map(item => item.id)).toEqual(["current"]);
    expect(selectedConversation(next)?.id).toBe("current");
    for (const id of ["a1", "a2", "b1"]) expect(await repo.load(id)).toBeUndefined();
  });

  it("rejects a newly added child before any deletion and accepts a freshly confirmed scope", async () => {
    const { repo, snapshot, db } = await setup();
    const expected = workspaceDeletionFingerprint(snapshot, "assistants", ["a", "b"]);
    const next = await repo.execute({ type: "create-conversation", id: "new", assistantId: "a" });
    const counts = await Promise.all(db.tables.map(table => table.count()));
    await expect(repo.execute({ type: "delete-assistants", ids: ["a", "b"], mode: "delete", expected })).rejects.toThrow("删除范围已变化");
    expect(await Promise.all(db.tables.map(table => table.count()))).toEqual(counts);
    await repo.execute({ type: "delete-assistants", ids: ["a", "b"], mode: "delete", expected: workspaceDeletionFingerprint(next, "assistants", ["a", "b"]) });
    expect(await repo.load("new")).toBeUndefined();
  });

  it("rejects missing, protected, duplicate and cross-assistant targets with zero partial deletion", async () => {
    const { repo, snapshot } = await setup();
    for (const ids of [["a", "missing"], ["a", "default"], ["a", "a"], []]) {
      await expect(repo.execute({ type: "delete-assistants", ids, mode: "delete", expected: workspaceDeletionFingerprint(snapshot, "assistants", ids) })).rejects.toThrow();
      expect(await repo.load("a1")).toBeDefined();
    }
    await expect(repo.execute({ type: "delete-conversations", ids: ["a1", "b1"], assistantId: "a",
      expected: workspaceDeletionFingerprint(snapshot, "conversations", ["a1", "b1"]) })).rejects.toThrow("同一助手");
    expect(await repo.load("a1")).toBeDefined(); expect(await repo.load("b1")).toBeDefined();
  });

  it("rolls back already removed transcripts when a later child deletion fails", async () => {
    const { repo, snapshot, db } = await setup();
    const fail = (_key: unknown, row: { id: string }) => { if (row.id === "a2") throw new Error("synthetic delete failure"); };
    db.table("conversations").hook("deleting", fail);
    try {
      await expect(repo.execute({ type: "delete-assistants", ids: ["a", "b"], mode: "delete",
        expected: workspaceDeletionFingerprint(snapshot, "assistants", ["a", "b"]) })).rejects.toThrow("synthetic delete failure");
    } finally { db.table("conversations").hook("deleting").unsubscribe(fail); }
    for (const id of ["a1", "a2", "b1"]) expect(await repo.load(id)).toBeDefined();
    expect(await db.table("assistants").get("a")).toBeDefined();
    expect(await db.table("workspace").get("selection")).toEqual(snapshot.selection);
  });

  it("does not mistake transcript activity timestamps for a change in the confirmed object scope", async () => {
    const { repo, snapshot } = await setup();
    await repo.save({ id: "a1", updatedAt: 999, messages: [{ id: "message", role: "user", content: "new synthetic history", status: "complete" }] });
    await repo.execute({ type: "delete-conversations", ids: ["a1"], assistantId: "a", expected: workspaceDeletionFingerprint(snapshot, "conversations", ["a1"]) });
    expect(await repo.load("a1")).toBeUndefined();
  });
});

describe("connection batch projections", () => {
  const state: ConnectionSettingsState = { version: 3, activeModelId: "ma", providers: [
    { id: "p", name: "P", connections: ["a", "b"].map(id => ({ id, name: id, protocol: "openai-chat", baseUrl: "https://example.invalid", apiKey: "", models: [{ id: `m${id}`, modelId: id }] })) },
    { id: "empty", name: "Empty", connections: [] },
  ] };
  it("removes the whole selected set and repairs the active model once", () => {
    expect(deleteConnections(state, "p", ["a", "b"])).toMatchObject({ activeModelId: null, providers: [{ id: "p", connections: [] }, { id: "empty" }] });
    expect(deleteProviders(state, ["p", "empty"]).providers).toEqual([]);
    expect(state.providers[0].connections).toHaveLength(2);
  });
  it("refuses an invalid whole set rather than deleting the valid subset", () => {
    expect(deleteConnections(state, "p", ["a", "missing"])).toBe(state);
    expect(deleteProviders(state, ["p", "missing"])).toBe(state);
    expect(deleteProviders(state, ["p", "p"])).toBe(state);
  });
});
