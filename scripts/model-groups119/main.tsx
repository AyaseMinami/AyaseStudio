import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/App.css";
import "./preview.css";
import { ConnectionSettings } from "../../src/ui/settings/ConnectionSettings";
import { ModelPicker } from "../../src/ui/chat/ModelPicker";
import { addConnection, addModel, applyModelGroupCommand, createProviderFromTemplate, deleteConnection, deleteModel, deleteProvider,
  loadConnectionSettings, moveConnection, moveProvider, renameProvider, saveConnectionSettings, selectModel, updateConnection, updateModel,
  type ConnectionSettingsState } from "../../src/chat/settings";
import { applyInitialAppearance, defaultAppearancePreferences } from "../../src/appearance/appearance";

const storage = { getItem: (key: string) => localStorage.getItem(`fixture119:${key}`),
  setItem: (key: string, value: string) => localStorage.setItem(`fixture119:${key}`, value) };
function seed(): ConnectionSettingsState {
  return { version: 3, activeModelId: "gpt-chat", providers: [{ id: "supplier", name: "演示供应商", connections: [
    { id: "main", name: "主线路", protocol: "openai-chat", baseUrl: "https://example.invalid/v1", apiKey: "", models: [
      { id: "gpt-chat", modelId: "gpt-5.3-chat-latest", displayName: "日常聊天" }, { id: "gpt-think", modelId: "gpt-5.3-thinking", displayName: "深度思考" },
      { id: "claude", modelId: "claude-sonnet-4-6" }, { id: "gemini", modelId: "gemini-3-pro" }, { id: "other", modelId: "custom-model" },
    ] },
    { id: "backup", name: "备用线路", protocol: "openai-responses", baseUrl: "https://example.invalid/v1", apiKey: "", models: [{ id: "backup-model", modelId: "gpt-5.3-chat-latest" }] },
    { id: "empty", name: "空线路", protocol: "openai-chat", baseUrl: "https://example.invalid/v1", apiKey: "", models: [] },
  ] }] };
}
function theme(dark: boolean) {
  applyInitialAppearance({ storage: { getItem: () => JSON.stringify({ ...defaultAppearancePreferences, themeMode: dark ? "dark" : "light" }), setItem: () => {} },
    systemPrefersDark: false, target: document.documentElement });
}
theme(false);
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (url.origin !== location.origin && !["data:", "blob:"].includes(url.protocol)) throw new Error("Synthetic preview blocks external requests");
  return nativeFetch(input, init);
};
function Preview() {
  const [settings, setSettings] = useState(() => {
    if (storage.getItem("ayase-studio.connection-settings.v3") !== null) return loadConnectionSettings(storage);
    const initial = seed(); saveConnectionSettings(initial, storage); return initial;
  });
  const [dark, setDark] = useState(false), [busy, setBusy] = useState(false), [failSave, setFailSave] = useState(false);
  const [picker, setPicker] = useState(false), [selected, setSelected] = useState<string | null>("gpt-chat");
  function update(change: (current: ConnectionSettingsState) => ConnectionSettingsState) {
    const next = change(settings); saveConnectionSettings(next, storage); setSettings(next);
  }
  return <main className="group-preview">
    <header className="group-preview-tools"><strong>#119 模型分组 · 隔离预览</strong>
      <button className="settings-button" onClick={() => { theme(!dark); setDark(!dark); }}>{dark ? "浅色" : "深色"}</button>
      <button className="settings-button" onClick={() => setPicker(true)}>查看聊天模型选择器</button>
      <label><input type="checkbox" checked={busy} onChange={event => setBusy(event.target.checked)} />模拟生成占用</label>
      <label><input type="checkbox" checked={failSave} onChange={event => setFailSave(event.target.checked)} />模拟保存失败</label>
      <button className="settings-button" onClick={() => { const next = seed(); saveConnectionSettings(next, storage); setSettings(next); }}>重置演示数据</button>
      <span>仅使用合成数据；分组修改可刷新恢复。</span>
    </header>
    <ConnectionSettings connectionSettings={settings} isStreaming={busy} modelCatalogs={{}} modelTests={{}}
      onAddConnection={(providerId, name, protocol, copy) => { const id = crypto.randomUUID(); update(current => addConnection(current, providerId, { id, name, protocol, copyFromConnectionId: copy })); return id; }}
      onAddModel={(connectionId, modelId, displayName) => { const id = crypto.randomUUID(); update(current => addModel(current, connectionId, { id, modelId, displayName })); return id; }}
      onAddProvider={(template, name) => { const id = crypto.randomUUID(); update(current => createProviderFromTemplate(current, template, { providerId: id, name })); return id; }}
      onCancelModelCatalogRefresh={() => {}} onCancelModelTest={() => {}}
      onConnectionChange={(id, field, value) => update(current => updateConnection(current, id, field, value))}
      onDeleteConnection={id => update(current => deleteConnection(current, id))} onDeleteModel={id => update(current => deleteModel(current, id))}
      onDeleteProvider={id => update(current => deleteProvider(current, id))}
      onModelChange={(id, field, value) => update(current => updateModel(current, id, field, value))}
      onModelGroupCommand={(id, command) => { if (busy) return false; if (failSave) throw new Error("演示保存失败，请关闭模拟保存失败后重试。"); update(current => applyModelGroupCommand(current, id, command)); return true; }}
      onProviderRename={(id, name) => update(current => renameProvider(current, id, name))}
      onProviderMove={(id, target, placement) => update(current => moveProvider(current, id, target, placement))}
      onConnectionMove={(id, target, placement) => update(current => moveConnection(current, id, target, placement))}
      onRefreshModelCatalog={async () => {}} onRunModelTest={async () => {}} onSelectModel={id => update(current => selectModel(current, id))} />
    {picker && <ModelPicker settings={settings} selectedModelId={selected} disabled={busy} onSelect={async id => { setSelected(id); return true; }} onClose={() => setPicker(false)} />}
  </main>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
