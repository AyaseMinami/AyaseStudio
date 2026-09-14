import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import { createChatRepository, type ChatSnapshot } from "./repository";

describe("ChatRepository", () => {
  it("persists and clears a chat through its public interface", async () => {
    const repository = createChatRepository(`AyaseStudioTest-${crypto.randomUUID()}`);
    const snapshot: ChatSnapshot = {
      id: "current",
      updatedAt: 1_700_000_000_000,
      messages: [
        {
          id: "m1",
          role: "user",
          content: "Hello",
          status: "complete",
        },
        {
          id: "m2",
          role: "assistant",
          content: "Hi",
          status: "aborted",
        },
      ],
    };

    await repository.save(snapshot);
    await expect(repository.load("current")).resolves.toEqual(snapshot);

    await repository.clear("current");
    await expect(repository.load("current")).resolves.toBeUndefined();
  });
});
