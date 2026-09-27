import { BookOpen, CircleAlert, ImagePlus, Monitor, Moon, RotateCcw, Sun, Trash2 } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { BackgroundFocus } from "../../appearance/backgroundFocus";
import type { BackgroundFit, ColorPreset, ResolvedTheme, ThemeMode } from "../../appearance/appearance";
import { defaultAppearancePreferences } from "../../appearance/appearance";
import { BackgroundImage } from "./BackgroundImage";
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
  backgroundMask: number; backgroundBlur: number; backgroundBusy: boolean; backgroundError: string | null; readabilityWarnings: string[];
  onThemeModeChange(themeMode: ThemeMode): void; onAccentColorChange(color: string | null): void; onCanvasColorChange(color: string | null): void;
  onAssistantBubbleColorChange(color: string | null): void; onAssistantBubbleTransparencyChange(value: number): void; onEditBackgroundFocus(): void;
  onUnifiedTransparencyChange(value: number | null): void; onSidebarTransparencyChange(value: number): void; onComposerTransparencyChange(value: number): void;
  onBackgroundFitChange(fit: BackgroundFit): void; onBackgroundMaskChange(mask: number): void; onBackgroundBlurChange(blur: number): void;
  onSelectBackground(): Promise<void> | void; onRemoveBackground(): Promise<void> | void; onResetCustomAppearance(): Promise<void> | void;
}

