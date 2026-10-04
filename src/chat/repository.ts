import { AyaseDatabase } from "../storage/database";
import { resolveAvatarSource, withoutAvatarSource } from "../avatar/repository";
import { readAssistantAvatarSelection } from "../avatar/assistantDefaults";
import { retainedRoundMessages, selectRoundVersion, withoutVersions } from "./roundVersions";
import { titleFromText } from "./conversationTitle";
import { copyAssistantConfig, resolveConversationConfig, assertLegacyOverrides, readConversationConfigData } from "./conversationConfig";
import { copyBranchMessages, withReplyLinks } from "./messageOperations";
import { readMessagesGenerationMetrics } from "./generationMetricsData";

import type { ChatMessage } from "./types";
import { defaultSessionConfig, restoreSessionConfig, readSessionConfigData, type SessionConfig } from "./sessionConfig";
import { DEFAULT_ASSISTANT_ID, orderedConversations, placeItem, workspaceDeletionFingerprint, type AssistantPreset, type WorkspaceCommand, type WorkspaceSelection, type WorkspaceSnapshot } from "./workspace";

export type StoredMessageStatus =
  | "complete"
  | "incomplete"
  | "paused"
  | "streaming"
  | "aborted"
  | "failed";

export interface StoredChatMessage extends ChatMessage {
  source?: { source: "cherry"; id: string; createdAt: number; unavailableAttachments?: string[] };
  roundVersions?: import("./roundVersions").RoundVersions;
  id: string;
  replyToId?: string | null;
  editedAt?: number;
  thinkingSummary?: string;
  /** Exact requested API model ID frozen when this assistant reply is created. */
  generationModel?: string;
  generationMetrics?: import("./generationMetrics").GenerationMetrics[];
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

class DexieChatRepository implements WorkspaceRepository {
  constructor(private readonly database: AyaseDatabase) {}

  async load(id: string): Promise<ChatSnapshot | undefined> {
    const snapshot = await this.database.chats.get(id);
    return snapshot && { ...snapshot, messages: readMessagesGenerationMetrics(snapshot.messages) };
  }

  async attachmentReferences(): Promise<string[]> {
    const chats = await this.database.chats.toArray();
    return [...new Set(chats.flatMap((chat) => chat.messages.flatMap(retainedRoundMessages).flatMap((message) =>
      message.attachments?.map((attachment) => attachment.reference) ?? [])))];
  }

  async save(snapshot: ChatSnapshot): Promise<void> {
    snapshot = { ...snapshot, messages: readMessagesGenerationMetrics(snapshot.messages) };
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
    return db.transaction("rw", [db.chats, db.assistants, db.conversations, db.workspace, db.legacyConversationConfigs, db.avatarLibrary], action);
  }

