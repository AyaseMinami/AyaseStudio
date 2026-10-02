import { BookOpen, Check, CircleAlert, ImagePlus, Monitor, Moon, RotateCcw, Sun } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { BackgroundFocus } from "../../appearance/backgroundFocus";
import type { BackgroundFit, BackgroundLibraryEdit, BackgroundLibraryEntry, BackgroundResource, ColorPreset, ResolvedTheme, ThemeMode } from "../../appearance/appearance";
import { defaultAppearancePreferences } from "../../appearance/appearance";
import { colorPresets, getColorPresetPalette } from "../../appearance/colorPresets";
import { AppearanceChatPreview } from "./AppearanceChatPreview";
import { BackgroundLibraryDialog } from "./BackgroundLibraryDialog";
import { BackgroundDisplayControls, RangeControl } from "./BackgroundDisplayControls";
import "./AppearanceSettings.css";
import { SettingsHelp } from "./SettingsHelp";

const themeOptions: readonly { value: ThemeMode; label: string; description: string; icon: ReactNode }[] = [
  { value: "system", label: "跟随系统", description: "自动匹配 Windows 当前的浅色或深色设置。", icon: <Monitor size={16} /> },
  { value: "light", label: "浅色", description: "始终使用明亮、清晰的界面配色。", icon: <Sun size={16} /> },
  { value: "dark", label: "深色", description: "始终使用低亮度的深色界面配色。", icon: <Moon size={16} /> },
];

export interface AppearanceSettingsProps {
  unifiedThemeColor: string | null; effectiveUserBubbleColor: string;
  onUnifiedThemeColorChange(color: string | null): void; onUserBubbleColorChange(color: string | null): void;
  colorPreset: ColorPreset; onColorPresetChange(preset: ColorPreset): void;
  themeMode: ThemeMode; resolvedTheme: ResolvedTheme; accentColor: string | null; canvasColor: string | null;
  assistantBubbleColor: string | null; assistantBubbleTransparency: number; effectiveAccentColor: string; effectiveCanvasColor: string;
  unifiedTransparency: number; sidebarTransparency: number; composerTransparency: number;
  backgroundReference: string | null; backgroundUrl: string | null; backgroundFocus: BackgroundFocus | null; backgroundFit: BackgroundFit;
  backgroundLibrary: BackgroundLibraryEntry[]; backgroundEnabled: boolean; backgroundName: string | null;
  backgroundMask: number; backgroundBlur: number; backgroundBusy: boolean; backgroundError: string | null; readabilityWarnings: string[];
  onThemeModeChange(themeMode: ThemeMode): void; onAccentColorChange(color: string | null): void; onCanvasColorChange(color: string | null): void;
  onAssistantBubbleColorChange(color: string | null): void; onAssistantBubbleTransparencyChange(value: number): void; onEditBackgroundFocus(): void;
  onUnifiedTransparencyChange(value: number | null): void; onSidebarTransparencyChange(value: number): void; onComposerTransparencyChange(value: number): void;
  onBackgroundFitChange(fit: BackgroundFit): void; onBackgroundMaskChange(mask: number): void; onBackgroundBlurChange(blur: number): void;
  onPrepareLibraryBackground(): Promise<BackgroundResource | null>;
  onSaveLibraryBackground(resource: BackgroundResource, replaceId?: string): Promise<BackgroundLibraryEntry>;
  onDiscardLibraryBackground(reference: string): Promise<void>;
  onResolveLibraryBackground(reference: string, options?: { thumbnail?: boolean; refresh?: boolean }): Promise<BackgroundResource>;
  onApplyLibraryBackground(id: string, edit?: BackgroundLibraryEdit): Promise<void>;
  onRemoveLibraryBackgrounds(ids: string[]): Promise<void>;
  onRestoreBackground(): Promise<void>;
  onRemoveBackground(): Promise<void> | void; onResetCustomAppearance(): Promise<void> | void;
}

