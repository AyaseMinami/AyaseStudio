import type { SessionConfig } from "../../chat/sessionConfig";

export function WebSearchControl({ config, disabled, onChange }: {
  config: SessionConfig;
  disabled: boolean;
  onChange(config: SessionConfig): void;
}) {
  return <label className="session-config-check session-config-web-search">
    <input type="checkbox" checked={config.webSearch === true} disabled={disabled}
      onChange={(event) => onChange({ ...config, webSearch: event.target.checked })} />
    联网搜索
  </label>;
}
