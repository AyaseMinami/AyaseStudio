import Dexie, { type EntityTable } from "dexie";

import type { ChatMessage } from "./types";

export type StoredMessageStatus =
  | "complete"
  | "streaming"
  | "aborted"
  | "failed";

export interface StoredChatMessage extends ChatMessage {
  id: string;
  status: StoredMessageStatus;
}

export interface ChatSnapshot {
  id: string;
  updatedAt: number;
  messages: StoredChatMessage[];
}

export interface ChatRepository {
  load(id: string): Promise<ChatSnapshot | undefined>;
  save(snapshot: ChatSnapshot): Promise<void>;
  clear(id: string): Promise<void>;
}

class AyaseDatabase extends Dexie {
  chats!: EntityTable<ChatSnapshot, "id">;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ chats: "id,updatedAt" });
  }
}

class DexieChatRepository implements ChatRepository {
  constructor(private readonly database: AyaseDatabase) {}

  load(id: string): Promise<ChatSnapshot | undefined> {
    return this.database.chats.get(id);
  }

  async save(snapshot: ChatSnapshot): Promise<void> {
    await this.database.chats.put(snapshot);
  }

  async clear(id: string): Promise<void> {
    await this.database.chats.delete(id);
  }
}

export function createChatRepository(
  databaseName = "AyaseStudio",
): ChatRepository {
  return new DexieChatRepository(new AyaseDatabase(databaseName));
}
