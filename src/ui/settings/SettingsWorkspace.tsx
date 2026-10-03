import { Info, Palette, Server, UserRound, Import, Globe } from "lucide-react";
import { NetworkSearchSettings } from "./NetworkSearchSettings";
import { DataImportSettings, type DataImportSettingsProps } from "./DataImportSettings";
import { GeneralSettings } from "./GeneralSettings";
import type { GeneralSettingsState } from "../../general/preferences";
import type { UserAvatarState } from "../../avatar/useUserAvatar";
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

export type SettingsSection = "general" | "connections" | "search" | "appearance" | "data" | "about";

export interface SettingsWorkspaceProps {
  activeSection: SettingsSection;
  appearance: AppearanceSettingsProps;
  avatar?: UserAvatarState;
  general?: GeneralSettingsState;
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
  general,
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
          <button className="settings-navigation-button" aria-label="常规"
            aria-current={activeSection === "general" ? "page" : undefined}
            onClick={() => onSectionChange("general")} type="button">
            <UserRound size={18} />
            <span><strong>常规</strong><small>日常使用偏好</small></span>
          </button>
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
              <small>模型服务与连接</small>
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
              <small>界面风格与显示</small>
            </span>
          </button>
          <button className="settings-navigation-button" aria-label="网络搜索"
            aria-current={activeSection === "search" ? "page" : undefined}
            onClick={() => onSectionChange("search")} type="button">
            <Globe size={18} />
            <span><strong>网络搜索</strong><small>搜索服务与偏好</small></span>
          </button>
          <button className="settings-navigation-button" aria-label="数据管理"
            aria-current={activeSection === "data" ? "page" : undefined}
            onClick={() => onSectionChange("data")} type="button">
            <Import size={18} />
            <span><strong>数据管理</strong><small>本地数据与备份</small></span>
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
          {activeSection === "general" ? (
            <GeneralSettings avatar={avatar} general={general} />
          ) : activeSection === "connections" ? (
            <ConnectionSettings {...connection} />
          ) : activeSection === "search" ? (
            <NetworkSearchSettings />
          ) : activeSection === "appearance" ? (
            <AppearanceSettings {...appearance} />
          ) : activeSection === "data" ? (
            <section className="settings-page data-management-page" aria-label="数据管理">
              <header className="settings-page-heading">
                <h2>数据管理</h2>
                <p className="muted-text">管理与迁移你的应用数据，所有处理均在本机完成。</p>
              </header>
              <section className="settings-card data-management-intro" aria-label="Ayase 备份与恢复入口">
                <div className="data-management-entry-heading"><h3>Ayase 备份与恢复</h3><span className="data-management-entry-tag">本应用数据</span></div>
                <p>备份助手、对话、消息、设置、头像、背景和附件。</p>
                <p className="muted-text">包含连接配置与 API Key，可选择加密备份。</p>
                <div className="data-management-entry-footer">
                <p className="data-management-entry-notice">进入将重新加载工作区。未发送的草稿和附件不会保留，请先发送或复制草稿，并等待当前任务完成。</p>
                <button type="button" className="settings-button settings-button-primary" disabled={backupDisabled || !onBackup} onClick={onBackup}>进入备份与恢复</button>
                </div>
                {backupError && <p className="error-banner" role="alert">{backupError}</p>}
              </section>
              {dataImport ? <DataImportSettings {...dataImport} /> : <p className="muted-text">请在桌面应用中导入聊天。</p>}
            </section>
          ) : (
            <AboutSettings />
          )}
        </div>
      </div>
    </div>
  );
}
