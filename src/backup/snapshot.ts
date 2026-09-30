import { loadAppearancePreferences } from "../appearance/appearance";
import { connectionSettingsStorageKey, loadConnectionSettings, type ConnectionSettingsState } from "../chat/settings";
import { bytesToBase64 } from "../chat/attachments";
import { check, decode64, sha256 } from "./codec";
import { backupTables, preferenceKeys, type BackupAsset, type BackupDocument, type BackupFiles, type BackupOptions, type BackupPreferences, type BackupRows } from "./types";
import { managedReference } from "./validation";
import { loadSearchConfiguration, SEARCH_SETTINGS_KEY } from "../search/settings";

export const allPreferenceKeys = [...preferenceKeys, connectionSettingsStorageKey, SEARCH_SETTINGS_KEY] as const;
export interface LocalSnapshot { rows: BackupRows; preferences: Record<string, string | null> }
export function pick(value: Record<string, any>, fields: string[]): Record<string, any> {
  return Object.fromEntries(fields.filter(k => value[k] !== undefined).map(k => [k, value[k]]));
}
function session(v: Record<string, any>) {
  const result = pick(v, ["version", "systemInstruction", "temperature", "topP", "topK", "contextBudget", "maxOutput", "stream", "dualSamplingConfirmed", "customJson", "webSearch", "webSearchProvider", "geminiThinking", "thinking", "invalidStoredConfig"]);
  for (const key of ["temperature", "topP", "topK", "contextBudget", "maxOutput"]) result[key] = pick(v[key], ["mode", "value"]);
  result.customJson = pick(v.customJson, ["openai-chat", "openai-responses", "gemini-native", "anthropic-native"]);
  if (v.geminiThinking) result.geminiThinking = pick(v.geminiThinking, ["choice", "budget", "includeSummary"]);
  if (v.thinking) result.thinking = Object.fromEntries(["openai-chat", "openai-responses", "anthropic-native"].filter(k => v.thinking[k]).map(k => [k, pick(v.thinking[k], ["choice", "budget", "includeSummary", "effort"])]));
  return result;
}
function settings(v: Record<string, any>) { return { modelId: v.modelId, config: session(v.config) }; }
function avatar(v: Record<string, any>) { return { original: v.original, thumbnail: v.thumbnail, crop: pick(v.crop, ["x", "y", "zoom"]), ...(v.source ? { source: pick(v.source, ["resourceId", "version"]) } : {}) }; }
function message(v: Record<string, any>, pair = false): Record<string, any> {
  const result = pick(v, ["id", "role", "content", "status", "replyToId", "editedAt", "thinkingSummary"]);
  if (["streaming", "paused"].includes(result.status)) result.status = "incomplete";
  if (v.source) result.source = pick(v.source, ["source", "id", "createdAt", "unavailableAttachments"]);
  if (v.attachments) result.attachments = v.attachments.map((a: Record<string, any>) => pick(a, ["reference", "name", "mimeType", "size"]));
  if (v.search) {
    result.search = { ...pick(v.search, ["enabled", "status", "queries", "suggestionHtml", "error", "provider", "warning"]),
      sources: v.search.sources.map((s: Record<string, any>) => pick(s, ["id", "url", "title", "excerpt"])), citations: v.search.citations.map((c: Record<string, any>) => pick(c, ["start", "end", "sourceIds"])) };
    if (["pending", "searching"].includes(result.search.status)) {
      result.search.status = "cancelled";
      if (result.status === "complete") result.status = "incomplete";
    }
  }
  if (v.providerReplay) result.providerReplay = pick(v.providerReplay, ["protocol", "scope", "content", "responses"]);
  if (!pair && v.roundVersions) result.roundVersions = { selected: v.roundVersions.selected, pairs: v.roundVersions.pairs.map((p: Record<string, any>[]) => p.map(m => message(m, true))) };
  return result;
}
export function exportConnections(state: ConnectionSettingsState, credentials: boolean) {
  return { version: 3, activeModelId: state.activeModelId, providers: state.providers.map(p => ({ id: p.id, name: p.name,
    connections: p.connections.map(c => ({ id: c.id, name: c.name, protocol: c.protocol, baseUrl: c.baseUrl,
      ...(credentials ? { apiKey: c.apiKey } : {}), models: c.models.map(m => ({ id: m.id, modelId: m.modelId, ...(m.displayName !== undefined ? { displayName: m.displayName } : {}) })) })) })) };
}
export async function createBackupDocument(snapshot: LocalSnapshot, options: BackupOptions, files: BackupFiles): Promise<BackupDocument> {
  check(typeof options.connections === "boolean" && typeof options.credentials === "boolean" && (!options.credentials || options.connections));
  const rows: Record<string, unknown[]> = {};
  rows.assistants = snapshot.rows.assistants.map(a => ({ ...pick(a, ["id", "name", "icon", "sortOrder", "defaultModelId", "defaultAvatar"]), defaultConfig: session(a.defaultConfig), ...(a.avatar ? { avatar: avatar(a.avatar) } : {}) }));
  rows.conversations = snapshot.rows.conversations.map(c => ({ ...pick(c, ["id", "assistantId", "title", "createdAt", "updatedAt"]), titleNaming: "manual", settings: settings(c.settings!), ...(c.creationConfig ? { creationConfig: settings(c.creationConfig) } : {}) }));
  rows.chats = snapshot.rows.chats.map(c => ({ ...pick(c, ["id", "updatedAt"]), messages: c.messages.map(m => message(m)) }));
  rows.workspace = snapshot.rows.workspace.map(s => pick(s, ["id", "activeAssistantId", "lastSelected"]));
  rows.avatarLibrary = snapshot.rows.avatarLibrary.map(a => ({ ...pick(a, ["id", "name", "version"]), avatar: avatar(a.avatar) }));
  rows.userAvatar = snapshot.rows.userAvatar.map(a => ({ id: a.id, ...(a.value ? { value: avatar(a.value) } : {}) }));
  rows.cherryImports = snapshot.rows.cherryImports.map(m => pick(m, ["id", "assistantId", "conversationIds"]));
  rows.legacyConversationConfigs = snapshot.rows.legacyConversationConfigs.map(l => ({ ...pick(l, ["id", "lastUsedModelId"]), ...(l.generationConfig ? { generationConfig: session(l.generationConfig) } : {}) }));
  const storage = { getItem: (key: string) => snapshot.preferences[key] ?? null, setItem: () => {} };
  const preferences = Object.fromEntries(preferenceKeys.map(k => [k, snapshot.preferences[k]])) as BackupPreferences;
  // Normalize legacy appearance through its documented migration, never copy raw storage.
  preferences[preferenceKeys[0]] = JSON.stringify(loadAppearancePreferences(storage));
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
  const appearance = JSON.parse(preferences[preferenceKeys[0]]!);
  if (appearance.backgroundReference) native.set(appearance.backgroundReference, {});
  for (const entry of appearance.backgroundLibrary) native.set(entry.reference, {});
  for (const [ref, metadata] of native) {
    let data;
    try { data = await files.read(ref); } catch { throw new Error("受管理的附件或背景缺失／不可读取；未生成备份。请先修复或移除对应引用。"); }
    const mime = metadata.mime ?? (ref.endsWith(".png") ? "image/png" : ref.endsWith(".webp") ? "image/webp" : "image/jpeg");
    const asset = await addAsset(ref, mime, data); if (metadata.size !== undefined) check(asset.size === metadata.size, "附件内容与记录大小不一致。");
  }
  const configuration = loadSearchConfiguration(storage);
  const profileFields = ["version", "baseUrl", "numResults", ...(options.credentials ? ["apiKey"] : [])];
  const searchSettings = { version: 2, exaMcp: pick(configuration.exaMcp, profileFields), exaApi: pick(configuration.exaApi, profileFields) } as BackupDocument["searchSettings"];
  return { format: "ayase-studio-backup", version: 3, createdAt: new Date().toISOString(), options: { connections: options.connections, credentials: options.credentials },
    rows: encoded as Record<typeof backupTables[number], unknown[]>, preferences,
    connections: options.connections ? exportConnections(loadConnectionSettings(storage), options.credentials) : null, searchSettings, assets };
}
