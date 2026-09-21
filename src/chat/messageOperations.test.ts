import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createChatRepository, type StoredChatMessage } from "./repository";
import { retryUser, withReplyLinks } from "./messageOperations";
import { planContextBudget } from "./contextBudget";
import { defaultSessionConfig } from "./sessionConfig";

const attachment = { name: "note.txt", reference: "attachments/shared.txt", size: 4, mimeType: "text/plain" as const };
const history: StoredChatMessage[] = [
  { id: "u1", role: "user", content: "first", status: "complete", attachments: [attachment] },
  { id: "a1", role: "assistant", content: "reply one", status: "complete" },
  { id: "u2", role: "user", content: "second", status: "complete" },
  { id: "a2", role: "assistant", content: "reply two", status: "complete" },
];
async function setup() {
  const name = `MessageActions-${crypto.randomUUID()}`;
  const repo = createChatRepository(name);
  await repo.initializeWorkspace("m", ["m"]);
  await repo.save({ id: "current", updatedAt: 1, messages: history });
  return { repo, name };
}

describe("message operations and persisted branches", () => {
  it.each(["u1", "a1"])("edits only %s and preserves following messages, surviving restart", async (messageId) => {
    const { repo, name } = await setup();
    await repo.execute({ type: "edit-message", conversationId: "current", messageId, content: "**edited**" });
    const messages = (await createChatRepository(name).load("current"))!.messages;
    expect(messages.map((item) => item.id)).toEqual(history.map((item) => item.id));
    expect(messages.find((item) => item.id === messageId)).toMatchObject({ id: messageId, content: "**edited**", editedAt: expect.any(Number) });
    expect(messages.filter((item) => item.id !== messageId)).toEqual(history.filter((item) => item.id !== messageId));
    expect(messages[0].attachments).toEqual([attachment]);
  });

  it.each(["u1", "a1"])("deletes only %s without assigning a surviving reply to the wrong question", async (messageId) => {
    const { repo, name } = await setup();
    await repo.execute({ type: "delete-message", conversationId: "current", messageId });
    const messages = (await createChatRepository(name).load("current"))!.messages;
    expect(messages.map((item) => item.id)).toEqual(history.filter((item) => item.id !== messageId).map((item) => item.id));
    expect(retryUser(messages, "a2")?.id).toBe("u2");
    if (messageId === "u1") expect(retryUser(messages, "a1")).toBeUndefined();
    const plan = await planContextBudget(messages, "next", defaultSessionConfig(), "openai-chat", "synthetic");
    expect(plan.messages.map((item) => item.content)).toEqual(["second", "reply two", "next"]);
  });

  it.each(["u1", "a1"])("forks at %s, keeps the source and shares attachment ownership", async (messageId) => {
    const { repo, name } = await setup();
    const config = { modelId: "m", config: defaultSessionConfig() };
    const fork = await repo.execute({ type: "fork-conversation", id: "fork", conversationId: "current", messageId, creationConfig: config });
    expect(fork.selection.lastSelected.default).toBe("fork");
    expect(fork.conversations.find((item) => item.id === "fork")).toMatchObject({ title: "新对话 (1)", creationConfig: config });
    const second = await repo.execute({ type: "fork-conversation", id: "fork2", conversationId: "current", messageId, creationConfig: config });
    expect(second.conversations.find((item) => item.id === "fork2")?.title).toBe("新对话 (2)");
    const restored = createChatRepository(name);
    const copied = (await restored.load("fork"))!.messages;
    expect(copied).toHaveLength(messageId === "u1" ? 1 : 2);
    expect(copied[0].id).not.toBe("u1");
    if (messageId === "a1") expect(retryUser(copied, copied[1].id)?.id).toBe(copied[0].id);
    expect((await restored.load("current"))!.messages).toEqual(history);
    await repo.execute({ type: "delete-conversation", id: "current" });
    await repo.execute({ type: "delete-conversation", id: "fork2" });
    expect(await repo.attachmentReferences()).toEqual([attachment.reference]);
    await repo.execute({ type: "delete-message", conversationId: "fork", messageId: copied[0].id });
    expect(await repo.attachmentReferences()).toEqual([]);
  });

  it("does not rebind an explicitly orphaned reply on a second normalization", () => {
    const linked = withReplyLinks(history);
    const removed = linked.filter((message) => message.id !== "a1" && message.id !== "u2");
    expect(retryUser(removed, "a2")).toBeUndefined();
    expect(withReplyLinks(removed)[1].replyToId).toBe("u2");
  });
});
