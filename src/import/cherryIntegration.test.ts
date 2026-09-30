import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { fetch as nativeFetch } from "@tauri-apps/plugin-http";
import { AttachmentLifecycle } from "../chat/attachmentLifecycle";
import type { AttachmentStore } from "../chat/attachmentResources";
import { bytesToBase64, type RequestAttachment, type SentAttachment } from "../chat/attachments";
import { createChatRepository } from "../chat/repository";
import { defaultSessionConfig } from "../chat/sessionConfig";
import { SessionStore } from "../chat/sessionStore";
import { selectedConversation } from "../chat/workspace";
import { AyaseDatabase } from "../storage/database";
import { commitCherryImport } from "./cherryImport";
import { createCherryImportPlan } from "./cherryMapping";
import { createCherryImportRepository } from "./cherryRepository";
import type { CherryBackup, CherryImportPlan, CherryMessage } from "./cherryTypes";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => { throw new Error("Native IPC is forbidden in this test."); }) }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn(async () => { throw new Error("Provider networking is forbidden in this test."); }) }));

const databases: AyaseDatabase[] = [];
const forbiddenFetch = vi.fn(async () => { throw new Error("Networking is forbidden in this test."); });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", forbiddenFetch);
});
afterEach(() => {
  expect(forbiddenFetch).not.toHaveBeenCalled();
  expect(nativeFetch).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  for (const database of databases.splice(0)) database.close();
});

function backup(source: "legacy-json" | "sqlite"): CherryBackup {
  const user: CherryMessage = { id: "u", role: "user", createdAt: 10, status: "complete", parts: [
    { type: "text", text: "original user text" },
    { type: "file", fileKey: "present", name: "notes.txt", available: true },
    { type: "file", fileKey: "missing", name: "missing.png", available: false },
  ] };
  const replies: CherryMessage[] = ["a1", "a2"].map((id) => ({ id, role: "assistant", createdAt: 11, status: "streaming",
    parts: [{ type: "text", text: `${id} first` }, { type: "thinking", text: `${id} thought` },
      { type: "text", text: `${id} second` }, { type: "unsupported", text: "private tool output" }] }));
  const messages = source === "sqlite"
    ? [{ id: "root", role: "root" as const, createdAt: 1, status: "complete" as const, parts: [] },
      { ...user, parentId: "root" }, ...replies.map((reply) => ({ ...reply, parentId: "u" }))]
    : [user, ...replies.map((reply) => ({ ...reply, askId: "u" }))];
  const data: CherryBackup = { token: "private-reader-token", source, format: source === "sqlite" ? 7 : 5,
    assistants: [{ id: "writer", name: "Imported writer" }, { id: "empty-assistant", name: "Empty assistant" }],
    topics: [{ id: "topic", assistantId: "writer", title: "Original title", createdAt: 1, updatedAt: 20,
      messages, ...(source === "sqlite" ? { activeNodeId: "a2" } : {}) },
    { id: "empty-topic", assistantId: "empty-assistant", title: "Empty topic", createdAt: 2, updatedAt: 3, messages: [] }], warnings: [] };
  Object.assign(data, { apiKey: "private backup key", baseUrl: "https://private-provider.invalid", model: "backup model" });
  Object.assign(data.assistants[0], { prompt: "private backup prompt", defaultModelId: "backup model" });
  return data;
}

function selectAssistants(plan: CherryImportPlan, ids: string[]): CherryImportPlan {
  const selected = new Set(ids);
  return { ...plan, assistants: plan.assistants.filter((assistant) => selected.has(assistant.id)),
    conversations: plan.conversations.filter((conversation) => selected.has(conversation.assistantId)) };
}

function memoryFiles() {
  const privateFiles = new Map<string, RequestAttachment>();
  const staged = new Set<string>();
  const store = {
    save: vi.fn(async (draft: RequestAttachment): Promise<SentAttachment> => {
      const reference = `attachments/${crypto.randomUUID()}.txt`;
      privateFiles.set(reference, structuredClone(draft));
      staged.add(reference);
      return { reference, name: draft.name, mimeType: draft.mimeType, size: draft.size };
    }),
    read: vi.fn(async (sent: SentAttachment): Promise<RequestAttachment> => {
      const saved = privateFiles.get(sent.reference);
      if (!saved) throw new Error("Missing private file.");
      return { ...saved, name: sent.name };
    }),
    verify: vi.fn(async (items: SentAttachment[]) => {
      for (const item of items) if (privateFiles.get(item.reference)?.size !== item.size) throw new Error("Missing private copy.");
    }),
    discardUncommitted: vi.fn(async (references: string[]) => {
      for (const reference of references) {
        if (!staged.has(reference)) throw new Error("Cannot discard a committed copy.");
        privateFiles.delete(reference);
        staged.delete(reference);
      }
    }),
    cleanup: vi.fn(async (retained: string[], pending: string[]) => {
      const keep = new Set([...retained, ...pending]);
      for (const reference of privateFiles.keys()) {
        if (!keep.has(reference)) { privateFiles.delete(reference); staged.delete(reference); }
        else if (retained.includes(reference)) staged.delete(reference);
      }
    }),
  } satisfies AttachmentStore;
  return { store, privateFiles, staged };
}

