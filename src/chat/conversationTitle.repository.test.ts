import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createChatRepository, type StoredChatMessage, type WorkspaceRepository } from "./repository";

const conversation = (repoState: Awaited<ReturnType<WorkspaceRepository["execute"]>>, id: string) =>
  repoState.conversations.find((item) => item.id === id);

async function setup(content = "  第一次提问  ", attachments?: StoredChatMessage["attachments"]) {
  const repo = createChatRepository(`Title-${crypto.randomUUID()}`);
  await repo.initializeWorkspace(null, []);
  await repo.execute({ type: "create-conversation", id: "named", assistantId: "default" });
  const message: StoredChatMessage = { id: "first", role: "user", content, status: "complete", attachments };
  await repo.save({ id: "named", updatedAt: 1, messages: [message] });
  return { repo, message };
}

describe("conversation title repository commands", () => {
  it("uses first-message text immediately, then accepts one matching summary", async () => {
    const { repo, message } = await setup();
    const pending = await repo.execute({ type: "start-conversation-title", id: "named", messageId: "first" });
    expect(conversation(pending, "named")).toMatchObject({ title: "第一次提问",
      titleNaming: { sourceMessageId: "first", source: "第一次提问", status: "pending" } });
    await repo.save({ id: "named", updatedAt: 2, messages: [message,
      { id: "reply", role: "assistant", content: "response", status: "complete" }] });
    expect(conversation(await repo.execute({ type: "finish-conversation-title", id: "named", messageId: "first", title: "摘要" }), "named"))
      .toMatchObject({ title: "摘要", titleNaming: { status: "finished" } });
    const repeated = await repo.execute({ type: "finish-conversation-title", id: "named", messageId: "first", title: "too late" });
    expect(conversation(repeated, "named")?.title).toBe("摘要");
    expect((await repo.load("named"))?.messages).toHaveLength(2);
  });

  it("keeps the original title when summarization returns no usable title", async () => {
    const { repo } = await setup();
    await repo.execute({ type: "start-conversation-title", id: "named", messageId: "first" });
    const result = await repo.execute({ type: "finish-conversation-title", id: "named", messageId: "first" });
    expect(conversation(result, "named")).toMatchObject({ title: "第一次提问", titleNaming: { status: "finished" } });
  });

  it("never overwrites a manual rename, including a rename to 新对话", async () => {
    for (const title of ["用户标题", "新对话"]) {
      const { repo } = await setup();
      await repo.execute({ type: "start-conversation-title", id: "named", messageId: "first" });
      await repo.execute({ type: "rename-conversation", id: "named", title });
      await repo.execute({ type: "finish-conversation-title", id: "named", messageId: "first", title: "迟到的摘要" });
      const result = await repo.execute({ type: "start-conversation-title", id: "named", messageId: "first" });
      expect(conversation(result, "named")).toMatchObject({ title, titleNaming: "manual" });
    }
  });

  it("ignores late summaries after source edit, clear, or deletion", async () => {
    for (const change of ["edit", "clear", "delete"] as const) {
      const { repo } = await setup();
      await repo.execute({ type: "start-conversation-title", id: "named", messageId: "first" });
      if (change === "edit") await repo.execute({ type: "edit-message", conversationId: "named", messageId: "first", content: "改过的问题" });
      if (change === "clear") await repo.save({ id: "named", updatedAt: 2, messages: [] });
      if (change === "delete") await repo.execute({ type: "delete-message", conversationId: "named", messageId: "first" });
      const result = await repo.execute({ type: "finish-conversation-title", id: "named", messageId: "first", title: "旧摘要" });
      expect(conversation(result, "named")).toMatchObject({ title: "第一次提问", titleNaming: { status: "finished" } });
    }
  });

  it("cannot retitle from a second message or after deleting the conversation", async () => {
    const { repo, message } = await setup();
    await repo.save({ id: "named", updatedAt: 2, messages: [message,
      { id: "second", role: "user", content: "第二次提问", status: "complete" }] });
    const ignored = await repo.execute({ type: "start-conversation-title", id: "named", messageId: "second" });
    expect(conversation(ignored, "named")?.title).toBe("新对话");
    await repo.execute({ type: "start-conversation-title", id: "named", messageId: "first" });
    await repo.execute({ type: "delete-conversation", id: "named" });
    const late = await repo.execute({ type: "finish-conversation-title", id: "named", messageId: "first", title: "旧摘要" });
    expect(conversation(late, "named")).toBeUndefined();
  });

  it("uses attachment names when the first message has no text", async () => {
    const { repo } = await setup("  ", [
      { name: "报告.pdf", mimeType: "application/pdf", size: 1, reference: "a" },
      { name: "图像.png", mimeType: "image/png", size: 1, reference: "b" },
    ]);
    const result = await repo.execute({ type: "start-conversation-title", id: "named", messageId: "first" });
    expect(conversation(result, "named")).toMatchObject({ title: "报告.pdf、图像.png",
      titleNaming: { source: "报告.pdf、图像.png", status: "pending" } });
  });

  it("keeps selection unchanged while naming a different conversation", async () => {
    const { repo, message } = await setup();
    const selected = await repo.execute({ type: "create-conversation", id: "other", assistantId: "default" });
    const before = selected.selection;
    await repo.execute({ type: "start-conversation-title", id: "named", messageId: "first" });
    await repo.save({ id: "named", updatedAt: 3, messages: [message] });
    const result = await repo.execute({ type: "finish-conversation-title", id: "named", messageId: "first", title: "摘要" });
    expect(result.selection).toEqual(before);
    expect(conversation(result, "named")?.title).toBe("摘要");
  });
});
