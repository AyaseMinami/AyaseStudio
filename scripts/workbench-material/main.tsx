import { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { createAppearanceController } from "../../src/appearance/appearance";
import { initialDrawingDraft, type DrawingDraft, type DrawingImageInput, type DrawingParameters, type DrawingResult, type DrawingTask } from "../../src/drawing/types";
import type { ConnectionSettingsState } from "../../src/chat/settings";
import { AppShell, type AppPage } from "../../src/ui/AppShell";
import { SettingsWorkspace, type SettingsSection } from "../../src/ui/settings/SettingsWorkspace";
import type { AppearanceSettingsProps } from "../../src/ui/settings/AppearanceSettings";
import type { ConnectionSettingsProps } from "../../src/ui/settings/ConnectionSettings";
import { DrawingWorkspace } from "../../src/ui/drawing/DrawingWorkspace";
import { BackgroundImage } from "../../src/ui/settings/BackgroundImage";
import "../../src/App.css";
import "./trial.css";

// Only isolated sample data. Never mount production App or request a provider.
const wallpaper = "/.chat108.local/anime-opacity/wallpaper.png";
const noop = () => {};
const asyncNoop = async () => {};
const appearanceController = createAppearanceController({
  storage: { getItem: () => null, setItem: noop },
  systemTheme: { isDark: () => false, subscribe: () => noop }, target: document.documentElement,
});
appearanceController.setThemeMode("light");
const connections: ConnectionSettingsState = { version: 3, activeModelId: null, providers: [{ id: "sample-provider", name: "示例供应商", connections: [{
  id: "sample-connection", name: "日常聊天与阅读", protocol: "openai-chat", baseUrl: "https://synthetic.invalid/v1", apiKey: "",
  models: [{ id: "sample-model", modelId: "sample-model", displayName: "日常对话模型" }, { id: "sample-long", modelId: "sample-reasoning-model", displayName: "长名称示例 · 文档分析与资料整理" }],
}] }] };
const connectionProps: ConnectionSettingsProps = {
  connectionSettings: connections, isStreaming: false, modelCatalogs: {}, modelTests: {},
  onAddConnection: () => "unused", onAddProvider: () => "unused", onAddModel: () => "unused",
  onConnectionChange: noop, onCancelModelCatalogRefresh: noop, onCancelModelTest: noop,
  onDeleteConnection: noop, onDeleteModel: noop, onDeleteProvider: noop, onModelChange: noop,
  onProviderRename: noop, onProviderMove: noop, onConnectionMove: noop,
  onRefreshModelCatalog: asyncNoop, onRunModelTest: asyncNoop, onSelectModel: noop,
};
// Locally drawn original sample, independent of the wallpaper. No image editing.
const canvas = document.createElement("canvas"); canvas.width = 1024; canvas.height = 768;
const context = canvas.getContext("2d")!;
const sky = context.createLinearGradient(0, 0, 0, 768);
sky.addColorStop(0, "#738fb7"); sky.addColorStop(0.55, "#e6bdd1"); sky.addColorStop(1, "#e7ceb5");
context.fillStyle = sky; context.fillRect(0, 0, 1024, 768);
context.fillStyle = "#f8e3c5"; context.beginPath(); context.arc(740, 225, 72, 0, Math.PI * 2); context.fill();
for (let layer = 0; layer < 3; layer++) {
  context.fillStyle = ["#7f879d", "#606b82", "#424d65"][layer];
  context.beginPath(); context.moveTo(0, 768);
  for (let x = 0; x <= 1024; x += 32) context.lineTo(x, 470 + layer * 80 + Math.sin(x / 140 + layer) * 55);
  context.lineTo(1024, 768); context.closePath(); context.fill();
}
const previewUrl = canvas.toDataURL("image/png");
const sampleImage: DrawingImageInput = { mime: "image/png", data: previewUrl.split(",")[1] };
canvas.width = canvas.height = 0;
const parameters: DrawingParameters = { protocol: "gemini-image", prompt: "暮色山谷，柔和粉紫天空与暖色夕阳，远山层次清晰，安静的插画构图。",
  providerId: "sample-provider", connectionId: "sample-drawing", configuredModelId: "sample-image", modelId: "sample-image", modelName: "示例绘图模型",
  baseUrl: "https://synthetic.invalid", aspectRatio: "4:3", resolution: "1K" };
const createdAt = "2026-10-03T08:00:00.000Z";
const results: DrawingResult[] = [1, 2, 3].map(index => ({ id: `sample-result-${index}`, taskId: `sample-task-${index}`, createdAt,
  parameters, reference: `synthetic-${index}.png`, mime: "image/png", size: 10000, width: 1024, height: 768 }));
const tasks: DrawingTask[] = [1, 2, 3].map(index => ({ id: `sample-task-${index}`, createdAt, updatedAt: createdAt, status: "completed",
  parameters, startedAt: createdAt, finishedAt: "2026-10-03T08:00:18.000Z" }));
const readSample = async () => sampleImage;

function Review() {
  const [page, setPage] = useState<AppPage>("settings");
  const [section, setSection] = useState<SettingsSection>("appearance");
  const [variant, setVariant] = useState("production");
  const [background, setBackground] = useState(true);
  const appearance = useSyncExternalStore(appearanceController.subscribe, appearanceController.getSnapshot);
  const [draft, setDraft] = useState<DrawingDraft>({ ...initialDrawingDraft, modelId: "sample-image", prompt: parameters.prompt,
    aspectRatio: "4:3", resolution: "1K", count: 1, concurrency: 1, completionSound: false });
  const [selected, setSelected] = useState(results[0].id);
  const [status, setStatus] = useState("");
  useEffect(() => {
    document.documentElement.dataset.hasBackground = String(background);
    document.documentElement.dataset.workbenchTrial = variant;
  }, [background, variant, appearance]);
  const appearanceProps: AppearanceSettingsProps = {
    ...appearance, backgroundUrl: background ? wallpaper : null, backgroundEnabled: background,
    onThemeModeChange: appearanceController.setThemeMode, onColorPresetChange: appearanceController.setColorPreset,
    onUnifiedThemeColorChange: appearanceController.setUnifiedThemeColor, onUserBubbleColorChange: appearanceController.setUserBubbleColor,
    onAccentColorChange: appearanceController.setAccentColor, onCanvasColorChange: appearanceController.setCanvasColor,
    onAssistantBubbleColorChange: appearanceController.setAssistantBubbleColor, onAssistantBubbleTransparencyChange: appearanceController.setAssistantBubbleTransparency,
    onUnifiedTransparencyChange: appearanceController.setUnifiedTransparency, onChromeTransparencyChange: appearanceController.setChromeTransparency,
    onSidebarTransparencyChange: appearanceController.setSidebarTransparency, onComposerTransparencyChange: appearanceController.setComposerTransparency,
    onSidebarGlassEnabledChange: appearanceController.setSidebarGlassEnabled, onComposerGlassEnabledChange: appearanceController.setComposerGlassEnabled,
    onBackgroundFitChange: appearanceController.setBackgroundFit, onBackgroundMaskChange: appearanceController.setBackgroundMask,
    onBackgroundBlurChange: appearanceController.setBackgroundBlur, onEditBackgroundFocus: noop,
    onPrepareLibraryBackground: async () => null, onSaveLibraryBackground: async () => { throw Error("Fixture resource operations are disabled."); },
    onResolveLibraryBackground: async () => { throw Error("Fixture has no native resources."); },
    onDiscardLibraryBackground: asyncNoop, onApplyLibraryBackground: asyncNoop, onRemoveLibraryBackgrounds: asyncNoop,
    onRestoreBackground: asyncNoop, onRemoveBackground: asyncNoop, onResetCustomAppearance: appearanceController.resetCustomAppearance,
  };
  return <><AppShell activePage={page} onPageChange={next => setPage(next === "chat" ? "settings" : next)}
    background={background ? <BackgroundImage url={wallpaper} focus={null} fit="cover" blur={0} /> : undefined}>
    {page === "drawing" ? <DrawingWorkspace draft={draft} onDraftChange={setDraft} models={[{ id: "sample-image", label: "示例供应商 / 插画绘图模型", protocol: "gemini-image" }]}
      tasks={tasks} results={results} selectedResultId={selected} previewUrl={previewUrl} previewError={null}
      ready busy={false} error={null} referencesBusy={false} onConfigure={() => { setSection("connections"); setPage("settings"); }}
      onGenerate={() => setStatus("仅查看本地示例，不发送生成请求。")} onCancel={noop} onPause={noop} onResume={noop} onSelectResult={setSelected}
      onExport={noop} onRetrySave={noop} onReuse={() => setDraft(value => ({ ...value, prompt: parameters.prompt }))}
      onAddReferences={noop} onRemoveReference={noop} onMoveReference={noop} onUseAsReference={noop}
      readReference={readSample} readThumbnail={readSample} onOpenOutputDirectory={asyncNoop} />
      : <SettingsWorkspace activeSection={section} onSectionChange={setSection} appearance={appearanceProps} connection={connectionProps}
        avatar={{ value: undefined, url: undefined, busy: false, error: undefined, save: async () => true }} />}
    </AppShell>
    <details className="workbench-trial-controls"><summary>容器对照</summary><div>
      <label>版本<select aria-label="容器版本" value={variant} onChange={event => setVariant(event.target.value)}>
        <option value="baseline">改前样式</option><option value="solid">稳定底板</option><option value="subtle">轻透 7%</option><option value="airy">轻透 15%</option><option value="production">实际样式</option>
      </select></label>
      <label>主题<select aria-label="对照主题" value={appearance.resolvedTheme} onChange={event => appearanceController.setThemeMode(event.target.value === "dark" ? "dark" : "light")}>
        <option value="light">浅色</option><option value="dark">深色</option></select></label>
      <label>人物背景<input aria-label="人物背景" type="checkbox" checked={background} onChange={event => setBackground(event.target.checked)} /></label>
      <label>遮罩<select aria-label="对照遮罩" value={appearance.backgroundMask} onChange={event => appearanceController.setBackgroundMask(Number(event.target.value))}>
        <option value="65">65%</option><option value="45">45%</option></select></label>
      <p>真实组件，独立合成数据；背景沿用上一轮本地生成素材。所有生成、文件及服务请求禁用。</p>{status && <p role="status">{status}</p>}
    </div></details></>;
}
createRoot(document.getElementById("root")!).render(<Review />);
