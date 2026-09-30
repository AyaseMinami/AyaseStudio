import { Info, Palette, Server, UserRound, Import } from "lucide-react";
import { DataImportSettings, type DataImportSettingsProps } from "./DataImportSettings";
import { AvatarPreview } from "./AvatarSettings";
import type { UserAvatarState } from "../../avatar/useUserAvatar";
import { AssistantAvatarDefaults } from "./AssistantAvatarDefaults";
import { AvatarLibraryPanel } from "../avatar/AvatarLibrary";
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

export type SettingsSection = "connections" | "appearance" | "avatars" | "data" | "about";

export interface SettingsWorkspaceProps {
  activeSection: SettingsSection;
  appearance: AppearanceSettingsProps;
  avatar?: UserAvatarState;
  connection: ConnectionSettingsProps;
  dataImport?: DataImportSettingsProps;
  onSectionChange(section: SettingsSection): void;
}

export function SettingsWorkspace({
  activeSection,
  appearance,
  avatar,
  connection,
  dataImport,
  onSectionChange,
}: SettingsWorkspaceProps) {
  return (
    <div className="settings-workspace">
      <header className="settings-header" data-tauri-drag-region>
        <div data-tauri-drag-region>
          <h1 data-tauri-drag-region>设置</h1>
          <p className="muted-text" data-tauri-drag-region>管理连接、外观、头像、数据与应用信息</p>
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
          <button className="settings-navigation-button" aria-label="头像"
            aria-current={activeSection === "avatars" ? "page" : undefined}
            onClick={() => onSectionChange("avatars")} type="button">
            <UserRound size={18} />
            <span><strong>头像</strong><small>用户头像与裁切</small></span>
          </button>
          <button className="settings-navigation-button" aria-label="数据导入"
            aria-current={activeSection === "data" ? "page" : undefined}
            onClick={() => onSectionChange("data")} type="button">
            <Import size={18} />
            <span><strong>数据导入</strong><small>迁移本地聊天与附件</small></span>
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
          ) : activeSection === "data" ? (
            dataImport ? <DataImportSettings {...dataImport} /> : <p className="muted-text">请在桌面应用中导入聊天。</p>
          ) : activeSection === "avatars" ? (
            <section className="settings-page settings-workspace-page avatar-settings-page" aria-labelledby="avatar-settings-title">
              <header className="settings-page-heading"><h2 id="avatar-settings-title">头像</h2><p className="muted-text">管理用户头像与本地头像库。</p></header>
              <div className="avatar-settings-layout">
                <div className="avatar-settings-preview">{avatar && <AvatarPreview avatar={avatar} />}</div>
                <div className="avatar-settings-controls">
                  <AssistantAvatarDefaults />
                  {avatar && <AvatarLibraryPanel avatar={avatar} />}
                </div>
              </div>
            </section>
          ) : (
            <AboutSettings />
          )}
        </div>
      </div>
    </div>
  );
}
