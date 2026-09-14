import { Monitor, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";

import type { ThemeMode } from "../../appearance/appearance";

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
  onThemeModeChange(themeMode: ThemeMode): void;
}

export function AppearanceSettings({
  themeMode,
  onThemeModeChange,
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
    </section>
  );
}
