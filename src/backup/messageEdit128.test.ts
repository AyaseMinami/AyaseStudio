import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AyaseDatabase } from "../storage/database";
import { createChatRepository, type StoredChatMessage } from "../chat/repository";
import { bytesToBase64, type SentAttachment } from "../chat/attachments";
import { appendRoundVersion } from "../chat/roundVersions";
import type { MessageEditDraft } from "../chat/messageEditTypes";
import { defaultSessionConfig } from "../chat/sessionConfig";
import { BackupRepository, type BackupStorage } from "./repository";
import { createBackupDocument, type LocalSnapshot } from "./snapshot";
import { createRestorePlan } from "./restorePlan";
import { decodeBackup, encodeBackup } from "./codec";
import type { BackupFiles } from "./types";

const databases: AyaseDatabase[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const db of databases.splice(0)) await db.delete(); });
const options = { connections: false, credentials: false };
const encoder = new TextEncoder();
function resource(name: string, suffix: string, text: string) {
  const bytes = encoder.encode(text);
  return { attachment: { name, reference: `attachments/00000000-0000-4000-8000-${suffix}.txt`, mimeType: "text/plain", size: bytes.length } satisfies SentAttachment,
    data: bytesToBase64(bytes) };
}
const original = resource("old.txt", "000000000001", "original file");
const shared = resource("shared.txt", "000000000002", "shared retained file");
const added = resource("new.txt", "000000000003", "new edited file");
const local = resource("local.txt", "000000000004", "unrelated local file");

async function setup() {
  const db = new AyaseDatabase(`message-edit-backup128-${crypto.randomUUID()}`); databases.push(db);
  const chat = createChatRepository(db.name);
  await chat.initializeWorkspace(null, []);
  const preferences = new Map<string, string>();
  const storage: BackupStorage = {
    getItem: key => preferences.get(key) ?? null,
    setItem: (key, value) => { preferences.set(key, value); },
    removeItem: key => { preferences.delete(key); },
  };
  const saved = new Map<string, string>();
  const files: BackupFiles = {
    read: vi.fn(async (reference: string) => {
      const value = saved.get(reference); if (value === undefined) throw new Error("synthetic missing file"); return value;
    }),
    assertAvailable: vi.fn(async (references: string[]) => { if (references.some(reference => saved.has(reference))) throw new Error("synthetic collision"); }),
    write: vi.fn(async (reference: string, data: string) => { saved.set(reference, data); }),
    remove: vi.fn(async (references: string[]) => { references.forEach(reference => saved.delete(reference)); }),
  };
  return { db, chat, preferences, storage, saved, files, repository: new BackupRepository(db, storage) };
}

async function editedSource() {
  const source = await setup();
  for (const asset of [original, shared, added]) source.saved.set(asset.attachment.reference, asset.data);
  await source.chat.execute({ type: "create-conversation", id: "source", assistantId: "default" });
  const oldUser: StoredChatMessage = { id: "user", role: "user", content: "original attachment message", status: "complete", attachments: [original.attachment, shared.attachment] };
  const oldAnswer: StoredChatMessage = { id: "old-answer", role: "assistant", content: "original answer", replyToId: "user", status: "complete" };
  const legacy: StoredChatMessage = { id: "legacy", role: "user", content: "legacy without attachments", status: "complete" };
  const before = [legacy, oldUser, oldAnswer];
  const answer: StoredChatMessage = { id: "new-answer", role: "assistant", content: "new answer", replyToId: "user", status: "complete" };
  const user = appendRoundVersion(before, { ...oldUser, content: "first revised message" }, answer);
  await source.chat.save({ id: "source", updatedAt: 2, messages: [legacy, user, answer] });
  await source.chat.execute({ type: "fork-conversation", id: "shared-branch", conversationId: "source", messageId: "new-answer",
    creationConfig: { modelId: null, config: defaultSessionConfig() } });
  // The UI's File/retained list stays in memory. Only prepared SentAttachment values
  // enter the existing repository command, including the final user-specified order.
  const runtimeDraft: MessageEditDraft = { base: user, attachments: [
    { kind: "added", attachment: { id: "runtime-file", file: new File(["new edited file"], "new.txt"),
      name: added.attachment.name, mimeType: added.attachment.mimeType, size: added.attachment.size } },
    { kind: "retained", attachment: shared.attachment },
  ] };
  await source.chat.execute({ type: "edit-message", conversationId: "source", messageId: "user", base: runtimeDraft.base,
    content: "edited attachment message", attachments: [added.attachment, shared.attachment] });
  const snapshot = await source.repository.snapshot();
  const exported = await createBackupDocument(snapshot, options, source.files);
  const encoded = await encodeBackup(exported);
  const decoded = await decodeBackup(encoded);
  return { ...source, snapshot, exported, encoded, document: decoded.document, runtimeDraft };
}

function allMessages(snapshot: LocalSnapshot): StoredChatMessage[] {
  return snapshot.rows.chats.flatMap(chat => chat.messages.flatMap(message => [message, ...(message.roundVersions?.pairs.flat() ?? [])]));
}
function referencesByName(snapshot: LocalSnapshot): Map<string, Set<string>> {
  const values = new Map<string, Set<string>>();
  for (const message of allMessages(snapshot)) for (const attachment of message.attachments ?? []) {
    const references = values.get(attachment.name) ?? new Set<string>(); references.add(attachment.reference); values.set(attachment.name, references);
  }
  return values;
}
function assertRuntimeAbsent(value: unknown) {
  if (value === null || typeof value !== "object") return;
  expect(value).not.toBeInstanceOf(File);
  for (const [key, nested] of Object.entries(value)) {
    expect(["file", "removed", "token", "runtimeDraft", "draftAttachments", "submitted", "pendingReads"]).not.toContain(key);
    assertRuntimeAbsent(nested);
  }
}

