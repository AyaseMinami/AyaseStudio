import { check, decode64, sha256 } from "./codec";
import { backupTables, preferenceKeys } from "./types";
import { validateSessionConfig, type SessionConfig } from "../chat/sessionConfig";
import { isAssistantDefaultAvatar } from "../avatar/assistantDefaults";
import { isThinkingSettings } from "../chat/thinking";
import { isGeminiThinkingSettings } from "../chat/geminiThinking";
import { loadAppearancePreferences } from "../appearance/appearance";
import { validateSearchConfiguration, validateSearchSettings } from "../search/settings";

export const managedReference = /^(attachments\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp|pdf|txt|md|docx|xlsx|pptx)|backgrounds\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp))$/;
export type JsonRecord = Record<string, any>; // Untrusted values are checked before access at every boundary below.
export function object(value: unknown): asserts value is JsonRecord {
  check(value !== null && typeof value === "object" && !Array.isArray(value));
}
export function fields(value: unknown, allowed: string[], required: string[] = allowed): asserts value is JsonRecord {
  object(value); check(Object.keys(value).every(k => allowed.includes(k)) && required.every(k => k in value));
}
function canonical(value: any): string {
  if (!value || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}
function text(value: unknown, limit = 8 * 1024 * 1024): asserts value is string { check(typeof value === "string" && value.length <= limit); }
function unicodeText(value: unknown, limit: number): asserts value is string { text(value, limit * 2); check(Array.from(value).length <= limit); }
function id(value: unknown): asserts value is string { text(value, 512); check(value.trim() && !["__proto__", "prototype", "constructor"].includes(value)); }
function cherryImportId(value: unknown): asserts value is string {
  // Conversation source markers embed the ordered upstream message-ID path.
  // The document-wide text budget bounds these longer composite keys.
  text(value); check(value.trim() && !["__proto__", "prototype", "constructor"].includes(value));
}
function number(value: unknown): asserts value is number { check(typeof value === "number" && Number.isFinite(value)); }
function time(value: unknown) { number(value); check(Number.isSafeInteger(value) && value >= 0); }
function list(value: unknown, max = 100000): asserts value is any[] { check(Array.isArray(value) && value.length <= max); }
function optional(value: JsonRecord, key: string, validator: (value: unknown) => void) { if (key in value) validator(value[key]); }
function model(value: unknown) { if (value !== null) id(value); }
function config(value: unknown, version: 1 | 2 | 3) {
  fields(value, ["version", "systemInstruction", "temperature", "topP", "topK", "contextBudget", "maxOutput", "stream", "dualSamplingConfirmed", "customJson", "webSearch", ...(version >= 2 ? ["webSearchProvider"] : []), "geminiThinking", "thinking", "invalidStoredConfig"],
    ["version", "systemInstruction", "temperature", "topP", "topK", "contextBudget", "maxOutput", "stream", "dualSamplingConfirmed", "customJson"]);
  check(value.version === 1 && typeof value.dualSamplingConfirmed === "boolean"); text(value.systemInstruction);
  for (const k of ["temperature", "topP", "topK", "contextBudget", "maxOutput"]) { fields(value[k], ["mode", "value"], ["mode"]); check(["auto", "custom"].includes(value[k].mode)); if (value[k].mode === "custom") text(value[k].value, 100); }
  fields(value.customJson, ["openai-chat", "openai-responses", "gemini-native", "anthropic-native"]);
  Object.values(value.customJson).forEach(v => text(v));
  optional(value, "webSearch", v => check(typeof v === "boolean"));
  optional(value, "webSearchProvider", v => check(["native", "exa-mcp", ...(version === 3 ? ["exa-api"] : [])].includes(v as string)));
  optional(value, "invalidStoredConfig", text);
  // Thinking is plain option data, never connection configuration or runtime requests.
  if (value.geminiThinking !== undefined) { fields(value.geminiThinking, ["choice", "budget", "includeSummary"]); check(isGeminiThinkingSettings(value.geminiThinking)); }
  if (value.thinking !== undefined) { fields(value.thinking, ["openai-chat", "openai-responses", "anthropic-native"], []);
    for (const v of Object.values(value.thinking)) { fields(v, ["choice", "budget", "includeSummary", "effort"], ["choice", "budget", "includeSummary"]); check(isThinkingSettings(v)); } }
  // Invalid saved numeric text remains editable, rather than silently replaced.
  const errors = validateSessionConfig(value as SessionConfig);
  check(!errors.systemInstruction && !errors.stream && !errors.customJson);
}
function conversationConfig(v: unknown, version: 1 | 2 | 3) { fields(v, ["modelId", "config"]); model(v.modelId); config(v.config, version); }
export function validateConnections(value: unknown, credentials: boolean) {
  fields(value, ["version", "providers", "activeModelId"]); check(value.version === 3); model(value.activeModelId); list(value.providers, 5000);
  const ids = new Set<string>(), models = new Set<string>();
  const unique = (v: unknown) => { id(v); check(!ids.has(v)); ids.add(v); };
  for (const p of value.providers) {
    fields(p, ["id", "name", "connections"]); unique(p.id); text(p.name, 4096); check(p.name.trim()); list(p.connections, 5000);
    for (const c of p.connections) {
      fields(c, ["id", "name", "protocol", "baseUrl", "models", ...(credentials ? ["apiKey"] : [])]);
      unique(c.id); text(c.name, 4096); check(c.name.trim()); text(c.baseUrl, 32768); check(["openai-chat", "openai-responses", "gemini-native", "anthropic-native"].includes(c.protocol));
      if (credentials) text(c.apiKey, 65536);
      list(c.models, 5000); const actual = new Set<string>();
      for (const m of c.models) { fields(m, ["id", "modelId", "displayName"], ["id", "modelId"]); unique(m.id); models.add(m.id); text(m.modelId, 4096); check(m.modelId.trim() && !actual.has(m.modelId)); actual.add(m.modelId); optional(m, "displayName", v => text(v, 4096)); }
    }
  }
  check(value.activeModelId === null || models.has(value.activeModelId));
}
export async function validateDocument(raw: unknown): Promise<void> {
  // This explicit visitor bounds recursion, aggregate object count, text and metadata before walking semantic data.
  let nodes = 0, metadata = 0;
  function budget(v: unknown, depth: number, assetData = false) {
    check(depth <= 32 && ++nodes <= 1_000_000);
    if (typeof v === "string") { if (!assetData) metadata += new TextEncoder().encode(v).length; check(metadata <= 8 * 1024 * 1024); return; }
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "number") { number(v); return; }
    check(typeof v === "object");
    for (const [k, item] of Object.entries(v!)) { check(!["__proto__", "prototype", "constructor"].includes(k)); budget(item, depth + 1, k === "data" && depth === 2); }
  }
  object(raw);
  check(raw.format === "ayase-studio-backup" && [1, 2, 3].includes(raw.version), "不支持此备份版本。");
  const version = raw.version as 1 | 2 | 3;
  const required = ["format", "version", "createdAt", "options", "rows", "preferences", "connections", "assets"];
  fields(raw, [...required, ...(version >= 2 ? ["searchSettings"] : [])], required);
  text(raw.createdAt, 64); check(Number.isFinite(Date.parse(raw.createdAt)));
  fields(raw.options, ["connections", "credentials"]); check(typeof raw.options.connections === "boolean" && typeof raw.options.credentials === "boolean" && (!raw.options.credentials || raw.options.connections));
  const credentials = raw.options.credentials;
  list(raw.assets, 2000); budget(raw, 0);
  function searchProfile(value: unknown) {
    fields(value, ["version", "baseUrl", "numResults", ...(credentials ? ["apiKey"] : [])]);
    text(value.baseUrl, 2048);
    if (credentials) text(value.apiKey, 4096);
    return validateSearchSettings({ ...value, apiKey: credentials ? value.apiKey : "" });
  }
  if (raw.searchSettings !== undefined) {
    if (version === 2) searchProfile(raw.searchSettings);
    else {
      fields(raw.searchSettings, ["version", "exaMcp", "exaApi"]); check(raw.searchSettings.version === 2);
      validateSearchConfiguration({ version: 2, exaMcp: searchProfile(raw.searchSettings.exaMcp), exaApi: searchProfile(raw.searchSettings.exaApi) });
    }
  }
  const assets = new Map<string, JsonRecord>(); let bytesTotal = 0;
  for (const a of raw.assets) {
    fields(a, ["id", "mime", "size", "data", "sha256"]); id(a.id); text(a.mime, 128); check(!assets.has(a.id) && (a.id.startsWith("blob:") || managedReference.test(a.id)));
    time(a.size); const bytes = decode64(a.data, 48 * 1024 * 1024); bytesTotal += bytes.length;
    check(bytesTotal <= 48 * 1024 * 1024 && bytes.length === a.size && await sha256(bytes) === a.sha256, "资源完整性校验失败或超出 48 MiB 资源预算。");
    if (managedReference.test(a.id)) {
      const extension = a.id.slice(a.id.lastIndexOf(".") + 1);
      const mimes: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", pdf: "application/pdf", txt: "text/plain", md: "text/markdown",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation" };
      check(a.mime === mimes[extension]);
      if (["txt", "md"].includes(extension)) { try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new Error("备份文本附件损坏。"); } }
      if (extension === "pdf") check(new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-");
      if (["docx", "xlsx", "pptx"].includes(extension)) check(bytes[0] === 80 && bytes[1] === 75 && bytes[2] === 3 && bytes[3] === 4);
    }
    if (a.id.startsWith("blob:") || a.id.startsWith("backgrounds/")) {
      check(["image/png", "image/jpeg", "image/webp"].includes(a.mime) && a.size > 0 && a.size <= (a.id.startsWith("blob:") ? 20 * 1024 * 1024 : 20_000_000));
      check((a.mime === "image/png" && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71)
        || (a.mime === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216)
        || (a.mime === "image/webp" && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"));
    }
    assets.set(a.id, a);
  }
  const used = new Set<string>();
  function resource(v: unknown, prefix: string) { id(v); check(v.startsWith(prefix) && assets.has(v)); used.add(v); }
  function avatar(v: unknown) {
    fields(v, ["original", "thumbnail", "crop", "source"], ["original", "thumbnail", "crop"]);
    for (const k of ["original", "thumbnail"]) { fields(v[k], ["$blob", "type"]); resource(v[k].$blob, "blob:"); check(v[k].type === assets.get(v[k].$blob)?.mime); }
    fields(v.crop, ["x", "y", "zoom"]); number(v.crop.x); number(v.crop.y); number(v.crop.zoom);
    check(v.crop.x >= 0 && v.crop.x <= 1 && v.crop.y >= 0 && v.crop.y <= 1 && v.crop.zoom >= 1 && v.crop.zoom <= 4);
    if (v.source) { fields(v.source, ["resourceId", "version"]); id(v.source.resourceId); id(v.source.version); }
  }
  let messageCount = 0;
  function message(v: unknown, pair = false) {
    fields(v, ["id", "role", "content", "status", "replyToId", "editedAt", "thinkingSummary", "attachments", "source", "search", "providerReplay", ...(!pair ? ["roundVersions"] : [])], ["id", "role", "content", "status"]);
    id(v.id); check(++messageCount <= 100000 && ["system", "user", "assistant"].includes(v.role)); text(v.content);
    check(["complete", "incomplete", "aborted", "failed"].includes(v.status)); optional(v, "replyToId", model); optional(v, "editedAt", time); optional(v, "thinkingSummary", text);
    if (v.source) { fields(v.source, ["source", "id", "createdAt", "unavailableAttachments"], ["source", "id", "createdAt"]); check(v.source.source === "cherry"); id(v.source.id); time(v.source.createdAt);
      if (v.source.unavailableAttachments) { list(v.source.unavailableAttachments, 2000); v.source.unavailableAttachments.forEach((n: unknown) => { text(n, 4096); check(!/[\\/\p{Cc}]/u.test(n)); }); } }
    if (v.attachments) { list(v.attachments, 2000); for (const a of v.attachments) { fields(a, ["reference", "name", "size", "mimeType"]); resource(a.reference, "attachments/"); text(a.name, 4096); check(a.name && !/[\\/\p{Cc}]/u.test(a.name)); check(a.size === assets.get(a.reference)?.size && a.mimeType === assets.get(a.reference)?.mime); } }
    if (v.search) { fields(v.search, ["enabled", "status", "sources", "citations", "queries", "suggestionHtml", "error", ...(version >= 2 ? ["provider", "warning"] : [])], ["enabled", "status", "sources", "citations", "queries"]);
      check(typeof v.search.enabled === "boolean" && ["pending", "searching", "completed", "not-used", "failed", "cancelled"].includes(v.search.status));
      optional(v.search, "provider", p => check(p === "exa-mcp" || (version === 3 && p === "exa-api"))); optional(v.search, "warning", w => unicodeText(w, 1000));
      const external = ["exa-mcp", "exa-api"].includes(v.search.provider);
      list(v.search.sources, external ? 10 : 100000); list(v.search.citations); list(v.search.queries, external ? 1 : 100000);
      let excerptCharacters = 0;
      for (const s of v.search.sources) { fields(s, ["id", "url", "title", ...(version >= 2 ? ["excerpt"] : [])], ["id", "url", "title"]); id(s.id); text(s.url, external ? 2048 : 32768);
        if (external) unicodeText(s.title, 300); else text(s.title);
        optional(s, "excerpt", e => { unicodeText(e, 1500); excerptCharacters += Array.from(e as string).length; check(excerptCharacters <= 8000); }); }
      for (const c of v.search.citations) { fields(c, ["start", "end", "sourceIds"]); time(c.start); time(c.end); check(c.end >= c.start && c.end <= v.content.length); list(c.sourceIds); c.sourceIds.forEach(id); }
      v.search.queries.forEach((q: unknown) => external ? unicodeText(q, 2000) : text(q)); optional(v.search, "error", text); optional(v.search, "suggestionHtml", text);
    }
    if (v.providerReplay) { fields(v.providerReplay, ["protocol", "scope", "content", "responses"], ["protocol", "scope", "content"]); check(v.providerReplay.protocol === "anthropic-native"); text(v.providerReplay.scope, 32768); list(v.providerReplay.content); v.providerReplay.content.forEach(object);
      if (v.providerReplay.responses) { list(v.providerReplay.responses); v.providerReplay.responses.forEach((r: unknown) => { list(r); r.forEach(object); }); } }
    if (v.roundVersions) { fields(v.roundVersions, ["selected", "pairs"]); list(v.roundVersions.pairs, 1000); time(v.roundVersions.selected); check(v.roundVersions.pairs.length && v.roundVersions.selected < v.roundVersions.pairs.length);
      for (const p of v.roundVersions.pairs) { list(p, 2); check(p.length === 2); p.forEach((m: unknown) => message(m, true)); check(p[0].role === "user" && p[1].role === "assistant" && p[1].replyToId === p[0].id); } }
  }
  fields(raw.rows, [...backupTables]); const ids = new Map<string, Set<string>>();
  for (const table of backupTables) { list(raw.rows[table]); const seen = new Set<string>(); for (const row of raw.rows[table]) { object(row);
    if (table === "cherryImports") cherryImportId(row.id); else id(row.id);
    check(!seen.has(row.id)); seen.add(row.id); } ids.set(table, seen); }
  for (const a of raw.rows.assistants) { fields(a, ["id", "name", "icon", "sortOrder", "defaultModelId", "defaultConfig", "avatar", "defaultAvatar"], ["id", "name", "icon", "sortOrder", "defaultModelId", "defaultConfig"]); text(a.name, 4096); text(a.icon, 4096); number(a.sortOrder); model(a.defaultModelId); config(a.defaultConfig, version); optional(a, "avatar", avatar); optional(a, "defaultAvatar", v => check(isAssistantDefaultAvatar(v))); }
  for (const c of raw.rows.conversations) { fields(c, ["id", "assistantId", "title", "titleNaming", "createdAt", "updatedAt", "sortOrder", "settings", "creationConfig"], ["id", "assistantId", "title", "createdAt", "updatedAt", "settings"]); check(ids.get("assistants")!.has(c.assistantId)); text(c.title, 4096); time(c.createdAt); time(c.updatedAt); optional(c, "sortOrder", number); conversationConfig(c.settings, version); optional(c, "creationConfig", c => conversationConfig(c, version)); if (c.titleNaming !== undefined) check(c.titleNaming === "manual"); }
  for (const c of raw.rows.chats) { fields(c, ["id", "updatedAt", "messages"]); check(ids.get("conversations")!.has(c.id)); time(c.updatedAt); list(c.messages); c.messages.forEach((m: unknown) => message(m)); const seen = new Set<string>(), present = new Set(c.messages.map((m: JsonRecord) => m.id)); for (const m of c.messages) { check(!seen.has(m.id) && (!m.replyToId || !present.has(m.replyToId) || seen.has(m.replyToId))); seen.add(m.id); } }
  check(raw.rows.workspace.length <= 1); for (const s of raw.rows.workspace) { fields(s, ["id", "activeAssistantId", "lastSelected"]); check(s.id === "selection" && ids.get("assistants")!.has(s.activeAssistantId)); object(s.lastSelected); for (const [a, c] of Object.entries(s.lastSelected)) check(ids.get("assistants")!.has(a) && (c === null || raw.rows.conversations.some((v: JsonRecord) => v.id === c && v.assistantId === a))); }
  for (const a of raw.rows.avatarLibrary) { fields(a, ["id", "name", "version", "avatar"]); text(a.name, 4096); id(a.version); avatar(a.avatar); }
  check(raw.rows.userAvatar.length <= 1); for (const u of raw.rows.userAvatar) { fields(u, ["id", "value"], ["id"]); check(u.id === "user"); optional(u, "value", avatar); }
  for (const m of raw.rows.cherryImports) { fields(m, ["id", "assistantId", "conversationIds"], ["id"]); check(("assistantId" in m) !== ("conversationIds" in m)); if (m.assistantId) id(m.assistantId); else { list(m.conversationIds); m.conversationIds.forEach(id); } }
  for (const l of raw.rows.legacyConversationConfigs) { fields(l, ["id", "generationConfig", "lastUsedModelId"], ["id"]); optional(l, "generationConfig", c => config(c, version)); optional(l, "lastUsedModelId", model); }
  fields(raw.preferences, [...preferenceKeys]);
  const appearance = raw.preferences[preferenceKeys[0]];
  if (appearance !== null) {
    text(appearance); const parsed = JSON.parse(appearance); object(parsed);
    const normalized = loadAppearancePreferences({ getItem: () => appearance, setItem: () => {} });
    check(canonical(parsed) === canonical(normalized), "外观配置损坏或包含不支持字段。");
    if (normalized.backgroundReference) resource(normalized.backgroundReference, "backgrounds/");
    normalized.backgroundLibrary.forEach(b => resource(b.reference, "backgrounds/"));
  }
  check([null, "narrow", "wide"].includes(raw.preferences[preferenceKeys[1]]));
  check(raw.preferences[preferenceKeys[2]] === null || isAssistantDefaultAvatar(raw.preferences[preferenceKeys[2]]));
  check(used.size === assets.size, "备份包含未引用的资源。");
  if (raw.options.connections) validateConnections(raw.connections, raw.options.credentials); else check(raw.connections === null);
}
