import { Palette, Server } from "lucide-react";

import {
  AppearanceSettings,
  type AppearanceSettingsProps,
} from "./AppearanceSettings";
import {
  ConnectionSettings,
  type ConnectionSettingsProps,
} from "./ConnectionSettings";

export type SettingsSection = "connections" | "appearance";

export interface SettingsWorkspaceProps {
  activeSection: SettingsSection;
  appearance: AppearanceSettingsProps;
  connection: ConnectionSettingsProps;
  onSectionChange(section: SettingsSection): void;
}

export function SettingsWorkspace({
  activeSection,
  appearance,
  connection,
  onSectionChange,
}: SettingsWorkspaceProps) {
  return (
    <div className="settings-workspace">
      <header className="settings-header">
        <div>
          <h1>设置</h1>
          <p className="muted-text">管理连接与本机外观</p>
        </div>
      </header>

      <div className="settings-body">
        <nav className="settings-navigation" aria-label="设置分类">
          <button
            className="settings-navigation-button"
            aria-label="连接配置"
            aria-current={activeSection === "connections" ? "page" : undefined}
            onClick={() => onSectionChange("connections")}
            type="button"
          >
            <Server size={18} />
            <span>
              <strong>连接配置</strong>
              <small>协议、地址与模型</small>
            </span>
          </button>
          <button
            className="settings-navigation-button"
            aria-label="外观"
            aria-current={activeSection === "appearance" ? "page" : undefined}
            onClick={() => onSectionChange("appearance")}
            type="button"
          >
            <Palette size={18} />
            <span>
              <strong>外观</strong>
              <small>主题与显示偏好</small>
            </span>
          </button>
        </nav>

        <div
          className={`settings-page-scroll${
            activeSection === "connections"
              ? " settings-page-scroll-workbench"
              : ""
          }`}
        >
          {activeSection === "connections" ? (
            <ConnectionSettings {...connection} />
          ) : (
            <AppearanceSettings {...appearance} />
          )}
        </div>
      </div>
    </div>
  );
}
