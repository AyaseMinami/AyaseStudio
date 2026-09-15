import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import { createChatRepository, type ChatSnapshot } from "./repository";

describe("ChatRepository", () => {
  it("retains attachment references only while messages still own them", async () => {
    const name = `AyaseAttachment-${crypto.randomUUID()}`;
    const repository = createChatRepository(name);
    const attachment = { reference: "attachments/123e4567-e89b-42d3-a456-426614174000.txt",
      name: "notes.txt", mimeType: "text/plain" as const, size: 2 };
    await repository.save({ id: "current", updatedAt: Date.now(), messages: [
      { id: "u", role: "user", content: "hi", status: "complete", attachments: [attachment] },
    ] });
    expect(await repository.attachmentReferences()).toEqual([attachment.reference]);
    const freshRepository = createChatRepository(name);
    expect((await freshRepository.load("current"))?.messages[0].attachments).toEqual([attachment]);
    await repository.save({ id: "current", updatedAt: Date.now(), messages: [] });
    expect(await repository.attachmentReferences()).toEqual([]);
  });
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
