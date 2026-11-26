import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, expect, it, vi } from "vitest";
import { defaultSessionConfig, readSessionConfigData } from "../chat/sessionConfig";
import { createChatRepository, type StoredChatMessage } from "../chat/repository";
import { connectionSettingsStorageKey, type ConnectionSettingsState } from "../chat/settings";
import { AyaseDatabase } from "../storage/database";
import { DataContractError } from "../storage/dataContract";
import { decodeBackup, encodeBackup, readBackupDocument } from "./codec";
import { createBackupDocument, allPreferenceKeys, type LocalSnapshot } from "./snapshot";
import { createRestorePlan } from "./restorePlan";
import { BackupRepository } from "./repository";
import { backupTables, type BackupFiles, type BackupRows } from "./types";

const validResponsesReplay = {
  protocol: "openai-responses" as const,
  scope: "conn-1|https://api.deepseek.com",
  content: [{
    type: "web_search_call",
    id: "ws_1",
    status: "completed",
    kind: "read_link",
    action: { type: "open_page", url: "https://example.invalid/article" },
    page: { url: "https://example.invalid/article", title: "Article" },
    signature: "synthetic-read-link-signature",
  }],
};

function connections(): ConnectionSettingsState {
  return {
    version: 3,
    activeModelId: "model-1",
    providers: [{
      id: "provider-1",
      name: "DeepSeek",
      connections: [{
        id: "conn-1",
        name: "Responses",
        protocol: "openai-responses",
        baseUrl: "https://api.deepseek.com",
        apiKey: "synthetic-key",
        models: [{ id: "model-1", modelId: "deepseek-flash" }],
      }],
    }],
  };
}

function deepseekSession(webSearch = true) {
  return {
    ...defaultSessionConfig(),
    webSearch,
    webSearchProvider: "deepseek-server" as const,
    deepseekWebTools: { search: true, readUrl: true },
  };
}

function snapshot(): LocalSnapshot {
  const rows = Object.fromEntries(backupTables.map((name) => [name, []])) as unknown as BackupRows;
  const longUrl = `https://example.invalid/${"q".repeat(600)}`;
  const refusedAnswer: StoredChatMessage = {
    id: "refused",
    role: "assistant",
    replyToId: "user-2",
    content: "该回复因内容安全审核被拒答。",
    status: "incomplete",
    search: {
      enabled: true,
      status: "completed",
      queries: ["public query"],
      sources: [{ id: "src-1", url: longUrl, title: "Long URL Source", excerpt: "bounded excerpt" }],
      citations: [],
    },
  };
  rows.assistants = [{
    id: "assistant", name: "synthetic", icon: "", sortOrder: 0, defaultModelId: "model-1",
    defaultConfig: deepseekSession(true),
  }];
  rows.conversations = [{
    id: "chat", assistantId: "assistant", title: "synthetic", createdAt: 1, updatedAt: 2,
    settings: { modelId: "model-1", config: deepseekSession(true) },
    creationConfig: { modelId: "model-1", config: { ...defaultSessionConfig(), webSearch: false, deepseekWebTools: { search: false, readUrl: true } } },
  }];
  rows.legacyConversationConfigs = [{
    id: "legacy",
    generationConfig: { ...defaultSessionConfig(), webSearch: false, webSearchProvider: "deepseek-server", deepseekWebTools: { search: true, readUrl: false } },
    lastUsedModelId: "model-1",
  }];
  rows.chats = [{
    id: "chat",
    updatedAt: 2,
    messages: [
      { id: "user-1", role: "user", content: "read https://example.invalid/article", status: "complete" },
      { id: "answer-1", role: "assistant", replyToId: "user-1", content: "summary", status: "complete", providerReplay: validResponsesReplay },
      { id: "user-2", role: "user", content: "check", status: "complete" },
      refusedAnswer,
    ],
  }];
  return {
    rows,
    preferences: {
      ...Object.fromEntries(allPreferenceKeys.map((key) => [key, null])),
      [connectionSettingsStorageKey]: JSON.stringify(connections()),
    },
  };
}

function files(): BackupFiles {
  return { read: vi.fn(), assertAvailable: vi.fn(), write: vi.fn(), remove: vi.fn() };
}