  private async snapshot(): Promise<WorkspaceSnapshot> {
    const db = this.database;
    const resources = new Set(await db.avatarLibrary.toCollection().primaryKeys());
    return {
      assistants: (await db.assistants.toArray()).map(assistant =>
        assistant.avatar?.source && !resources.has(assistant.avatar.source.resourceId)
          ? { ...assistant, avatar: withoutAvatarSource(assistant.avatar) } : assistant)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)),
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
      // Reject unsupported data before initialization can publish defaults or repair any rows.
      // The enclosing transaction also rolls back any later migration/selection failure.
      for (const chat of await db.chats.toArray()) readMessagesGenerationMetrics(chat.messages);
      for (const assistant of await db.assistants.toArray()) {
        readSessionConfigData(assistant.defaultConfig);
        readAssistantAvatarSelection(assistant);
      }
      for (const conversation of await db.conversations.toArray()) {
        if (conversation.settings !== undefined) readConversationConfigData(conversation.settings);
        if (conversation.creationConfig !== undefined) readConversationConfigData(conversation.creationConfig);
        if (conversation.overrides !== undefined) {
          assertLegacyOverrides(conversation.overrides);
          const assistant = await db.assistants.get(conversation.assistantId);
          readSessionConfigData(resolveConversationConfig(assistant, conversation.overrides).config);
        }
      }
      for (const legacy of await db.legacyConversationConfigs.toArray()) {
        if (legacy.generationConfig !== undefined) readSessionConfigData(legacy.generationConfig);
      }
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
      const newConversationRank = async (assistantId: string) => {
        const siblings = await db.conversations.where("assistantId").equals(assistantId).toArray();
        if (!siblings.some(item => Number.isFinite(item.sortOrder))) return {};
        // Normalize before adding to avoid ever growing/overflowing ranks.
        const ordered = orderedConversations(siblings);
        for (let order = 0; order < ordered.length; order++) await db.conversations.update(ordered[order].id, { sortOrder: order + 1 });
        return { sortOrder: 0 };
      };
      switch (action.type) {
        case "create-assistant":
        case "edit-assistant": {
          readAssistantAvatarSelection(action.input);
          if (!action.input.name.trim()) throw new Error("请输入助手名称。");
          const existing = action.type === "edit-assistant" ? await requireAssistant(action.id) : undefined;
          const avatar = await resolveAvatarSource(db, action.input.avatar);
          const orders = (await db.assistants.toArray()).map((item) => item.sortOrder);
          const assistant: AssistantPreset = { id: action.id, sortOrder: existing?.sortOrder ?? Math.max(0, ...orders) + 1,
            name: action.id === DEFAULT_ASSISTANT_ID ? "默认助手" : action.input.name.trim(),
            icon: action.input.icon.trim(), defaultModelId: action.input.defaultModelId,
            avatar, defaultAvatar: action.input.defaultAvatar,
            defaultConfig: restoreSessionConfig(action.input.defaultConfig) };
          if (existing) await db.assistants.put(assistant); else await db.assistants.add(assistant);
          if (!existing) selection.activeAssistantId = action.id;
          break;
        }
        case "move-assistant":
        case "reorder-assistant": {
          await requireAssistant(action.id);
          const items = (await this.snapshot()).assistants;
          const index = items.findIndex((item) => item.id === action.id);
          const targetId = action.type === "reorder-assistant" ? (await requireAssistant(action.targetId)).id : items[index + action.direction]?.id;
          const next = targetId && placeItem(items, action.id, targetId, action.type === "reorder-assistant" ? action.placement : action.direction < 0 ? "before" : "after");
          if (next) for (let order = 0; order < next.length; order++) await db.assistants.update(next[order].id, { sortOrder: order });
          break;
        }
        case "move-conversation":
        case "reorder-conversation": {
          const item = await requireConversation(action.id);
          const items = orderedConversations(await db.conversations.where("assistantId").equals(item.assistantId).toArray());
          const index = items.findIndex(child => child.id === action.id);
          const target = action.type === "reorder-conversation" ? await requireConversation(action.targetId) : items[index + action.direction];
          if (target && target.assistantId !== item.assistantId) throw new Error("只能在同一助手内调整对话顺序。");
          const next = target && placeItem(items, action.id, target.id, action.type === "reorder-conversation" ? action.placement : action.direction < 0 ? "before" : "after");
          if (next) for (let order = 0; order < next.length; order++) await db.conversations.update(next[order].id, { sortOrder: order });
          break;
        }
        case "delete-assistant":
        case "delete-assistants": {
          const ids = action.type === "delete-assistant" ? [action.id] : action.ids;
          if (!ids.length || new Set(ids).size !== ids.length) throw new Error("请选择有效的助手。");
          if (ids.includes(DEFAULT_ASSISTANT_ID)) throw new Error("默认助手不能删除。");
          for (const id of ids) await requireAssistant(id);
          if (action.type === "delete-assistants" && workspaceDeletionFingerprint(await this.snapshot(), "assistants", ids) !== action.expected)
            throw new Error("删除范围已变化，请取消后重新选择并确认。");
          const selected = new Set(ids);
          const children = orderedConversations((await db.conversations.toArray()).filter(item => selected.has(item.assistantId)));
          const destination = orderedConversations(await db.conversations.where("assistantId").equals(DEFAULT_ASSISTANT_ID).toArray());
          for (const child of children) {
            if (action.mode === "move") {
              const { sortOrder: _oldRank, ...moved } = child;
              await db.conversations.put({ ...moved, assistantId: DEFAULT_ASSISTANT_ID });
            }
            else { await db.chats.delete(child.id); await db.conversations.delete(child.id); await db.legacyConversationConfigs.delete(child.id); }
          }
          if (action.mode === "move" && destination.some(item => Number.isFinite(item.sortOrder))) {
            const combined = [...destination, ...children];
            for (let order = 0; order < combined.length; order++) await db.conversations.update(combined[order].id, { sortOrder: order });
          }
          if (selected.has(selection.activeAssistantId) && action.mode === "move") {
            selection.lastSelected[DEFAULT_ASSISTANT_ID] = selection.lastSelected[selection.activeAssistantId] ?? null;
          }
          await db.assistants.bulkDelete(ids);
          break;
        }
        case "create-conversation": {
          const assistant = await requireAssistant(action.assistantId);
          const now = Date.now();
          await db.conversations.add({ id: action.id, assistantId: assistant.id, title: "新对话",
            createdAt: now, updatedAt: now, settings: copyAssistantConfig(assistant), ...await newConversationRank(assistant.id) });
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
            ...(action.title === undefined ? {} : { title: action.title.trim(), titleNaming: "manual" as const }),
          });
          break;
        }
        case "rename-conversation": {
          await requireConversation(action.id);
          if (!action.title.trim()) throw new Error("请输入对话标题。");
          await db.conversations.update(action.id, { title: action.title.trim(), titleNaming: "manual" });
          break;
        }
        case "start-conversation-title": {
          const conversation = await db.conversations.get(action.id);
          const chat = await this.load(action.id);
          const firstUser = chat?.messages.find((message) => message.role === "user");
          if (!conversation || conversation.titleNaming || conversation.title !== "新对话" || firstUser?.id !== action.messageId) break;
          const source = firstUser.content.trim() || firstUser.attachments?.map((item) => item.name).join("、") || "";
          const title = titleFromText(source);
          if (!title) break;
          await db.conversations.update(action.id, { title,
            titleNaming: { sourceMessageId: action.messageId, source, status: "pending" } });
          break;
        }
        case "finish-conversation-title": {
          const conversation = await db.conversations.get(action.id);
          const naming = conversation?.titleNaming;
          if (!naming || naming === "manual" || naming.status !== "pending" || naming.sourceMessageId !== action.messageId) break;
          const chat = await this.load(action.id);
          const firstUser = chat?.messages.find((message) => message.role === "user");
          const source = firstUser && (firstUser.content.trim() || firstUser.attachments?.map((item) => item.name).join("、") || "");
          const title = action.title && titleFromText(action.title);
          await db.conversations.update(action.id, {
            ...(title && firstUser?.id === action.messageId && source === naming.source ? { title } : {}),
            titleNaming: { ...naming, status: "finished" },
          });
          break;
        }
        case "select-round-version": {
          const source = await requireConversation(action.conversationId);
          const chat = await this.load(source.id);
          const messages = selectRoundVersion(withReplyLinks(chat?.messages ?? []), action.index);
          const now = Date.now();
          await db.chats.put({ id: source.id, updatedAt: now, messages });
          await db.conversations.update(source.id, { updatedAt: now });
          break;
        }
        case "edit-message":
        case "delete-message":
        case "fork-conversation": {
          const source = await requireConversation(action.conversationId);
          const chat = await this.load(source.id);
          const messages = action.type === "edit-message" ? chat?.messages ?? [] : withReplyLinks(chat?.messages ?? []);
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
              creationConfig: action.creationConfig, settings: structuredClone(source.settings), ...await newConversationRank(source.assistantId) });
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
                status: message.status === "paused" ? "incomplete" : message.status }, ...messages.slice(index + 1)];
            } else next = messages.filter((message) => message.id !== action.messageId).map((message) =>
              message.status === "paused" ? { ...message, status: "incomplete" as const, continuation: undefined } : message);
            if (action.type === "delete-message" && index >= messages.length - 2) next = next.map(withoutVersions);
            await db.chats.put({ id: source.id, updatedAt: now, messages: next });
            await db.conversations.update(source.id, { updatedAt: now });
          }
          break;
        }
        case "delete-conversation":
        case "delete-conversations": {
          const ids = action.type === "delete-conversation" ? [action.id] : action.ids;
          if (!ids.length || new Set(ids).size !== ids.length) throw new Error("请选择有效的对话。");
          const items = await Promise.all(ids.map(requireConversation));
          if (action.type === "delete-conversations") {
            if (items.some(item => item.assistantId !== action.assistantId)) throw new Error("只能批量删除同一助手内的对话。");
            if (workspaceDeletionFingerprint(await this.snapshot(), "conversations", ids) !== action.expected)
              throw new Error("删除范围已变化，请取消后重新选择并确认。");
          }
          const selected = new Set(ids);
          for (const assistantId of new Set(items.map(item => item.assistantId))) {
            const siblings = orderedConversations(await db.conversations.where("assistantId").equals(assistantId).toArray());
            const index = siblings.findIndex(item => item.id === selection.lastSelected[assistantId]);
            if (index >= 0 && selected.has(siblings[index].id)) {
              selection.lastSelected[assistantId] = siblings.slice(index + 1).find(item => !selected.has(item.id))?.id
                ?? siblings.slice(0, index).reverse().find(item => !selected.has(item.id))?.id ?? null;
            }
          }
          await db.chats.bulkDelete(ids);
          await db.legacyConversationConfigs.bulkDelete(ids);
          await db.conversations.bulkDelete(ids);
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
