import { loadConnectionSettings, connectionSettingsStorageKey, emptyConnectionSettings, type ConnectionSettingsState } from "../chat/settings";
import { loadAppearancePreferences } from "../appearance/appearance";
import { decode64 } from "./codec";
import { allPreferenceKeys, type LocalSnapshot } from "./snapshot";
import { backupTables, preferenceKeys, type BackupDocument, type BackupRows, type RestoreMode } from "./types";
import { loadSearchConfiguration, SEARCH_SETTINGS_KEY, type SearchConfiguration } from "../search/settings";
import { DATA_COMPATIBILITY_KEY } from "../storage/dataRegistry";
import { compatibilityWarnings, validateFilteredParameters } from "./compatibility";
import { initialDrawingDraft } from "../drawing/types";
import { isDrawingProtocol } from "../chat/protocolOptions";
import { readDrawingSettingsData } from "../drawing/settingsData";

export interface RestorePlan { after: LocalSnapshot; writes: { reference: string; data: string }[]; conflicts: number; warnings: string[] }
// Called only after document validation, in the exclusive maintenance workspace.
export function createRestorePlan(document: BackupDocument, before: LocalSnapshot, mode: RestoreMode): RestorePlan {
  const incoming = structuredClone(document.rows) as Record<string, any[]>;
  const rows = structuredClone(before.rows) as unknown as Record<string, any[]>;
  const preferences = { ...before.preferences };
  let conflicts = 0, missingModels = 0;
  const warnings: string[] = compatibilityWarnings(document.compatibility);
  const previousReport: unknown = preferences[DATA_COMPATIBILITY_KEY] ? JSON.parse(preferences[DATA_COMPATIBILITY_KEY]!) : [];
  validateFilteredParameters(previousReport);
  const filtered = [...new Set([...previousReport, ...(document.compatibility?.filteredParameters ?? [])])];
  validateFilteredParameters(filtered);
  if (filtered.length) preferences[DATA_COMPATIBILITY_KEY] = JSON.stringify(filtered);
  const currentStorage = { getItem: (k: string) => before.preferences[k] ?? null, setItem: () => {} };
  let currentConnections: ConnectionSettingsState;
  try { currentConnections = loadConnectionSettings(currentStorage); }
  catch (error) {
    if (mode !== "replace" || !document.options.connections || !document.options.credentials) throw error;
    currentConnections = structuredClone(emptyConnectionSettings);
    warnings.push("当前连接配置无法读取：按已确认的替换策略应用完整备份配置，原配置由恢复日志保护；恢复不发送请求。");
  }
  if (document.version === 1 || !document.searchSettings) {
    warnings.push("此备份不含网络搜索设置：保留本机搜索配置与 API Key；尚未配置时使用默认匿名配置，不自动开启或执行搜索。");
  } else if (mode === "replace") {
    const restoreProfile = (profile: { version: 1; baseUrl: string; numResults: number; apiKey?: string }, key: string) => ({ ...profile, apiKey: document.options.credentials ? profile.apiKey! : key });
    const imported = document.searchSettings;
    let configuration: SearchConfiguration;
    if (imported.version === 2 && document.options.credentials) {
      // A complete replacement can repair corrupt local data; nothing local is retained.
      configuration = { version: 2, exaMcp: restoreProfile(imported.exaMcp, ""), exaApi: restoreProfile(imported.exaApi, "") };
    } else {
      const current = loadSearchConfiguration(currentStorage);
      configuration = imported.version === 1
        ? { ...current, exaMcp: restoreProfile(imported, current.exaMcp.apiKey) }
        : { version: 2, exaMcp: restoreProfile(imported.exaMcp, current.exaMcp.apiKey), exaApi: restoreProfile(imported.exaApi, current.exaApi.apiKey) };
    }
    preferences[SEARCH_SETTINGS_KEY] = JSON.stringify(configuration);
    warnings.push(document.options.credentials
      ? "替换备份包含的网络搜索设置及对应搜索 API Key；恢复不会自动执行搜索。"
      : "替换备份包含的网络搜索设置，保留本机对应搜索 API Key；恢复不会自动执行搜索。");
    if (document.version === 2) warnings.push("此旧 v2 备份只包含 Exa MCP 配置；保留本机 Exa API 配置与 Key。");
  } else warnings.push("保留本机全局网络搜索设置及搜索 API Key；恢复不会自动执行搜索。");
  const targetConnections: ConnectionSettingsState = structuredClone(currentConnections);
  const modelMap = new Map<string, string>();
  if (document.options.connections) {
    const exported = document.connections as ConnectionSettingsState;
    if (mode === "replace") conflicts += exported.providers.reduce((n, p) => n + Number(currentConnections.providers.some(v => v.id === p.id)) + p.connections.filter(c => currentConnections.providers.some(v => v.connections.some(r => r.id === c.id))).length, 0);
    if (mode === "replace") targetConnections.providers = [];
    const ids = new Set(targetConnections.providers.flatMap(p => [p.id, ...p.connections.flatMap(c => [c.id, ...c.models.map(m => m.id)])]));
    for (const provider of exported.providers) {
      let target = mode === "merge" ? targetConnections.providers.find(p => p.id === provider.id) : undefined;
      if (target) conflicts++;
      else { const providerId = mode === "copy" || ids.has(provider.id) ? crypto.randomUUID() : provider.id; ids.add(providerId);
        target = { id: providerId, name: provider.name, connections: [] }; targetConnections.providers.push(target); }
      for (const connection of provider.connections) {
        const existing = mode === "merge" ? targetConnections.providers.flatMap(p => p.connections).find(c => c.id === connection.id) : undefined;
        if (existing) { conflicts++; for (const m of connection.models) if (existing.models.some(v => v.id === m.id)) modelMap.set(m.id, m.id); continue; }
        const connectionId = mode === "copy" || ids.has(connection.id) ? crypto.randomUUID() : connection.id; ids.add(connectionId);
        const models = connection.models.map(m => { const id = mode === "copy" || ids.has(m.id) ? crypto.randomUUID() : m.id; ids.add(id); modelMap.set(m.id, id); return { ...m, id }; });
        target.connections.push({ ...connection, id: connectionId, apiKey: document.options.credentials ? connection.apiKey : "", models });
      }
    }
    if (mode === "replace") targetConnections.activeModelId = exported.activeModelId ? modelMap.get(exported.activeModelId) ?? null : null;
    preferences[connectionSettingsStorageKey] = JSON.stringify(targetConnections);
    if (!document.options.credentials && exported.providers.some(p => p.connections.length)) warnings.push("新恢复的连接不含 API Key，请在连接配置中重新填写；保留的连接密钥未被清空。");
  } else warnings.push("此备份不含连接配置：现有连接保持不变，导入对象的模型设为未选择，请手动配置。");
  const maps = new Map<string, Map<string, string>>();
  for (const table of ["assistants", "conversations", "avatarLibrary", "legacyConversationConfigs"]) {
    const existing = new Set(rows[table].map(r => r.id));
    maps.set(table, new Map(incoming[table].map(r => [r.id, mode === "copy" ? crypto.randomUUID() : r.id])));
    if (mode !== "copy") conflicts += incoming[table].filter(r => existing.has(r.id)).length;
  }
  const mapped = (table: string, id: string) => maps.get(table)?.get(id) ?? id;
  const bindModel = (id: string | null) => { if (id && !modelMap.has(id)) missingModels++; return id ? modelMap.get(id) ?? null : null; };
  const config = (v: any) => { v.modelId = bindModel(v.modelId); };
  const avatar = (v: any) => { if (v?.source) v.source.resourceId = mapped("avatarLibrary", v.source.resourceId); };
  for (const a of incoming.assistants) { a.id = mapped("assistants", a.id); a.defaultModelId = bindModel(a.defaultModelId); avatar(a.avatar); }
  for (const c of incoming.conversations) { c.id = mapped("conversations", c.id); c.assistantId = mapped("assistants", c.assistantId); config(c.settings); if (c.creationConfig) config(c.creationConfig); }
  for (const a of incoming.avatarLibrary) { a.id = mapped("avatarLibrary", a.id); avatar(a.avatar); }
  for (const u of incoming.userAvatar) avatar(u.value);
  const selectedConversations = new Set(incoming.conversations.filter(c => mode !== "merge" || !rows.conversations.some(r => r.id === c.id) && !rows.chats.some(r => r.id === c.id)).map(c => c.id));
  incoming.conversations = incoming.conversations.filter(c => selectedConversations.has(c.id));
  for (const chat of incoming.chats) {
    chat.id = mapped("conversations", chat.id);
    const messageIds = new Map<string, string>();
    const collect = (m: any) => { if (!messageIds.has(m.id)) messageIds.set(m.id, mode === "copy" ? crypto.randomUUID() : m.id); if (m.roundVersions) m.roundVersions.pairs.flat().forEach(collect); };
    chat.messages.forEach(collect);
    const remap = (m: any) => { m.id = messageIds.get(m.id); if (m.replyToId) m.replyToId = messageIds.get(m.replyToId) ?? null;
      if (m.search && ["pending", "searching"].includes(m.search.status)) { m.search.status = "cancelled"; if (m.status === "complete") m.status = "incomplete"; }
      // Scoped provider replay is meaningful only with its original connection identity.
      if (mode === "copy" || !document.options.connections) delete m.providerReplay;
      if (m.roundVersions) m.roundVersions.pairs.flat().forEach(remap); };
    chat.messages.forEach(remap);
  }
  incoming.chats = incoming.chats.filter(c => selectedConversations.has(c.id));
  for (const l of incoming.legacyConversationConfigs) { l.id = maps.get("conversations")?.get(l.id) ?? mapped("legacyConversationConfigs", l.id); if (l.lastUsedModelId) l.lastUsedModelId = bindModel(l.lastUsedModelId); }
  for (const marker of incoming.cherryImports) {
    if (marker.assistantId) marker.assistantId = mapped("assistants", marker.assistantId);
    else marker.conversationIds = marker.conversationIds.map((id: string) => mapped("conversations", id));
  }
  if (mode === "replace") {
    warnings.push(`将替换当前 ${before.rows.assistants.length} 个助手、${before.rows.conversations.length} 个对话及其消息、头像和资源库；备份未保留的支持范围数据将移除。`);
    const s = incoming.workspace[0];
    if (s) { s.activeAssistantId = mapped("assistants", s.activeAssistantId); s.lastSelected = Object.fromEntries(Object.entries(s.lastSelected).map(([a, c]) => [mapped("assistants", a), c ? mapped("conversations", c as string) : null])); }
    for (const k of preferenceKeys) preferences[k] = document.preferences[k];
  } else {
    incoming.workspace = [];
    incoming.userAvatar = [];
    const saved = loadAppearancePreferences(currentStorage);
    const imported = JSON.parse(document.preferences[preferenceKeys[0]] ?? "null");
    for (const b of imported?.backgroundLibrary ?? []) {
      if (mode === "merge" && saved.backgroundLibrary.some(r => r.id === b.id)) { conflicts++; continue; }
      saved.backgroundLibrary.push({ ...b, id: mode === "copy" ? crypto.randomUUID() : b.id });
    }
    preferences[preferenceKeys[0]] = JSON.stringify(saved);
    warnings.push("保留现有外观、显示偏好、当前背景、用户头像和工作区选择；仅追加图库资源。");
  }
  for (const table of backupTables) {
    if (mode === "replace") rows[table] = incoming[table];
    else if (table === "cherryImports") {
      for (const m of incoming[table]) { const existing = rows[table].find(r => r.id === m.id);
        if (existing?.conversationIds && m.conversationIds) existing.conversationIds = [...new Set([...existing.conversationIds, ...m.conversationIds])];
        else if (!existing) rows[table].push(m); }
    } else for (const r of incoming[table]) if (!rows[table].some(v => v.id === r.id)) rows[table].push(r);
  }
  // Tombstone prevents the obsolete avatar migration source from resurrecting after replacement.
  if (mode === "replace" && !rows.userAvatar.length) rows.userAvatar.push({ id: "user" });
  if (missingModels) warnings.push(`${missingModels} 个模型引用缺失或未包含连接，已设为未选择；不会测试连接或发送请求。`);
  const drawing = before.drawing ? structuredClone(before.drawing) : undefined;
  const drawingAfter = drawing ?? { presets: [] };
  const targets = targetConnections.providers.flatMap(p => p.connections.flatMap(c => c.models.map(m => ({ ...m, providerId: p.id, connection: c }))));
  if (document.drawing?.presets !== undefined) {
    const existing = new Set(drawingAfter.presets.map(p => p.id));
    if (mode !== "copy") conflicts += document.drawing.presets.filter(p => existing.has(p.id)).length;
    const imported = structuredClone(document.drawing.presets).map(p => ({ ...p, id: mode === "copy" ? crypto.randomUUID() : p.id }));
    drawingAfter.presets = mode === "replace" ? imported : [...drawingAfter.presets, ...imported.filter(p => !existing.has(p.id))];
  } else warnings.push("此备份不含绘图预设：保留本机已保存的提示词预设。");
  if (document.drawing?.settings !== undefined && mode === "replace") {
    const settings = readDrawingSettingsData(document.drawing.settings);
    const mappedModel = settings.modelId ? modelMap.get(settings.modelId) : undefined;
    const target = targets.find(m => m.id === mappedModel && isDrawingProtocol(m.connection.protocol));
    if (settings.modelId && !target) warnings.push("绘图模型引用不可用，已设为未选择；请手动选择绘图模型，不自动替换协议或生成。");
    drawingAfter.draft = { ...(drawingAfter.draft ?? initialDrawingDraft), ...settings, modelId: target?.id ?? null };
    if (settings.reusedProtocol === undefined) delete drawingAfter.draft.reusedProtocol;
    warnings.push("仅替换绘图参数、数量、并发及提示音设置；保留本机自动草稿提示词和参考图，参考图不从备份恢复，不创建生成任务。");
  } else warnings.push(document.drawing?.settings !== undefined
    ? "保留本机全局绘图设置；本策略只导入显式保存的提示词预设。"
    : "此备份不含绘图设置：保留本机绘图设置及自动草稿提示词。");
  const invalidHistory = (drawingAfter.targets ?? []).filter(p => !targets.some(m => m.id === p.modelId && m.providerId === p.providerId
    && m.connection.id === p.connectionId && m.connection.protocol === p.protocol
    && m.connection.baseUrl === p.baseUrl && m.modelId === p.upstreamModelId)).length;
  if (invalidHistory) warnings.push(`${invalidHistory} 组保留的绘图历史目标无法解析或连接已改变；历史、成果和图片保持，复用或继续队列须重新核对目标。`);
  if (drawingAfter.draft?.modelId && !targets.some(m => m.id === drawingAfter.draft!.modelId && isDrawingProtocol(m.connection.protocol)))
    warnings.push("本机保留的绘图草稿目标不可用，请重新选择；草稿提示词和参考图保持。");
  warnings.push("绘图任务／批次历史、成果、图片及未决本地保存日志均保留；备份不包含这些类别，不从源路径读取或下载图片。");
  const assets = new Map(document.assets.map(a => [a.id, a]));
  const fileMap = new Map<string, string>(), writes: RestorePlan["writes"] = [];
  function reference(old: string) {
    const asset = assets.get(old); if (!asset) return old;
    let target = fileMap.get(old);
    if (!target) { target = `${old.slice(0, old.indexOf("/") + 1)}${crypto.randomUUID()}.${old.slice(old.lastIndexOf(".") + 1)}`; fileMap.set(old, target); writes.push({ reference: target, data: asset.data }); }
    return target;
  }
  function hydrateAvatar(v: any) {
    if (!v) return;
    for (const k of ["original", "thumbnail"]) { const a = assets.get(v[k].$blob)!; v[k] = new Blob([decode64(a.data, a.size)], { type: a.mime }); }
  }
  function hydrateMessage(v: any) {
    for (const a of v.attachments ?? []) a.reference = reference(a.reference);
    for (const p of v.roundVersions?.pairs ?? []) p.forEach(hydrateMessage);
  }
  function hydrate(table: string, value: any) {
    const v = structuredClone(value);
    if (table === "assistants" || table === "avatarLibrary") hydrateAvatar(v.avatar);
    if (table === "userAvatar") hydrateAvatar(v.value);
    if (table === "chats") v.messages.forEach(hydrateMessage);
    return v;
  }
  // Hydrate only imported portable rows, not retained native Blob snapshots or references.
  const afterRows: Record<string, any[]> = {};
  for (const table of backupTables) afterRows[table] = rows[table].map(r => incoming[table].includes(r) ? hydrate(table, r) : r);
  const ap = JSON.parse(preferences[preferenceKeys[0]] ?? "null");
  if (ap) {
    if (mode === "replace" && ap.backgroundReference) ap.backgroundReference = reference(ap.backgroundReference);
    const oldIds = new Set(loadAppearancePreferences(currentStorage).backgroundLibrary.map(b => b.id));
    for (const b of ap.backgroundLibrary) if (mode === "replace" || !oldIds.has(b.id)) b.reference = reference(b.reference);
    preferences[preferenceKeys[0]] = JSON.stringify(ap);
  }
  return { after: { rows: afterRows as unknown as BackupRows, preferences: Object.fromEntries(allPreferenceKeys.map(k => [k, preferences[k] ?? null])),
    ...(before.drawing || document.drawing ? { drawing: drawingAfter } : {}) }, writes, conflicts, warnings };
}
