import { Info, Palette, Server } from "lucide-react";
import { AboutSettings } from "./AboutSettings";
import { WindowControls } from "../window/WindowControls";

import {
  AppearanceSettings,
  type AppearanceSettingsProps,
} from "./AppearanceSettings";
import {
  ConnectionSettings,
  type ConnectionSettingsProps,
} from "./ConnectionSettings";

export type SettingsSection = "connections" | "appearance" | "about";

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
      <header className="settings-header" data-tauri-drag-region>
        <div data-tauri-drag-region>
          <h1 data-tauri-drag-region>设置</h1>
          <p className="muted-text" data-tauri-drag-region>管理连接、外观与应用信息</p>
        </div>
        <WindowControls />
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
          <button className="settings-navigation-button" aria-label="关于"
            aria-current={activeSection === "about" ? "page" : undefined}
            onClick={() => onSectionChange("about")} type="button">
            <Info size={18} />
            <span><strong>关于</strong><small>应用信息与反馈</small></span>
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
          ) : activeSection === "appearance" ? (
            <AppearanceSettings {...appearance} />
          ) : (
            <AboutSettings />
          )}
        </div>
      </div>
    </div>
  );
}
