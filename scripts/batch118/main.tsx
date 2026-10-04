import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Dexie from "dexie";
import "../../src/App.css";
import "./fixture.css";
import { ConnectionSettings } from "../../src/ui/settings/ConnectionSettings";
import { ConversationNavigation } from "../../src/ui/chat/ConversationNavigation";
import { createConversationNavigationController } from "../../src/ui/chat/useConversationNavigation";
import { useConversationWorkspace } from "../../src/chat/useConversationWorkspace";
import { createChatRepository, type StoredChatMessage } from "../../src/chat/repository";
import { defaultSessionConfig } from "../../src/chat/sessionConfig";
import { DEFAULT_ASSISTANT_ID } from "../../src/chat/workspace";
import { addConnection, addModel, createProviderFromTemplate, deleteConnection, deleteConnections, deleteModel, deleteProvider,
  deleteProviders, moveConnection, moveProvider, providerTemplates, renameProvider, selectModel, updateConnection, updateModel,
  type ConnectionSettingsState } from "../../src/chat/settings";
import { applyInitialAppearance, defaultAppearancePreferences } from "../../src/appearance/appearance";

const databaseName = `Batch118Synthetic-${crypto.randomUUID()}`;
const repository = createChatRepository(databaseName);
const noModelIds: string[] = [];
const readingAssistantId = "batch118-reading", emptyAssistantId = "batch118-empty";
const firstReadingConversation = "batch118-reading-0";

function applyTheme(dark: boolean) {
  applyInitialAppearance({ storage: { getItem: () => JSON.stringify({ ...defaultAppearancePreferences, themeMode: dark ? "dark" : "light" }), setItem: () => {} },
    systemPrefersDark: false, target: document.documentElement });
}
applyTheme(false);
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (url.origin !== location.origin && !["data:", "blob:"].includes(url.protocol)) throw new Error("Fixture blocks external requests");
  return nativeFetch(input, init);
};

await repository.initializeWorkspace(null, noModelIds);
for (const [id, name] of [[readingAssistantId, "阅读助手"], [emptyAssistantId, "空助手"]]) {
  await repository.execute({ type: "create-assistant", id, input: { name, icon: "", defaultModelId: null, defaultConfig: defaultSessionConfig() } });
}
for (const [assistantId, conversationId, title] of [
  [DEFAULT_ASSISTANT_ID, "current", "默认助手的保留对话"],
  [readingAssistantId, firstReadingConversation, "读书摘录"],
  [readingAssistantId, "batch118-reading-1", "阅读计划"],
  [readingAssistantId, "batch118-reading-2", "长名称对话 · 用于检查批量管理行的省略与选择状态"],
]) {
  if (conversationId !== "current") await repository.execute({ type: "create-conversation", id: conversationId, assistantId });
  await repository.execute({ type: "rename-conversation", id: conversationId, title });
  const messages: StoredChatMessage[] = [
    { id: `${conversationId}-user`, role: "user", content: "这是一条隔离验收用的合成问题。", status: "complete" },
    { id: `${conversationId}-answer`, replyToId: `${conversationId}-user`, role: "assistant", content: "合成回复：批量移除助手时，可选择把对话移至默认助手，或连同对话删除。", status: "complete" },
  ];
  await repository.save({ id: conversationId, updatedAt: Date.now(), messages });
}
await repository.execute({ type: "select", assistantId: readingAssistantId, conversationId: firstReadingConversation });

const navigation = createConversationNavigationController(window.innerWidth);
navigation.setOpen(true); navigation.expandAssistant();
function seedConnections(): ConnectionSettingsState {
  return { version: 3, activeModelId: "model-a", providers: [
    { id: "provider-a", name: "合成供应商 A", connections: [
      { id: "connection-a", name: "主线路", protocol: "openai-chat", baseUrl: "https://example.invalid/v1", apiKey: "", models: [{ id: "model-a", modelId: "synthetic-alpha" }, { id: "model-b", modelId: "synthetic-beta" }] },
      { id: "connection-b", name: "无模型备用线路", protocol: "openai-responses", baseUrl: "https://example.invalid/v1", apiKey: "", models: [] },
    ] },
    { id: "provider-b", name: "合成供应商 B", connections: [{ id: "connection-c", name: "研究线路", protocol: "anthropic-native", baseUrl: "https://example.invalid", apiKey: "", models: [{ id: "model-c", modelId: "synthetic-research" }] }] },
    { id: "provider-empty", name: "空供应商", connections: [] },
  ] };
}

function SnapshotProbe({ workspace, settings, generatingIds }: { workspace: ReturnType<typeof useConversationWorkspace>; settings: ConnectionSettingsState; generatingIds: ReadonlySet<string> }) {
  const current = useRef({ workspace, settings, generatingIds }); current.current = { workspace, settings, generatingIds };
  useEffect(() => {
    Object.defineProperty(window, "batch118Snapshot", { configurable: true, get: () => ({ databaseName,
      workspace: structuredClone(current.current.workspace.snapshot), selectedConversationId: current.current.workspace.conversation?.id,
      settings: structuredClone(current.current.settings), generatingIds: [...current.current.generatingIds] }) });
    return () => { delete (window as Window & { batch118Snapshot?: unknown }).batch118Snapshot; };
  }, []);
  return null;
}

