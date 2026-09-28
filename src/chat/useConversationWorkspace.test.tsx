// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatRepository } from "./repository";
import { useConversationWorkspace } from "./useConversationWorkspace";

describe("workspace failure recovery", () => {
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;
  let current: ReturnType<typeof useConversationWorkspace>;
  const generatingId = { current: null as string | null };
  let modelIds: string[] = [];
  afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.restoreAllMocks(); generatingId.current = null; });
  async function wait(predicate: () => boolean) {
    for (let i = 0; i < 100 && !predicate(); i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    expect(predicate()).toBe(true);
  }
  async function mount(repo: ReturnType<typeof createChatRepository>, cleanup?: () => Promise<void>) {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    function Probe() { current = useConversationWorkspace(repo, null, modelIds, (id) => generatingId.current === id, cleanup); return null; }
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root.render(<Probe />)); await wait(() => current.isReady);
  }

  it("isolates history, edits, original drafts and delayed send consumption by conversation", async () => {
    const repo = createChatRepository(`History-${crypto.randomUUID()}`);
    await repo.initializeWorkspace(null, []);
    await repo.save({ id: "current", updatedAt: 1, messages: [{ id: "a", role: "user", content: "A history", status: "complete" }] });
    await repo.execute({ type: "create-conversation", id: "b", assistantId: "default" });
    await repo.save({ id: "b", updatedAt: 1, messages: [{ id: "b", role: "user", content: "B history", status: "complete" }] });
    await repo.execute({ type: "select", assistantId: "default", conversationId: "current" });
    await mount(repo);
    await act(async () => current.setDraft("A unsent"));
    await act(async () => { expect(current.browseHistory(-1, { start: 2, end: 2 })).toBe(true); });
    await act(async () => current.setDraft("A edited"));
    const a = current;
    await act(async () => { await current.execute({ type: "select", assistantId: "default", conversationId: "b" }); });
    await act(async () => current.setDraft("B unsent"));
    await act(async () => { current.browseHistory(-1, { start: 0, end: 0 }); });
    expect(current.view.draft).toBe("B history");
    await act(async () => a.clearDraftIfUnchanged(a.view.draftRevision));
    expect(current.view.draft).toBe("B history");
    await act(async () => { await current.execute({ type: "select", assistantId: "default", conversationId: "current" }); });
    expect(current.view.draft).toBe("A unsent");
    expect(current.view.draftSelection).toEqual({ start: 2, end: 2 });
    await act(async () => { await current.execute({ type: "select", assistantId: "default", conversationId: "b" }); });
    expect(current.view.draft).toBe("B history");
    await act(async () => { current.browseHistory(1, { start: 9, end: 9 }); });
    expect(current.view.draft).toBe("B unsent");
    expect((await repo.load("current"))?.messages[0].content).toBe("A history");
    await act(async () => root.unmount()); container.remove();
    await mount(repo);
    expect(current.view.draft).toBe("");
    expect(current.view.inputHistory).toBeUndefined();
  });

  it("does not repeat a committed create when loading its new transcript fails", async () => {
    const repo = createChatRepository(`Recovery-${crypto.randomUUID()}`); await mount(repo);
    vi.spyOn(repo, "load").mockRejectedValueOnce(new Error("temporary read failure"));
    let result = false;
    await act(async () => { result = await current.execute({ type: "create-conversation", id: "new", assistantId: "default" }); });
    expect(result).toBe(true);
    expect(current.conversation?.id).toBe("new");
    expect(current.canSend()).toBe(false);
    expect(current.loadError).toContain("操作已保存");
    await act(async () => current.retry()); await wait(() => current.isReady);
    expect(current.conversation?.id).toBe("new");
    expect(current.snapshot?.conversations).toHaveLength(2);
  });

  it("reports a failed attachment cleanup without misreporting a successful workspace load or deletion", async () => {
    const repo = createChatRepository(`Cleanup-${crypto.randomUUID()}`);
    await repo.initializeWorkspace(null, []);
    await repo.execute({ type: "create-conversation", id: "b", assistantId: "default" });
    const cleanup = vi.fn().mockRejectedValue(new Error("storage"));
    await mount(repo, cleanup);
    await wait(() => !!current.operationError);
    expect(current.loadError).toBeUndefined();
    expect(current.operationError).toContain("附件副本整理失败");
    let completed = false;
    await act(async () => { completed = await current.execute({ type: "delete-conversation", id: "b" }); });
    expect(completed).toBe(true);
    expect(current.loadError).toBeUndefined();
    expect(current.operationError).toContain("操作已保存，但附件副本整理失败");
    expect((await repo.load("b"))).toBeUndefined();
  });

  it("reloads a committed edit after a read failure without resurrecting the old transcript", async () => {
    const repo = createChatRepository(`EditRecovery-${crypto.randomUUID()}`);
    await repo.initializeWorkspace(null, []);
    await repo.save({ id: "current", updatedAt: 1, messages: [
      { id: "u", role: "user", content: "old", status: "complete" },
      { id: "a", role: "assistant", content: "discard", status: "complete" },
    ] });
    await mount(repo);
    await act(async () => current.setDraft("unsent"));
    vi.spyOn(repo, "load").mockRejectedValueOnce(new Error("read failed"));
    await act(async () => { expect(await current.execute({ type: "edit-message", conversationId: "current", messageId: "u", content: "edited" })).toBe(true); });
    expect(current.canSend()).toBe(false);
    expect(current.loadError).toContain("操作已保存");
    await act(async () => current.retry()); await wait(() => current.isReady);
    expect(current.view.messages.map((item) => item.content)).toEqual(["edited", "discard"]);
    expect(current.view.draft).toBe("unsent");
    expect((await repo.load("current"))?.messages).toHaveLength(2);
  });

  it("never retains a deleted selection when loading its replacement fails", async () => {
    const repo = createChatRepository(`Recovery-${crypto.randomUUID()}`);
    await repo.initializeWorkspace(null, []);
    await repo.execute({ type: "create-conversation", id: "b", assistantId: "default" });
    await repo.execute({ type: "select", assistantId: "default", conversationId: "current" });
    await mount(repo);
    vi.spyOn(repo, "load").mockRejectedValueOnce(new Error("temporary read failure"));
    await act(async () => { await current.execute({ type: "delete-conversation", id: "current" }); });
    expect(current.conversation?.id).toBe("b"); expect(current.canSend()).toBe(false);
    expect(current.snapshot?.conversations.map((item) => item.id)).toEqual(["b"]);
    await act(async () => current.retry()); await wait(() => current.isReady);
  });

  it("allows navigation despite another conversation's persistent save failure", async () => {
    const repo = createChatRepository(`Recovery-${crypto.randomUUID()}`);
    await repo.initializeWorkspace(null, []);
    await repo.execute({ type: "create-conversation", id: "b", assistantId: "default" });
    await repo.execute({ type: "select", assistantId: "default", conversationId: "current" });
    await mount(repo);
    vi.spyOn(repo, "save").mockRejectedValue(new Error("quota"));
    await current.store!.updateMessages([]).catch(() => undefined);
    await act(async () => { await current.execute({ type: "select", assistantId: "default", conversationId: "b" }); });
    expect(current.conversation?.id).toBe("b"); expect(current.isReady).toBe(true);
  });

  it("blocks deletion until the originating generation finishes", async () => {
    const repo = createChatRepository(`Recovery-${crypto.randomUUID()}`); await mount(repo);
    generatingId.current = "current";
    await act(async () => { expect(await current.execute({ type: "delete-conversation", id: "current" })).toBe(false); });
    expect(current.operationError).toContain("先停止"); expect(await repo.load("current")).toBeDefined();
    generatingId.current = null;
    await act(async () => { expect(await current.execute({ type: "delete-conversation", id: "current" })).toBe(true); });
    expect(current.conversation).toBeUndefined();
  });

  it("uses the latest model catalog on retry instead of clearing models added after startup", async () => {
    modelIds = [];
    const repo = createChatRepository(`Recovery-${crypto.randomUUID()}`); await mount(repo);
    modelIds = ["later-model"];
    await act(async () => current.setDraft("force current catalog render"));
    await act(async () => { await current.execute({ type: "select-model", assistantId: "default", modelId: "later-model" }); });
    await act(async () => current.retry()); await wait(() => current.isReady);
    expect(current.assistant?.defaultModelId).toBe("later-model");
    modelIds = [];
  });

  it("rejects a stale send guard after assistant configuration changes", async () => {
    const repo = createChatRepository(`Recovery-${crypto.randomUUID()}`); await mount(repo);
    const oldCanSend = current.canSend;
    expect(oldCanSend()).toBe(true);
    await act(async () => { await current.execute({ type: "edit-assistant", id: "default", input: {
      ...current.assistant!, defaultConfig: { ...current.assistant!.defaultConfig, stream: false },
    } }); });
    expect(oldCanSend()).toBe(false);
    expect(current.canSend()).toBe(true);
  });

  it("keeps unsent attachments per conversation in this run, never across restart", async () => {
    const repo = createChatRepository(`Drafts-${crypto.randomUUID()}`);
    await repo.initializeWorkspace(null, []);
    await repo.execute({ type: "create-conversation", id: "b", assistantId: "default" });
    await repo.execute({ type: "select", assistantId: "default", conversationId: "current" });
    await mount(repo);
    const draft = { id: "draft", name: "file.txt", mimeType: "text/plain" as const, size: 2,
      file: new File(["Hi"], "file.txt") };
    await act(async () => current.setDraftAttachments([draft]));
    await act(async () => { await current.execute({ type: "select", assistantId: "default", conversationId: "b" }); });
    expect(current.view.draftAttachments).toEqual([]);
    await act(async () => { await current.execute({ type: "select", assistantId: "default", conversationId: "current" }); });
    expect(current.view.draftAttachments).toEqual([draft]);
    expect((await repo.load("current"))?.messages).toEqual([]);
    await act(async () => root.unmount()); container.remove();
    await mount(repo);
    expect(current.view.draftAttachments).toEqual([]);
  });
});
