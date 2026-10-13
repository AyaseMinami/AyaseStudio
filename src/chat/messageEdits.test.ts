// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AyaseDatabase } from "../storage/database";
import { createChatRepository, type StoredChatMessage } from "./repository";
import { MessageEdits, type MessageEditAccess, type PreparedMessageEdit } from "./messageEdits";
import { AttachmentLifecycle } from "./attachmentLifecycle";
import type { AttachmentStore } from "./attachmentResources";
import { prepareDraftAttachment, type SentAttachment, type RequestAttachment } from "./attachments";
import type { MessageEditDraft } from "./messageEditTypes";
import { sameTranscriptValue } from "./messageData";
import { defaultSessionConfig } from "./sessionConfig";

const old: SentAttachment = { reference: "attachments/123e4567-e89b-42d3-a456-426614174000.txt", name: "old.txt", mimeType: "text/plain", size: 3 };
const later: SentAttachment = { ...old, reference: "attachments/123e4567-e89b-42d3-a456-426614174001.txt", name: "later.txt" };
const hidden: SentAttachment = { ...old, reference: "attachments/123e4567-e89b-42d3-a456-426614174002.txt", name: "hidden.txt" };
const before: StoredChatMessage[] = [
  { id: "u", role: "user", content: "original", status: "complete", attachments: [old] },
  { id: "a", role: "assistant", content: "answer", replyToId: "u", status: "complete" },
  { id: "later", role: "user", content: "later", status: "complete", attachments: [later], roundVersions: { selected: 0, pairs: [
    [{ id: "later", role: "user", content: "later", status: "complete", attachments: [later] }, { id: "answer", role: "assistant", content: "now", status: "complete", replyToId: "later" }],
    [{ id: "later", role: "user", content: "hidden", status: "complete", attachments: [hidden] }, { id: "hidden", role: "assistant", content: "previous", status: "complete", replyToId: "later" }],
  ] } },
  { id: "answer", role: "assistant", content: "now", status: "complete", replyToId: "later" },
];
const databases: AyaseDatabase[] = [];
afterEach(async () => { await Promise.all(databases.splice(0).map(db => db.delete())); });
function deferred<T = void>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

async function fixture(messages = before) {
  const database = new AyaseDatabase(`MessageEdit128-${crypto.randomUUID()}`); databases.push(database);
  const repository = createChatRepository(database.name);
  await repository.initializeWorkspace(null, []);
  await repository.save({ id: "current", updatedAt: 1, messages });
  const files = new Set([old.reference, later.reference, hidden.reference]);
  let sequence = 10;
  const store: AttachmentStore = {
    save: vi.fn(async (item: RequestAttachment) => {
      const reference = `attachments/123e4567-e89b-42d3-a456-42661417${String(sequence++).padStart(4, "0")}.txt`;
      files.add(reference); return { name: item.name, size: item.size, mimeType: item.mimeType, reference };
    }),
    read: vi.fn(async (item: SentAttachment) => { if (!files.has(item.reference)) throw Error("unreadable"); return { ...item, data: "b2xk" }; }),
    verify: vi.fn(async (items: SentAttachment[]) => { if (items.some(item => !files.has(item.reference))) throw Error("unreadable"); }),
    discardUncommitted: vi.fn(async (refs: string[]) => { refs.forEach(ref => files.delete(ref)); }),
    cleanup: vi.fn(async (retained, pending) => {
      for (const ref of files) if (!retained.includes(ref) && !pending.includes(ref)) files.delete(ref);
    }),
  };
  const lifecycle = new AttachmentLifecycle(store, () => repository.attachmentReferences());
  let writable = true, view = structuredClone(messages);
  const access: MessageEditAccess = {
    canBegin: () => writable,
    read: vi.fn(async () => (await repository.load("current"))!.messages),
    replace: vi.fn(async (id, expected, next) => { await repository.execute({ type: "replace-transcript", conversationId: id, expected, messages: next }); }),
    detach: vi.fn(() => { writable = false; }),
    reload: vi.fn(async (_id, confirmed) => { view = confirmed ?? (await repository.load("current"))!.messages; writable = true; }),
    outcome: vi.fn(),
  };
  const coordinator = new MessageEdits(access, lifecycle, store);
  const draft = async (retained = false, names = ["new.txt"]): Promise<MessageEditDraft> => ({ base: structuredClone(messages[0]), attachments: [
    ...(retained ? [{ kind: "retained" as const, attachment: old }] : []),
    ...await Promise.all(names.map(async name => ({ kind: "added" as const, attachment: await prepareDraftAttachment(new File([name], name)) }))),
  ] });
  return { database, repository, store, lifecycle, access, coordinator, files, draft, view: () => view, writable: () => writable };
}

