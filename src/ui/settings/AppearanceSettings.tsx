import { CircleAlert, ImagePlus, Monitor, Moon, RotateCcw, Sun, Trash2 } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { BackgroundFocus } from "../../appearance/backgroundFocus";
import type { BackgroundFit, ResolvedTheme, ThemeMode } from "../../appearance/appearance";
import { BackgroundImage } from "./BackgroundImage";
import "./AppearanceSettings.css";
import { SettingsHelp } from "./SettingsHelp";

const themeOptions: readonly { value: ThemeMode; label: string; description: string; icon: ReactNode }[] = [
  { value: "system", label: "跟随系统", description: "自动匹配 Windows 当前的浅色或深色设置。", icon: <Monitor size={16} /> },
  { value: "light", label: "浅色", description: "始终使用明亮、清晰的界面配色。", icon: <Sun size={16} /> },
  { value: "dark", label: "深色", description: "始终使用低亮度的深色界面配色。", icon: <Moon size={16} /> },
];

export interface AppearanceSettingsProps {
  themeMode: ThemeMode; resolvedTheme: ResolvedTheme; accentColor: string | null; canvasColor: string | null;
  assistantBubbleColor: string | null; assistantBubbleTransparency: number; effectiveAccentColor: string; effectiveCanvasColor: string;
  unifiedTransparency: number; sidebarTransparency: number; composerTransparency: number;
  backgroundReference: string | null; backgroundUrl: string | null; backgroundFocus: BackgroundFocus | null; backgroundFit: BackgroundFit;
  backgroundMask: number; backgroundBlur: number; backgroundBusy: boolean; backgroundError: string | null; readabilityWarnings: string[];
  onThemeModeChange(themeMode: ThemeMode): void; onAccentColorChange(color: string | null): void; onCanvasColorChange(color: string | null): void;
  onAssistantBubbleColorChange(color: string | null): void; onAssistantBubbleTransparencyChange(value: number): void; onEditBackgroundFocus(): void;
  onUnifiedTransparencyChange(value: number): void; onSidebarTransparencyChange(value: number): void; onComposerTransparencyChange(value: number): void;
  onBackgroundFitChange(fit: BackgroundFit): void; onBackgroundMaskChange(mask: number): void; onBackgroundBlurChange(blur: number): void;
  onSelectBackground(): Promise<void> | void; onRemoveBackground(): Promise<void> | void; onResetCustomAppearance(): Promise<void> | void;
}

export function AppearanceSettings({
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
        {themeOptions.map((option) => <label className="appearance-theme-option" data-selected={themeMode === option.value ? "true" : undefined} key={option.value} title={option.description}>
          <input type="radio" name="theme-mode" value={option.value} checked={themeMode === option.value} onChange={() => onThemeModeChange(option.value)} />
          <span aria-hidden="true">{option.icon}</span><span>{option.label}</span>
        </label>)}
      </div>
    </fieldset>
    </div>

    <section className="appearance-group appearance-group-card" aria-labelledby="appearance-colors-title">
      <GroupHeading id="appearance-colors-title" title="自定义配色">用于主要按钮、选中提示和聊天画布。</GroupHeading>
      <div className="appearance-rows">
        <label className="appearance-row"><RowCopy title="强调色" /><input aria-label="自定义强调色" type="color" value={accentColor ?? effectiveAccentColor} onChange={(event) => onAccentColorChange(event.currentTarget.value)} /></label>
        <label className="appearance-row"><RowCopy title="画布背景色" /><input aria-label="自定义画布背景色" type="color" value={canvasColor ?? effectiveCanvasColor} onChange={(event) => onCanvasColorChange(event.currentTarget.value)} /></label>
      </div>
      {readabilityWarnings.map((warning) => <p className="notice notice-warning appearance-inline-notice" key={warning}>{warning}</p>)}
    </section>

    <section className="appearance-group appearance-group-card" aria-labelledby="appearance-bubble-title">
      <GroupHeading id="appearance-bubble-title" title="助手回复">助手气泡底色独立设置；用户气泡仍跟随强调色。</GroupHeading>
      <div className="appearance-rows">
        <label className="appearance-row"><RowCopy title="气泡背景色" /><input aria-label="助手回复气泡颜色" type="color" value={assistantBubbleColor ?? (resolvedTheme === "dark" ? "#292524" : "#f5f5f4")} onChange={(event) => onAssistantBubbleColorChange(event.currentTarget.value)} /></label>
      </div>
      <button className="settings-button appearance-secondary-action" type="button" disabled={!assistantBubbleColor} onClick={() => onAssistantBubbleColorChange(null)}>气泡颜色跟随主题</button>
    </section>

    <section className="appearance-group appearance-group-card" aria-labelledby="appearance-transparency-title">
      <GroupHeading id="appearance-transparency-title" title="区域透明度">只改变区域背景，文字和操作控件保持清晰。</GroupHeading>
      <div className="appearance-rows">
        <div className="appearance-row appearance-range-row"><span className="appearance-row-copy"><strong>统一透明度</strong>{mixedTransparency && <span className="appearance-mixed-indicator"><span>已分别调整</span><span className="appearance-mixed-help"><SettingsHelp label="区域透明度差异" icon={<CircleAlert size={15} aria-hidden="true" />}>各区域透明度不同，调整统一滑块将覆盖三个区域的设置。</SettingsHelp></span></span>}</span><RangeControl value={mixedTransparency ? "各项不同" : `${unifiedTransparency}%`} ariaLabel="统一透明度" valueNumber={unifiedTransparency} onChange={onUnifiedTransparencyChange} max="100" min="0" /></div>
        <label className="appearance-row appearance-range-row"><RowCopy title="侧栏透明度" /><RangeControl value={`${sidebarTransparency}%`} ariaLabel="侧栏透明度" valueNumber={sidebarTransparency} onChange={onSidebarTransparencyChange} max="100" min="0" /></label>
        <label className="appearance-row appearance-range-row"><RowCopy title="输入区域透明度" /><RangeControl value={`${composerTransparency}%`} ariaLabel="输入区域透明度" valueNumber={composerTransparency} onChange={onComposerTransparencyChange} max="100" min="0" /></label>
        <label className="appearance-row appearance-range-row"><RowCopy title="消息气泡透明度" /><RangeControl value={`${assistantBubbleTransparency}%`} ariaLabel="消息气泡透明度" valueNumber={assistantBubbleTransparency} onChange={onAssistantBubbleTransparencyChange} max="100" min="0" /></label>
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
        <label className="appearance-row appearance-range-row"><RowCopy title="遮罩强度" /><RangeControl value={`${backgroundMask}%`} ariaLabel="背景遮罩强度" valueNumber={backgroundMask} onChange={onBackgroundMaskChange} disabled={!backgroundReference || backgroundBusy} max="90" min="35" /></label>
        <label className="appearance-row appearance-range-row"><RowCopy title="模糊程度" /><RangeControl value={`${backgroundBlur}px`} ariaLabel="背景模糊程度" valueNumber={backgroundBlur} onChange={onBackgroundBlurChange} disabled={!backgroundReference || backgroundBusy} max="32" min="0" /></label>
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

function RangeControl({ ariaLabel, disabled, max, min, onChange, value, valueNumber }: { ariaLabel: string; disabled?: boolean; max: string; min: string; onChange(value: number): void; value: string; valueNumber: number }) {
  return <span className="appearance-range-control"><output>{value}</output><input aria-label={ariaLabel} disabled={disabled} max={max} min={min} step="1" type="range" value={valueNumber} onChange={(event) => onChange(Number(event.currentTarget.value))} /></span>;
}
