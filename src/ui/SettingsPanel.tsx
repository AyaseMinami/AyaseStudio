import { Bot } from "lucide-react";

import type { ThemeMode } from "../appearance/appearance";
import { protocolOptions, type ProtocolOption } from "../chat/protocolOptions";
import type { ProviderProfile } from "../chat/settings";
import type { ChatProtocol } from "../chat/types";

export interface SettingsPanelProps {
  activeProfile: ProviderProfile;
  isStreaming: boolean;
  protocol: ChatProtocol;
  protocolInfo: ProtocolOption;
  themeMode: ThemeMode;
  onProfileChange(field: keyof ProviderProfile, value: string): void;
  onProtocolChange(protocol: ChatProtocol): void;
  onThemeModeChange(themeMode: ThemeMode): void;
}

export function SettingsPanel({
  activeProfile,
  isStreaming,
  protocol,
  protocolInfo,
  themeMode,
  onProfileChange,
  onProtocolChange,
  onThemeModeChange,
}: SettingsPanelProps) {
  return (
    <aside className="settings-panel" aria-label="设置">
      <div className="brand-lockup">
        <div className="brand-mark">
          <Bot size={20} />
        </div>
        <div>
          <h1 className="brand-title">Ayase Studio</h1>
          <p className="muted-text text-xs">轻量本地对话</p>
        </div>
      </div>

      <label className="field-label" htmlFor="theme-mode">
        外观
      </label>
      <select
        id="theme-mode"
        className="field"
        value={themeMode}
        onChange={(event) => onThemeModeChange(event.target.value as ThemeMode)}
      >
        <option value="system">跟随系统</option>
        <option value="light">浅色</option>
        <option value="dark">深色</option>
      </select>

      <label className="field-label" htmlFor="protocol">
        协议
      </label>
      <select
        id="protocol"
        className="field"
        value={protocol}
        disabled={isStreaming}
        onChange={(event) =>
          onProtocolChange(event.target.value as ChatProtocol)
        }
      >
        {protocolOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <label className="field-label" htmlFor="base-url">
        Base URL
      </label>
      <input
        id="base-url"
        className="field"
        value={activeProfile.baseUrl}
        onChange={(event) => onProfileChange("baseUrl", event.target.value)}
        placeholder="https://relay.example.com/v1"
        spellCheck={false}
      />
      <p className="field-hint">{protocolInfo.hint}</p>

      <label className="field-label" htmlFor="api-key">
        API Key
      </label>
      <input
        id="api-key"
        className="field"
        type="password"
        value={activeProfile.apiKey}
        onChange={(event) => onProfileChange("apiKey", event.target.value)}
        placeholder="仅保存在本机 WebView"
        autoComplete="off"
        spellCheck={false}
      />

      <label className="field-label" htmlFor="model">
        Model
      </label>
      <input
        id="model"
        className="field"
        value={activeProfile.model}
        onChange={(event) => onProfileChange("model", event.target.value)}
        placeholder="模型 ID"
        spellCheck={false}
      />

      <div className="notice notice-warning">
        Alpha 版凭据以明文保存在本机。不要输入与你无关或不可信的中转站密钥。
      </div>
    </aside>
  );
}
