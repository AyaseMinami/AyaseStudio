import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type {} from "mdast-util-to-hast";
import { addConnection, addModel, createProviderFromTemplate, deleteConnection, deleteModel, deleteProvider, getActiveTarget, getDrawingModels, moveConnection, moveProvider, renameProvider, updateConnection, updateModel, type ConnectionSettingsState } from "../../src/chat/settings";
import { defaultSessionConfig } from "../../src/chat/sessionConfig";
import { getThinkingSettings, withThinkingSettings } from "../../src/chat/thinking";
import type { ChatProtocol } from "../../src/chat/types";
import type { ServiceProtocol } from "../../src/chat/protocolOptions";
import type { StoredChatMessage } from "../../src/chat/repository";
import type { GenerationMetrics } from "../../src/chat/generationMetrics";
import { initialDrawingDraft, type DrawingDraft } from "../../src/drawing/types";
import type { DrawingPromptPreset } from "../../src/drawing/presets";
import type { BackgroundFit } from "../../src/appearance/appearance";
import { ConnectionSettings } from "../../src/ui/settings/ConnectionSettings";
import { NetworkSearchSettings } from "../../src/ui/settings/NetworkSearchSettings";
import { BackgroundDisplayControls } from "../../src/ui/settings/BackgroundDisplayControls";
import { DrawingWorkspace } from "../../src/ui/drawing/DrawingWorkspace";
import { GenerationStats } from "../../src/ui/chat/GenerationStats";
import { SessionConfigPanel } from "../../src/ui/chat/SessionConfigPanel";
import { ModelSelectField } from "../../src/ui/chat/ModelSelectField";
import { WebSearchControl } from "../../src/ui/chat/WebSearchControl";
import { ThinkingControl, ThinkingToolbarControl } from "../../src/ui/chat/ThinkingControl";
import { SelectField } from "../../src/ui/SelectField";
import { SearchSelectField } from "../../src/ui/SearchSelectField";
import "../../src/App.css";
import "../../src/ui/chat/AssistantConfig.css";
import "../../src/ui/settings/AppearanceSettings.css";
import "./fixture.css";

const chatProtocols: ChatProtocol[] = ["openai-chat", "openai-responses", "gemini-native", "anthropic-native"];
const drawingProtocols: ServiceProtocol[] = ["gemini-image", "openai-images", "grok-images", "seedream-images"];
const allProtocols = [...chatProtocols, ...drawingProtocols];
const initialSettings: ConnectionSettingsState = {
  version: 3, activeModelId: "chat-0-0", providers: [{ id: "synthetic-provider", name: "隔离合成供应商（长名称分组）", connections: allProtocols.map((protocol, index) => ({
    id: `connection-${index}`, name: `${protocol} · 用于完整连接名称与搜索验证的合成专线`, protocol,
    baseUrl: "https://synthetic.invalid/v1", apiKey: "synthetic-only",
    models: Array.from({ length: index < 4 ? 5 : 3 }, (_, model) => ({
      id: `${index < 4 ? "chat" : "drawing"}-${index}-${model}`, modelId: `synthetic-${protocol}-${model}`,
      displayName: `${protocol} 模型 ${model + 1} · 长名称用于检验完整标签换行与当前选项展示`,
    })),
  })) }],
};
const metrics: GenerationMetrics = { version: 1, protocol: "openai-chat", streaming: true, status: "complete", elapsedMs: 2450,
  firstTextMs: 800, firstThinkingMs: 300, usageComplete: true, usage: { inputTokens: 1200, outputTokens: 300, totalTokens: 1500, cacheReadTokens: 800 } };
const messages: StoredChatMessage[] = Array.from({ length: 5 }, (_, index) => ({ id: `reply-${index}`, role: "assistant", status: "complete", content: `合成回复 ${index + 1}`,
  generationMetrics: Array.from({ length: 3 }, (_, invocation) => ({ ...metrics, elapsedMs: metrics.elapsedMs + invocation * 150, status: invocation === 0 ? "paused" : "complete" })),
}));
const initialPresets: DrawingPromptPreset[] = Array.from({ length: 8 }, (_, index) => ({ id: `preset-${index}`, name: `合成提示词预设 ${index + 1} · 清晨森林湖泊与远景山峰的长名称完整展示`,
  content: `合成场景 ${index + 1}：清晨的山谷湖泊。`, createdAt: "2026-10-03T00:00:00Z", updatedAt: "2026-10-03T00:00:00Z" }));
const no = () => undefined;
const pages = ["连接配置", "网络搜索", "背景适配", "绘图参数", "生成统计", "助手配置", "对话配置", "原生对话框"] as const;
type Page = typeof pages[number];

