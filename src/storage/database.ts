import Dexie, { type EntityTable, type Table } from "dexie";
import type { ChatSnapshot } from "../chat/repository";
import type { SessionConfig } from "../chat/sessionConfig";
import type { AssistantPreset, Conversation, WorkspaceSelection } from "../chat/workspace";
import type { UserAvatar } from "../avatar/repository";
import type { AvatarLibraryEntry } from "../avatar/library";
import type { BackupJournal } from "../backup/repository";

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
    this.version(4).stores({ avatarLibrary: "id", userAvatar: "id" });
    this.version(5).stores({ cherryImports: "id" });
    this.version(6).stores({ backupJournal: "id" });
  }
}
