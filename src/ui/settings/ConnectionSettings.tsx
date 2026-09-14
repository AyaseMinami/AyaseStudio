import type { ProtocolOption } from "../../chat/protocolOptions";
import { protocolOptions } from "../../chat/protocolOptions";
import type { ProviderProfile } from "../../chat/settings";
import type { ChatProtocol } from "../../chat/types";

export interface ConnectionSettingsProps {
  activeProfile: ProviderProfile;
  isStreaming: boolean;
  protocol: ChatProtocol;
  protocolInfo: ProtocolOption;
  onProfileChange(field: keyof ProviderProfile, value: string): void;
  onProtocolChange(protocol: ChatProtocol): void;
}

export function ConnectionSettings({
  activeProfile,
  isStreaming,
  protocol,
  protocolInfo,
  onProfileChange,
  onProtocolChange,
}: ConnectionSettingsProps) {
  return (
    <section className="settings-page" aria-labelledby="connection-title">
      <div className="settings-page-heading">
        <p className="settings-eyebrow">模型服务</p>
        <h2 id="connection-title">连接配置</h2>
        <p className="muted-text">
          选择协议并配置本机使用的服务地址、密钥与模型。
        </p>
      </div>

      <div className="settings-card">
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
      </div>

      <div className="notice notice-warning">
        Alpha 版凭据以明文保存在本机。不要输入与你无关或不可信的中转站密钥。
      </div>
    </section>
  );
}
