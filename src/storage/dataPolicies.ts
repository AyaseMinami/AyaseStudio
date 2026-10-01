import type { SessionConfig, NumericSetting } from "../chat/sessionConfig";
import type { AssistantPreset, Conversation, WorkspaceSelection } from "../chat/workspace";
import type { StoredChatMessage, ChatSnapshot } from "../chat/repository";
import type { ConnectionSettingsState, ProviderGroup, ConnectionProfile, ConfiguredModel } from "../chat/settings";
import type { SearchSettings, SearchConfiguration } from "../search/settings";
import type { SearchRecord, SearchSource, SearchCitation, ProviderReplay } from "../chat/nativeSearch";
import type { ThinkingSettings } from "../chat/thinking";
import type { GeminiThinkingSettings } from "../chat/geminiThinking";
import type { SentAttachment } from "../chat/attachments";
import type { UserAvatar, AvatarCrop } from "../avatar/repository";
import type { AvatarLibraryEntry } from "../avatar/library";
import type { AppearancePreferences, BackgroundLibraryEntry } from "../appearance/appearance";
import type { DrawingDraft, DrawingTask, DrawingResult, DrawingParameters, DrawingReference, GeminiDrawingOptions } from "../drawing/types";
import type { DrawingPromptPreset } from "../drawing/presets";
import type { AyaseDatabase, CherryImportRecord } from "./database";
import type { FieldPolicy } from "./dataContract";
import type { ConversationConfig } from "../chat/conversationConfig";
import type { RoundVersions } from "../chat/roundVersions";
import type { BackgroundFocus } from "../appearance/backgroundFocus";
import type { Table } from "dexie";

// Infer the real row parameter, not toArray's final generic callback overload (which returns unknown).
type TableRow<T> = T extends Table<infer Row, infer _Key, infer _Insert> ? Row : never;

