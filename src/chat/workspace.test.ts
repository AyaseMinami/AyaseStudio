import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { createChatRepository } from "./repository";
import { defaultSessionConfig } from "./sessionConfig";
import { SessionStore } from "./sessionStore";
import { selectedConversation } from "./workspace";

const input = () => ({ name: "写作", icon: "📝", defaultModelId: "model-a", defaultConfig: { ...defaultSessionConfig(), systemInstruction: "Write clearly" } });
const name = () => `Workspace-${crypto.randomUUID()}`;

describe("assistant and conversation repository", () => {
  it("archives v2 conversation settings once while preserving assistant settings and transcripts", async () => {
    const databaseName = name(); const old = new Dexie(databaseName);
    old.version(2).stores({ chats: "id,updatedAt", assistants: "id,sortOrder", conversations: "id,assistantId,updatedAt", workspace: "id" });
    const config = { ...defaultSessionConfig(), systemInstruction: "Conversation override" };
    await old.table("assistants").put({ id: "default", sortOrder: 0, ...input(), name: "默认助手" });
    await old.table("conversations").put({ id: "current", assistantId: "default", title: "Saved", lastUsedModelId: "model-b", createdAt: 1, updatedAt: 12 });
    await old.table("chats").put({ id: "current", updatedAt: 12, messages: [{ id: "u", role: "user", content: "Preserved", status: "complete" }], generationConfig: config });
    await old.table("workspace").put({ id: "selection", activeAssistantId: "default", lastSelected: { default: "current" } });
    old.close();
    const repo = createChatRepository(databaseName);
    const state = await repo.initializeWorkspace(null, ["model-a", "model-b"]);
    expect(state.assistants[0].defaultConfig.systemInstruction).toBe("Write clearly");
    expect(state.assistants[0].defaultModelId).toBe("model-a");
    expect(state.conversations[0]).not.toHaveProperty("lastUsedModelId");
    const raw = new Dexie(databaseName); await raw.open();
    expect(await raw.table("legacyConversationConfigs").get("current")).toEqual({ id: "current", generationConfig: config, lastUsedModelId: "model-b" });
    const store = new SessionStore(repo, "current"); await store.hydrate();
    expect((await repo.load("current"))?.updatedAt).toBe(12);
    await store.updateMessages([{ id: "u", role: "user", content: "Preserved", status: "complete" }]);
    await repo.initializeWorkspace(null, ["model-a", "model-b"]);
    expect(await raw.table("legacyConversationConfigs").get("current")).toEqual({ id: "current", generationConfig: config, lastUsedModelId: "model-b" });
    expect((await repo.load("current"))?.generationConfig).toBeUndefined();
    await repo.execute({ type: "delete-conversation", id: "current" });
    expect(await raw.table("legacyConversationConfigs").count()).toBe(0);
    raw.close();
  });
  it("migrates a real version 1 database without changing message IDs/content/config, and is idempotent", async () => {
    const databaseName = name();
    const legacy = new Dexie(databaseName);
    legacy.version(1).stores({ chats: "id,updatedAt" });
    const config = { ...defaultSessionConfig(), systemInstruction: "Legacy instruction" };
    const messages = [{ id: "original", role: "assistant", content: "原文", status: "streaming" }];
    await legacy.table("chats").put({ id: "current", updatedAt: 12, messages, generationConfig: config });
    legacy.close();
    const repository = createChatRepository(databaseName);
    const first = await repository.initializeWorkspace("model-a", ["model-a"]);
    expect(first.assistants).toHaveLength(1);
    expect(selectedConversation(first)).toMatchObject({ id: "current", assistantId: "default" });
    expect(first.assistants[0]).toMatchObject({ defaultModelId: "model-a", defaultConfig: config });
    expect(await repository.load("current")).toMatchObject({ messages });
    expect((await repository.load("current"))?.generationConfig).toBeUndefined();
    expect(await repository.initializeWorkspace("another-model", ["model-a"])).toEqual(first);
    const store = new SessionStore(repository, "current");
    expect((await store.hydrate()).messages[0]).toMatchObject({ id: "original", content: "原文", status: "aborted" });
  });

  it("stores configuration only on assistants and restores navigation without rewriting messages", async () => {
    const repo = createChatRepository(name());
    await repo.initializeWorkspace(null, ["model-a", "model-b"]);
    await repo.execute({ type: "create-assistant", id: "writer", input: input() });
    await repo.execute({ type: "create-conversation", id: "a", assistantId: "writer" });
    const store = new SessionStore(repo, "a"); await store.hydrate();
    await store.updateMessages([{ id: "u", role: "user", content: "Keep this", status: "complete" }]);
    await repo.execute({ type: "edit-assistant", id: "writer", input: { ...input(), defaultModelId: "model-b", defaultConfig: { ...defaultSessionConfig(), systemInstruction: "New default" } } });
    expect((await repo.load("a"))?.generationConfig).toBeUndefined();
    await repo.execute({ type: "create-conversation", id: "b", assistantId: "writer" });
    expect((await repo.load("b"))?.generationConfig).toBeUndefined();
    await repo.execute({ type: "rename-conversation", id: "a", title: "第一篇" });
    await repo.execute({ type: "select", assistantId: "writer", conversationId: "a" });
    await repo.execute({ type: "select", assistantId: "default" });
    const restored = await repo.execute({ type: "select", assistantId: "writer" });
    expect(selectedConversation(restored)?.id).toBe("a");
    expect((await repo.initializeWorkspace(null, ["model-a", "model-b"])).selection).toEqual(restored.selection);
    await store.flush();
    expect(restored.assistants.find((item) => item.id === "writer")?.defaultModelId).toBe("model-b");
    const restoredStore = new SessionStore(repo, "a");
    expect(await restoredStore.hydrate()).toMatchObject({ messages: [{ content: "Keep this" }] });
  });

  it("moves conversations safely, prevents deleting the default assistant, and never resurrects a deleted conversation", async () => {
    const repo = createChatRepository(name());
    await repo.initializeWorkspace(null, ["model-a"]);
    await repo.execute({ type: "create-assistant", id: "writer", input: input() });
    await repo.execute({ type: "create-conversation", id: "a", assistantId: "writer" });
    const old = (await repo.load("a"))!;
    const moved = await repo.execute({ type: "delete-assistant", id: "writer", mode: "move" });
    expect(selectedConversation(moved)).toMatchObject({ id: "a", assistantId: "default" });
    expect(await repo.load("a")).toEqual(old);
    await expect(repo.execute({ type: "delete-assistant", id: "default", mode: "delete" })).rejects.toThrow("不能删除");
    await repo.execute({ type: "delete-conversation", id: "a" });
    await expect(repo.save(old)).rejects.toThrow("已删除");
    expect(await repo.load("a")).toBeUndefined();
    const restarted = await repo.initializeWorkspace(null, ["model-a"]);
    expect(restarted.conversations.some((item) => item.id === "a")).toBe(false);
  });

  it("permanently deletes assistant messages only with the explicit delete command", async () => {
    const repo = createChatRepository(name());
    await repo.initializeWorkspace(null, []);
    await repo.execute({ type: "create-assistant", id: "writer", input: input() });
    for (const id of ["a", "b"]) await repo.execute({ type: "create-conversation", id, assistantId: "writer" });
    const result = await repo.execute({ type: "delete-assistant", id: "writer", mode: "delete" });
    expect(result.conversations.map((item) => item.id)).toEqual(["current"]);
    expect(await repo.load("a")).toBeUndefined();
    expect(await repo.load("b")).toBeUndefined();
  });

  it("repairs orphan ownership and invalid selections/models deterministically without dropping messages", async () => {
    const databaseName = name(); const repo = createChatRepository(databaseName);
    await repo.initializeWorkspace("gone", []);
    const raw = new Dexie(databaseName); await raw.open();
    await raw.table("conversations").update("current", { assistantId: "missing", lastUsedModelId: "deleted" });
    await raw.table("workspace").put({ id: "selection", activeAssistantId: "missing", lastSelected: { default: "missing" } });
    await raw.table("chats").put({ id: "orphan", updatedAt: 2, messages: [{ id: "m", role: "user", content: "preserved", status: "complete" }] });
    raw.close();
    const repaired = await repo.initializeWorkspace("gone", []);
    expect(repaired.conversations).toHaveLength(2);
    expect(repaired.conversations.every((item) => item.assistantId === "default")).toBe(true);
    expect(repaired.selection.activeAssistantId).toBe("default");
    expect(await repo.load("orphan")).toMatchObject({ messages: [{ content: "preserved" }] });
    expect(await repo.initializeWorkspace("gone", [])).toEqual(repaired);
  });

  it("rolls back the whole create action when the message record cannot be inserted", async () => {
    const databaseName = name(); const repo = createChatRepository(databaseName);
    const initial = await repo.initializeWorkspace(null, []);
    const raw = new Dexie(databaseName); await raw.open();
    await raw.table("chats").put({ id: "collision", updatedAt: 0, messages: [] });
    await expect(repo.execute({ type: "create-conversation", id: "collision", assistantId: "default" })).rejects.toThrow();
    expect(await raw.table("conversations").get("collision")).toBeUndefined();
    expect(await raw.table("workspace").get("selection")).toEqual(initial.selection);
    raw.close();
  });

  it("persists explicit sorting and rejects cross-assistant selection", async () => {
    const repo = createChatRepository(name()); await repo.initializeWorkspace(null, []);
    await repo.execute({ type: "create-assistant", id: "writer", input: input() });
    const moved = await repo.execute({ type: "move-assistant", id: "writer", direction: -1 });
    expect(moved.assistants.map((item) => item.id)).toEqual(["writer", "default"]);
    await expect(repo.execute({ type: "select", assistantId: "writer", conversationId: "current" })).rejects.toThrow("不属于");
  });
});
