import { useState } from "react";
import { createRoot } from "react-dom/client";
import { addModel, updateConnection, type ConnectionSettingsState } from "../../src/chat/settings";
import { ConnectionSettings } from "../../src/ui/settings/ConnectionSettings";
import "../../src/App.css";
const initial: ConnectionSettingsState = { version: 3, activeModelId: null, providers: [{ id: "p", name: "隔离协议设置", connections: [{ id: "c", name: "合成绘图连接", protocol: "grok-images", baseUrl: "https://synthetic.invalid", apiKey: "synthetic-only", models: [{ id: "m", modelId: "synthetic-alias" }] }] }] };
function App() {
  const [settings, setSettings] = useState(initial);
  const no = () => undefined;
  return <ConnectionSettings connectionSettings={settings} isStreaming={false} modelCatalogs={{}} modelTests={{}}
    onAddConnection={() => "unused"} onAddProvider={() => "unused"}
    onAddModel={(id, modelId, displayName) => { const key = crypto.randomUUID(); setSettings(value => addModel(value, id, { id: key, modelId, displayName })); return key; }}
    onConnectionChange={(id, field, value) => setSettings(settings => updateConnection(settings, id, field, value))}
    onCancelModelCatalogRefresh={no} onCancelModelTest={no} onDeleteConnection={no} onDeleteModel={no}
    onDeleteProvider={no} onModelChange={no} onProviderRename={no} onProviderMove={no} onConnectionMove={no}
    onRefreshModelCatalog={async () => {}} onRunModelTest={async () => {}} onSelectModel={no} />;
}
document.documentElement.dataset.theme = "light";
createRoot(document.getElementById("root")!).render(<App />);
