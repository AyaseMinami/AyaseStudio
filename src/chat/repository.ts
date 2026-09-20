import Dexie, { type EntityTable } from "dexie";
import { copyAssistantConfig, resolveConversationConfig } from "./conversationConfig";
import { copyBranchMessages, withReplyLinks } from "./messageOperations";

import type { ChatMessage } from "./types";
import { defaultSessionConfig, restoreSessionConfig, type SessionConfig } from "./sessionConfig";
import { DEFAULT_ASSISTANT_ID, orderedConversations, type AssistantPreset, type Conversation, type WorkspaceCommand, type WorkspaceSelection, type WorkspaceSnapshot } from "./workspace";

export type StoredMessageStatus =
  | "complete"
  | "incomplete"
  | "paused"
  | "streaming"
  | "aborted"
  | "failed";

export interface StoredChatMessage extends ChatMessage {
  id: string;
  replyToId?: string | null;
  editedAt?: number;
  thinkingSummary?: string;
  continuation?: import("./nativeSearch").SearchContinuation;
  status: StoredMessageStatus;
  attachments?: import("./attachments").SentAttachment[];
}

export interface ChatSnapshot {
  id: string;
  updatedAt: number;
  messages: StoredChatMessage[];
  generationConfig?: SessionConfig;
}

export interface ChatRepository {
  load(id: string): Promise<ChatSnapshot | undefined>;
  save(snapshot: ChatSnapshot): Promise<void>;
  clear(id: string): Promise<void>;
  attachmentReferences(): Promise<string[]>;
}

export interface WorkspaceRepository extends ChatRepository {
  initializeWorkspace(legacyModelId: string | null, validModelIds: string[]): Promise<WorkspaceSnapshot>;
  execute(command: WorkspaceCommand): Promise<WorkspaceSnapshot>;
}

class AyaseDatabase extends Dexie {
  legacyConversationConfigs!: EntityTable<{ id: string; generationConfig?: SessionConfig; lastUsedModelId?: string | null }, "id">;
  chats!: EntityTable<ChatSnapshot, "id">;
  assistants!: EntityTable<AssistantPreset, "id">;
  conversations!: EntityTable<Conversation, "id">;
  workspace!: EntityTable<WorkspaceSelection, "id">;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ chats: "id,updatedAt" });
    this.version(2).stores({
      chats: "id,updatedAt", assistants: "id,sortOrder",
      conversations: "id,assistantId,updatedAt", workspace: "id",
    });
    this.version(3).stores({ legacyConversationConfigs: "id" }).upgrade(async (transaction) => {
      const chats = transaction.table("chats");
      const conversations = transaction.table("conversations");
      for (const chat of await chats.toArray()) {
        const conversation = await conversations.get(chat.id);
        await transaction.table("legacyConversationConfigs").put({ id: chat.id,
          generationConfig: chat.generationConfig, lastUsedModelId: conversation?.lastUsedModelId });
        delete chat.generationConfig;
        await chats.put(chat);
      }
      await conversations.toCollection().modify((item) => { delete item.lastUsedModelId; });
    });
  }
}

class DexieChatRepository implements WorkspaceRepository {
  constructor(private readonly database: AyaseDatabase) {}

  load(id: string): Promise<ChatSnapshot | undefined> {
    return this.database.chats.get(id);
  }

  async attachmentReferences(): Promise<string[]> {
    const chats = await this.database.chats.toArray();
    return [...new Set(chats.flatMap((chat) => chat.messages.flatMap((message) =>
      message.attachments?.map((attachment) => attachment.reference) ?? [])))];
  }

  async save(snapshot: ChatSnapshot): Promise<void> {
    const db = this.database;
    await db.transaction("rw", [db.chats, db.conversations, db.workspace], async () => {
      const conversation = await db.conversations.get(snapshot.id);
      if (!conversation && await db.workspace.get("selection")) {
        throw new Error("对话已删除，不能写入旧回复。");
      }
      const { generationConfig: _legacyConfig, ...transcript } = snapshot;
      await db.chats.put(transcript);
      if (conversation) await db.conversations.update(snapshot.id, { updatedAt: snapshot.updatedAt });
    });
  }

