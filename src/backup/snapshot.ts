import { readAppearancePreferences } from "../appearance/appearance";
import { readProviderAvatarEntry } from "../avatar/providerAvatars";
import { readAssistantAvatarSelection } from "../avatar/assistantDefaults";
import { loadConnectionSettings, type ConnectionSettingsState } from "../chat/settings";
import { bytesToBase64 } from "../chat/attachments";
import { check, decode64, sha256 } from "./codec";
import { backupTables, preferenceKeys, type BackupAsset, type BackupDocument, type BackupFiles, type BackupOptions, type BackupPreferences, type BackupRows } from "./types";
import { managedReference } from "./validation";
import { loadSearchConfiguration } from "../search/settings";
import { DATA_COMPATIBILITY_KEY, currentModuleVersions, persistentPreferences } from "../storage/dataRegistry";
import { dataPolicies } from "../storage/dataPolicies";
import { backupFields } from "../storage/dataContract";
import { readSessionConfigData } from "../chat/sessionConfig";
import { readConversationConfigData } from "../chat/conversationConfig";
import { validateFilteredParameters } from "./compatibility";
import type { DrawingDraft } from "../drawing/types";
import type { DrawingPromptPreset } from "../drawing/presets";
import { projectDrawingSettings, readDrawingPromptPresetData } from "../drawing/settingsData";
import { readMessageGenerationMetrics } from "../chat/generationMetricsData";

export const allPreferenceKeys = Object.keys(persistentPreferences);
/** drawing is private rollback state; it must never be copied into portable rows. */
export interface LocalSnapshot { rows: BackupRows; preferences: Record<string, string | null>;
  drawing?: { draft?: DrawingDraft; presets: DrawingPromptPreset[]; targets?: { modelId: string; providerId: string; connectionId: string; protocol: string; baseUrl: string; upstreamModelId: string }[] } }