describe("#128 edited attachment backup integration", () => {
  it("exports real edited rows, deduplicates shared candidate resources and keeps the existing format", async () => {
    const source = await editedSource();
    expect(source.exported.version).toBe(5);
    expect(source.exported.compatibility!.modules.chat).toEqual({ version: 3, minimumReaderVersion: 3, requiredCapabilities: [] });
    expect(JSON.parse(source.encoded).version).toBe(1);
    assertRuntimeAbsent(source.exported); assertRuntimeAbsent(source.snapshot);
    expect(source.runtimeDraft.attachments?.[0].kind).toBe("added");
    expect(source.encoded).not.toContain("runtime-file");
    const persisted = (await source.chat.load("source"))!.messages;
    expect(persisted[1]).toMatchObject({ content: "edited attachment message", editedAt: expect.any(Number), attachments: [added.attachment, shared.attachment] });
    expect(persisted[1].roundVersions!.pairs[0][0]).toMatchObject({ content: "original attachment message", attachments: [original.attachment, shared.attachment] });
    expect(persisted[0]).not.toHaveProperty("attachments");
    expect(source.exported.assets.map(asset => asset.id).sort()).toEqual([original, shared, added].map(asset => asset.attachment.reference).sort());
    expect(source.files.read).toHaveBeenCalledTimes(3);
    expect(source.files.write).not.toHaveBeenCalled();
  });

  it.each(["merge", "copy", "replace"] as const)("restores final attachment order and shared old references through %s and re-export", async mode => {
    const source = await editedSource(), target = await setup();
    await target.chat.save({ id: "current", updatedAt: 1, messages: [{ id: "local", role: "user", content: "keep local", status: "complete", attachments: [local.attachment] }] });
    target.saved.set(local.attachment.reference, local.data);
    const before = await target.repository.snapshot();
    const plan = createRestorePlan(source.document, before, mode);
    expect(plan.writes).toHaveLength(3);
    expect(new Set(plan.writes.map(write => write.reference)).size).toBe(3);
    await target.repository.restore(plan, before, target.files);
    const restored = await target.repository.snapshot();
    const visible = restored.rows.chats.flatMap(chat => chat.messages).find(message => message.content === "edited attachment message")!;
    expect(visible.attachments?.map(attachment => attachment.name)).toEqual(["new.txt", "shared.txt"]);
    expect(visible.roundVersions!.pairs[0][0].content).toBe("original attachment message");
    expect(visible.roundVersions!.pairs[0][0].attachments?.map(attachment => attachment.name)).toEqual(["old.txt", "shared.txt"]);
    expect(restored.rows.chats.flatMap(chat => chat.messages).find(message => message.content === "legacy without attachments")).not.toHaveProperty("attachments");
    const references = referencesByName(restored);
    for (const asset of [original, shared, added]) {
      const mapped = [...references.get(asset.attachment.name)!];
      expect(mapped).toHaveLength(1); expect(mapped[0]).not.toBe(asset.attachment.reference);
      expect(target.saved.get(mapped[0])).toBe(asset.data);
    }
    const mappedShared = visible.attachments![1].reference;
    expect(allMessages(restored).filter(message => message.attachments?.some(attachment => attachment.reference === mappedShared)).length).toBeGreaterThan(2);
    expect(visible.roundVersions!.pairs[0][1].replyToId).toBe(visible.id);
    if (mode === "copy") expect(visible.id).not.toBe("user");
    if (mode !== "replace") expect(restored.rows.chats.find(chat => chat.id === "current")?.messages[0].content).toBe("keep local");
    const reexported = await createBackupDocument(restored, options, target.files);
    const reread = (await decodeBackup(await encodeBackup(reexported))).document;
    expect(reread).toEqual(reexported); expect(reread.version).toBe(5);
    expect(reread.compatibility!.modules.chat.version).toBe(3);
    expect(reread.assets.map(asset => asset.id).sort()).toEqual([...references.values()].flatMap(value => [...value]).sort());
    assertRuntimeAbsent(reread);
    expect(target.files.write).toHaveBeenCalledTimes(3);
    expect(await target.db.backupJournal.get("restore")).toBeUndefined();
  });

  it("rolls back exact local rows and removes only new mapped resources after preference failure", async () => {
    const source = await editedSource(), target = await setup();
    await target.chat.save({ id: "current", updatedAt: 1, messages: [{ id: "local", role: "user", content: "rollback original", status: "complete", attachments: [local.attachment] }] });
    target.saved.set(local.attachment.reference, local.data);
    const before = await target.repository.snapshot(), existingFiles = new Map(target.saved);
    const plan = createRestorePlan(source.document, before, "replace");
    const setItem = target.storage.setItem;
    vi.spyOn(target.storage, "setItem").mockImplementationOnce(() => { throw new Error("synthetic preference failure"); }).mockImplementation(setItem);
    await expect(target.repository.restore(plan, before, target.files)).rejects.toThrow("已回滚");
    expect(await target.repository.snapshot()).toEqual(before);
    expect(target.saved).toEqual(existingFiles);
    expect(target.files.remove).toHaveBeenCalledWith(plan.writes.map(write => write.reference));
    expect(target.files.remove).not.toHaveBeenCalledWith(expect.arrayContaining([local.attachment.reference]));
    expect(await target.db.backupJournal.get("restore")).toBeUndefined();
    const reexported = await createBackupDocument(await target.repository.snapshot(), options, target.files);
    expect(reexported.assets.map(asset => asset.id)).toEqual([local.attachment.reference]);
    expect((await decodeBackup(await encodeBackup(reexported))).document).toEqual(reexported);
  });
});
