import { loadConnectionSettings, connectionSettingsStorageKey, type ConnectionSettingsState } from "../chat/settings";
import { loadAppearancePreferences } from "../appearance/appearance";
import { decode64 } from "./codec";
import { allPreferenceKeys, type LocalSnapshot } from "./snapshot";
import { backupTables, preferenceKeys, type BackupDocument, type BackupRows, type RestoreMode } from "./types";

export interface RestorePlan { after: LocalSnapshot; writes: { reference: string; data: string }[]; conflicts: number; warnings: string[] }
// Called only after document validation, in the exclusive maintenance workspace.
export function createRestorePlan(document: BackupDocument, before: LocalSnapshot, mode: RestoreMode): RestorePlan {
  const incoming = structuredClone(document.rows) as Record<string, any[]>;
  const rows = structuredClone(before.rows) as unknown as Record<string, any[]>;
  const preferences = { ...before.preferences };
  let conflicts = 0, missingModels = 0;
  const warnings: string[] = [];
  const currentStorage = { getItem: (k: string) => before.preferences[k] ?? null, setItem: () => {} };
  const currentConnections = loadConnectionSettings(currentStorage);
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
  return { after: { rows: afterRows as unknown as BackupRows, preferences: Object.fromEntries(allPreferenceKeys.map(k => [k, preferences[k] ?? null])) }, writes, conflicts, warnings };
}