describe("message edit durable ownership and recovery", () => {
  it("saves text and ordered references once, needs no model, reopens and preserves other history", async () => {
    const f = await fixture(); const input = await f.draft(true, ["same.txt", "same.txt"]);
    expect(await f.coordinator.submit("current", "u", "changed", input)).toEqual({ status: "saved", warning: undefined });
    const reopened = createChatRepository(f.database.name);
    const saved = (await reopened.load("current"))!.messages;
    expect(saved[0]).toMatchObject({ content: "changed", editedAt: expect.any(Number), attachments: [old, { name: "same.txt" }, { name: "same.txt" }] });
    expect(saved.slice(1)).toEqual(before.slice(1));
    expect(f.store.save).toHaveBeenCalledTimes(2); expect(f.store.verify).toHaveBeenCalledTimes(2);
    expect(f.access.replace).toHaveBeenCalledTimes(1); expect(f.coordinator.has("current")).toBe(false);
    expect(f.view()).toEqual(saved);
  });
  it("keeps drafts retryable after partial save and cleans only successful newly owned copies", async () => {
    const f = await fixture(); const save = vi.mocked(f.store.save).getMockImplementation()!;
    vi.mocked(f.store.save).mockImplementationOnce(save).mockRejectedValueOnce(Error("second save failed"));
    const input = await f.draft(false, ["first.txt", "second.txt"]);
    expect(await f.coordinator.submit("current", "u", "changed", input)).toMatchObject({ status: "notSaved", error: "second save failed" });
    expect((await f.repository.load("current"))!.messages).toEqual(before);
    expect(f.store.discardUncommitted).toHaveBeenCalledWith([expect.stringContaining("426614170010")]);
    expect(f.files.has(old.reference)).toBe(true); expect(input.attachments).toHaveLength(2);
  });
  it.each(["before verify", "DB write"])("leaves original transcript on %s failure with zero committed callback", async failure => {
    const f = await fixture(); const input = await f.draft(); const committed = vi.fn();
    if (failure === "before verify") vi.mocked(f.store.verify).mockRejectedValueOnce(Error(failure));
    else vi.mocked(f.access.replace).mockRejectedValueOnce(Error(failure));
    const prepare = vi.fn(async (_previous, edited): Promise<PreparedMessageEdit> => ({ messages: [edited], committed }));
    expect((await f.coordinator.submit("current", "u", "changed", input, prepare)).status).toBe("notSaved");
    expect((await f.repository.load("current"))!.messages).toEqual(before); expect(committed).not.toHaveBeenCalled();
    expect(f.files.has(old.reference)).toBe(true);
  });
  it("protects full before including truncated and hidden files during DB-after/commit-before competing cleanup", async () => {
    const f = await fixture(); const replace = vi.mocked(f.access.replace).getMockImplementation()!;
    vi.mocked(f.access.replace).mockImplementationOnce(async (...args) => {
      await replace(...args); await f.lifecycle.cleanup();
      expect([...f.files]).toEqual(expect.arrayContaining([old.reference, later.reference, hidden.reference]));
      expect(f.store.cleanup).toHaveBeenCalledWith(expect.arrayContaining([old.reference, later.reference, hidden.reference]), expect.any(Array));
    });
    vi.mocked(f.store.verify).mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error("post DB verify"));
    const committed = vi.fn();
    const result = await f.coordinator.submit("current", "u", "changed", await f.draft(), async (_previous, edited) => ({ messages: [edited], committed }));
    expect(result.status).toBe("notSaved"); expect(committed).not.toHaveBeenCalled();
    expect((await f.repository.load("current"))!.messages).toEqual(before);
    await f.lifecycle.cleanup(); expect([...f.files]).toEqual(expect.arrayContaining([old.reference, later.reference, hidden.reference]));
  });
  it("recognizes a lost DB success acknowledgement without duplicate writes or discarding owners", async () => {
    const f = await fixture(); const replace = vi.mocked(f.access.replace).getMockImplementation()!;
    vi.mocked(f.access.replace).mockImplementationOnce(async (...args) => { await replace(...args); throw Error("lost ack"); });
    expect((await f.coordinator.submit("current", "u", "changed", await f.draft())).status).toBe("saved");
    expect(f.store.discardUncommitted).not.toHaveBeenCalled(); expect(f.access.replace).toHaveBeenCalledTimes(1);
  });
  it("holds new reservations and old leases on unknown write, reconciles explicitly without sending", async () => {
    const f = await fixture(); const replace = vi.mocked(f.access.replace).getMockImplementation()!; const read = vi.mocked(f.access.read).getMockImplementation()!;
    vi.mocked(f.access.replace).mockImplementationOnce(async (...args) => { await replace(...args); throw Error("lost ack"); });
    vi.mocked(f.access.read).mockImplementationOnce(read).mockRejectedValueOnce(Error("DB unavailable"));
    const committed = vi.fn(), cancel = vi.fn();
    const result = await f.coordinator.submit("current", "u", "changed", await f.draft(), async (_before, edited) => ({ messages: [edited], committed, cancel }));
    expect(result.status).toBe("recoveryRequired"); expect(f.coordinator.isPending()).toBe(false);
    expect(f.coordinator.has("current")).toBe(true); expect(f.writable()).toBe(false);
    await f.lifecycle.cleanup(); expect(f.files.has(old.reference)).toBe(true);
    expect(f.store.discardUncommitted).not.toHaveBeenCalled(); expect(committed).not.toHaveBeenCalled();
    expect((await f.coordinator.recover("current"))?.status).toBe("saved");
    expect(committed).not.toHaveBeenCalled(); expect(f.coordinator.has("current")).toBe(false);
    expect(cancel).toHaveBeenCalled(); expect(f.writable()).toBe(true);
  });
  it("protects both resource generations on failed rollback, never writes a stale store", async () => {
    const f = await fixture(); const replace = vi.mocked(f.access.replace).getMockImplementation()!;
    vi.mocked(f.access.replace).mockImplementationOnce(replace).mockRejectedValueOnce(Error("rollback failed"));
    vi.mocked(f.store.verify).mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error("post DB verify"));
    expect((await f.coordinator.submit("current", "u", "changed", await f.draft())).status).toBe("recoveryRequired");
    await f.lifecycle.cleanup(); expect(f.files.has(old.reference)).toBe(true);
    expect(f.store.cleanup).toHaveBeenLastCalledWith(expect.arrayContaining([old.reference]), expect.arrayContaining([expect.stringContaining("426614170010")]));
    expect(f.writable()).toBe(false); expect(f.store.discardUncommitted).not.toHaveBeenCalled();
  });
  it("uses independently reloadable saved state; reload does not re-save Files or leave a pending lock", async () => {
    const f = await fixture(); vi.mocked(f.access.reload).mockRejectedValueOnce(Error("reload failed"));
    const committed = vi.fn();
    expect((await f.coordinator.submit("current", "u", "changed", await f.draft(), async (_before, edited) => ({ messages: [edited], committed }))).status).toBe("savedNeedsReload");
    expect(f.coordinator.isPending()).toBe(false); expect(f.writable()).toBe(false);
    expect((await f.coordinator.recover("current"))?.status).toBe("saved");
    expect(f.store.save).toHaveBeenCalledTimes(1); expect(f.access.replace).toHaveBeenCalledTimes(1); expect(committed).not.toHaveBeenCalled();
    expect(f.writable()).toBe(true);
  });
  it("serializes ownership synchronously, freezes input and rejects double submit or stale base", async () => {
    const f = await fixture(); const gate = deferred(); const read = vi.mocked(f.access.read).getMockImplementation()!;
    vi.mocked(f.access.read).mockImplementationOnce(async (...args) => { await gate.promise; return read(...args); });
    const input = await f.draft(); const first = f.coordinator.submit("current", "u", "changed", input);
    input.base.content = "mutated"; input.attachments = [];
    expect((await f.coordinator.submit("current", "u", "duplicate", input)).status).toBe("notSaved");
    gate.resolve(); expect((await first).status).toBe("saved"); expect(f.store.save).toHaveBeenCalledTimes(1);
    expect((await f.coordinator.submit("current", "u", "stale", { base: before[0] })).status).toBe("notSaved");
    expect(f.access.replace).toHaveBeenCalledTimes(1);
  });
  it("rejects injected old paths, assistant attachment edits and empty final messages before any writes", async () => {
    const f = await fixture();
    expect((await f.coordinator.submit("current", "u", "changed", { base: before[0], attachments: [{ kind: "retained", attachment: hidden }] })).status).toBe("notSaved");
    expect((await f.coordinator.submit("current", "a", "changed", { base: before[1], attachments: [] })).status).toBe("notSaved");
    expect((await f.coordinator.submit("current", "u", "", { base: before[0], attachments: [] })).status).toBe("notSaved");
    expect(f.access.replace).not.toHaveBeenCalled(); expect(f.store.save).not.toHaveBeenCalled();
    await expect(f.repository.execute({ type: "edit-message", conversationId: "current", messageId: "a", content: "changed", attachments: [old] })).rejects.toThrow("仅用户");
  });
  it("permits removing an unreadable old file, while cleanup failure remains saved with a warning", async () => {
    const f = await fixture(); f.files.delete(old.reference); vi.mocked(f.store.cleanup).mockRejectedValueOnce(Error("cleanup"));
    const result = await f.coordinator.submit("current", "u", "changed", { base: before[0], attachments: [] });
    expect(result).toMatchObject({ status: "saved", warning: expect.any(String) });
    expect((await f.repository.load("current"))!.messages[0]).not.toHaveProperty("attachments"); expect(f.store.read).not.toHaveBeenCalled();
  });
  it("retains discard failures for later resource retry without blocking the conversation", async () => {
    const f = await fixture(); vi.mocked(f.access.replace).mockRejectedValueOnce(Error("DB failure"));
    vi.mocked(f.store.discardUncommitted).mockRejectedValueOnce(Error("discard"));
    expect(await f.coordinator.submit("current", "u", "changed", await f.draft())).toMatchObject({ status: "notSaved", warning: expect.any(String) });
    expect(f.coordinator.has("current")).toBe(false); await f.lifecycle.cleanup();
    expect([...f.files]).toEqual(expect.arrayContaining([old.reference, later.reference, hidden.reference]));
    expect([...f.files].some(ref => ref.includes("426614170010"))).toBe(false);
  });
  it("refuses unknown original data without replacing or repairing it", async () => {
    const f = await fixture(); const unsupported = { ...before[0], futureSecurity: "preserve" };
    await f.database.chats.put({ id: "current", updatedAt: 1, messages: [unsupported] });
    expect((await f.coordinator.submit("current", "u", "changed", { base: unsupported })).status).toBe("notSaved");
    expect(sameTranscriptValue((await f.database.chats.get("current"))!.messages, [unsupported])).toBe(true);
    expect(f.access.replace).not.toHaveBeenCalled();
  });
  it.each(["continuation.config", "continuation.messages", "search.sources", "source"])("rejects unknown nested %s before editing can erase it", async location => {
    const f = await fixture();
    const raw = { ...before[1], status: "paused", continuation: { config: defaultSessionConfig(), model: "m", baseUrl: "https://synthetic.invalid", scope: "s", messages: [{ role: "user", content: "old", attachments: [old] }] } } as unknown as Record<string, unknown>;
    if (location === "continuation.config") (raw.continuation as { config: Record<string, unknown> }).config.futureSecurityMode = true;
    if (location === "continuation.messages") (raw.continuation as { messages: Record<string, unknown>[] }).messages[0].futureReference = "preserve";
    if (location === "search.sources") raw.search = { enabled: true, status: "completed", sources: [{ id: "s", title: "t", url: "https://synthetic.invalid", futureSecret: "preserve" }], queries: [], citations: [] };
    if (location === "source") raw.source = { source: "cherry", id: "x", createdAt: 1, futureSecret: "preserve" };
    const messages = [raw as unknown as StoredChatMessage];
    await f.database.chats.put({ id: "current", updatedAt: 1, messages });
    expect((await f.coordinator.submit("current", "a", "new", { base: messages[0] })).status).toBe("notSaved");
    expect((await f.database.chats.get("current"))!.messages).toEqual(messages);
    expect(f.access.replace).not.toHaveBeenCalled(); expect(f.store.save).not.toHaveBeenCalled();
  });
  it("rejects duplicate message identities before one edit can replace multiple original messages", async () => {
    const invalid = [before[0], { ...before[0], content: "independent second", attachments: [hidden] }];
    const f = await fixture(invalid);
    expect((await f.coordinator.submit("current", "u", "new", { base: invalid[0], attachments: [] })).status).toBe("notSaved");
    expect((await f.database.chats.get("current"))!.messages).toEqual(invalid);
    expect(f.access.replace).not.toHaveBeenCalled(); expect(f.files.has(hidden.reference)).toBe(true);
  });
});

it("shared old-file leases release only their own identity, including idempotent release", async () => {
  const cleanup = vi.fn().mockResolvedValue(undefined);
  const store = { cleanup } as unknown as AttachmentStore;
  const lifecycle = new AttachmentLifecycle(store, async () => []);
  const one = await lifecycle.acquireReferences([old.reference]), two = await lifecycle.acquireReferences([old.reference]);
  await one.release(); await one.release(); await lifecycle.cleanup(); expect(cleanup).toHaveBeenLastCalledWith([old.reference], []);
  await two.release(); await lifecycle.cleanup(); expect(cleanup).toHaveBeenLastCalledWith([], []);
});