  async clear(id: string): Promise<void> {
    const db = this.database;
    await db.transaction("rw", [db.chats, db.workspace], async () => {
      if (await db.workspace.get("selection")) throw new Error("请通过对话删除操作移除记录。");
      await db.chats.delete(id);
    });
  }

  private transaction<T>(action: () => Promise<T>): Promise<T> {
    const db = this.database;
    return db.transaction("rw", [db.chats, db.assistants, db.conversations, db.workspace, db.legacyConversationConfigs], action);
  }

  private async snapshot(): Promise<WorkspaceSnapshot> {
    const db = this.database;
    return {
      assistants: (await db.assistants.toArray()).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)),
      conversations: orderedConversations(await db.conversations.toArray()),
      selection: (await db.workspace.get("selection"))!,
    };
  }

  private async repairSelection(selection: WorkspaceSelection): Promise<void> {
    const db = this.database;
    const assistants = await db.assistants.toArray();
    const conversations = orderedConversations(await db.conversations.toArray());
    const lastSelected: Record<string, string | null> = {};
    for (const assistant of assistants) {
      const children = conversations.filter((item) => item.assistantId === assistant.id);
      const oldId = selection.lastSelected?.[assistant.id];
      lastSelected[assistant.id] = children.find((item) => item.id === oldId)?.id ?? children[0]?.id ?? null;
    }
    await db.workspace.put({
      id: "selection", lastSelected,
      activeAssistantId: assistants.some((item) => item.id === selection.activeAssistantId)
        ? selection.activeAssistantId : DEFAULT_ASSISTANT_ID,
    });
  }

  initializeWorkspace(legacyModelId: string | null, validModelIds: string[]): Promise<WorkspaceSnapshot> {
    return this.transaction(async () => {
      const db = this.database;
      const valid = new Set(validModelIds);
      const modelId = legacyModelId && valid.has(legacyModelId) ? legacyModelId : null;
      const previous = await db.workspace.get("selection");
      if (!await db.assistants.get(DEFAULT_ASSISTANT_ID)) {
        await db.assistants.put({ id: DEFAULT_ASSISTANT_ID, name: "默认助手", icon: "", sortOrder: 0,
          defaultModelId: previous ? null : modelId,
          defaultConfig: previous ? defaultSessionConfig() : restoreSessionConfig((await db.legacyConversationConfigs.get("current"))?.generationConfig) });
      }
      const assistantIds = new Set((await db.assistants.toArray()).map((item) => item.id));
      // Keep every recoverable message record, including orphaned legacy IDs.
      const chats = await db.chats.toArray();
      if (!previous && chats.length === 0 && await db.conversations.count() === 0) {
        chats.push({ id: "current", updatedAt: Date.now(), messages: [] });
        await db.chats.put(chats[0]);
      }
      for (const chat of chats) {
        if (!await db.conversations.get(chat.id)) {
          await db.conversations.put({ id: chat.id, assistantId: DEFAULT_ASSISTANT_ID, title: "新对话",
            createdAt: chat.updatedAt, updatedAt: chat.updatedAt });
        }
      }
      for (const conversation of await db.conversations.toArray()) {
        const assistantId = assistantIds.has(conversation.assistantId) ? conversation.assistantId : DEFAULT_ASSISTANT_ID;
        // Freeze the formerly effective settings once, before repairing assistant model references.
        // Existing snapshots are never refreshed from the assistant on later launches.
        if (conversation.settings === undefined) {
          const assistant = (await db.assistants.get(assistantId))!;
          conversation.settings = resolveConversationConfig({ ...assistant, defaultConfig: restoreSessionConfig(assistant.defaultConfig) }, conversation.overrides);
        }
        delete conversation.overrides;
        await db.conversations.put({ ...conversation, assistantId,
          title: typeof conversation.title === "string" && conversation.title.trim() ? conversation.title : "新对话" });
      }
      for (const assistant of await db.assistants.toArray()) {
        await db.assistants.update(assistant.id, {
          name: assistant.id === DEFAULT_ASSISTANT_ID ? "默认助手" : (typeof assistant.name === "string" && assistant.name.trim() ? assistant.name : "未命名助手"),
          icon: typeof assistant.icon === "string" ? assistant.icon : "",
          sortOrder: Number.isFinite(assistant.sortOrder) ? assistant.sortOrder : 0,
          defaultModelId: assistant.defaultModelId && valid.has(assistant.defaultModelId) ? assistant.defaultModelId : null,
          defaultConfig: restoreSessionConfig(assistant.defaultConfig),
        });
      }
      await this.repairSelection(previous ?? { id: "selection", activeAssistantId: DEFAULT_ASSISTANT_ID, lastSelected: { default: "current" } });
      return this.snapshot();
    });
  }

  execute(command: WorkspaceCommand): Promise<WorkspaceSnapshot> {
    // Clone at invocation so queued transactions never observe later form edits.
    const action = structuredClone(command);
    return this.transaction(async () => {
      const db = this.database;
      const selection = await db.workspace.get("selection");
      if (!selection) throw new Error("请先加载本地工作区。");
      const requireAssistant = async (id: string) => {
        const item = await db.assistants.get(id);
        if (!item) throw new Error("助手不存在。");
        return item;
      };
      const requireConversation = async (id: string) => {
        const item = await db.conversations.get(id);
        if (!item) throw new Error("对话不存在。");
        return item;
      };
      switch (action.type) {
        case "create-assistant":
        case "edit-assistant": {
          if (!action.input.name.trim()) throw new Error("请输入助手名称。");
          const existing = action.type === "edit-assistant" ? await requireAssistant(action.id) : undefined;
          const orders = (await db.assistants.toArray()).map((item) => item.sortOrder);
          const assistant: AssistantPreset = { id: action.id, sortOrder: existing?.sortOrder ?? Math.max(0, ...orders) + 1,
            name: action.id === DEFAULT_ASSISTANT_ID ? "默认助手" : action.input.name.trim(),
            icon: action.input.icon.trim(), defaultModelId: action.input.defaultModelId,
            defaultConfig: restoreSessionConfig(action.input.defaultConfig) };
          if (existing) await db.assistants.put(assistant); else await db.assistants.add(assistant);
          if (!existing) selection.activeAssistantId = action.id;
          break;
        }
        case "move-assistant": {
          await requireAssistant(action.id);
          const items = (await this.snapshot()).assistants;
          const index = items.findIndex((item) => item.id === action.id);
          const target = index + action.direction;
          if (target >= 0 && target < items.length) {
            [items[index], items[target]] = [items[target], items[index]];
            for (let order = 0; order < items.length; order++) await db.assistants.update(items[order].id, { sortOrder: order });
          }
          break;
        }
        case "delete-assistant": {
          if (action.id === DEFAULT_ASSISTANT_ID) throw new Error("默认助手不能删除。");
          await requireAssistant(action.id);
          const children = await db.conversations.where("assistantId").equals(action.id).toArray();
          for (const child of children) {
            if (action.mode === "move") await db.conversations.update(child.id, { assistantId: DEFAULT_ASSISTANT_ID });
            else { await db.chats.delete(child.id); await db.conversations.delete(child.id); await db.legacyConversationConfigs.delete(child.id); }
          }
          if (selection.activeAssistantId === action.id && action.mode === "move") {
            selection.lastSelected[DEFAULT_ASSISTANT_ID] = selection.lastSelected[action.id] ?? null;
          }
          await db.assistants.delete(action.id);
          break;
        }
        case "create-conversation": {
          const assistant = await requireAssistant(action.assistantId);
          const now = Date.now();
          await db.conversations.add({ id: action.id, assistantId: assistant.id, title: "新对话",
            createdAt: now, updatedAt: now, settings: copyAssistantConfig(assistant) });
          await db.chats.add({ id: action.id, updatedAt: now, messages: [] });
          selection.activeAssistantId = assistant.id;
          selection.lastSelected[assistant.id] = action.id;
          break;
        }
        case "configure-conversation": {
          await requireConversation(action.id);
          if (action.title !== undefined && !action.title.trim()) throw new Error("请输入对话标题。");
          await db.conversations.update(action.id, {
            settings: action.settings,
            ...(action.title === undefined ? {} : { title: action.title.trim() }),
          });
          break;
        }
        case "rename-conversation": {
          await requireConversation(action.id);
          if (!action.title.trim()) throw new Error("请输入对话标题。");
          await db.conversations.update(action.id, { title: action.title.trim() });
          break;
        }
        case "edit-message":
        case "delete-message":
        case "fork-conversation": {
          const source = await requireConversation(action.conversationId);
          const chat = await db.chats.get(source.id);
          const messages = withReplyLinks(chat?.messages ?? []);
          const index = messages.findIndex((message) => message.id === action.messageId);
          if (index < 0) throw new Error("消息不存在。");
          const now = Date.now();
          if (action.type === "fork-conversation") {
            const siblings = await db.conversations.where("assistantId").equals(source.assistantId).toArray();
            const base = source.title.replace(/ \(\d+\)$/, "");
            let suffix = 1;
            while (siblings.some((item) => item.title === `${base} (${suffix})`)) suffix++;
            await db.conversations.add({ id: action.id, assistantId: source.assistantId,
              title: `${base} (${suffix})`, createdAt: now, updatedAt: now,
              creationConfig: action.creationConfig, settings: structuredClone(source.settings) });
            await db.chats.add({ id: action.id, updatedAt: now,
              messages: copyBranchMessages(messages.slice(0, index + 1)) });
            selection.activeAssistantId = source.assistantId;
            selection.lastSelected[source.assistantId] = action.id;
          } else {
            let next: StoredChatMessage[];
            if (action.type === "edit-message") {
              const message = messages[index];
              if (!action.content.trim() && !message.attachments?.length) throw new Error("消息正文不能为空。");
              next = [...messages.slice(0, index), { ...message, content: action.content, editedAt: now,
                search: undefined, providerReplay: undefined, continuation: undefined,
                status: message.status === "paused" ? "incomplete" : message.status }];
            } else next = messages.filter((message) => message.id !== action.messageId).map((message) =>
              message.status === "paused" ? { ...message, status: "incomplete" as const, continuation: undefined } : message);
            await db.chats.put({ id: source.id, updatedAt: now, messages: next });
            await db.conversations.update(source.id, { updatedAt: now });
          }
          break;
        }
        case "delete-conversation": {
          const item = await requireConversation(action.id);
          const siblings = orderedConversations(await db.conversations.where("assistantId").equals(item.assistantId).toArray());
          const index = siblings.findIndex((child) => child.id === item.id);
          if (selection.lastSelected[item.assistantId] === item.id) {
            selection.lastSelected[item.assistantId] = siblings[index + 1]?.id ?? siblings[index - 1]?.id ?? null;
          }
          await db.chats.delete(action.id);
          await db.legacyConversationConfigs.delete(action.id);
          await db.conversations.delete(action.id);
          break;
        }
        case "select": {
          await requireAssistant(action.assistantId);
          if (action.conversationId) {
            const item = await requireConversation(action.conversationId);
            if (item.assistantId !== action.assistantId) throw new Error("对话不属于该助手。");
            selection.lastSelected[action.assistantId] = item.id;
          }
          selection.activeAssistantId = action.assistantId;
          break;
        }
        case "select-model":
          await requireAssistant(action.assistantId);
          await db.assistants.update(action.assistantId, { defaultModelId: action.modelId });
          break;
        case "repair-models": {
          const valid = new Set(action.validModelIds);
          for (const item of await db.assistants.toArray()) {
            if (item.defaultModelId && !valid.has(item.defaultModelId)) await db.assistants.update(item.id, { defaultModelId: null });
          }
          break;
        }
      }
      await this.repairSelection(selection);
      return this.snapshot();
    });
  }
}

export function createChatRepository(
  databaseName = "AyaseStudio",
): WorkspaceRepository {
  return new DexieChatRepository(new AyaseDatabase(databaseName));
}
