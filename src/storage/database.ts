import Dexie, { type EntityTable, type Table } from "dexie";
import type { ChatSnapshot } from "../chat/repository";
import { readSessionConfigData, type SessionConfig } from "../chat/sessionConfig";
import { dataCheck } from "./dataContract";
import type { AssistantPreset, Conversation, WorkspaceSelection } from "../chat/workspace";
import type { UserAvatar } from "../avatar/repository";
import type { AvatarLibraryEntry } from "../avatar/library";
import type { BackupJournal } from "../backup/repository";
import type { DrawingDraft, DrawingTask, DrawingResult } from "../drawing/types";
import type { DrawingPromptPreset } from "../drawing/presets";

export type CherryImportRecord =
  | { id: string; conversationIds: string[] }
  | { id: string; assistantId: string };

export class AyaseDatabase extends Dexie {
  legacyConversationConfigs!: EntityTable<{ id: string; generationConfig?: SessionConfig; lastUsedModelId?: string | null }, "id">;
  chats!: EntityTable<ChatSnapshot, "id">;
  assistants!: EntityTable<AssistantPreset, "id">;
  conversations!: EntityTable<Conversation, "id">;
  workspace!: EntityTable<WorkspaceSelection, "id">;
  avatarLibrary!: EntityTable<AvatarLibraryEntry, "id">;
  userAvatar!: EntityTable<{ id: string; value?: UserAvatar }, "id">;
  cherryImports!: Table<CherryImportRecord, string>;
  backupJournal!: Table<BackupJournal, string>;
  drawingDrafts!: EntityTable<DrawingDraft, "id">;
  drawingTasks!: EntityTable<DrawingTask, "id">;
  drawingResults!: EntityTable<DrawingResult, "id">;
  drawingPromptPresets!: EntityTable<DrawingPromptPreset, "id">;

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
      const originalChats = await chats.toArray();
      // Validate fields moved by this historical upgrade before any durable change.
      // A failure aborts Dexie's whole version transaction and retains the old schema.
      for (const chat of originalChats) {
        if (chat.generationConfig !== undefined) readSessionConfigData(chat.generationConfig);
      }
      for (const conversation of await conversations.toArray()) {
        dataCheck(conversation.lastUsedModelId === undefined || conversation.lastUsedModelId === null || typeof conversation.lastUsedModelId === "string",
          "历史模型选择无法安全读取，原数据已保留。");
      }
      for (const chat of originalChats) {
        const conversation = await conversations.get(chat.id);
        await transaction.table("legacyConversationConfigs").put({ id: chat.id,
          generationConfig: chat.generationConfig, lastUsedModelId: conversation?.lastUsedModelId });
        delete chat.generationConfig;
        await chats.put(chat);
      }
      await conversations.toCollection().modify((item) => { delete item.lastUsedModelId; });
    });
    this.version(4).stores({ avatarLibrary: "id", userAvatar: "id" });
    this.version(5).stores({ cherryImports: "id" });
    this.version(6).stores({ backupJournal: "id" });
    this.version(7).stores({ drawingDrafts: "id", drawingTasks: "id,createdAt", drawingResults: "id,taskId,createdAt" });
    this.version(8).stores({ drawingPromptPresets: "id,createdAt" });
  }
}