describe("Issue 141 DeepSeek server web tools data contracts and backup compatibility", () => {
  it("exports search v5 and chat v4, round-trips bounded long URL and refusal snapshots, and strips replay on copy or without connections", async () => {
    const before = snapshot();
    const original = structuredClone(before);
    const doc = await createBackupDocument(before, { connections: true, credentials: false }, files());
    expect(doc.version).toBe(5);
    expect(doc.compatibility?.modules.search).toEqual({ version: 5, minimumReaderVersion: 5, requiredCapabilities: [] });
    expect(doc.compatibility?.modules.chat).toEqual({ version: 4, minimumReaderVersion: 4, requiredCapabilities: [] });
    expect(doc.compatibility?.modules.session).toEqual({ version: 1, minimumReaderVersion: 1, requiredCapabilities: [] });

    const decoded = (await decodeBackup(await encodeBackup(doc))).document;
    expect(decoded).toEqual(doc);
    expect(before).toEqual(original);

    // Replace with connections keeps providerReplay and deepseekWebTools
    const emptyCurrent = snapshot();
    emptyCurrent.rows.chats = [];
    emptyCurrent.rows.conversations = [];
    const replacePlan = createRestorePlan(decoded, emptyCurrent, "replace");
    expect(replacePlan.after.rows.assistants[0].defaultConfig?.webSearchProvider).toBe("deepseek-server");
    expect(replacePlan.after.rows.assistants[0].defaultConfig?.deepseekWebTools).toEqual({ search: true, readUrl: true });
    expect(replacePlan.after.rows.chats[0].messages[1].providerReplay).toEqual(validResponsesReplay);

    // Copy strips providerReplay
    const copyPlan = createRestorePlan(decoded, emptyCurrent, "copy");
    expect(copyPlan.after.rows.chats[0].messages[1].providerReplay).toBeUndefined();

    // Backup without connections strips providerReplay even on replace
    const noConnDoc = await createBackupDocument(before, { connections: false, credentials: false }, files());
    const noConnDecoded = (await decodeBackup(await encodeBackup(noConnDoc))).document;
    const noConnPlan = createRestorePlan(noConnDecoded, emptyCurrent, "replace");
    expect(noConnPlan.after.rows.chats[0].messages[1].providerReplay).toBeUndefined();
  });

  it.each(["assistant-mode", "conversation-mode", "creation-tools-off", "legacy-tools-off"])(
    "rejects search v5 %s under original modules.search.version 4 before restamping",
    async (variant) => {
      const base = snapshot();
      base.rows.assistants[0].defaultConfig = defaultSessionConfig();
      base.rows.conversations[0].settings!.config = defaultSessionConfig();
      base.rows.conversations[0].creationConfig!.config = defaultSessionConfig();
      base.rows.legacyConversationConfigs[0].generationConfig = defaultSessionConfig();
      if (variant === "assistant-mode") base.rows.assistants[0].defaultConfig = deepseekSession(true);
      if (variant === "conversation-mode") base.rows.conversations[0].settings!.config = deepseekSession(true);
      if (variant === "creation-tools-off") base.rows.conversations[0].creationConfig!.config = { ...defaultSessionConfig(), webSearch: false, deepseekWebTools: { search: true, readUrl: false } };
      if (variant === "legacy-tools-off") base.rows.legacyConversationConfigs[0].generationConfig = { ...defaultSessionConfig(), webSearch: false, deepseekWebTools: { search: false, readUrl: true } };

      const doc = await createBackupDocument(base, { connections: false, credentials: false }, files()) as any;
      doc.compatibility.modules.search = { version: 4, minimumReaderVersion: 4, requiredCapabilities: [] };
      const frozen = structuredClone(doc);
      await expect(readBackupDocument(doc)).rejects.toThrow("搜索模块");
      expect(doc).toEqual(frozen);
    },
  );

  it.each(["visible", "roundVersions"])(
    "rejects openai-responses providerReplay in %s under original modules.chat.version 3 before restamping",
    async (variant) => {
      const base = snapshot();
      base.rows.assistants[0].defaultConfig = defaultSessionConfig();
      base.rows.conversations[0].settings!.config = defaultSessionConfig();
      base.rows.conversations[0].creationConfig!.config = defaultSessionConfig();
      base.rows.legacyConversationConfigs[0].generationConfig = defaultSessionConfig();
      if (variant === "roundVersions") {
        const answer = base.rows.chats[0].messages[1];
        base.rows.chats[0].messages[0].roundVersions = {
          selected: 0,
          pairs: [[{ ...base.rows.chats[0].messages[0] }, structuredClone(answer)]],
        };
        delete base.rows.chats[0].messages[1].providerReplay;
      }

      const doc = await createBackupDocument(base, { connections: false, credentials: false }, files()) as any;
      doc.compatibility.modules.chat = { version: 3, minimumReaderVersion: 3, requiredCapabilities: [] };
      const frozen = structuredClone(doc);
      await expect(readBackupDocument(doc)).rejects.toThrow("聊天模块");
      expect(doc).toEqual(frozen);
    },
  );

  it.each([
    "both-false-tools",
    "unknown-tool-key",
    "responses-replay-on-user",
    "responses-replay-with-responses-field",
    "responses-replay-unsigned",
  ])("rejects malformed %s before writes and preserves raw data", async (variant) => {
    if (variant === "both-false-tools") {
      expect(() => readSessionConfigData({ ...defaultSessionConfig(), deepseekWebTools: { search: false, readUrl: false } })).toThrow(DataContractError);
      return;
    }
    if (variant === "unknown-tool-key") {
      expect(() => readSessionConfigData({ ...defaultSessionConfig(), deepseekWebTools: { search: true, readUrl: true, extra: true } })).toThrow(DataContractError);
      return;
    }
    const dbName = `replay-guard-${crypto.randomUUID()}`;
    const db = new AyaseDatabase(dbName);
    const repo = createChatRepository(dbName);
    try {
      const badReplay: any = structuredClone(validResponsesReplay);
      if (variant === "responses-replay-with-responses-field") badReplay.responses = [badReplay.content];
      if (variant === "responses-replay-unsigned") delete badReplay.content[0].signature;
      const msg: any = variant === "responses-replay-on-user"
        ? { id: "u1", role: "user", content: "hi", status: "complete", providerReplay: badReplay }
        : { id: "a1", role: "assistant", content: "hi", status: "complete", providerReplay: badReplay };

      await expect(repo.save({ id: "c1", updatedAt: 1, messages: [msg] })).rejects.toThrow(DataContractError);

      // Existing corrupt row in IndexedDB is rejected on load & initializeWorkspace without mutating it
      await db.chats.put({ id: "c1", updatedAt: 1, messages: [msg] });
      const rawBefore = await db.chats.get("c1");
      await expect(repo.load("c1")).rejects.toThrow(DataContractError);
      await expect(repo.initializeWorkspace(null, [])).rejects.toThrow(DataContractError);
      expect(await db.chats.get("c1")).toEqual(rawBefore);

      // Snapshot export also rejects before reading assets
      const snap = snapshot();
      snap.rows.chats[0].messages[1] = msg;
      const io = files();
      await expect(createBackupDocument(snap, { connections: false, credentials: false }, io)).rejects.toThrow(DataContractError);
      expect(io.read).not.toHaveBeenCalled();
    } finally {
      db.close();
      await Dexie.delete(dbName);
    }
  });

  it("rolls back cleanly on restore commit failure and completes real DB export -> restore -> re-export", async () => {
    const dbName = `restore141-${crypto.randomUUID()}`;
    const db = new AyaseDatabase(dbName);
    const values = new Map<string, string>();
    const store = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    const repo = new BackupRepository(db, store);
    try {
      const before = await repo.snapshot();
      const doc = await createBackupDocument(snapshot(), { connections: true, credentials: true }, files());
      const decoded = (await decodeBackup(await encodeBackup(doc))).document;
      const plan = createRestorePlan(decoded, before, "replace");

      vi.spyOn(db.backupJournal, "delete").mockRejectedValueOnce(new Error("injected commit failure"));
      await expect(repo.restore(plan, before, files())).rejects.toThrow("已回滚");
      expect(await db.chats.count()).toBe(0);

      await repo.restore(plan, before, files());
      expect(await db.backupJournal.count()).toBe(0);
      const after = await repo.snapshot();
      const reexported = await createBackupDocument(after, { connections: true, credentials: false }, files());
      const reread = (await decodeBackup(await encodeBackup(reexported))).document;
      expect(reread.compatibility?.modules.search.version).toBe(5);
      expect(reread.compatibility?.modules.chat.version).toBe(4);
      expect(reread.rows.chats[0]).toMatchObject({
        messages: expect.arrayContaining([
          expect.objectContaining({ id: "answer-1", providerReplay: validResponsesReplay }),
          expect.objectContaining({ id: "refused", status: "incomplete" }),
        ]),
      });
    } finally {
      db.close();
      await db.delete();
    }
  });
});
