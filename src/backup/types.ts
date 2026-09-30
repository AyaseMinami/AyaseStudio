import type { AssistantPreset, Conversation, WorkspaceSelection } from "../chat/workspace";
import type { ChatSnapshot } from "../chat/repository";
import type { AvatarLibraryEntry } from "../avatar/library";
import type { UserAvatar } from "../avatar/repository";
import type { CherryImportRecord } from "../storage/database";
import type { SessionConfig } from "../chat/sessionConfig";

export const backupTables = ["assistants", "conversations", "chats", "workspace", "avatarLibrary", "userAvatar", "cherryImports", "legacyConversationConfigs"] as const;
export type BackupTable = typeof backupTables[number];
export interface BackupRows {
  assistants: AssistantPreset[];
  conversations: Conversation[];
  chats: ChatSnapshot[];
  workspace: WorkspaceSelection[];
  avatarLibrary: AvatarLibraryEntry[];
  userAvatar: { id: string; value?: UserAvatar }[];
  cherryImports: CherryImportRecord[];
  legacyConversationConfigs: { id: string; generationConfig?: SessionConfig; lastUsedModelId?: string | null }[];
}
export const preferenceKeys = ["ayase-studio.appearance.v1", "ayase-studio.chat-layout.v1", "ayase-studio.assistant-default-avatar"] as const;
export type BackupPreferences = Record<typeof preferenceKeys[number], string | null>;
export interface BackupOptions { connections: boolean; credentials: boolean }
export interface BackupExportOptions { encrypted: boolean }
export interface BackupAsset { id: string; mime: string; data: string; size: number; sha256: string }
export interface BackupDocument {
  format: "ayase-studio-backup";
  version: 1;
  createdAt: string;
  options: BackupOptions;
  // JSON data only. Avatar Blobs are encoded as {$blob: assetId, type: mime}.
  rows: Record<BackupTable, unknown[]>;
  preferences: BackupPreferences;
  connections: unknown | null;
  assets: BackupAsset[];
}
export interface BackupPreview {
  document: BackupDocument;
  encrypted: boolean;
  counts: { assistants: number; conversations: number; messages: number; avatars: number; files: number; connections: number };
}
export type RestoreMode = "merge" | "copy" | "replace";
export interface BackupFiles {
  read(reference: string): Promise<string>;
  assertAvailable(references: string[]): Promise<void>;
  write(reference: string, data: string): Promise<void>;
  remove(references: string[]): Promise<void>;
}
