import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/App.css";
import { ConnectionSettings } from "../../src/ui/settings/ConnectionSettings";
import { initializeProviderPresets, createProviderFromTemplate, providerTemplates, addConnection, addModel, updateConnection, updateModel,
  deleteConnection, deleteModel, deleteProvider, renameProvider, moveProvider, moveConnection, selectModel,
  resetPresetConnection, setProviderAvatar, type ConnectionSettingsState } from "../../src/chat/settings";
import { applyInitialAppearance, defaultAppearancePreferences } from "../../src/appearance/appearance";
import { providerAvatarRepository } from "./providerAvatars";
import { TransparencyAcceptance } from "./transparency";

function theme(dark: boolean) {
  applyInitialAppearance({ storage: { getItem: () => JSON.stringify({ ...defaultAppearancePreferences, themeMode: dark ? "dark" : "light" }), setItem: () => {} },
    systemPrefersDark: false, target: document.documentElement });
}
theme(false);
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (url.origin !== location.origin && !["data:", "blob:"].includes(url.protocol)) throw new Error("Fixture blocks external requests");
  return nativeFetch(input, init);
};

function App() {
  const [state, setState] = useState<ConnectionSettingsState>(() => {
    const next = initializeProviderPresets({ version: 3, activeModelId: null, providers: [] });
    next.providers[0].connections[0].apiKey = "synthetic-fixture-key";
    return next;
  });
  const [dark, setDark] = useState(false), [streaming, setStreaming] = useState(false), [failure, setFailure] = useState(false);
  const [transparency, setTransparency] = useState(false);
  Object.defineProperty(window, "providers100State", { configurable: true, get: () => structuredClone(state) });
  return <main style={{ height: "100dvh", minHeight: 0, padding: 16, display: "flex", flexDirection: "column", gap: 12, color: "rgb(var(--color-text))" }}>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button className="settings-button" onClick={() => { theme(!dark); setDark(!dark); }}>切换主题</button>
      <button className="settings-button" aria-pressed={streaming} onClick={() => setStreaming(!streaming)}>切换生成保护</button>
      <button className="settings-button" aria-pressed={failure} onClick={() => setFailure(!failure)}>切换头像保存失败</button>
      <button className="settings-button" aria-pressed={transparency} onClick={() => setTransparency(!transparency)}>透明头像验收</button>
      <span>隔离合成数据，无生产存储或服务商请求。</span>
    </div>
    <div style={{ minHeight: 0, flex: 1, overflow: "auto" }}>
      {transparency ? <TransparencyAcceptance /> : <ConnectionSettings connectionSettings={state} isStreaming={streaming} modelCatalogs={{}} modelTests={{}}
        onAddProvider={(id, name) => { const providerId = crypto.randomUUID(); const template = providerTemplates.find(template => template.id === id)!;
          setState(state => createProviderFromTemplate(state, id, { providerId, name, prepend: id === "custom", connectionIds: Object.fromEntries(template.connections.map(connection => [connection.protocol, crypto.randomUUID()])) })); return providerId; }}
        onAddConnection={(providerId, name, protocol, copyFromConnectionId) => { const id = crypto.randomUUID(); setState(state => addConnection(state, providerId, { id, name, protocol, copyFromConnectionId })); return id; }}
        onAddModel={(connectionId, modelId, displayName) => { const id = crypto.randomUUID(); setState(state => addModel(state, connectionId, { id, modelId, displayName })); return id; }}
        onProviderAvatarChange={async (providerId, avatar) => {
          if (streaming || failure) return false;
          const selection = avatar && "original" in avatar ? { kind: "image" as const, id: await providerAvatarRepository.save(avatar) } : avatar;
          setState(state => setProviderAvatar(state, providerId, selection)); return true;
        }}
        onResetConnection={id => setState(state => resetPresetConnection(state, id))}
        onProviderRename={(id, name) => setState(state => renameProvider(state, id, name))}
        onProviderMove={(id, targetId, placement) => setState(state => moveProvider(state, id, targetId, placement))}
        onConnectionMove={(id, targetId, placement) => setState(state => moveConnection(state, id, targetId, placement))}
        onConnectionChange={(id, field, value) => setState(state => updateConnection(state, id, field, value))}
        onModelChange={(id, field, value) => setState(state => updateModel(state, id, field, value))}
        onDeleteProvider={id => setState(state => deleteProvider(state, id))} onDeleteConnection={id => setState(state => deleteConnection(state, id))}
        onDeleteModel={id => setState(state => deleteModel(state, id))} onSelectModel={id => setState(state => selectModel(state, id))}
        onRefreshModelCatalog={async () => {}} onRunModelTest={async () => {}} onCancelModelCatalogRefresh={() => {}} onCancelModelTest={() => {}} />}
    </div>
  </main>;
}
createRoot(document.getElementById("root")!).render(<App />);
