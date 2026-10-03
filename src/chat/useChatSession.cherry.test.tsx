// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatSession } from "./useChatSession";
import { createChatRepository } from "./repository";
import { DataImportSettings } from "../ui/settings/DataImportSettings";
import type { CherryImportPlan } from "../import/cherryTypes";

const native = vi.hoisted(() => ({ invoke: vi.fn(), cleanup: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: native.invoke }));
vi.mock("./runtime", () => ({ createRuntimeChatTransport: vi.fn(), createRuntimeModelCatalogClient: vi.fn() }));
vi.mock("./attachmentResources", () => ({ createTauriAttachmentStore: () => ({
  read: vi.fn(), save: vi.fn(), verify: vi.fn(), cleanup: native.cleanup,
}) }));

function plan(): CherryImportPlan {
  return { format: 7, assistants: [{ id: "source", name: "Synthetic import" }], warnings: [], conversations: [{
    sourceKey: "topic/path", topicId: "topic", assistantId: "source", title: "Synthetic conversation",
    createdAt: 1000, updatedAt: 2000,
    messages: [{ sourceId: "message", role: "user", content: "Synthetic text", createdAt: 1001, status: "complete", files: [] }],
  }] };
}

describe("Cherry import workspace gates", () => {
  const repository = createChatRepository();
  let root: ReturnType<typeof createRoot>;
  let host: HTMLDivElement;
  let session: ReturnType<typeof useChatSession>;
  function Probe({ externalBusy = false }: { externalBusy?: boolean }) {
    session = useChatSession({ onConfigurationRequired: () => undefined, externalBusy });
    return <DataImportSettings {...session.dataImport} />;
  }
  async function settled() {
    for (let i = 0; i < 100 && (!session.workspace.snapshot || session.workspace.busy); i++) {
      await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
    }
    expect(session.workspace.snapshot).toBeDefined();
    expect(session.workspace.busy).toBe(false);
  }
  function entry() {
    const button = [...host.querySelectorAll("button")].find(item => item.textContent === "导入 Cherry Studio 聊天");
    if (!button) throw new Error("Missing import entry");
    return button;
  }
  async function emptyAssistant() {
    await act(async () => {
      await session.workspace.execute({ type: "create-assistant", id: "empty", input: {
        name: "Empty", icon: "", defaultModelId: null, defaultConfig: session.sessionConfig,
      } });
    });
    await settled();
    expect(session.workspace.conversation).toBeUndefined();
    expect(session.generatingConversationIds.size).toBe(0);
  }
  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.clear();
    await repository.load("current");
    const database = new Dexie("AyaseStudio");
    await database.open();
    await Promise.all(database.tables.map(table => table.clear()));
    database.close();
    native.invoke.mockReset();
    native.cleanup.mockReset().mockResolvedValue(undefined);
    native.invoke.mockResolvedValue({ token: "synthetic-token" });
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root.render(<Probe />));
    await settled();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("imports through the real session and repository with a selected conversation", async () => {
    expect(entry().disabled).toBe(false);
    await act(async () => { await session.dataImport.selectBackup(); });
    await act(async () => { expect(await session.dataImport.importPlan(plan(), "skip")).toMatchObject({ imported: 1 }); });
    await settled();
    expect(await session.dataImport.existingSourceKeys(["topic/path"])).toEqual(["topic/path"]);
  });

  it("enables the entry for an empty assistant", async () => {
    await emptyAssistant();
    expect(entry().disabled).toBe(false);
  });

  it("imports without a selected conversation at the execution boundary", async () => {
    await emptyAssistant();
    await act(async () => { await session.dataImport.selectBackup(); });
    await act(async () => { expect(await session.dataImport.importPlan(plan(), "skip")).toMatchObject({ imported: 1 }); });
  });

  it("enables the entry after deleting the last conversation", async () => {
    for (const conversation of session.workspace.snapshot!.conversations) {
      await act(async () => { await session.workspace.execute({ type: "delete-conversation", id: conversation.id }); });
    }
    await settled();
    expect(session.workspace.snapshot!.conversations).toHaveLength(0);
    expect(entry().disabled).toBe(false);
  });

  it("recovers the entry after selecting an existing conversation", async () => {
    const current = session.workspace.conversation!;
    await emptyAssistant();
    await act(async () => { await session.workspace.execute({ type: "select", assistantId: current.assistantId, conversationId: current.id }); });
    expect(entry().disabled).toBe(false);
  });

  it("rejects choosing and importing synchronously while a workspace operation is pending", async () => {
    await emptyAssistant();
    await act(async () => { await session.dataImport.selectBackup(); });
    native.invoke.mockClear();
    const prior = session;
    await act(async () => {
      const pending = prior.workspace.execute({ type: "create-conversation", id: "pending", assistantId: "empty" });
      await expect(prior.dataImport.selectBackup()).rejects.toThrow("请先等待当前操作完成");
      await expect(prior.dataImport.importPlan(plan(), "skip")).rejects.toThrow("请先等待当前操作完成");
      await pending;
    });
    expect(native.invoke).not.toHaveBeenCalled();
    expect(await session.dataImport.existingSourceKeys(["topic/path"])).toEqual([]);
    expect(entry().disabled).toBe(false);
  });

  it("rejects stale import callbacks after a settled workspace selection change", async () => {
    await emptyAssistant();
    await act(async () => { await session.dataImport.selectBackup(); });
    native.invoke.mockClear();
    const prior = session;
    await act(async () => { await session.workspace.execute({ type: "create-conversation", id: "next", assistantId: "empty" }); });
    await settled();
    await expect(prior.dataImport.selectBackup()).rejects.toThrow("请先等待当前操作完成");
    await expect(prior.dataImport.importPlan(plan(), "skip")).rejects.toThrow("请先等待当前操作完成");
    expect(native.invoke).not.toHaveBeenCalled();
    expect(await session.dataImport.existingSourceKeys(["topic/path"])).toEqual([]);
    await act(async () => { expect(await session.dataImport.importPlan(plan(), "skip")).toMatchObject({ imported: 1 }); });
  });

  it("blocks for external activity and recovers when it ends", async () => {
    await act(async () => root.render(<Probe externalBusy />));
    expect(entry().disabled).toBe(true);
    await expect(session.dataImport.selectBackup()).rejects.toThrow("请先等待当前操作完成");
    expect(native.invoke).not.toHaveBeenCalled();
    await act(async () => root.render(<Probe />));
    expect(entry().disabled).toBe(false);
  });

  it("blocks during backup maintenance and recovers after cancellation", async () => {
    await act(async () => { expect(await session.prepareBackup()).toBe(true); });
    expect(entry().disabled).toBe(true);
    await expect(session.dataImport.selectBackup()).rejects.toThrow("请先等待当前操作完成");
    await act(async () => session.cancelBackupPreparation());
    expect(entry().disabled).toBe(false);
  });

  it("releases the import gate after a failed commit and allows another attempt", async () => {
    await act(async () => { await session.dataImport.selectBackup(); });
    const invalid = plan(); invalid.conversations[0].createdAt = NaN;
    await act(async () => { await expect(session.dataImport.importPlan(invalid, "skip")).rejects.toThrow("未提交聊天记录"); });
    expect(entry().disabled).toBe(false);
    expect(await session.dataImport.existingSourceKeys(["topic/path"])).toEqual([]);
    await act(async () => { expect(await session.dataImport.importPlan(plan(), "skip")).toMatchObject({ imported: 1 }); });
  });
});
