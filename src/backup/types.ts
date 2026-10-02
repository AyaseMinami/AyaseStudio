import type { AssistantPreset, Conversation, WorkspaceSelection } from "../chat/workspace";
import type { ChatSnapshot } from "../chat/repository";
import type { AvatarLibraryEntry } from "../avatar/library";
import type { UserAvatar } from "../avatar/repository";
import type { ProviderAvatarEntry } from "../avatar/providerAvatars";
import type { CherryImportRecord } from "../storage/database";
import type { SessionConfig } from "../chat/sessionConfig";
import type { SearchSettings, TavilySearchSettings, ZhipuSearchSettings } from "../search/settings";
import type { DataVersion } from "../storage/dataContract";
import type { DrawingPromptPreset } from "../drawing/presets";
import type { DrawingSettingsData } from "../drawing/settingsData";

export const backupTables = ["assistants", "conversations", "chats", "workspace", "avatarLibrary", "userAvatar", "cherryImports", "legacyConversationConfigs", "providerAvatars"] as const;
/** These tables are projected into dedicated portable areas, never exported as raw rows. */
export const projectedBackupTables = ["drawingDrafts", "drawingPromptPresets"] as const;
export type BackupTable = typeof backupTables[number];
export interface BackupRows {
  assistants: AssistantPreset[];
  conversations: Conversation[];
  chats: ChatSnapshot[];
  workspace: WorkspaceSelection[];
  avatarLibrary: AvatarLibraryEntry[];
  userAvatar: { id: string; value?: UserAvatar }[];
  providerAvatars?: ProviderAvatarEntry[];
  cherryImports: CherryImportRecord[];
  legacyConversationConfigs: { id: string; generationConfig?: SessionConfig; lastUsedModelId?: string | null }[];
}
export const preferenceKeys = ["ayase-studio.appearance.v1", "ayase-studio.chat-layout.v1", "ayase-studio.assistant-default-avatar"] as const;
export type BackupPreferences = Record<typeof preferenceKeys[number], string | null>;
export interface BackupOptions { connections: boolean; credentials: boolean }
export interface BackupExportOptions { encrypted: boolean }
export interface BackupAsset { id: string; mime: string; data: string; size: number; sha256: string }
export type BackupSearchProfile = Omit<SearchSettings, "apiKey"> & { apiKey?: string };
export type BackupSearchConfiguration = { version: 2; exaMcp: BackupSearchProfile; exaApi: BackupSearchProfile }
  | { version: 3; exaMcp: BackupSearchProfile; exaApi: BackupSearchProfile;
      tavily: Omit<TavilySearchSettings, "apiKey"> & { apiKey?: string };
      zhipu: Omit<ZhipuSearchSettings, "apiKey"> & { apiKey?: string } };
export interface BackupDocument {
  format: "ayase-studio-backup";
  version: 1 | 2 | 3 | 4 | 5;
  createdAt: string;
  options: BackupOptions;
  // JSON data only. Avatar Blobs are encoded as {$blob: assetId, type: mime}.
  rows: Record<Exclude<BackupTable, "providerAvatars">, unknown[]> & { providerAvatars?: unknown[] };
  preferences: BackupPreferences;
  connections: unknown | null;
  searchSettings?: BackupSearchProfile | BackupSearchConfiguration;
  assets: BackupAsset[];
  compatibility?: BackupCompatibility;
  drawing?: { settings?: DrawingSettingsData; presets?: DrawingPromptPreset[] };
}
export interface BackupCompatibility {
  minimumReaderVersion: 4 | 5;
  requiredCapabilities: string[];
  modules: Record<string, DataVersion>;
  /** Paths only, never discarded values. Persisted to keep later export warnings honest. */
  filteredParameters?: string[];
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