export function AppearanceSettings({
  unifiedThemeColor, effectiveUserBubbleColor, onUnifiedThemeColorChange, onUserBubbleColorChange,
  colorPreset, onColorPresetChange,
  themeMode, resolvedTheme, accentColor, canvasColor, assistantBubbleColor, assistantBubbleTransparency,
  unifiedTransparency, sidebarTransparency, composerTransparency,
  effectiveAccentColor, effectiveCanvasColor, backgroundReference, backgroundUrl, backgroundFocus, backgroundFit,
  backgroundLibrary, backgroundEnabled, backgroundName,
  backgroundMask, backgroundBlur, backgroundBusy, backgroundError, readabilityWarnings, onThemeModeChange,
  onAccentColorChange, onCanvasColorChange, onAssistantBubbleColorChange, onAssistantBubbleTransparencyChange,
  onUnifiedTransparencyChange, onSidebarTransparencyChange, onComposerTransparencyChange,
  onEditBackgroundFocus, onBackgroundFitChange, onBackgroundMaskChange, onBackgroundBlurChange,
  onPrepareLibraryBackground, onSaveLibraryBackground, onDiscardLibraryBackground, onResolveLibraryBackground,
  onApplyLibraryBackground, onRemoveLibraryBackgrounds, onRestoreBackground,
  onRemoveBackground, onResetCustomAppearance,
}: AppearanceSettingsProps) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [thumbnail, setThumbnail] = useState<{ reference: string; url: string }>();
  useEffect(() => {
    let cancelled = false;
    if (backgroundReference && !backgroundUrl) void onResolveLibraryBackground(backgroundReference, { thumbnail: true }).then((resource) => {
      if (!cancelled) setThumbnail({ reference: resource.reference, url: resource.url });
    }).catch(() => { if (!cancelled) setThumbnail(undefined); });
    return () => { cancelled = true; };
  }, [backgroundReference, backgroundUrl, onResolveLibraryBackground]);
  const thumbnailUrl = backgroundUrl ?? (thumbnail?.reference === backgroundReference ? thumbnail.url : null);
  const mixedTransparency = sidebarTransparency !== composerTransparency || sidebarTransparency !== assistantBubbleTransparency;
  const mixedThemeColor = effectiveAccentColor !== effectiveUserBubbleColor;
  const presetPalette = getColorPresetPalette(colorPreset, resolvedTheme);
  const readingSelected = themeMode === "light" && colorPreset === "reading";
  return <section className="settings-page settings-workspace-page appearance-settings-page" aria-labelledby="appearance-title">
    <div className="settings-page-heading"><h2 id="appearance-title">外观</h2><p className="muted-text">选择 Ayase Studio 在这台设备上的显示方式。</p></div>

    <div className="appearance-layout">
    <div className="appearance-preview-column">
    <div className="appearance-group-card appearance-preview-card">
    <p className="appearance-preview-caption">1920 × 1080 · 16:9 等比预览 · {backgroundEnabled && backgroundUrl ? "本地背景已应用" : "当前使用纯色画布"}</p>
    <AppearanceChatPreview url={backgroundUrl} focus={backgroundFocus} fit={backgroundFit} mask={backgroundMask} blur={backgroundBlur} />
    </div>
    </div>
    <div className="appearance-controls">
    <div className="appearance-group appearance-group-card">
    <fieldset className="appearance-theme-group">
      <legend>主题模式</legend>
      <div className="appearance-theme-options">
        {themeOptions.map((option) => <label className="appearance-theme-option" data-selected={!readingSelected && themeMode === option.value ? "true" : undefined} key={option.value} title={option.description}>
          <input type="radio" name="theme-mode" value={option.value} checked={!readingSelected && themeMode === option.value} onChange={() => { if (readingSelected) onColorPresetChange("default"); onThemeModeChange(option.value); }} />
          <span aria-hidden="true">{option.icon}</span><span>{option.label}</span>
        </label>)}
        <label className="appearance-theme-option" data-selected={readingSelected ? "true" : undefined} title="使用浅色阅读配色，重置自定义颜色，保留背景图片和透明度。">
          <input type="radio" name="theme-mode" value="reading" checked={readingSelected} onChange={() => { onColorPresetChange("reading"); onThemeModeChange("light"); }} />
          <span aria-hidden="true"><BookOpen size={16} /></span><span>阅读</span>
        </label>
      </div>
    </fieldset>
    <fieldset className="appearance-theme-group appearance-preset-group">
      <legend>配色方案</legend>
      <div className="appearance-preset-options">
        {colorPresets.map((preset) => {
          const palette = getColorPresetPalette(preset.id, resolvedTheme);
          return <label className="appearance-preset-option" data-selected={colorPreset === preset.id ? "true" : undefined} key={preset.id} title={`${preset.label}：${preset.description}`}>
            <input type="radio" name="color-preset" aria-label={preset.label} value={preset.id} checked={colorPreset === preset.id} onChange={() => onColorPresetChange(preset.id)} />
            <span className="appearance-preset-preview" aria-hidden="true" style={{ backgroundColor: palette.canvas }}>
              <span className="appearance-preset-accent" style={{ backgroundColor: palette.accent }} />
              <span className="appearance-preset-assistant" style={{ backgroundColor: palette.assistantBubble }} />
              <span className="appearance-preset-user" style={{ backgroundColor: palette.userBubble }} />
            </span>
            <Check className="appearance-preset-check" size={12} aria-hidden="true" />
          </label>;
        })}
      </div>
    </fieldset>
    <button className="settings-button appearance-secondary-action" type="button" title="清除自定义颜色，恢复当前方案配色；保留背景图片和透明度。" onClick={() => onColorPresetChange(colorPreset)}><RotateCcw size={15} aria-hidden="true" />恢复方案配色</button>
    </div>

    <section className="appearance-group appearance-group-card" aria-labelledby="appearance-colors-title">
      <GroupHeading id="appearance-colors-title" title="自定义配色">统一主题色仅覆盖组件和用户消息气泡；助手气泡与画布背景独立设置。</GroupHeading>
      <div className="appearance-rows">
        <div className="appearance-row"><span className="appearance-row-copy"><strong>统一主题色</strong>{mixedThemeColor && <span className="appearance-mixed-indicator"><span>已分别调整</span><span className="appearance-mixed-help"><SettingsHelp label="主题色差异" icon={<CircleAlert size={15} aria-hidden="true" />}>组件和用户消息气泡颜色不同。修改统一主题色会覆盖这两项，不影响助手气泡和画布背景。</SettingsHelp></span></span>}</span><ColorControl label="统一主题色" value={mixedThemeColor ? unifiedThemeColor ?? effectiveAccentColor : effectiveAccentColor} onChange={onUnifiedThemeColorChange} /></div>
        <div className="appearance-row appearance-color-child"><RowCopy title="组件颜色" /><ColorControl label="组件颜色" value={accentColor ?? effectiveAccentColor} onChange={onAccentColorChange} /></div>
        <div className="appearance-row appearance-color-child"><RowCopy title="用户消息气泡颜色" /><ColorControl label="用户消息气泡颜色" value={effectiveUserBubbleColor} onChange={onUserBubbleColorChange} /></div>
        <div className="appearance-row"><RowCopy title="助手消息气泡颜色" /><ColorControl label="助手回复气泡颜色" value={assistantBubbleColor ?? presetPalette.assistantBubble} onChange={onAssistantBubbleColorChange} /></div>
        <div className="appearance-row"><RowCopy title="画布背景色" /><ColorControl label="自定义画布背景色" value={canvasColor ?? effectiveCanvasColor} onChange={onCanvasColorChange} /></div>
      </div>
      {readabilityWarnings.map((warning) => <p className="notice notice-warning appearance-inline-notice" key={warning}>{warning}</p>)}
    </section>

    <section className="appearance-group appearance-group-card" aria-labelledby="appearance-transparency-title">
      <GroupHeading id="appearance-transparency-title" title="区域透明度">只改变区域背景，文字和操作控件保持清晰。侧栏透明度同时控制聊天的助手栏、对话栏和设置分类导航。</GroupHeading>
      <div className="appearance-rows">
        <div className="appearance-row appearance-range-row"><span className="appearance-row-copy"><strong>统一透明度</strong>{mixedTransparency && <span className="appearance-mixed-indicator"><span>已分别调整</span><span className="appearance-mixed-help"><SettingsHelp label="区域透明度差异" icon={<CircleAlert size={15} aria-hidden="true" />}>各区域透明度不同，调整统一滑块将覆盖三个区域的设置。</SettingsHelp></span></span>}</span><RangeControl value={mixedTransparency ? "各项不同" : `${unifiedTransparency}%`} ariaLabel="统一透明度" valueNumber={unifiedTransparency} onChange={onUnifiedTransparencyChange} onReset={() => onUnifiedTransparencyChange(null)} max="100" min="0" /></div>
        <div className="appearance-row appearance-range-row"><RowCopy title="侧栏透明度" /><RangeControl value={`${sidebarTransparency}%`} ariaLabel="侧栏透明度" valueNumber={sidebarTransparency} onChange={onSidebarTransparencyChange} onReset={() => onSidebarTransparencyChange(defaultAppearancePreferences.sidebarTransparency)} max="100" min="0" /></div>
        <div className="appearance-row appearance-range-row"><RowCopy title="输入区域透明度" /><RangeControl value={`${composerTransparency}%`} ariaLabel="输入区域透明度" valueNumber={composerTransparency} onChange={onComposerTransparencyChange} onReset={() => onComposerTransparencyChange(defaultAppearancePreferences.composerTransparency)} max="100" min="0" /></div>
        <div className="appearance-row appearance-range-row"><RowCopy title="消息气泡透明度" /><RangeControl value={`${assistantBubbleTransparency}%`} ariaLabel="消息气泡透明度" valueNumber={assistantBubbleTransparency} onChange={onAssistantBubbleTransparencyChange} onReset={() => onAssistantBubbleTransparencyChange(defaultAppearancePreferences.assistantBubbleTransparency)} max="100" min="0" /></div>
      </div>
    </section>

    <section className="appearance-group appearance-group-card" aria-labelledby="appearance-background-title">
      <GroupHeading id="appearance-background-title" title="全局背景">聊天、绘图与设置共用此背景。图片仅保存在本机，不上传。支持 PNG、JPEG、WebP，最大 20 MB。删除或替换库图片不影响当前背景。</GroupHeading>
      {backgroundReference && <div className="appearance-current-background">{thumbnailUrl && <img src={thumbnailUrl} alt="当前背景缩略图" />}<span title={backgroundName ?? "当前背景"}>{backgroundName ?? "当前背景"}<small>{backgroundEnabled ? "已启用" : "已停用，图片和参数已保留"}</small></span></div>}
      <div className="appearance-background-actions">
        <button className="settings-button settings-button-primary" disabled={backgroundBusy} onClick={() => setLibraryOpen(true)} type="button"><ImagePlus size={16} />选择背景</button>
        {backgroundReference && <button className="settings-button" disabled={backgroundBusy || !backgroundUrl} onClick={onEditBackgroundFocus} type="button">调整取景中心</button>}
        {backgroundReference && <button className="settings-button" disabled={backgroundBusy} onClick={() => void (backgroundEnabled ? onRemoveBackground() : onRestoreBackground())} type="button">{backgroundEnabled ? "停用背景" : "重新启用背景"}</button>}
      </div>
      <BackgroundDisplayControls fit={backgroundFit} mask={backgroundMask} blur={backgroundBlur} disabled={!backgroundReference || backgroundBusy} onFitChange={onBackgroundFitChange} onMaskChange={onBackgroundMaskChange} onBlurChange={onBackgroundBlurChange} />
      {backgroundError && <p className="notice notice-warning appearance-inline-notice" role="alert">{backgroundError}</p>}
    </section>

    <section className="appearance-group appearance-group-card appearance-reset-group" aria-labelledby="appearance-reset-title">
      <GroupHeading id="appearance-reset-title" title="恢复默认">恢复当前主题的默认颜色、各区域透明度和背景设置，保留背景库图片。</GroupHeading>
      <button className="settings-button" disabled={backgroundBusy} onClick={() => void onResetCustomAppearance()} type="button"><RotateCcw size={15} />恢复当前主题默认外观</button>
    </section>
    </div>
    </div>
    {libraryOpen && <BackgroundLibraryDialog entries={backgroundLibrary} currentReference={backgroundReference} busy={backgroundBusy}
      onPrepare={onPrepareLibraryBackground} onSave={onSaveLibraryBackground} onDiscard={onDiscardLibraryBackground} onResolve={onResolveLibraryBackground}
      onApply={onApplyLibraryBackground} onRemove={onRemoveLibraryBackgrounds} onClose={() => setLibraryOpen(false)} />}
  </section>;
}

function GroupHeading({ children, id, title }: { children: string; id: string; title: string }) {
  return <div className="appearance-group-heading"><h3 id={id}>{title}</h3><SettingsHelp label={title}>{children}</SettingsHelp></div>;
}

function RowCopy({ title }: { title: string }) {
  return <span className="appearance-row-copy"><strong>{title}</strong></span>;
}

function ColorControl({ label, value, onChange }: { label: string; value: string; onChange(color: string | null): void }) {
  const resetLabel = label === "统一主题色" ? "恢复组件和用户气泡默认颜色" : `恢复${label}默认值`;
  return <span className="appearance-color-control">
    <input aria-label={label} type="color" value={value} onChange={(event) => onChange(event.currentTarget.value)} />
    <button className="settings-button appearance-color-reset" type="button" title={resetLabel} aria-label={resetLabel} onClick={() => onChange(null)}><RotateCcw size={15} aria-hidden="true" /></button>
  </span>;
}