function App() {
  const [page, setPage] = useState<"chat" | "connections">("chat");
  const [dark, setDark] = useState(false), [streaming, setStreaming] = useState(false);
  const [generatingIds, setGeneratingIds] = useState<ReadonlySet<string>>(new Set());
  const generatingRef = useRef(generatingIds); generatingRef.current = generatingIds;
  const [settings, setSettings] = useState(seedConnections);
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const workspace = useConversationWorkspace(repository, null, noModelIds, id => generatingRef.current.has(id));
  function update(change: (current: ConnectionSettingsState) => ConnectionSettingsState) {
    const next = change(settingsRef.current); settingsRef.current = next; setSettings(next);
  }
  return <main className="batch118-fixture">
    <SnapshotProbe workspace={workspace} settings={settings} generatingIds={generatingIds} />
    <div className="batch118-controls">
      <button className="settings-button" aria-pressed={page === "chat"} onClick={() => setPage("chat")}>聊天验收</button>
      <button className="settings-button" aria-pressed={page === "connections"} onClick={() => setPage("connections")}>连接验收</button>
      <button className="settings-button" aria-pressed={dark} onClick={() => { applyTheme(!dark); setDark(!dark); }}>{dark ? "深色主题" : "浅色主题"}</button>
      <button className="settings-button" aria-pressed={streaming} onClick={() => {
        const next = !streaming; setStreaming(next); setGeneratingIds(next ? new Set([workspace.conversation?.id ?? firstReadingConversation]) : new Set());
      }}>生成保护{streaming ? "开启" : "关闭"}</button>
      <p>隔离合成数据；刷新重新创建验收数据库。无外部服务请求。</p>
    </div>
    <div className="batch118-content">
      {page === "chat" ? <ConversationNavigation workspace={workspace} settings={settings} generatingIds={generatingIds} navigation={navigation}>
        <section className="batch118-messages"><h2>{workspace.conversation?.title ?? "正在加载"}</h2>
          {workspace.view.messages.map(message => <p key={message.id}><small>{message.role === "user" ? "用户" : "助手"}</small><br />{message.content}</p>)}
          {workspace.operationError && <p role="alert">{workspace.operationError}</p>}
        </section>
      </ConversationNavigation> : <ConnectionSettings connectionSettings={settings} isStreaming={streaming} modelCatalogs={{}} modelTests={{}}
        onAddProvider={(templateId, name) => { const providerId = crypto.randomUUID(); const template = providerTemplates.find(item => item.id === templateId)!;
          update(current => createProviderFromTemplate(current, templateId, { providerId, name, connectionIds: Object.fromEntries(template.connections.map(item => [item.protocol, crypto.randomUUID()])) })); return providerId; }}
        onAddConnection={(providerId, name, protocol, copyFromConnectionId) => { const id = crypto.randomUUID(); update(current => addConnection(current, providerId, { id, name, protocol, copyFromConnectionId })); return id; }}
        onAddModel={(connectionId, modelId, displayName) => { const id = crypto.randomUUID(); update(current => addModel(current, connectionId, { id, modelId, displayName })); return id; }}
        onDeleteProviders={targets => {
          const current = settingsRef.current;
          if (streaming || !targets.length || targets.some(target => !current.providers.includes(target))) return false;
          const next = deleteProviders(current, targets.map(target => target.id)); if (next === current) return false;
          settingsRef.current = next; setSettings(next); return true;
        }}
        onDeleteConnections={(providerId, targets) => {
          const current = settingsRef.current, provider = current.providers.find(item => item.id === providerId);
          if (streaming || !provider || !targets.length || targets.some(target => !provider.connections.includes(target))) return false;
          const next = deleteConnections(current, providerId, targets.map(target => target.id)); if (next === current) return false;
          settingsRef.current = next; setSettings(next); return true;
        }}
        onDeleteProvider={id => update(current => deleteProvider(current, id))} onDeleteConnection={id => update(current => deleteConnection(current, id))}
        onDeleteModel={id => update(current => deleteModel(current, id))} onSelectModel={id => update(current => selectModel(current, id))}
        onProviderRename={(id, name) => update(current => renameProvider(current, id, name))}
        onProviderMove={(id, target, placement) => update(current => moveProvider(current, id, target, placement))}
        onConnectionMove={(id, target, placement) => update(current => moveConnection(current, id, target, placement))}
        onConnectionChange={(id, field, value) => update(current => updateConnection(current, id, field, value))}
        onModelChange={(id, field, value) => update(current => updateModel(current, id, field, value))}
        onRefreshModelCatalog={async () => {}} onRunModelTest={async () => {}} onCancelModelCatalogRefresh={() => {}} onCancelModelTest={() => {}} />}
    </div>
  </main>;
}
const root = createRoot(document.getElementById("root")!); root.render(<App />);
window.addEventListener("pagehide", () => {
  // Only this page's uniquely named fixture database is eligible for cleanup.
  if (!databaseName.startsWith("Batch118Synthetic-")) return;
  root.unmount(); Dexie.connections.filter(database => database.name === databaseName).forEach(database => database.close());
  void Dexie.delete(databaseName);
}, { once: true });
