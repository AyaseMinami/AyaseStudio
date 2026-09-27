import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { createChatRepository, type StoredChatMessage } from "./repository";
import { appendRoundVersion, selectRoundVersion, withoutVersions } from "./roundVersions";
import { SessionStore } from "./sessionStore";

it("restores a stopped active version, keeps inactive attachments, and releases them on the next round", async () => {
  const repo = createChatRepository(`RoundVersions-${crypto.randomUUID()}`);
  const user: StoredChatMessage = { id: "u", role: "user", content: "before", status: "complete" };
  const answer: StoredChatMessage = { id: "a", role: "assistant", replyToId: "u", content: "old", status: "complete",
    attachments: [{ reference: "attachments/old.txt", name: "old.txt", mimeType: "text/plain", size: 1 }] };
  const nextAnswer: StoredChatMessage = { id: "a2", role: "assistant", replyToId: "u", content: "partial", status: "streaming" };
  const nextUser = appendRoundVersion([user, answer], { ...user, content: "after" }, nextAnswer);
  await repo.save({ id: "c", updatedAt: 1, messages: [nextUser, nextAnswer] });
  expect(await repo.attachmentReferences()).toEqual(["attachments/old.txt"]);
  const restored = await new SessionStore(repo, "c").hydrate();
  expect(restored.messages[1].status).toBe("aborted");
  const old = selectRoundVersion(restored.messages, 0);
  expect(old.map((message) => message.content)).toEqual(["before", "old"]);
  const back = selectRoundVersion(old, 1);
  expect(back[1]).toMatchObject({ content: "partial", status: "aborted" });
  await repo.save({ id: "c", updatedAt: 2, messages: back.map(withoutVersions) });
  expect(await repo.attachmentReferences()).toEqual([]);
});