async function setup() {
  const name = `CherryIntegration-${crypto.randomUUID()}`;
  const chats = createChatRepository(name);
  const initial = await chats.initializeWorkspace("local-model", ["local-model"]);
  const database = new AyaseDatabase(name);
  databases.push(database);
  const imports = createCherryImportRepository(name, database);
  const files = memoryFiles();
  const lifecycle = new AttachmentLifecycle(files.store, () => chats.attachmentReferences());
  const bytes = new TextEncoder().encode("private attachment bytes");
  const resources = { lifecycle, verify: files.store.verify,
    readFile: vi.fn(async (key: string, fileName: string): Promise<RequestAttachment | null> => key === "present"
      ? { name: fileName, mimeType: "text/plain", size: bytes.length, data: bytesToBase64(bytes) } : null) };
  return { name, chats, initial, database, imports, files, resources };
}

describe.each(["legacy-json", "sqlite"] as const)("Cherry %s integrated import", (source) => {
  it("imports both branch paths and an empty topic, restores workspace/messages and excludes provider configuration", async () => {
    const test = await setup();
    const plan = createCherryImportPlan(backup(source));
    expect(plan.conversations).toHaveLength(3);
    expect(plan.conversations.filter((conversation) => conversation.assistantId === "writer")).toHaveLength(2);
    const result = await commitCherryImport(plan, "skip", test.imports, test.resources);
    expect(result).toMatchObject({ imported: 3, skipped: 0 });
    expect(test.resources.readFile).toHaveBeenCalledTimes(2);
    expect(test.files.store.save).toHaveBeenCalledTimes(1);
    expect(test.files.staged.size).toBe(0);
    expect(await test.database.workspace.get("selection")).toEqual(test.initial.selection);
    expect(await test.database.conversations.count()).toBe(4);
    expect(await test.database.assistants.count()).toBe(3);
    test.database.close();
    const reopened = createChatRepository(test.name);
    const workspace = await reopened.initializeWorkspace("different-model", ["local-model", "different-model"]);
    expect(selectedConversation(workspace)?.id).toBe(selectedConversation(test.initial)?.id);
    expect(workspace.selection.activeAssistantId).toBe(test.initial.selection.activeAssistantId);
    const writer = workspace.assistants.find((assistant) => assistant.name === "Imported writer")!;
    expect(writer).toMatchObject({ defaultModelId: null, defaultConfig: defaultSessionConfig(), icon: "" });
    const writerConversations = workspace.conversations.filter((conversation) => conversation.assistantId === writer.id);
    expect(writerConversations).toHaveLength(2);
    const expectedReplyIds = source === "sqlite" ? ["a2", "a1"] : ["a1", "a2"];
    const allImported = workspace.conversations.filter((conversation) => conversation.id !== "current");
    const importedChats = await Promise.all(allImported.map((conversation) => reopened.load(conversation.id)));
    expect(JSON.stringify([writer, allImported, importedChats])).not.toMatch(/private backup|backup model|private-provider|private-reader-token|private tool output/);
    for (const conversation of allImported) {
      expect(conversation.settings).toEqual({ modelId: null, config: defaultSessionConfig() });
      expect(conversation.titleNaming).toBe("manual");
    }
    for (const replyId of expectedReplyIds) {
      const conversation = writerConversations.find((item) => importedChats.find((chat) => chat?.id === item.id)?.messages[1].source?.id === replyId)!;
      const session = new SessionStore(reopened, conversation.id);
      const state = await session.hydrate();
      expect(state.messages).toHaveLength(2);
      const [user, reply] = state.messages;
      expect(user.content).toBe("original user text");
      expect(user.source).toEqual({ source: "cherry", id: "u", createdAt: 10, unavailableAttachments: ["missing.png"] });
      expect(user.attachments).toHaveLength(1);
      expect(reply).toMatchObject({ content: `${replyId} first\n${replyId} second`, thinkingSummary: `${replyId} thought`,
        status: "aborted", replyToId: user.id, source: { source: "cherry", id: replyId, createdAt: 11 } });
      expect((await test.files.store.read(user.attachments![0])).data).toBe(bytesToBase64(new TextEncoder().encode("private attachment bytes")));
    }
    const emptyAssistant = workspace.assistants.find((assistant) => assistant.name === "Empty assistant")!;
    const empty = workspace.conversations.find((conversation) => conversation.assistantId === emptyAssistant.id)!;
    expect((await reopened.load(empty.id))?.messages).toEqual([]);
    const refs = await reopened.attachmentReferences();
    expect(refs).toHaveLength(1);
    expect(test.files.store.cleanup).toHaveBeenLastCalledWith(refs, []);
  });

  it("imports only selected assistant paths, skips repeats, creates copies, permits edits and retains shared files until their last owner is deleted", async () => {
    const test = await setup();
    const plan = selectAssistants(createCherryImportPlan(backup(source)), ["writer"]);
    expect(plan.conversations).toHaveLength(2);
    expect(await commitCherryImport(plan, "skip", test.imports, test.resources)).toMatchObject({ imported: 2, skipped: 0 });
    const originalIds = new Set((await test.database.conversations.toArray()).map((conversation) => conversation.id));
    const originalRef = (await test.chats.attachmentReferences())[0];
    const readsBeforeSkip = test.resources.readFile.mock.calls.length;
    expect(await commitCherryImport(plan, "skip", test.imports, test.resources)).toMatchObject({ imported: 0, skipped: 2 });
    expect(test.resources.readFile).toHaveBeenCalledTimes(readsBeforeSkip);
    expect(await commitCherryImport(plan, "copy", test.imports, test.resources)).toMatchObject({ imported: 2, skipped: 0 });
    expect(await test.database.assistants.count()).toBe(2);
    const copies = (await test.database.conversations.toArray()).filter((conversation) => !originalIds.has(conversation.id));
    expect(copies).toHaveLength(2);
    const copyChat = (await test.chats.load(copies[0].id))!;
    const user = copyChat.messages[0];
    const copiedRef = user.attachments![0].reference;
    expect(copiedRef).not.toBe(originalRef);
    expect((await test.chats.load(copies[1].id))?.messages[0].attachments?.[0].reference).toBe(copiedRef);
    const selection = await test.chats.execute({ type: "select", assistantId: copies[0].assistantId, conversationId: copies[0].id });
    expect(selectedConversation(selection)?.id).toBe(copies[0].id);
    await test.chats.execute({ type: "edit-message", conversationId: copies[0].id, messageId: user.id, content: "edited imported message" });
    const edited = (await test.chats.load(copies[0].id))!.messages[0];
    expect(edited.content).toBe("edited imported message");
    expect(edited.source).toEqual(user.source);
    expect(edited.attachments).toEqual(user.attachments);
    await test.chats.execute({ type: "delete-conversation", id: copies[0].id });
    await test.resources.lifecycle.cleanup();
    expect(test.files.privateFiles.has(copiedRef)).toBe(true);
    expect(await test.chats.attachmentReferences()).toContain(copiedRef);
    await test.chats.execute({ type: "delete-conversation", id: copies[1].id });
    await test.resources.lifecycle.cleanup();
    expect(test.files.privateFiles.has(copiedRef)).toBe(false);
    expect(test.files.privateFiles.has(originalRef)).toBe(true);
    expect(await test.chats.attachmentReferences()).toEqual([originalRef]);
    expect(await test.imports.existingSourceKeys(plan.conversations.map((conversation) => conversation.sourceKey))).toHaveLength(2);
  });

  it("rolls back all import objects/markers midway through DB writes and discards staged files while preserving existing chat/files", async () => {
    const test = await setup();
    const existingFile = await test.resources.lifecycle.save({ name: "existing.txt", mimeType: "text/plain", size: 2, data: "SGk=" });
    const existingChat = { id: "current", updatedAt: 100, messages: [{ id: "existing-message", role: "user" as const,
      content: "existing chat", status: "complete" as const, attachments: [existingFile] }] };
    await test.chats.save(existingChat);
    await test.resources.lifecycle.commit([existingFile]);
    await test.resources.lifecycle.cleanup();
    const baselineSelection = await test.database.workspace.get("selection");
    let writes = 0;
    test.database.chats.hook("creating", () => { if (++writes === 2) throw new Error("private DB failure details"); });
    const plan = createCherryImportPlan(backup(source));
    await expect(commitCherryImport(plan, "skip", test.imports, test.resources)).rejects.toThrow("未提交聊天记录");
    expect(writes).toBe(2);
    expect(await test.database.chats.count()).toBe(1);
    expect(await test.database.conversations.count()).toBe(1);
    expect(await test.database.assistants.count()).toBe(1);
    expect(await test.database.cherryImports.count()).toBe(0);
    expect(await test.database.workspace.get("selection")).toEqual(baselineSelection);
    expect(await test.chats.load("current")).toEqual(existingChat);
    expect(test.files.staged.size).toBe(0);
    expect([...test.files.privateFiles.keys()]).toEqual([existingFile.reference]);
    expect(test.files.store.discardUncommitted).toHaveBeenCalledTimes(1);
    expect(test.files.store.discardUncommitted.mock.calls[0][0]).toHaveLength(1);
    expect(test.files.store.discardUncommitted.mock.calls[0][0]).not.toContain(existingFile.reference);
    await test.resources.lifecycle.cleanup();
    expect(test.files.store.cleanup).toHaveBeenLastCalledWith([existingFile.reference], []);
  });
});
