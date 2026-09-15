import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { createChatRepository } from "./repository";
import { SessionStore } from "./sessionStore";

describe("SessionStore", () => {
  it("loads a completed transcript without writing or changing its sort timestamp", async () => {
    const repo = createChatRepository(`AyaseSessionTest-${crypto.randomUUID()}`);
    await repo.save({ id: "current", updatedAt: 12, messages: [] });
    const save = vi.spyOn(repo, "save").mockRejectedValue(new Error("read-only"));
    await new SessionStore(repo, "current").hydrate();
    expect(save).not.toHaveBeenCalled();
    expect((await repo.load("current"))?.updatedAt).toBe(12);
  });
  it("retries the current state after a transient persistence failure at a write barrier", async () => {
    const repo = createChatRepository(`AyaseSessionTest-${crypto.randomUUID()}`);
    vi.spyOn(repo, "save").mockRejectedValueOnce(new Error("temporary"));
    const store = new SessionStore(repo, "current");
    await expect(store.updateMessages([{ id: "m", role: "user", content: "retained", status: "complete" }])).rejects.toThrow("temporary");
    await store.flush();
    expect((await repo.load("current"))?.messages[0].content).toBe("retained");
  });
  it("isolates transcripts by chat ID and clears only selected messages", async () => {
    const repo = createChatRepository(`AyaseSessionTest-${crypto.randomUUID()}`);
    const first = new SessionStore(repo, "chat-a");
    const second = new SessionStore(repo, "chat-b");
    await first.updateMessages([]);
    await second.updateMessages([{ id: "b", role: "user", content: "Only B", status: "complete" }]);
    expect((await repo.load("chat-a"))?.messages).toEqual([]);
    expect((await repo.load("chat-a"))?.generationConfig).toBeUndefined();
    expect((await repo.load("chat-b"))?.messages[0].content).toBe("Only B");
    await first.updateMessages([{ id: "m", role: "user", content: "Hi", status: "complete" }]);
    await first.clearMessages();
    expect((await repo.load("chat-b"))?.messages[0].content).toBe("Only B");
    expect((await repo.load("chat-a"))?.messages).toEqual([]);
  });

  it("serializes writes so the latest transcript wins", async () => {
    const repo = createChatRepository(`AyaseSessionTest-${crypto.randomUUID()}`);
    const store = new SessionStore(repo, "current");
    const olderWrite = store.updateMessages([{ id: "m", role: "user", content: "Hi", status: "complete" }]);
    const newerWrite = store.updateMessages([{ id: "m", role: "user", content: "Latest", status: "complete" }]);
    await Promise.all([olderWrite, newerWrite]);
    expect((await repo.load("current"))?.messages[0].content).toBe("Latest");
  });

  it("recovers an unfinished message without adding conversation config", async () => {
    const repo = createChatRepository(`AyaseSessionTest-${crypto.randomUUID()}`);
    await repo.save({ id: "old", updatedAt: 1, messages: [
      { id: "a", role: "assistant", content: "partial", status: "streaming" },
    ] });
    const store = new SessionStore(repo, "old");
    const state = await store.hydrate();
    expect(state.messages[0].status).toBe("aborted");
    expect((await repo.load("old"))?.generationConfig).toBeUndefined();
  });
});
