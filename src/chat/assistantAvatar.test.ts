import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { createChatRepository } from "./repository";
import { defaultSessionConfig } from "./sessionConfig";

it("atomically persists each assistant avatar, restores it, removes it and deletes its owner", async () => {
  const name = `assistant-avatar-${crypto.randomUUID()}`;
  const repo = createChatRepository(name);
  await repo.initializeWorkspace(null, []);
  const avatar = { original: new Blob(["original"], { type: "image/png" }), thumbnail: new Blob(["cropped"], { type: "image/png" }), crop: { x: .3, y: .7, zoom: 2 } };
  const input = { name: "助手 A", icon: "", defaultModelId: null, defaultConfig: defaultSessionConfig(), defaultAvatar: "blue", avatar };
  await repo.execute({ type: "create-assistant", id: "a", input });
  await repo.execute({ type: "create-assistant", id: "b", input: { ...input, name: "助手 B", avatar: undefined, defaultAvatar: "green" } });
  await repo.execute({ type: "create-conversation", id: "chat-a", assistantId: "a" });
  const fresh = createChatRepository(name);
  const restored = await fresh.initializeWorkspace(null, []);
  expect(restored.assistants.find(a => a.id === "a")?.avatar).toEqual(avatar);
  expect(restored.assistants.find(a => a.id === "b")?.avatar).toBeUndefined();
  expect(restored.conversations.find(c => c.id === "chat-a")?.settings).not.toHaveProperty("avatar");
  const removed = await fresh.execute({ type: "edit-assistant", id: "a", input: { ...input, avatar: undefined } });
  expect(removed.assistants.find(a => a.id === "a")?.avatar).toBeUndefined();
  expect(removed.assistants.find(a => a.id === "a")?.defaultAvatar).toBe("blue");
  expect(removed.assistants.find(a => a.id === "b")?.defaultAvatar).toBe("green");
  const deleted = await fresh.execute({ type: "delete-assistant", id: "a", mode: "move" });
  expect(deleted.assistants.some(a => a.id === "a")).toBe(false);
  expect(deleted.conversations.find(c => c.id === "chat-a")?.assistantId).toBe("default");
});
