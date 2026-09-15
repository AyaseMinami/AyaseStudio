import { ImagePlus, Monitor, Moon, RotateCcw, Sun, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import type {
  BackgroundFit,
  ResolvedTheme,
  ThemeMode,
} from "../../appearance/appearance";

const themeOptions: readonly {
  value: ThemeMode;
  label: string;
  description: string;
  icon: ReactNode;
}[] = [
  {
    value: "system",
    label: "跟随系统",
    description: "自动匹配 Windows 当前的浅色或深色设置。",
    icon: <Monitor size={20} />,
  },
  {
    value: "light",
    label: "浅色",
    description: "始终使用明亮、清晰的界面配色。",
    icon: <Sun size={20} />,
  },
  {
    value: "dark",
    label: "深色",
    description: "始终使用低亮度的深色界面配色。",
    icon: <Moon size={20} />,
  },
];

export interface AppearanceSettingsProps {
  themeMode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  accentColor: string | null;
  canvasColor: string | null;
  effectiveAccentColor: string;
  effectiveCanvasColor: string;
  backgroundReference: string | null;
  backgroundFit: BackgroundFit;
  backgroundMask: number;
  backgroundBlur: number;
  backgroundBusy: boolean;
  backgroundError: string | null;
  readabilityWarnings: string[];
  onThemeModeChange(themeMode: ThemeMode): void;
  onAccentColorChange(color: string | null): void;
  onCanvasColorChange(color: string | null): void;
  onBackgroundFitChange(fit: BackgroundFit): void;
  onBackgroundMaskChange(mask: number): void;
  onBackgroundBlurChange(blur: number): void;
  onSelectBackground(): Promise<void> | void;
  onRemoveBackground(): Promise<void> | void;
  onResetCustomAppearance(): Promise<void> | void;
}

export function AppearanceSettings({
  themeMode,
  resolvedTheme,
  accentColor,
  canvasColor,
  effectiveAccentColor,
  effectiveCanvasColor,
  backgroundReference,
  backgroundFit,
  backgroundMask,
  backgroundBlur,
  backgroundBusy,
  backgroundError,
  readabilityWarnings,
  onThemeModeChange,
  onAccentColorChange,
  onCanvasColorChange,
  onBackgroundFitChange,
  onBackgroundMaskChange,
  onBackgroundBlurChange,
  onSelectBackground,
  onRemoveBackground,
  onResetCustomAppearance,
}: AppearanceSettingsProps) {
  return (
    <section className="settings-page" aria-labelledby="appearance-title">
      <div className="settings-page-heading">
        <p className="settings-eyebrow">个性化</p>
        <h2 id="appearance-title">外观</h2>
        <p className="muted-text">选择 Ayase Studio 在这台设备上的显示方式。</p>
      </div>

      <fieldset className="settings-card theme-settings-card">
        <legend>主题模式</legend>
        <div className="theme-option-list">
          {themeOptions.map((option) => (
            <label
              className="theme-option"
              data-selected={themeMode === option.value ? "true" : undefined}
              key={option.value}
            >
              <input
                type="radio"
                name="theme-mode"
                value={option.value}
                checked={themeMode === option.value}
                onChange={() => onThemeModeChange(option.value)}
              />
              <span className="theme-option-icon">{option.icon}</span>
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="settings-card appearance-section-card">
        <legend>自定义配色</legend>
        <p className="field-hint appearance-card-hint">
          自定义值通过语义化主题变量即时应用，并随当前
          {resolvedTheme === "dark" ? "深色" : "浅色"}基础主题派生安全表面。
        </p>
        <div className="appearance-color-grid">
          <label className="appearance-color-field">
            <span>
              <strong>强调色</strong>
              <small>{accentColor ? "自定义" : "主题默认"}</small>
            </span>
            <input
              aria-label="自定义强调色"
              type="color"
              value={accentColor ?? effectiveAccentColor}
              onChange={(event) => onAccentColorChange(event.currentTarget.value)}
            />
          </label>
          <label className="appearance-color-field">
            <span>
              <strong>画布背景色</strong>
              <small>{canvasColor ? "自定义" : "主题默认"}</small>
            </span>
            <input
              aria-label="自定义画布背景色"
              type="color"
              value={canvasColor ?? effectiveCanvasColor}
              onChange={(event) => onCanvasColorChange(event.currentTarget.value)}
            />
          </label>
        </div>
        {readabilityWarnings.map((warning) => (
          <p className="notice notice-warning appearance-inline-notice" key={warning}>
            {warning}
          </p>
        ))}
      </fieldset>

      <fieldset className="settings-card appearance-section-card">
        <legend>本地背景图片</legend>
        <div
          aria-label="背景图片预览"
          className="appearance-background-preview"
          data-has-image={backgroundReference ? "true" : undefined}
        >
          <div className="appearance-background-preview-mask" />
          <div className="appearance-background-preview-content">
            <span className="appearance-preview-badge">聊天画布预览</span>
            <strong>{backgroundReference ? "本地背景已应用" : "当前使用纯色画布"}</strong>
            <small>导航、消息和输入控件保持在可读表面之上。</small>
          </div>
        </div>

        <div className="appearance-background-actions">
          <button
            className="settings-button settings-button-primary"
            disabled={backgroundBusy}
            onClick={() => void onSelectBackground()}
            type="button"
          >
            <ImagePlus size={16} />
            {backgroundReference ? "替换本地图片" : "选择本地图片"}
          </button>
          {backgroundReference && (
            <button
              className="settings-button settings-button-danger"
              disabled={backgroundBusy}
              onClick={() => void onRemoveBackground()}
              type="button"
            >
              <Trash2 size={15} />
              移除背景
            </button>
          )}
        </div>
        <p className="field-hint appearance-card-hint">
          仅支持 PNG、JPEG、WebP，最大 20 MB。图片复制到应用私有目录，不上传；替换或移除不会删除原文件。
        </p>

        <div className="appearance-control-grid">
          <label>
            <span className="field-label">图片适配方式</span>
            <select
              className="field"
              disabled={!backgroundReference || backgroundBusy}
              value={backgroundFit}
              onChange={(event) =>
                onBackgroundFitChange(event.currentTarget.value as BackgroundFit)
              }
            >
              <option value="cover">填充</option>
              <option value="contain">适应</option>
            </select>
          </label>
          <label className="appearance-range-field">
            <span className="field-label">
              遮罩强度 <output>{backgroundMask}%</output>
            </span>
            <input
              aria-label="背景遮罩强度"
              disabled={!backgroundReference || backgroundBusy}
              max="90"
              min="35"
              step="1"
              type="range"
              value={backgroundMask}
              onChange={(event) =>
                onBackgroundMaskChange(Number(event.currentTarget.value))
              }
            />
          </label>
          <label className="appearance-range-field">
            <span className="field-label">
              模糊程度 <output>{backgroundBlur}px</output>
            </span>
            <input
              aria-label="背景模糊程度"
              disabled={!backgroundReference || backgroundBusy}
              max="32"
              min="0"
              step="1"
              type="range"
              value={backgroundBlur}
              onChange={(event) =>
                onBackgroundBlurChange(Number(event.currentTarget.value))
              }
            />
          </label>
        </div>
        {backgroundError && (
          <p className="notice notice-warning appearance-inline-notice" role="alert">
            {backgroundError}
          </p>
        )}
      </fieldset>

      <div className="appearance-reset-row">
        <button
          className="settings-button"
          disabled={backgroundBusy}
          onClick={() => void onResetCustomAppearance()}
          type="button"
        >
          <RotateCcw size={15} />
          恢复当前主题默认外观
        </button>
      </div>
    </section>
  );
}