export function pick(value: Record<string, any>, fields: string[]): Record<string, any> {
  return Object.fromEntries(fields.filter(k => value[k] !== undefined).map(k => [k, value[k]]));
}
function session(v: Record<string, any>) {
  readSessionConfigData(v);
  const result = pick(v, backupFields(dataPolicies.session));
  for (const key of ["temperature", "topP", "topK", "contextBudget", "maxOutput"]) result[key] = pick(v[key], backupFields(dataPolicies.numeric));
  result.customJson = pick(v.customJson, ["openai-chat", "openai-responses", "gemini-native", "anthropic-native"]);
  if (v.geminiThinking) result.geminiThinking = pick(v.geminiThinking, backupFields(dataPolicies.geminiThinking));
  if (v.thinking) result.thinking = Object.fromEntries(["openai-chat", "openai-responses", "anthropic-native"].filter(k => v.thinking[k]).map(k => [k, pick(v.thinking[k], backupFields(dataPolicies.thinking))]));
  return readSessionConfigData(result);
}
function settings(v: Record<string, any>) { readConversationConfigData(v); return { ...pick(v, backupFields(dataPolicies.conversationConfig)), config: session(v.config) }; }
function avatar(v: Record<string, any>) { return { ...pick(v, backupFields(dataPolicies.avatar)), crop: pick(v.crop, backupFields(dataPolicies.crop)), ...(v.source ? { source: pick(v.source, backupFields(dataPolicies.avatarSource)) } : {}) }; }
function message(v: Record<string, any>, pair = false): Record<string, any> {
  v = readMessageGenerationMetrics(v);
  const result = pick(v, backupFields(dataPolicies.messages).filter(key => !["source", "attachments", "search", "providerReplay", "roundVersions", "generationMetrics"].includes(key)));
  if (v.generationMetrics !== undefined) result.generationMetrics = v.generationMetrics.map((metric: Record<string, any>) => ({
    ...pick(metric, backupFields(dataPolicies.generationMetrics)),
    ...(metric.usage !== undefined ? { usage: pick(metric.usage, backupFields(dataPolicies.tokenUsage)) } : {}),
  }));
  if (["streaming", "paused"].includes(result.status)) result.status = "incomplete";
  if (v.source) result.source = pick(v.source, backupFields(dataPolicies.messageSource));
  if (v.attachments) result.attachments = v.attachments.map((a: Record<string, any>) => pick(a, backupFields(dataPolicies.attachment)));
  if (v.search) {
    result.search = { ...pick(v.search, backupFields(dataPolicies.searchRecord).filter(key => !["sources", "citations"].includes(key))),
      sources: v.search.sources.map((s: Record<string, any>) => pick(s, backupFields(dataPolicies.searchSource))), citations: v.search.citations.map((c: Record<string, any>) => pick(c, backupFields(dataPolicies.citation))) };
    if (["pending", "searching"].includes(result.search.status)) {
      result.search.status = "cancelled";
      if (result.status === "complete") result.status = "incomplete";
    }
  }
  if (v.providerReplay) result.providerReplay = pick(v.providerReplay, backupFields(dataPolicies.replay));
  if (!pair && v.roundVersions) result.roundVersions = { ...pick(v.roundVersions, backupFields(dataPolicies.roundVersions)), pairs: v.roundVersions.pairs.map((p: Record<string, any>[]) => p.map(m => message(m, true))) };
  return result;
}
export function exportConnections(state: ConnectionSettingsState, credentials: boolean) {
  return { ...pick(state, backupFields(dataPolicies.connections)), providers: state.providers.map(p => ({ ...pick(p, backupFields(dataPolicies.provider)),
    ...(p.avatar ? { avatar: pick(p.avatar, backupFields(dataPolicies.providerAvatar)) } : {}),
    connections: p.connections.map(c => ({ ...pick(c, backupFields(dataPolicies.connection, credentials)),
      models: c.models.map(m => pick(m, backupFields(dataPolicies.model))) })) })) };
}
export async function createBackupDocument(snapshot: LocalSnapshot, options: BackupOptions, files: BackupFiles): Promise<BackupDocument> {
  check(typeof options.connections === "boolean" && typeof options.credentials === "boolean" && (!options.credentials || options.connections));
  const rows: Record<string, unknown[]> = {};
  rows.assistants = snapshot.rows.assistants.map(a => {
    readAssistantAvatarSelection(a);
    return { ...pick(a, backupFields(dataPolicies.assistants)), defaultConfig: session(a.defaultConfig), ...(a.avatar ? { avatar: avatar(a.avatar) } : {}) };
  });
  rows.conversations = snapshot.rows.conversations.map(c => ({ ...pick(c, backupFields(dataPolicies.conversations)), titleNaming: "manual", settings: settings(c.settings!), ...(c.creationConfig ? { creationConfig: settings(c.creationConfig) } : {}) }));
  rows.chats = snapshot.rows.chats.map(c => ({ ...pick(c, backupFields(dataPolicies.chats)), messages: c.messages.map(m => message(m)) }));
  rows.workspace = snapshot.rows.workspace.map(s => pick(s, backupFields(dataPolicies.workspace)));
  rows.avatarLibrary = snapshot.rows.avatarLibrary.map(a => ({ ...pick(a, backupFields(dataPolicies.avatarLibrary)), avatar: avatar(a.avatar) }));
  rows.userAvatar = snapshot.rows.userAvatar.map(a => ({ ...pick(a, backupFields(dataPolicies.userAvatar)), ...(a.value ? { value: avatar(a.value) } : {}) }));
  const connectionState = options.connections ? loadConnectionSettings({ getItem: key => snapshot.preferences[key] ?? null, setItem: () => {} }) : undefined;
  const providerImageIds = new Set(connectionState?.providers.flatMap(p => p.avatar?.kind === "image" ? [p.avatar.id] : []) ?? []);
  const providerImages = (snapshot.rows.providerAvatars ?? []).map(readProviderAvatarEntry);
  check([...providerImageIds].every(id => providerImages.some(a => a.id === id)), "供应商头像缺失，未生成备份。");
  if (providerImageIds.size) rows.providerAvatars = providerImages.filter(a => providerImageIds.has(a.id)).map(a => ({
    ...pick(a, backupFields(dataPolicies.providerAvatars)), value: avatar(a.value),
  }));
  rows.cherryImports = snapshot.rows.cherryImports.map(m => pick(m, backupFields(dataPolicies.cherryImports)));
  rows.legacyConversationConfigs = snapshot.rows.legacyConversationConfigs.map(l => ({ ...pick(l, backupFields(dataPolicies.legacyConversationConfigs)), ...(l.generationConfig ? { generationConfig: session(l.generationConfig) } : {}) }));
  const storage = { getItem: (key: string) => snapshot.preferences[key] ?? null, setItem: () => {} };
  const preferences = Object.fromEntries(preferenceKeys.map(k => [k, snapshot.preferences[k]])) as BackupPreferences;
  // Normalize legacy appearance through its documented migration, never copy raw storage.
  const appearance = readAppearancePreferences(storage);
  preferences[preferenceKeys[0]] = JSON.stringify({
    ...pick(appearance, backupFields(dataPolicies.appearance)),
    backgroundFocus: appearance.backgroundFocus ? pick(appearance.backgroundFocus, backupFields(dataPolicies.backgroundFocus)) : null,
    backgroundLibrary: appearance.backgroundLibrary.map(entry => ({
      ...pick(entry, backupFields(dataPolicies.background)),
      focus: entry.focus ? pick(entry.focus, backupFields(dataPolicies.backgroundFocus)) : null,
    })),
  });
  const assets: BackupAsset[] = [], blobIds = new Map<string, string>(), native = new Map<string, { size?: number; mime?: string }>();
  let total = 0;
  async function addAsset(id: string, mime: string, data: string) {
    const bytes = decode64(data, 48 * 1024 * 1024); total += bytes.length;
    check(total <= 48 * 1024 * 1024 && assets.length < 2000, "备份超过 48 MiB 或 2000 个资源限制。");
    const a = { id, mime, data, size: bytes.length, sha256: await sha256(bytes) }; assets.push(a); return a;
  }
  async function encode(v: any): Promise<any> {
    if (v instanceof Blob) {
      const bytes = new Uint8Array(await v.arrayBuffer()), digest = `${v.type}:${await sha256(bytes)}`;
      let id = blobIds.get(digest);
      if (!id) { id = `blob:${crypto.randomUUID()}`; blobIds.set(digest, id); await addAsset(id, v.type, bytesToBase64(bytes)); }
      return { $blob: id, type: v.type };
    }
    if (v && typeof v === "object") {
      if (Array.isArray(v)) return Promise.all(v.map(encode));
      return Object.fromEntries(await Promise.all(Object.entries(v).map(async ([k, item]) => [k, await encode(item)])));
    }
    return v;
  }
  const encoded = await encode(rows);
  function collectMessage(m: any) {
    for (const a of m.attachments ?? []) {
      check(managedReference.test(a.reference)); const previous = native.get(a.reference);
      if (previous) check(previous.size === a.size && previous.mime === a.mimeType);
      native.set(a.reference, { size: a.size, mime: a.mimeType });
    }
    for (const p of m.roundVersions?.pairs ?? []) p.forEach(collectMessage);
  }
  for (const c of encoded.chats) c.messages.forEach(collectMessage);
  if (appearance.backgroundReference) native.set(appearance.backgroundReference, {});
  for (const entry of appearance.backgroundLibrary) native.set(entry.reference, {});
  for (const [ref, metadata] of native) {
    let data;
    try { data = await files.read(ref); } catch { throw new Error("受管理的附件或背景缺失／不可读取；未生成备份。请先修复或移除对应引用。"); }
    const mime = metadata.mime ?? (ref.endsWith(".png") ? "image/png" : ref.endsWith(".webp") ? "image/webp" : "image/jpeg");
    const asset = await addAsset(ref, mime, data); if (metadata.size !== undefined) check(asset.size === metadata.size, "附件内容与记录大小不一致。");
  }
  const configuration = loadSearchConfiguration(storage);
  const profileFields = backupFields(dataPolicies.searchProfile, options.credentials);
  const searchSettings = { version: 3, exaMcp: pick(configuration.exaMcp, profileFields), exaApi: pick(configuration.exaApi, profileFields),
    tavily: pick(configuration.tavily, backupFields(dataPolicies.tavilyProfile, options.credentials)),
    zhipu: pick(configuration.zhipu, backupFields(dataPolicies.zhipuProfile, options.credentials)) } as BackupDocument["searchSettings"];
  const encodedReport = snapshot.preferences[DATA_COMPATIBILITY_KEY];
  const filteredParameters: unknown = encodedReport ? JSON.parse(encodedReport) : [];
  validateFilteredParameters(filteredParameters);
  const drawing = { settings: projectDrawingSettings(snapshot.drawing?.draft), presets: (snapshot.drawing?.presets ?? []).map(readDrawingPromptPresetData) };
  return { format: "ayase-studio-backup", version: 5, createdAt: new Date().toISOString(), options: { connections: options.connections, credentials: options.credentials },
    rows: encoded as Record<typeof backupTables[number], unknown[]>, preferences,
    connections: options.connections ? exportConnections(loadConnectionSettings(storage), options.credentials) : null, searchSettings, assets,
    drawing, compatibility: { minimumReaderVersion: 5, requiredCapabilities: [], modules: currentModuleVersions(drawing),
      ...(filteredParameters.length ? { filteredParameters } : {}) } };
}