// Exhaustive policies: a new declared field cannot compile until its disposition is chosen.
// Nested persisted records have their own policies; resources still use their existing validators.
export const dataPolicies = {
  session: {
    version: "backup", systemInstruction: "backup", temperature: "backup", topP: "backup", topK: "backup",
    contextBudget: "backup", maxOutput: "backup", stream: "backup", dualSamplingConfirmed: "backup", customJson: "backup",
    webSearch: "backup", webSearchProvider: "backup", geminiThinking: "backup", thinking: "backup", invalidStoredConfig: "backup",
  } satisfies FieldPolicy<SessionConfig>,
  numeric: { mode: "backup", value: "backup" } satisfies FieldPolicy<NumericSetting>,
  thinking: { choice: "backup", budget: "backup", includeSummary: "backup", effort: "backup" } satisfies FieldPolicy<ThinkingSettings>,
  geminiThinking: { choice: "backup", budget: "backup", includeSummary: "backup" } satisfies FieldPolicy<GeminiThinkingSettings>,
  assistants: { id: "backup", name: "backup", icon: "backup", avatar: "resource", defaultAvatar: "backup", sortOrder: "backup", defaultModelId: "backup", defaultConfig: "backup" } satisfies FieldPolicy<AssistantPreset>,
  conversations: { id: "backup", assistantId: "backup", title: "backup", titleNaming: "backup", createdAt: "backup", updatedAt: "backup", sortOrder: "backup", settings: "backup", creationConfig: "backup", overrides: "legacy" } satisfies FieldPolicy<Conversation>,
  chats: { id: "backup", updatedAt: "backup", messages: "backup", generationConfig: "legacy" } satisfies FieldPolicy<ChatSnapshot>,
  messages: { id: "backup", role: "backup", content: "backup", status: "backup", replyToId: "backup", editedAt: "backup", thinkingSummary: "backup", attachments: "resource", search: "backup", source: "backup", providerReplay: "backup", roundVersions: "backup", continuation: "exclude" } satisfies FieldPolicy<StoredChatMessage>,
  workspace: { id: "backup", activeAssistantId: "backup", lastSelected: "backup" } satisfies FieldPolicy<WorkspaceSelection>,
  avatarLibrary: { id: "backup", name: "backup", version: "backup", avatar: "resource" } satisfies FieldPolicy<AvatarLibraryEntry>,
  avatar: { original: "resource", thumbnail: "resource", crop: "backup", source: "backup" } satisfies FieldPolicy<UserAvatar>,
  crop: { x: "backup", y: "backup", zoom: "backup" } satisfies FieldPolicy<AvatarCrop>,
  userAvatar: { id: "backup", value: "resource" } as const satisfies FieldPolicy<TableRow<AyaseDatabase["userAvatar"]>>,
  cherryImports: { id: "backup", assistantId: "backup", conversationIds: "backup" } satisfies FieldPolicy<CherryImportRecord>,
  legacyConversationConfigs: { id: "backup", generationConfig: "backup", lastUsedModelId: "backup" } as const satisfies FieldPolicy<TableRow<AyaseDatabase["legacyConversationConfigs"]>>,
  conversationConfig: { modelId: "backup", config: "backup" } satisfies FieldPolicy<ConversationConfig>,
  creationConfig: { modelId: "backup", config: "backup" } satisfies FieldPolicy<NonNullable<Conversation["creationConfig"]>>,
  avatarSource: { resourceId: "backup", version: "backup" } satisfies FieldPolicy<NonNullable<UserAvatar["source"]>>,
  messageSource: { source: "backup", id: "backup", createdAt: "backup", unavailableAttachments: "backup" } satisfies FieldPolicy<NonNullable<StoredChatMessage["source"]>>,
  roundVersions: { selected: "backup", pairs: "backup" } satisfies FieldPolicy<RoundVersions>,
  backgroundFocus: { x: "backup", y: "backup", zoom: "backup" } satisfies FieldPolicy<BackgroundFocus>,
  connections: { version: "backup", providers: "backup", activeModelId: "backup" } satisfies FieldPolicy<ConnectionSettingsState>,
  provider: { id: "backup", name: "backup", connections: "backup" } satisfies FieldPolicy<ProviderGroup>,
  connection: { id: "backup", name: "backup", protocol: "backup", baseUrl: "backup", apiKey: "credential", models: "backup" } satisfies FieldPolicy<ConnectionProfile>,
  model: { id: "backup", modelId: "backup", displayName: "backup" } satisfies FieldPolicy<ConfiguredModel>,
  search: { version: "backup", exaMcp: "backup", exaApi: "backup" } satisfies FieldPolicy<SearchConfiguration>,
  searchProfile: { version: "backup", baseUrl: "backup", apiKey: "credential", numResults: "backup" } satisfies FieldPolicy<SearchSettings>,
  searchRecord: { provider: "backup", warning: "backup", enabled: "backup", status: "backup", sources: "backup", citations: "backup", queries: "backup", suggestionHtml: "backup", error: "backup" } satisfies FieldPolicy<SearchRecord>,
  searchSource: { id: "backup", url: "backup", title: "backup", excerpt: "backup" } satisfies FieldPolicy<SearchSource>,
  citation: { start: "backup", end: "backup", sourceIds: "backup" } satisfies FieldPolicy<SearchCitation>,
  replay: { protocol: "backup", scope: "backup", content: "backup", responses: "backup" } satisfies FieldPolicy<ProviderReplay>,
  attachment: { reference: "resource", name: "backup", size: "backup", mimeType: "backup" } satisfies FieldPolicy<SentAttachment>,
  appearance: {
    colorPreset: "backup", themeMode: "backup", accentColor: "backup", userBubbleColor: "backup", unifiedThemeColor: "backup",
    canvasColor: "backup", assistantBubbleColor: "backup", unifiedTransparency: "backup", sidebarTransparency: "backup",
    composerTransparency: "backup", assistantBubbleTransparency: "backup", backgroundReference: "resource", backgroundFocus: "backup",
    backgroundFit: "backup", backgroundMask: "backup", backgroundBlur: "backup", backgroundLibrary: "resource", backgroundEnabled: "backup", backgroundName: "backup",
  } satisfies FieldPolicy<AppearancePreferences>,
  background: { id: "backup", name: "backup", reference: "resource", focus: "backup", fit: "backup", mask: "backup", blur: "backup" } satisfies FieldPolicy<BackgroundLibraryEntry>,
  drawingDraft: { id: "exclude", prompt: "exclude", aspectRatio: "backup", resolution: "backup", modelId: "backup", openai: "backup", gemini: "backup", count: "backup", concurrency: "backup", completionSound: "backup", reusedProtocol: "backup", references: "exclude" } satisfies FieldPolicy<DrawingDraft>,
  drawingOpenai: { size: "backup", quality: "backup" } satisfies FieldPolicy<NonNullable<DrawingDraft["openai"]>>,
  drawingGemini: { temperature: "backup", safetyThreshold: "backup", outputMode: "backup" } satisfies FieldPolicy<GeminiDrawingOptions>,
  drawingPresets: { id: "backup", name: "backup", content: "backup", createdAt: "backup", updatedAt: "backup" } satisfies FieldPolicy<DrawingPromptPreset>,
  drawingTasks: { id: "exclude", createdAt: "exclude", updatedAt: "exclude", status: "exclude", parameters: "exclude", error: "exclude", batchId: "exclude", queueOrder: "exclude", startedAt: "exclude", finishedAt: "exclude", sourceTaskId: "exclude", diagnostic: "exclude", recovery: "exclude" } satisfies FieldPolicy<DrawingTask>,
  drawingResults: { id: "exclude", taskId: "exclude", createdAt: "exclude", parameters: "exclude", reference: "exclude", mime: "exclude", size: "exclude", width: "exclude", height: "exclude" } satisfies FieldPolicy<DrawingResult>,
  drawingParameters: { prompt: "exclude", providerId: "exclude", connectionId: "exclude", configuredModelId: "exclude", modelId: "exclude", modelName: "exclude", baseUrl: "exclude", references: "exclude", protocol: "exclude", aspectRatio: "exclude", resolution: "exclude", gemini: "exclude", size: "exclude", quality: "exclude" } satisfies FieldPolicy<DrawingParameters>,
  drawingReference: { id: "exclude", reference: "exclude", mime: "exclude", size: "exclude", width: "exclude", height: "exclude", name: "exclude", digest: "exclude" } satisfies FieldPolicy<DrawingReference>,
} as const;
