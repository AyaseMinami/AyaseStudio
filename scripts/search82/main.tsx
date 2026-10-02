import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/App.css";
import "../../src/ui/settings/DataManagementSettings.css";
import { NetworkSearchSettings } from "../../src/ui/settings/NetworkSearchSettings";
import { WebSearchControl, WebSearchToolbarControl } from "../../src/ui/chat/WebSearchControl";
import { defaultSessionConfig } from "../../src/chat/sessionConfig";
import { resolveSearchMode, withSearchMode } from "../../src/search/mode";
import { applyInitialAppearance, defaultAppearancePreferences } from "../../src/appearance/appearance";
import { requests } from "./nativeHttp";

function theme(dark: boolean) {
  applyInitialAppearance({ storage: { getItem: () => JSON.stringify({ ...defaultAppearancePreferences, themeMode: dark ? "dark" : "light" }),
    setItem: () => {} }, systemPrefersDark: false, target: document.documentElement });
}
theme(false);
// Separate origin + separate Tauri identifier. No chat repository or production credentials are read.
function App() {
  const [config, setConfig] = useState(defaultSessionConfig());
  const [dark, setDark] = useState(false);
  return <main style={{ maxWidth: 1160, margin: "0 auto", padding: 20, color: "rgb(var(--color-text))" }}>
    <p>合成数据验收：测试请求由本地夹具响应，不会连接服务商。</p>
    <button className="settings-button" onClick={() => { theme(!dark); setDark(!dark); }}>切换主题</button>
    <div className="composer-toolbar" style={{ position: "fixed", bottom: 12, left: 20, zIndex: 100,
      background: "rgb(var(--color-panel))", padding: 12, borderRadius: 8, justifyContent: "flex-start", flexWrap: "wrap" }}>
      <WebSearchToolbarControl mode={resolveSearchMode(config)} disabled={false} onChange={mode => setConfig(withSearchMode(config, mode))} />
      <WebSearchControl config={config} disabled={false} onChange={setConfig} />
    </div>
    <NetworkSearchSettings />
  </main>;
}
Object.defineProperty(window, "search82Requests", { get: () => [...requests] });
createRoot(document.getElementById("root")!).render(<App />);