export function AppearanceSettings({
  unifiedThemeColor, effectiveUserBubbleColor, onUnifiedThemeColorChange, onUserBubbleColorChange,
  colorPreset, onColorPresetChange,
  themeMode, resolvedTheme, accentColor, canvasColor, assistantBubbleColor, assistantBubbleTransparency,
  unifiedTransparency, sidebarTransparency, composerTransparency,
  effectiveAccentColor, effectiveCanvasColor, backgroundReference, backgroundUrl, backgroundFocus, backgroundFit,
  backgroundMask, backgroundBlur, backgroundBusy, backgroundError, readabilityWarnings, onThemeModeChange,
  onAccentColorChange, onCanvasColorChange, onAssistantBubbleColorChange, onAssistantBubbleTransparencyChange,
  onUnifiedTransparencyChange, onSidebarTransparencyChange, onComposerTransparencyChange,
  onEditBackgroundFocus, onBackgroundFitChange, onBackgroundMaskChange, onBackgroundBlurChange, onSelectBackground,
  onRemoveBackground, onResetCustomAppearance,
}: AppearanceSettingsProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewScale, setPreviewScale] = useState(0);
  useLayoutEffect(() => {
    const element = previewRef.current;
    if (!element) return;
    const update = () => setPreviewScale(element.clientWidth / 1920);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const mixedTransparency = sidebarTransparency !== composerTransparency || sidebarTransparency !== assistantBubbleTransparency;
  const mixedThemeColor = effectiveAccentColor !== effectiveUserBubbleColor;
  const readingSelected = themeMode === "light" && colorPreset === "reading";
  return <section className="settings-page settings-workspace-page appearance-settings-page" aria-labelledby="appearance-title">
    <div className="settings-page-heading"><h2 id="appearance-title">外观</h2><p className="muted-text">选择 Ayase Studio 在这台设备上的显示方式。</p></div>

    <div className="appearance-layout">
    <div className="appearance-preview-column">
    <p className="appearance-preview-caption">1920 × 1080 · 16:9 等比预览 · {backgroundReference ? "本地背景已应用" : "当前使用纯色画布"}</p>
    <div ref={previewRef} aria-label="聊天界面预览" className="appearance-background-preview" data-has-image={backgroundReference ? "true" : undefined}>
      <div className="appearance-preview-stage" style={{ transform: `scale(${previewScale})` }}>
        <div className="appearance-background-art"><BackgroundImage url={backgroundUrl} focus={backgroundFocus} fit={backgroundFit} aspectRatio={16 / 9} /></div>{backgroundUrl && <div className="appearance-background-preview-mask" />}
        <div className="appearance-preview-rail" aria-hidden="true"><strong>A</strong><span>聊天</span><span>设置</span></div>
        <div className="appearance-preview-titlebar"><span>☰</span><strong>今天的阅读笔记</strong><span>−　□　×</span></div>
        <div className="appearance-background-preview-content">
          <aside className="appearance-preview-sidebar" aria-label="助手侧栏预览"><strong>助手</strong><span>✦ 默认助手</span><span>◇ 写作助手</span></aside>
          <aside className="appearance-preview-sidebar" aria-label="对话侧栏预览"><strong>对话</strong><span>今天的阅读笔记</span><span>新的对话</span></aside>
          <div className="appearance-preview-chat"><div className="user-message user-bubble-preview">帮我整理一下今天的阅读笔记。</div><div className="assistant-message assistant-bubble-preview"><strong>这是一条助手回复</strong><p>我整理了三个重点，方便稍后回顾。</p><p>先确定阅读主题，再记录核心观点和支持它的证据，最后留下值得继续思考的问题。</p></div><div className="appearance-preview-composer composer-frame"><span>发送消息…</span><div className="appearance-preview-tools">＋　⌕　✦　选择模型 <span>➤</span></div></div></div>
        </div>
      </div>
      </div>

    </div>
    <div className="appearance-controls">
    <div className="appearance-group appearance-group-card">
    <fieldset className="appearance-theme-group">
      <legend>主题模式</legend>
      <div className="appearance-theme-options">
        {themeOptions.map((option) => <label className="appearance-theme-option" data-selected={!readingSelected && themeMode === option.value ? "true" : undefined} key={option.value} title={option.description}>
          <input type="radio" name="theme-mode" value={option.value} checked={!readingSelected && themeMode === option.value} onChange={() => { if (colorPreset === "reading") onColorPresetChange("default"); onThemeModeChange(option.value); }} />
          <span aria-hidden="true">{option.icon}</span><span>{option.label}</span>
        </label>)}
        <label className="appearance-theme-option" data-selected={readingSelected ? "true" : undefined} title="使用浅色阅读配色，重置自定义颜色，保留背景图片和透明度。">
          <input type="radio" name="theme-mode" value="reading" checked={readingSelected} onChange={() => { onColorPresetChange("reading"); onThemeModeChange("light"); }} />
          <span aria-hidden="true"><BookOpen size={16} /></span><span>阅读</span>
        </label>
      </div>
    </fieldset>
    </div>

    <section className="appearance-group appearance-group-card" aria-labelledby="appearance-colors-title">
      <GroupHeading id="appearance-colors-title" title="自定义配色">统一主题色仅覆盖组件和用户消息气泡；助手气泡与画布背景独立设置。</GroupHeading>
      <div className="appearance-rows">
        <div className="appearance-row"><span className="appearance-row-copy"><strong>统一主题色</strong>{mixedThemeColor && <span className="appearance-mixed-indicator"><span>已分别调整</span><span className="appearance-mixed-help"><SettingsHelp label="主题色差异" icon={<CircleAlert size={15} aria-hidden="true" />}>组件和用户消息气泡颜色不同。修改统一主题色会覆盖这两项，不影响助手气泡和画布背景。</SettingsHelp></span></span>}</span><ColorControl label="统一主题色" value={mixedThemeColor ? unifiedThemeColor ?? effectiveAccentColor : effectiveAccentColor} onChange={onUnifiedThemeColorChange} /></div>
        <div className="appearance-row appearance-color-child"><RowCopy title="组件颜色" /><ColorControl label="组件颜色" value={accentColor ?? effectiveAccentColor} onChange={onAccentColorChange} /></div>
        <div className="appearance-row appearance-color-child"><RowCopy title="用户消息气泡颜色" /><ColorControl label="用户消息气泡颜色" value={effectiveUserBubbleColor} onChange={onUserBubbleColorChange} /></div>
        <div className="appearance-row"><RowCopy title="助手消息气泡颜色" /><ColorControl label="助手回复气泡颜色" value={assistantBubbleColor ?? (resolvedTheme === "dark" ? "#292524" : colorPreset === "reading" ? "#f0f0ed" : "#f2f2f2")} onChange={onAssistantBubbleColorChange} /></div>
        <div className="appearance-row"><RowCopy title="画布背景色" /><ColorControl label="自定义画布背景色" value={canvasColor ?? effectiveCanvasColor} onChange={onCanvasColorChange} /></div>
      </div>
      {readabilityWarnings.map((warning) => <p className="notice notice-warning appearance-inline-notice" key={warning}>{warning}</p>)}
    </section>

    <section className="appearance-group appearance-group-card" aria-labelledby="appearance-transparency-title">
      <GroupHeading id="appearance-transparency-title" title="区域透明度">只改变区域背景，文字和操作控件保持清晰。</GroupHeading>
      <div className="appearance-rows">
        <div className="appearance-row appearance-range-row"><span className="appearance-row-copy"><strong>统一透明度</strong>{mixedTransparency && <span className="appearance-mixed-indicator"><span>已分别调整</span><span className="appearance-mixed-help"><SettingsHelp label="区域透明度差异" icon={<CircleAlert size={15} aria-hidden="true" />}>各区域透明度不同，调整统一滑块将覆盖三个区域的设置。</SettingsHelp></span></span>}</span><RangeControl value={mixedTransparency ? "各项不同" : `${unifiedTransparency}%`} ariaLabel="统一透明度" valueNumber={unifiedTransparency} onChange={onUnifiedTransparencyChange} onReset={() => onUnifiedTransparencyChange(null)} max="100" min="0" /></div>
        <div className="appearance-row appearance-range-row"><RowCopy title="侧栏透明度" /><RangeControl value={`${sidebarTransparency}%`} ariaLabel="侧栏透明度" valueNumber={sidebarTransparency} onChange={onSidebarTransparencyChange} onReset={() => onSidebarTransparencyChange(defaultAppearancePreferences.sidebarTransparency)} max="100" min="0" /></div>
        <div className="appearance-row appearance-range-row"><RowCopy title="输入区域透明度" /><RangeControl value={`${composerTransparency}%`} ariaLabel="输入区域透明度" valueNumber={composerTransparency} onChange={onComposerTransparencyChange} onReset={() => onComposerTransparencyChange(defaultAppearancePreferences.composerTransparency)} max="100" min="0" /></div>
        <div className="appearance-row appearance-range-row"><RowCopy title="消息气泡透明度" /><RangeControl value={`${assistantBubbleTransparency}%`} ariaLabel="消息气泡透明度" valueNumber={assistantBubbleTransparency} onChange={onAssistantBubbleTransparencyChange} onReset={() => onAssistantBubbleTransparencyChange(defaultAppearancePreferences.assistantBubbleTransparency)} max="100" min="0" /></div>
      </div>
    </section>

    <section className="appearance-group appearance-group-card" aria-labelledby="appearance-background-title">
      <GroupHeading id="appearance-background-title" title="聊天背景">图片仅保存在本机，不上传。支持 PNG、JPEG、WebP，最大 20 MB；替换或移除不会删除原文件。</GroupHeading>
      <div className="appearance-background-actions">
        <button className="settings-button settings-button-primary" disabled={backgroundBusy} onClick={() => void onSelectBackground()} type="button"><ImagePlus size={16} />{backgroundReference ? "替换本地图片" : "选择本地图片"}</button>
        {backgroundReference && <button className="settings-button" disabled={backgroundBusy || !backgroundUrl} onClick={onEditBackgroundFocus} type="button">调整取景中心</button>}
        {backgroundReference && <button className="settings-button settings-button-danger" disabled={backgroundBusy} onClick={() => void onRemoveBackground()} type="button"><Trash2 size={15} />移除背景</button>}
      </div>
      <div className="appearance-rows appearance-background-rows">
        <label className="appearance-row"><RowCopy title="图片适配方式" /><select className="field" disabled={!backgroundReference || backgroundBusy} value={backgroundFit} onChange={(event) => onBackgroundFitChange(event.currentTarget.value as BackgroundFit)}><option value="cover">填充</option><option value="contain">适应</option></select></label>
        <div className="appearance-row appearance-range-row"><RowCopy title="遮罩强度" /><RangeControl value={`${backgroundMask}%`} ariaLabel="背景遮罩强度" valueNumber={backgroundMask} onChange={onBackgroundMaskChange} onReset={() => onBackgroundMaskChange(defaultAppearancePreferences.backgroundMask)} disabled={!backgroundReference || backgroundBusy} max="90" min="35" /></div>
        <div className="appearance-row appearance-range-row"><RowCopy title="模糊程度" /><RangeControl value={`${backgroundBlur}px`} ariaLabel="背景模糊程度" valueNumber={backgroundBlur} onChange={onBackgroundBlurChange} onReset={() => onBackgroundBlurChange(defaultAppearancePreferences.backgroundBlur)} disabled={!backgroundReference || backgroundBusy} max="32" min="0" /></div>
      </div>
      {backgroundError && <p className="notice notice-warning appearance-inline-notice" role="alert">{backgroundError}</p>}
    </section>

    <section className="appearance-group appearance-group-card appearance-reset-group" aria-labelledby="appearance-reset-title">
      <GroupHeading id="appearance-reset-title" title="恢复默认">恢复当前主题的默认颜色、各区域透明度和背景设置，不删除原始图片文件。</GroupHeading>
      <button className="settings-button" disabled={backgroundBusy} onClick={() => void onResetCustomAppearance()} type="button"><RotateCcw size={15} />恢复当前主题默认外观</button>
    </section>
    </div>
    </div>
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

function RangeControl({ ariaLabel, disabled, max, min, onChange, onReset, value, valueNumber }: { ariaLabel: string; disabled?: boolean; max: string; min: string; onChange(value: number): void; onReset(): void; value: string; valueNumber: number }) {
  const resetLabel = ariaLabel === "统一透明度" ? "恢复各区域默认透明度" : `恢复${ariaLabel}默认值`;
  return <span className="appearance-range-actions"><span className="appearance-range-control"><output>{value}</output><input aria-label={ariaLabel} disabled={disabled} max={max} min={min} step="1" type="range" value={valueNumber} onChange={(event) => onChange(Number(event.currentTarget.value))} /></span><button className="settings-button appearance-color-reset" type="button" disabled={disabled} title={resetLabel} aria-label={resetLabel} onClick={onReset}><RotateCcw size={15} aria-hidden="true" /></button></span>;
}
