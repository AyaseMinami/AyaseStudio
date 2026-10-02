import { Info, Palette, Server, UserRound, Import, Globe } from "lucide-react";
import { NetworkSearchSettings } from "./NetworkSearchSettings";
import { DataImportSettings, type DataImportSettingsProps } from "./DataImportSettings";
import { AvatarPreview } from "./AvatarSettings";
import type { UserAvatarState } from "../../avatar/useUserAvatar";
import { AvatarLibraryPanel } from "../avatar/AvatarLibrary";
import { AboutSettings } from "./AboutSettings";
import { WindowControls } from "../window/WindowControls";
import "./DataManagementSettings.css";

import {
  AppearanceSettings,
  type AppearanceSettingsProps,
} from "./AppearanceSettings";
import {
  ConnectionSettings,
  type ConnectionSettingsProps,
} from "./ConnectionSettings";

export type SettingsSection = "connections" | "search" | "appearance" | "avatars" | "data" | "about";

export interface SettingsWorkspaceProps {
  activeSection: SettingsSection;
  appearance: AppearanceSettingsProps;
  avatar?: UserAvatarState;
  connection: ConnectionSettingsProps;
  dataImport?: DataImportSettingsProps;
  backupDisabled?: boolean;
  backupError?: string;
  onBackup?(): void;
  onSectionChange(section: SettingsSection): void;
}

export function SettingsWorkspace({
  activeSection,
  appearance,
  avatar,
  connection,
  dataImport,
  backupDisabled,
  backupError,
  onBackup,
  onSectionChange,
}: SettingsWorkspaceProps) {
  return (
    <div className="settings-workspace">
      <header className="settings-header" data-tauri-drag-region>
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
          <button className="settings-navigation-button" aria-label="网络搜索"
            aria-current={activeSection === "search" ? "page" : undefined}
            onClick={() => onSectionChange("search")} type="button">
            <Globe size={18} />
            <span><strong>网络搜索</strong><small>Exa、Tavily、智谱与搜索凭据</small></span>
          </button>
          <button className="settings-navigation-button" aria-label="数据管理"
            aria-current={activeSection === "data" ? "page" : undefined}
            onClick={() => onSectionChange("data")} type="button">
            <Import size={18} />
            <span><strong>数据管理</strong><small>备份、恢复与迁移</small></span>
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
          ) : activeSection === "search" ? (
            <NetworkSearchSettings />
          ) : activeSection === "appearance" ? (
            <AppearanceSettings {...appearance} />
          ) : activeSection === "data" ? (
            <section className="settings-page data-management-page" aria-label="数据管理">
              <header className="settings-page-heading">
                <h2>数据管理</h2>
                <p className="muted-text">备份、恢复与迁移，所有处理均在本机完成。</p>
              </header>
              <section className="settings-card data-management-intro" aria-label="Ayase 备份与恢复入口">
                <h3>Ayase 备份与恢复</h3>
                <p>备份助手、对话、消息、设置、头像、背景和附件，包含连接配置与 API Key，可选择加密备份。</p>
                <p className="muted-text">进入将重新加载工作区。未发送的草稿和附件不会保留，请先发送或复制草稿，并等待当前任务完成。</p>
                {backupError && <p className="error-banner" role="alert">{backupError}</p>}
                <button type="button" className="settings-button" disabled={backupDisabled || !onBackup} onClick={onBackup}>进入备份与恢复</button>
              </section>
              {dataImport ? <DataImportSettings {...dataImport} /> : <p className="muted-text">请在桌面应用中导入聊天。</p>}
            </section>
          ) : activeSection === "avatars" ? (
            <section className="settings-page settings-workspace-page avatar-settings-page" aria-labelledby="avatar-settings-title">
              <header className="settings-page-heading"><h2 id="avatar-settings-title">头像</h2><p className="muted-text">管理用户头像与本地头像库。</p></header>
              <div className="avatar-settings-layout">
                <div className="avatar-settings-preview">{avatar && <AvatarPreview avatar={avatar} />}</div>
                <div className="avatar-settings-controls">
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
