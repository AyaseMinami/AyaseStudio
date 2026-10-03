import { dataPolicies } from "./dataPolicies";
import type { DataVersion } from "./dataContract";

/** Module data versions are independent of application, Dexie schema and backup envelope versions. */
export const dataModules = {
  chat: { version: 3, capabilities: [], resources: "managed attachments; scoped provider replay; per-invocation generation metrics v1; exact requested API model snapshots; no runtime continuation" },
  session: { version: 1, capabilities: [], resources: "none; parameter compatibility only" },
  workspace: { version: 1, capabilities: [], resources: "model/assistant/conversation IDs remapped by restore plan" },
  avatars: { version: 1, capabilities: [], resources: "encoded Blobs and library ownership" },
  appearance: { version: 3, capabilities: [], resources: "shared titlebar/rail transparency defaults to 40%, sidebar to 50%, message bubbles to 12%; independent glass flags default sidebar off/composer on; managed background originals; derived thumbnails excluded" },
  connections: { version: 5, capabilities: [], resources: "built-in preset identities and initialization marker; bundled brand IDs; immutable provider avatar snapshots exported only with selected connections; local record remains v3" },
  search: { version: 3, capabilities: [], resources: "independent Exa/Tavily/Zhipu credentials; disabled new providers; v1 MCP and v2 Exa migrate without writes; governs new provider selections and records across modules" },
  drawingSettings: { version: 3, capabilities: [], resources: "allowlisted Gemini/Grok/Seedream controls with explicit version contracts; no prompt or image bindings" },
  drawingPresets: { version: 1, capabilities: [], resources: "explicit text only; dedicated drawing.presets projection" },
  drawingHistory: { version: 2, capabilities: [], resources: "excluded; Grok/Seedream frozen parameters; retained local task/result/image ownership; #110 session selections excluded, legacy draft bindings retained until explicit removal" },
  recovery: { version: 1, capabilities: [], resources: "private journals; origin-scoped native drawing import receipts v1; never portable" },
} as const;

/** Every Dexie table, including intentionally excluded tables, must be registered. */
export const persistentTables = {
  assistants: { module: "workspace", fields: "assistants", backup: "included" },
  conversations: { module: "workspace", fields: "conversations", backup: "included" },
  chats: { module: "chat", fields: "chats", backup: "included" },
  workspace: { module: "workspace", fields: "workspace", backup: "included" },
  avatarLibrary: { module: "avatars", fields: "avatarLibrary", backup: "included" },
  userAvatar: { module: "avatars", fields: "userAvatar", backup: "included" },
  providerAvatars: { module: "connections", fields: "providerAvatars", backup: "included" },
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
  // Historical compatibility only since #81; new assistants no longer consume it.
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
