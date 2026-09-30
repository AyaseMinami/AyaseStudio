import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { defaultSessionConfig } from "../chat/sessionConfig";
import { AyaseDatabase } from "../storage/database";
import { createCherryImportRepository } from "./cherryRepository";
import type { CherryImportPlan } from "./cherryTypes";

const databases: AyaseDatabase[] = [];
afterEach(async () => {
  const names = new Set(databases.map((database) => database.name));
  for (const database of databases.splice(0)) database.close();
  for (const name of names) await new AyaseDatabase(name).delete();
});

function plan(): CherryImportPlan {
  return { format: 7, assistants: [{ id: "source-assistant", name: "Cherry 助手" }], warnings: [], conversations: [{
    sourceKey: "source-topic/path", topicId: "source-topic", assistantId: "source-assistant", title: "导入标题",
    createdAt: 1000, updatedAt: 3000, messages: [
      { sourceId: "source-user", role: "user", content: "hello", createdAt: 1001, status: "complete", files: [] },
      { sourceId: "source-reply", role: "assistant", content: "world", thinkingSummary: "summary", createdAt: 1002,
        status: "incomplete", replyToSourceId: "source-user", files: [] },
    ],
  }] };
}

async function setup() {
  const database = new AyaseDatabase(`CherryImport-${crypto.randomUUID()}`);
  databases.push(database);
  const selection = { id: "selection" as const, activeAssistantId: "default", lastSelected: { default: "current" } };
  await database.assistants.add({ id: "default", name: "默认助手", icon: "", sortOrder: 0,
    defaultModelId: "live-model", defaultConfig: { ...defaultSessionConfig(), systemInstruction: "live prompt" } });
  await database.conversations.add({ id: "current", assistantId: "default", title: "existing", createdAt: 1, updatedAt: 2 });
  await database.chats.add({ id: "current", updatedAt: 2, messages: [] });
  await database.workspace.add(selection);
  return { database, selection, repository: createCherryImportRepository(database.name, database) };
}