function NativeDialogFixture() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [short, setShort] = useState("first"), [long, setLong] = useState("long-1");
  const options = Array.from({ length: 20 }, (_, index) => ({ value: `long-${index}`, label: `长标签 ${index + 1} · 用于确认原生 dialog 顶层中的搜索与完整文本展示`, group: index < 10 ? "第一组" : "第二组" }));
  return <section className="select116-card"><h2>原生 HTML dialog 内的选择器</h2>
    <button className="settings-button" onClick={() => dialog.current?.showModal()}>打开原生对话框</button>
    <dialog ref={dialog} className="select116-native-dialog" aria-label="原生对话框选择器验收">
      <h2>原生对话框选择器验收</h2><p>短列表与搜索选择器应出现在此对话框内。</p>
      <SelectField label="对话框短列表" value={short} onChange={setShort} options={[{ value: "first", label: "第一项" }, { value: "second", label: "第二项" }, { value: "disabled", label: "禁用项", disabled: true }]} />
      <SearchSelectField label="对话框长列表" value={long} onChange={setLong} options={options} />
      <button className="settings-button" onClick={() => dialog.current?.close()}>关闭原生对话框</button>
    </dialog>
  </section>;
}

function Fixture() {
  const toolbar = useRef<HTMLElement>(null);
  const [page, setPage] = useState<Page>("连接配置"), [theme, setTheme] = useState("light"), [disabled, setDisabled] = useState(false);
  const [settings, setSettings] = useState(initialSettings);
  const [modelId, setModelId] = useState<string | null>("chat-0-0");
  const [config, setConfig] = useState(defaultSessionConfig);
  const [name, setName] = useState("合成助手与对话");
  const [fit, setFit] = useState<BackgroundFit>("cover"), [mask, setMask] = useState(65), [blur, setBlur] = useState(0);
  const [draft, setDraft] = useState<DrawingDraft>({ ...initialDrawingDraft, modelId: "drawing-4-0", prompt: "清晨的山谷湖泊（合成验收）", completionSound: false });
  const [presets, setPresets] = useState(initialPresets), [notice, setNotice] = useState<string | null>(null);
  const target = getActiveTarget({ ...settings, activeModelId: modelId });
  const protocol = target?.connection.protocol as ChatProtocol | undefined;
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    const observer = new ResizeObserver(() => document.documentElement.style.setProperty("--fixture-toolbar-height", `${toolbar.current?.getBoundingClientRect().height ?? 88}px`));
    if (toolbar.current) observer.observe(toolbar.current);
    return () => observer.disconnect();
  }, []);
  const chatPanel = page === "助手配置" || page === "对话配置";
  const assistant = page === "助手配置";
  const scope = assistant ? "assistant" : "conversation";
  return <div className="select116-shell"><header className="select116-toolbar" ref={toolbar}>
    <strong>#116 隔离验收</strong>
    {pages.map(item => <button className="settings-button" key={item} aria-pressed={page === item} onClick={() => setPage(item)}>{item}</button>)}
    <button className="settings-button" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>主题：{theme === "light" ? "浅色" : "深色"}</button>
    <button className="settings-button" aria-pressed={disabled} onClick={() => setDisabled(!disabled)}>禁用：{disabled ? "是" : "否"}</button>
    {(chatPanel || page === "生成统计") && chatProtocols.map((item, index) => <button className="settings-button" key={item} aria-pressed={protocol === item} onClick={() => setModelId(`chat-${index}-0`)}>{item}</button>)}
    <p>真实组件／合成长标签／仅内存数据。选择、保存与测试均不触发供应商或原生请求；浅深主题与小窗口分别验收。</p>
  </header><main className="select116-content">
    {page === "连接配置" && <ConnectionSettings connectionSettings={settings} isStreaming={disabled} modelCatalogs={{}} modelTests={{}}
      onAddConnection={(providerId, connectionName, connectionProtocol, copyFromConnectionId) => { const id = crypto.randomUUID(); setSettings(value => addConnection(value, providerId, { id, name: connectionName, protocol: connectionProtocol, copyFromConnectionId })); return id; }}
      onAddProvider={(templateId, providerName) => { const id = crypto.randomUUID(); setSettings(value => createProviderFromTemplate(value, templateId, { providerId: id, name: providerName, connectionIds: Object.fromEntries(allProtocols.map(item => [item, crypto.randomUUID()])) })); return id; }}
      onAddModel={(id, actual, displayName) => { const key = crypto.randomUUID(); setSettings(value => addModel(value, id, { id: key, modelId: actual, displayName })); return key; }}
      onConnectionChange={(id, field, value) => setSettings(previous => updateConnection(previous, id, field, value))}
      onDeleteConnection={id => setSettings(value => deleteConnection(value, id))} onDeleteModel={id => setSettings(value => deleteModel(value, id))}
      onDeleteProvider={id => setSettings(value => deleteProvider(value, id))} onModelChange={(id, field, value) => setSettings(previous => updateModel(previous, id, field, value))}
      onProviderRename={(id, value) => setSettings(previous => renameProvider(previous, id, value))}
      onProviderMove={(id, targetId, placement) => setSettings(value => moveProvider(value, id, targetId, placement))}
      onConnectionMove={(id, targetId, placement) => setSettings(value => moveConnection(value, id, targetId, placement))}
      onCancelModelCatalogRefresh={no} onCancelModelTest={no} onRefreshModelCatalog={async () => {}} onRunModelTest={async () => {}} onSelectModel={setModelId} />}
    {page === "网络搜索" && <NetworkSearchSettings />}
    {page === "背景适配" && <section className="select116-card"><h2>背景显示</h2><BackgroundDisplayControls fit={fit} mask={mask} blur={blur} disabled={disabled} onFitChange={setFit} onMaskChange={setMask} onBlurChange={setBlur} /></section>}
    {page === "绘图参数" && <div className="select116-drawing"><DrawingWorkspace draft={draft} onDraftChange={setDraft} onConfigure={() => setPage("连接配置")}
      models={getDrawingModels(settings)} tasks={[]} results={[]} selectedResultId={null} previewUrl={null} previewError={null} ready busy={disabled} error={null}
      onGenerate={() => setNotice("隔离验收：未发送生成请求。")} onCancel={no} onPause={no} onResume={no} onSelectResult={no} onExport={no} onRetrySave={no} onReuse={no}
      onAddReferences={no} onRemoveReference={no} onMoveReference={no} onUseAsReference={no} readReference={async () => ({ mime: "image/png", data: "AQ==" })} referencesBusy={false}
      presets={presets} onApplyPreset={id => setDraft(value => ({ ...value, prompt: presets.find(preset => preset.id === id)?.content ?? value.prompt }))}
      onCreatePreset={async input => { setPresets(value => [...value, { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]); return true; }}
      onUpdatePreset={async (id, input) => { setPresets(value => value.map(preset => preset.id === id ? { ...preset, ...input } : preset)); return true; }}
      onDeletePreset={async id => { setPresets(value => value.filter(preset => preset.id !== id)); return true; }} onOpenOutputDirectory={async () => { setNotice("隔离验收：未打开原生目录。"); }} notice={notice} /></div>}
    {page === "生成统计" && <section className="select116-card"><h2>玻璃输入框、思考工具栏与生成统计</h2><p>思考弹层内的力度选择器需保持定位正确；展开统计后检查回复与请求选择器。</p>
      <footer className="composer-footer select116-composer"><div className="composer-width"><div className="composer-frame">
        <textarea className="composer-input" aria-label="合成聊天输入" placeholder="隔离玻璃输入框，用于选择器定位验收" />
        <div className="composer-toolbar"><ThinkingToolbarControl protocol={protocol ?? "openai-chat"} model={target?.model.modelId ?? ""}
          value={getThinkingSettings(config, protocol ?? "openai-chat")} disabled={disabled} hint="隔离草稿" scope="当前会话"
          onChange={value => setConfig(previous => withThinkingSettings(previous, protocol ?? "openai-chat", value))} /></div>
      </div><GenerationStats messages={messages} /></div></footer>
    </section>}
    {chatPanel && <SessionConfigPanel key={scope} presentation="modal" title={page} description="隔离配置草稿，不保存真实配置。" disabled={disabled}
      config={config} errors={{}} protocol={protocol} model={target?.model.modelId ?? ""} onChange={setConfig} onReset={() => setConfig(defaultSessionConfig())} onClose={() => setPage("连接配置")}
      footer={<button className="settings-button" onClick={() => setPage("连接配置")}>完成验收</button>}>
      <section className={`session-config-section ${scope}-config-basics`}><h3>{assistant ? "基本信息" : "对话信息"}</h3>
        <div className={assistant ? "assistant-config-identity" : undefined}><div className={assistant ? "assistant-config-name" : undefined}>
          <label htmlFor={assistant ? "assistant-name" : "conversation-title"}>{assistant ? "助手名称" : "对话标题"}</label><div className={assistant ? "assistant-identity-row" : undefined}><input id={assistant ? "assistant-name" : "conversation-title"} value={name} onChange={event => setName(event.target.value)} /></div>
        </div></div>
      </section>
      <section className={`session-config-section ${scope}-config-model`}><h3>模型与能力</h3><label htmlFor={`${scope}-model`}>{assistant ? "默认模型 / 连接" : "当前对话模型 / 连接"}</label>
        <ModelSelectField id={`${scope}-model`} label={assistant ? "默认模型 / 连接" : "当前对话模型 / 连接"} settings={settings} selectedModelId={modelId} disabled={disabled} hint="隔离配置草稿" onSelect={async id => { setModelId(id || null); return true; }} />
        <div className="session-config-capabilities"><WebSearchControl config={config} disabled={disabled} customSelect onChange={setConfig} />
          {protocol && <ThinkingControl key={protocol} protocol={protocol} model={target?.model.modelId ?? ""} value={getThinkingSettings(config, protocol)} disabled={disabled} hint="" scope={assistant ? "当前助手" : "当前会话"} onChange={value => setConfig(previous => withThinkingSettings(previous, protocol, value))} />}
        </div>
      </section>
    </SessionConfigPanel>}
    {page === "原生对话框" && <NativeDialogFixture />}
  </main></div>;
}

// Only DOM assets load in this fixture; runtime API fetches are forbidden.
globalThis.fetch = async () => { throw Error("Network fetch is disabled in the select116 visual fixture."); };
document.documentElement.dataset.theme = "light";
document.documentElement.dataset.composerGlass = "true";
createRoot(document.getElementById("root")!).render(<Fixture />);
