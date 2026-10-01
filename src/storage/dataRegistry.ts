import { dataPolicies } from "./dataPolicies";
import type { DataVersion } from "./dataContract";

/** Module data versions are independent of application, Dexie schema and backup envelope versions. */
export const dataModules = {
  chat: { version: 1, capabilities: [], resources: "managed attachments; scoped provider replay; no runtime continuation" },
  session: { version: 1, capabilities: [], resources: "none; parameter compatibility only" },
  workspace: { version: 1, capabilities: [], resources: "model/assistant/conversation IDs remapped by restore plan" },
  avatars: { version: 1, capabilities: [], resources: "encoded Blobs and library ownership" },
  appearance: { version: 1, capabilities: [], resources: "managed background originals; derived thumbnails excluded" },
  connections: { version: 3, capabilities: [], resources: "credentials only in the explicit credential section" },
  search: { version: 2, capabilities: [], resources: "separate Exa credentials; legacy v1 migrates to MCP" },
  drawingSettings: { version: 1, capabilities: [], resources: "allowlisted settings only; no prompt or image bindings" },
  drawingPresets: { version: 1, capabilities: [], resources: "explicit text only; dedicated drawing.presets projection" },
  drawingHistory: { version: 1, capabilities: [], resources: "excluded; retained local task/result/image ownership" },
  recovery: { version: 1, capabilities: [], resources: "private journals; never portable" },
} as const;

/** Every Dexie table, including intentionally excluded tables, must be registered. */
export const persistentTables = {
  assistants: { module: "workspace", fields: "assistants", backup: "included" },
  conversations: { module: "workspace", fields: "conversations", backup: "included" },
  chats: { module: "chat", fields: "chats", backup: "included" },
  workspace: { module: "workspace", fields: "workspace", backup: "included" },
  avatarLibrary: { module: "avatars", fields: "avatarLibrary", backup: "included" },
  userAvatar: { module: "avatars", fields: "userAvatar", backup: "included" },
  cherryImports: { module: "workspace", fields: "cherryImports", backup: "included" },
  legacyConversationConfigs: { module: "session", fields: "legacyConversationConfigs", backup: "included" },
  drawingDrafts: { module: "drawingSettings", fields: "drawingDraft", backup: "projected" },
  drawingPromptPresets: { module: "drawingPresets", fields: "drawingPresets", backup: "projected" },
  drawingTasks: { module: "drawingHistory", fields: "drawingTasks", backup: "excluded" },
  drawingResults: { module: "drawingHistory", fields: "drawingResults", backup: "excluded" },
  backupJournal: { module: "recovery", fields: null, backup: "excluded" },
} as const satisfies Record<string, { module: keyof typeof dataModules; fields: keyof typeof dataPolicies | null; backup: "included" | "excluded" | "projected" }>;

export const DATA_COMPATIBILITY_KEY = "ayase-studio.data-compatibility.v1";
export const persistentPreferences = {
  "ayase-studio.appearance.v1": { module: "appearance", backup: "included" },
  "ayase-studio.chat-layout.v1": { module: "workspace", backup: "included" },
  "ayase-studio.assistant-default-avatar": { module: "avatars", backup: "included" },
  "ayase-studio.connection-settings.v3": { module: "connections", backup: "included" },
  "ayase-studio.search.v1": { module: "search", backup: "included" },
  "ayase-studio.connection-settings.v2": { module: "connections", backup: "legacy-source" },
  "ayase-studio.provider-profiles.v1": { module: "connections", backup: "legacy-source" },
  "ayase-studio.data-compatibility.v1": { module: "recovery", backup: "compatibility-report" },
} as const;

export const backupModuleIds = ["chat", "session", "workspace", "avatars", "appearance", "connections", "search"] as const;
export function currentModuleVersions(drawing?: { settings?: unknown; presets?: unknown }): Record<string, DataVersion> {
  const ids: (keyof typeof dataModules)[] = [...backupModuleIds];
  if (drawing?.settings !== undefined) ids.push("drawingSettings");
  if (drawing?.presets !== undefined) ids.push("drawingPresets");
  return Object.fromEntries(ids.map(id => [id, { version: dataModules[id].version,
    minimumReaderVersion: dataModules[id].version, requiredCapabilities: [] }]));
}