describe("Cherry import repository", () => {
  it("adds version 5 markers without rewriting version 4 workspace data", async () => {
    const name = `CherryUpgrade-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(4).stores({ chats: "id,updatedAt", assistants: "id,sortOrder", conversations: "id,assistantId,updatedAt",
      workspace: "id", legacyConversationConfigs: "id", avatarLibrary: "id", userAvatar: "id" });
    const chat = { id: "legacy", updatedAt: 12, messages: [{ id: "legacy-message", role: "user", content: "original", status: "complete" }] };
    const avatar = { id: "legacy-avatar", untouched: "avatar data" };
    await legacy.table("chats").add(chat);
    await legacy.table("avatarLibrary").add(avatar);
    legacy.close();
    const database = new AyaseDatabase(name);
    databases.push(database);
    await database.open();
    expect(database.verno).toBe(7);
    expect(await database.chats.get(chat.id)).toEqual(chat);
    expect(await database.avatarLibrary.get(avatar.id)).toEqual(avatar);
    expect(await database.cherryImports.count()).toBe(0);
  });

  it("imports ordered linked messages with fresh IDs, allowlisted provenance and independent empty model settings", async () => {
    const { database, selection, repository } = await setup();
    const input = plan();
    input.conversations[0].messages[0].attachments = [{ reference: "attachments/123e4567-e89b-42d3-a456-426614174000.txt",
      name: "notes.txt", mimeType: "text/plain", size: 3 }];
    Object.assign(input.assistants[0], { defaultModelId: "backup-model", prompt: "backup secret" });
    Object.assign(input.conversations[0].messages[0], { providerReplay: { secret: "ignored" }, apiKey: "ignored" });
    await expect(repository.commit(input, "skip")).resolves.toEqual({ imported: 1, skipped: 0 });
    const assistant = (await database.assistants.toArray()).find((item) => item.id !== "default")!;
    const conversation = (await database.conversations.toArray()).find((item) => item.id !== "current")!;
    const chat = (await database.chats.get(conversation.id))!;
    expect(assistant).toEqual({ id: expect.any(String), name: "Cherry 助手", icon: "", sortOrder: 1,
      defaultModelId: null, defaultConfig: defaultSessionConfig() });
    expect(assistant.id).not.toBe("source-assistant");
    expect(conversation).toEqual({ id: expect.any(String), assistantId: assistant.id, title: "导入标题", titleNaming: "manual",
      createdAt: 1000, updatedAt: 3000, settings: { modelId: null, config: defaultSessionConfig() } });
    expect(chat.messages.map((message) => message.content)).toEqual(["hello", "world"]);
    expect(chat.messages[0]).toEqual({ id: expect.any(String), role: "user", content: "hello", status: "complete",
      source: { source: "cherry", id: "source-user", createdAt: 1001 }, attachments: input.conversations[0].messages[0].attachments });
    expect(chat.messages[1]).toEqual({ id: expect.any(String), role: "assistant", content: "world", status: "incomplete",
      source: { source: "cherry", id: "source-reply", createdAt: 1002 }, replyToId: chat.messages[0].id, thinkingSummary: "summary" });
    expect(chat.messages[0].id).not.toBe("source-user");
    expect(chat.messages[1].id).not.toBe("source-reply");
    expect(await database.workspace.get("selection")).toEqual(selection);
    expect(await database.cherryImports.count()).toBe(2);
  });

  it("groups conversations by source assistant, reuses the live assistant and freezes default config for copies", async () => {
    const { database, repository } = await setup();
    const input = plan();
    input.conversations.push({ ...structuredClone(input.conversations[0]), sourceKey: "second", topicId: "second" });
    await expect(repository.commit(input, "skip")).resolves.toEqual({ imported: 2, skipped: 0 });
    expect(await database.assistants.count()).toBe(2);
    const assistant = (await database.assistants.toArray()).find((item) => item.id !== "default")!;
    await database.assistants.update(assistant.id, { defaultModelId: "edited-model",
      defaultConfig: { ...defaultSessionConfig(), systemInstruction: "edited prompt" } });
    await expect(repository.commit(input, "copy")).resolves.toEqual({ imported: 2, skipped: 0 });
    expect(await database.assistants.count()).toBe(2);
    const conversations = (await database.conversations.toArray()).filter((item) => item.id !== "current");
    expect(conversations).toHaveLength(4);
    for (const conversation of conversations) {
      expect(conversation.assistantId).toBe(assistant.id);
      expect(conversation.settings).toEqual({ modelId: null, config: defaultSessionConfig() });
    }
    const messageIds = (await database.chats.toArray()).flatMap((chat) => chat.messages.map((message) => message.id));
    expect(new Set(messageIds).size).toBe(8);
  });

  it("durably reloads missing attachment names as source metadata while preserving the original message content", async () => {
    const { database, repository } = await setup();
    const input = plan();
    input.conversations[0].messages[0].files = [{ key: "missing-file", name: "丢失的图片.png" }];
    input.conversations[0].messages[0].unavailableAttachments = ["丢失的图片.png"];
    await repository.commit(input, "skip");
    const conversation = (await database.conversations.toArray()).find((item) => item.id !== "current")!;
    database.close();
    const reopened = new AyaseDatabase(database.name);
    databases.push(reopened);
    const message = (await reopened.chats.get(conversation.id))!.messages[0];
    expect(message.content).toBe("hello");
    expect(message.source).toEqual({ source: "cherry", id: "source-user", createdAt: 1001,
      unavailableAttachments: ["丢失的图片.png"] });
    expect(message.attachments).toBeUndefined();
    expect(message).not.toHaveProperty("files");
  });

  it.each(["", "  ", "../secret.txt", "private\\secret.txt", "line\nname.txt", "nul\u0000name.txt", "x".repeat(4097)])(
    "rejects unsafe missing attachment labels before any write", async (name) => {
      const { database, repository } = await setup();
      const input = plan();
      input.conversations[0].messages[0].unavailableAttachments = [name];
      await expect(repository.commit(input, "skip")).rejects.toThrow("导入计划无效。");
      expect(await database.cherryImports.count()).toBe(0);
    });

  it("rejects excessive missing attachment descriptors before any write", async () => {
    const { database, repository } = await setup();
    const input = plan();
    input.conversations[0].messages[0].unavailableAttachments = Array.from({ length: 1001 }, () => "missing.png");
    await expect(repository.commit(input, "skip")).rejects.toThrow("导入计划无效。");
    expect(await database.cherryImports.count()).toBe(0);
  });

  it("skips live sources, preserves all copies, prunes dead copies and allows reimport after all targets are deleted", async () => {
    const { database, repository } = await setup();
    const input = plan();
    await repository.commit(input, "skip");
    await expect(repository.existingSourceKeys([input.conversations[0].sourceKey, "missing", input.conversations[0].sourceKey]))
      .resolves.toEqual([input.conversations[0].sourceKey]);
    await expect(repository.commit(input, "skip")).resolves.toEqual({ imported: 0, skipped: 1 });
    const first = (await database.conversations.toArray()).find((item) => item.id !== "current")!;
    await repository.commit(input, "copy");
    const second = (await database.conversations.toArray()).find((item) => item.id !== "current" && item.id !== first.id)!;
    await database.conversations.delete(second.id);
    await database.chats.delete(second.id);
    await expect(repository.existingSourceKeys([input.conversations[0].sourceKey])).resolves.toEqual([input.conversations[0].sourceKey]);
    await repository.commit(input, "skip");
    const marker = (await database.cherryImports.toArray()).find((item) => "conversationIds" in item)!;
    expect(marker).toEqual({ id: marker.id, conversationIds: [first.id] });
    await database.conversations.delete(first.id);
    await database.chats.delete(first.id);
    await expect(repository.existingSourceKeys([input.conversations[0].sourceKey])).resolves.toEqual([]);
    await expect(repository.commit(input, "skip")).resolves.toEqual({ imported: 1, skipped: 0 });
    expect(await database.assistants.count()).toBe(2);
    expect(await database.conversations.count()).toBe(2);
  });

  it("recreates a deleted source assistant without restoring old IDs", async () => {
    const { database, repository } = await setup();
    await repository.commit(plan(), "skip");
    const assistant = (await database.assistants.toArray()).find((item) => item.id !== "default")!;
    const conversation = (await database.conversations.toArray()).find((item) => item.id !== "current")!;
    await database.transaction("rw", [database.assistants, database.conversations, database.chats], async () => {
      await database.assistants.delete(assistant.id);
      await database.conversations.delete(conversation.id);
      await database.chats.delete(conversation.id);
    });
    await repository.commit(plan(), "skip");
    expect((await database.assistants.toArray()).find((item) => item.id !== "default")?.id).not.toBe(assistant.id);
  });

  it("rechecks sources in the transaction across separate concurrent repository connections", async () => {
    const { database, repository } = await setup();
    const otherDatabase = new AyaseDatabase(database.name);
    databases.push(otherDatabase);
    const other = createCherryImportRepository(database.name, otherDatabase);
    expect(await repository.existingSourceKeys([plan().conversations[0].sourceKey])).toEqual([]);
    const results = await Promise.all([repository.commit(plan(), "skip"), other.commit(plan(), "skip")]);
    expect(results.map((result) => result.imported).sort()).toEqual([0, 1]);
    expect(results.map((result) => result.skipped).sort()).toEqual([0, 1]);
    expect(await database.conversations.count()).toBe(2);
    expect(await database.assistants.count()).toBe(2);
    expect(await database.cherryImports.count()).toBe(2);
  });

  it("rolls back earlier conversations, newly created assistants and markers when a later write fails", async () => {
    const { database, selection, repository } = await setup();
    const input = plan();
    input.assistants.push({ id: "second-assistant", name: "second" });
    input.conversations.push({ ...structuredClone(input.conversations[0]), sourceKey: "second", topicId: "second", assistantId: "second-assistant" });
    let writes = 0;
    database.chats.hook("creating", () => {
      if (++writes === 2) throw new Error("synthetic storage failure");
    });
    await expect(repository.commit(input, "skip")).rejects.toThrow("synthetic storage failure");
    expect(writes).toBe(2);
    expect(await database.assistants.count()).toBe(1);
    expect(await database.conversations.count()).toBe(1);
    expect(await database.chats.count()).toBe(1);
    expect(await database.cherryImports.count()).toBe(0);
    expect(await database.workspace.get("selection")).toEqual(selection);
  });

  it("preserves empty conversations and gives empty labels safe defaults without initializing workspace", async () => {
    const database = new AyaseDatabase(`CherryEmpty-${crypto.randomUUID()}`);
    databases.push(database);
    const input = plan();
    input.assistants[0].name = " ";
    input.conversations[0].title = " ";
    input.conversations[0].messages = [];
    await createCherryImportRepository(database.name, database).commit(input, "skip");
    expect((await database.assistants.toArray())[0].name).toBe("导入助手");
    expect((await database.conversations.toArray())[0].title).toBe("新对话");
    expect((await database.chats.toArray())[0].messages).toEqual([]);
    expect(await database.workspace.count()).toBe(0);
  });

  it("snapshots imported fields before asynchronous writes so later caller changes cannot cross the boundary", async () => {
    const { database, repository } = await setup();
    const input = plan();
    const pending = repository.commit(input, "skip");
    input.conversations[0].messages[0].content = "later mutation";
    input.assistants[0].name = "later name";
    await pending;
    expect((await database.chats.toArray()).find((chat) => chat.id !== "current")?.messages[0].content).toBe("hello");
    expect((await database.assistants.toArray()).find((assistant) => assistant.id !== "default")?.name).toBe("Cherry 助手");
  });

  it.each([
    ["timestamp", (input: CherryImportPlan) => { input.conversations[0].createdAt = NaN; }],
    ["fractional timestamp", (input: CherryImportPlan) => { input.conversations[0].messages[0].createdAt = 1.5; }],
    ["duplicate source key", (input: CherryImportPlan) => { input.conversations.push(structuredClone(input.conversations[0])); }],
    ["duplicate message", (input: CherryImportPlan) => { input.conversations[0].messages[1].sourceId = "source-user"; }],
    ["missing reply", (input: CherryImportPlan) => { input.conversations[0].messages[1].replyToSourceId = "missing"; }],
    ["forward reply", (input: CherryImportPlan) => { input.conversations[0].messages.reverse(); }],
    ["wrong reply role", (input: CherryImportPlan) => { input.conversations[0].messages[0].role = "system"; }],
    ["wrong assistant", (input: CherryImportPlan) => { input.conversations[0].assistantId = "unknown"; }],
    ["attachment traversal", (input: CherryImportPlan) => { input.conversations[0].messages[0].attachments = [
      { reference: "attachments/../secret.txt", name: "secret.txt", mimeType: "text/plain", size: 1 }]; }],
    ["too much text", (input: CherryImportPlan) => { input.conversations[0].messages[0].content = "a".repeat(8 * 1024 * 1024 + 1); }],
    ["UTF-8 byte limit", (input: CherryImportPlan) => { input.conversations[0].messages[0].content = "汉".repeat(3 * 1024 * 1024); }],
    ["too many files", (input: CherryImportPlan) => { input.conversations[0].messages[0].files =
      Array.from({ length: 1001 }, () => ({ key: "file", name: "file.txt" })); }],
    ["too many conversations", (input: CherryImportPlan) => { input.conversations = Array.from({ length: 2001 }, (_, index) =>
      ({ ...input.conversations[0], sourceKey: `source-${index}` })); }],
  ])("rejects malformed %s before creating objects", async (_label, mutate) => {
    const { database, repository } = await setup();
    const input = plan();
    mutate(input);
    await expect(repository.commit(input, "skip")).rejects.toThrow("导入计划无效。");
    expect(await database.assistants.count()).toBe(1);
    expect(await database.conversations.count()).toBe(1);
    expect(await database.cherryImports.count()).toBe(0);
  });

  it("rejects unknown roles/statuses and malformed top-level shapes with generic errors", async () => {
    const { repository } = await setup();
    const role = plan();
    Object.assign(role.conversations[0].messages[0], { role: "tool" });
    const status = plan();
    Object.assign(status.conversations[0].messages[0], { status: "secret error text" });
    const badShape = plan();
    Object.assign(badShape, { conversations: null });
    for (const input of [role, status, badShape]) await expect(repository.commit(input, "skip")).rejects.toThrow("导入计划无效。");
  });

  it("enforces total message count across conversations before writes", async () => {
    const { database, repository } = await setup();
    const input = plan();
    const base = input.conversations[0].messages[0];
    input.conversations[0].messages = Array.from({ length: 50001 }, (_, index) => ({ ...base, sourceId: `first-${index}` }));
    input.conversations.push({ ...input.conversations[0], sourceKey: "second",
      messages: Array.from({ length: 50000 }, (_, index) => ({ ...base, sourceId: `second-${index}` })) });
    await expect(repository.commit(input, "skip")).rejects.toThrow("导入计划无效。");
    expect(await database.cherryImports.count()).toBe(0);
  });

  it("enforces the combined text byte limit before writes", async () => {
    const { database, repository } = await setup();
    const input = plan();
    const base = input.conversations[0].messages[0];
    const content = "x".repeat(8 * 1024 * 1024);
    input.conversations[0].messages = Array.from({ length: 8 }, (_, index) => ({ ...base, sourceId: `large-${index}`, content }));
    await expect(repository.commit(input, "skip")).rejects.toThrow("导入计划无效。");
    expect(await database.cherryImports.count()).toBe(0);
  });
});
