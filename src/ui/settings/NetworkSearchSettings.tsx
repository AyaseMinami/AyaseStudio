import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, RotateCcw, X } from "lucide-react";
import { defaultSearchConfiguration, loadSearchConfiguration, saveSearchConfiguration, searchProfileKeys, searchProviderNames, validateSearchSettings, validateTavilySettings, validateZhipuSettings, type SearchProfile, type SearchConfiguration, type ExternalSearchProvider } from "../../search/settings";
import { searchExa } from "../../search/runtime";
import { validateExaApiSettings } from "../../search/exaApi";
import { validateTavilyApiSettings } from "../../search/tavily";
import { validateZhipuApiSettings } from "../../search/zhipu";
import { openExternal } from "../../chat/externalLinks";
import type { SearchRecord } from "../../chat/nativeSearch";
import { SearchResults } from "../chat/SearchResults";
import { SettingsHelp } from "./SettingsHelp";
import { SelectField } from "../SelectField";
import "./NetworkSearchSettings.css";

const TEST_QUERY = "What is the Exa search API?";
const PROVIDER_TEST_QUERY = "上海今天的天气";

function SearchProfileCard({ provider, initial, onSave }: {
  provider: ExternalSearchProvider; initial: SearchProfile; onSave(settings: SearchProfile): SearchProfile;
}) {
  const [draft, setDraft] = useState(initial);
  const [numResults, setNumResults] = useState(String(initial.numResults));
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [test, setTest] = useState<SearchRecord>();
  const request = useRef<AbortController | null>(null);
  const saveInProgress = useRef(false);
  const mounted = useRef(false);
  const name = searchProviderNames[provider];
  const api = provider === "exa-api";
  const additional = provider === "tavily" || provider === "zhipu";
  const keyRequired = api || ("enabled" in draft && draft.enabled);
  const testQuery = additional ? PROVIDER_TEST_QUERY : TEST_QUERY;
  const id = provider;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); request.current = null; };
  }, []);

  function snapshot(forTest = false): SearchProfile | undefined {
    try {
      const candidate = { ...draft, numResults: Number(numResults) };
      if (provider === "tavily") {
        const settings = validateTavilySettings(candidate);
        return forTest || settings.enabled ? validateTavilyApiSettings(settings) : settings;
      }
      if (provider === "zhipu") {
        const settings = validateZhipuSettings(candidate);
        return forTest || settings.enabled ? validateZhipuApiSettings(settings) : settings;
      }
      return api ? validateExaApiSettings(candidate) : validateSearchSettings(candidate);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "请检查搜索设置。");
      return undefined;
    }
  }
  async function save() {
    if (saveInProgress.current || request.current) return;
    setError(""); setFeedback("");
    const settings = snapshot();
    if (!settings) return;
    saveInProgress.current = true; setSaving(true);
    try {
      const saved = onSave(settings);
      if (!mounted.current) return;
      setDraft(saved); setNumResults(String(saved.numResults)); setFeedback("搜索设置已保存，下次搜索生效。");
    } catch {
      if (mounted.current) setError("保存失败，草稿已保留，请重试。");
    } finally { saveInProgress.current = false; if (mounted.current) setSaving(false); }
  }
  async function runTest() {
    if (saveInProgress.current || request.current) return;
    setError(""); setFeedback("");
    const settings = snapshot(true);
    if (!settings) return;
    const controller = new AbortController(); request.current = controller;
    setTest({ enabled: true, provider, status: "searching", queries: [testQuery], sources: [], citations: [] });
    try {
      const result = await searchExa(settings, testQuery, controller.signal, provider);
      if (!mounted.current || request.current !== controller) return;
      setTest({ enabled: true, provider, status: "completed", queries: [testQuery], sources: result.sources, citations: [], warning: result.warning });
    } catch (cause) {
      if (!mounted.current || request.current !== controller) return;
      setTest({ enabled: true, provider, status: controller.signal.aborted ? "cancelled" : "failed",
        queries: [testQuery], sources: [], citations: [], error: controller.signal.aborted ? undefined
          : cause instanceof Error ? cause.message : "测试搜索失败，请检查地址、Key、网络或服务限流后重试。" });
    } finally { if (request.current === controller) request.current = null; }
  }
  function stopTest() {
    request.current?.abort(); request.current = null;
    setTest((current) => current ? { ...current, status: "cancelled", error: undefined } : current);
  }
  const testing = test?.status === "searching";
  const busy = saving || testing;
  function officialLink(url: string, label: string) {
    return <a href={url} target="_blank" rel="noopener noreferrer" onClick={(event) => {
      event.preventDefault();
      void openExternal(url).catch(() => { if (mounted.current) setError("无法打开链接，请复制链接后在浏览器中打开。"); });
    }}>{label}</a>;
  }
  return <section className="settings-card network-search-card" aria-labelledby={id + "-title"}>
    <header className="network-search-card-heading">
      <div className="network-search-service-title"><div className="settings-label-help"><h3 id={id + "-title"}>{name}</h3>
        <SettingsHelp label={name}>{`${additional ? `调用 ${name} 官方搜索 API，需要官方 API Key，费用按量计费。` : api ? "直接调用 Exa 搜索 API，需要 API Key。" : "通过 Exa MCP 搜索，Key 选填；匿名额度和限流由 Exa 决定。"}查询会发送给所配置的搜索服务。`}</SettingsHelp>
      </div><p className="network-search-service-description">{additional ? "启用并保存后，可在聊天中选择" : api ? "使用 API Key 连接 Exa 搜索" : "支持匿名搜索，也可填写独立 Key"}</p></div>
      {"enabled" in draft && <div className="settings-label-help">
        <label className="network-search-enable" htmlFor={id + "-enabled"}><input id={id + "-enabled"} type="checkbox" checked={draft.enabled} disabled={busy}
          onChange={(event) => { setDraft({ ...draft, enabled: event.target.checked }); setFeedback(""); }} />启用{name === "Tavily" ? " Tavily " : name}搜索</label>
        <SettingsHelp label={name + "启用"}>启用并保存后出现在聊天搜索菜单；关闭后保存即可隐藏。测试搜索也需要 API Key。</SettingsHelp>
      </div>}
    </header>
    <fieldset disabled={busy} className="network-search-fields">
      <legend className="network-search-section-label">连接信息</legend>
      <div className="network-search-row">
      <label className="field-label" htmlFor={id + "-base-url"}>服务地址</label>
      <div className="network-search-address">
      <input id={id + "-base-url"} className="field" type="url" value={draft.baseUrl} spellCheck={false}
        onChange={(event) => { setDraft({ ...draft, baseUrl: event.target.value }); setFeedback(""); }} />
      <button type="button" className="icon-button network-search-field-action" aria-label="恢复官方地址" title="恢复官方地址" onClick={() => {
        setDraft({ ...draft, baseUrl: defaultSearchConfiguration()[searchProfileKeys[provider]].baseUrl }); setFeedback("");
      }}><RotateCcw size={16} aria-hidden="true" /></button></div></div>
      <div className="network-search-row">
      <div className="settings-label-help"><label className="field-label" htmlFor={id + "-api-key"}>API Key</label>
        <SettingsHelp label={name + " API Key"}>{`${additional ? "启用或测试时必填。" : api ? "必填。" : "选填。"}此 Key 与聊天连接及其他搜索配置独立；${additional ? "关闭时可留空保存草稿。" : api ? "Exa API 不支持匿名方式。" : "留空使用匿名方式。"}当前在本机以明文保存，尚未加密。`}</SettingsHelp>
      </div>
      <div className="network-search-key">
        <input id={id + "-api-key"} className="field" type={showKey ? "text" : "password"} autoComplete="off" placeholder={additional ? "启用或测试时必填" : api ? "必填" : "选填，留空使用匿名搜索"} value={draft.apiKey} required={keyRequired}
          onChange={(event) => { setDraft({ ...draft, apiKey: event.target.value }); setFeedback(""); }} />
        <button type="button" className="icon-button" aria-label={showKey ? "隐藏 " + name + " Key" : "显示 " + name + " Key"} aria-pressed={showKey}
          onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}</button>
        <button type="button" className="icon-button network-search-field-action" aria-label="清空 Key" title="清空 Key" disabled={!draft.apiKey} onClick={() => { setDraft({ ...draft, apiKey: "" }); setFeedback(""); }}><X size={16} aria-hidden="true" /></button>
      </div>
      </div>
      <div className="network-search-options" role="group" aria-labelledby={id + "-options-title"}>
      <h4 className="network-search-section-label" id={id + "-options-title"}>搜索选项</h4>
      <div className="network-search-option network-search-result-option">
        <label className="field-label" htmlFor={id + "-num-results"}>结果数量</label>
        <input id={id + "-num-results"} className="field network-search-count" type="number" min="1" max="10" step="1" value={numResults}
          onChange={(event) => { setNumResults(event.target.value); setFeedback(""); }} />
        <span className="network-search-range">1–10 条</span>
      </div>
      {"searchDepth" in draft && <div className="network-search-option">
        <label className="field-label" htmlFor={id + "-search-depth"}>搜索深度</label>
        <SelectField id={id + "-search-depth"} label="搜索深度" value={draft.searchDepth} onChange={(value) => {
          if (value === "basic" || value === "advanced") setDraft({ ...draft, searchDepth: value });
          setFeedback("");
        }} options={[{ value: "basic", label: "Basic（1 credit/次）" }, { value: "advanced", label: "Advanced（2 credits/次）" }]} />
      </div>}
      {"searchEngine" in draft && <div className="network-search-option">
        <label className="field-label" htmlFor={id + "-search-engine"}>搜索引擎</label>
        <SelectField id={id + "-search-engine"} label="搜索引擎" value={draft.searchEngine} onChange={(searchEngine) => {
          if (searchEngine === "search_std" || searchEngine === "search_pro" || searchEngine === "search_pro_sogou" || searchEngine === "search_pro_quark") setDraft({ ...draft, searchEngine });
          setFeedback("");
        }} options={[{ value: "search_std", label: "search_std（¥0.01/次）" }, { value: "search_pro", label: "search_pro（¥0.03/次）" },
          { value: "search_pro_sogou", label: "search_pro_sogou（¥0.05/次）" }, { value: "search_pro_quark", label: "search_pro_quark（¥0.05/次）" }]} />
      </div>}
      </div>
      <div className="network-search-actions">
        <button type="button" className="settings-button settings-button-primary" onClick={() => void save()}>{saving ? "正在保存…" : "保存搜索设置"}</button>
        <button type="button" className="settings-button" onClick={() => void runTest()}>测试搜索</button>
        <SettingsHelp label={name + "测试搜索"}>{`测试使用本卡片当前草稿发送固定公开问题“${testQuery}”，不保存设置，也不使用聊天记录或附件。打开页面、切换启用与保存均不会联网。`}</SettingsHelp>
        {additional && <span className="network-search-test-notice">测试会消耗服务商额度或产生费用</span>}
      </div>
    </fieldset>
    {testing && <button type="button" className="settings-button" onClick={stopTest}>停止测试</button>}
    {provider === "tavily" && <div className="network-search-provider-info">
      <span className="settings-label-help">每月免费 1,000 credits<SettingsHelp label="Tavily 计费">按量付费 $0.008/credit。Basic 每次 1 credit（$8/1,000 次），Advanced 每次 2 credits（$16/1,000 次）。搜索深度由你选择，不会自动升级。</SettingsHelp></span>
      {officialLink("https://app.tavily.com", "获取 Tavily API Key")}{officialLink("https://docs.tavily.com/documentation/api-credits", "Tavily 官方计费说明")}
    </div>}
    {provider === "zhipu" && <div className="network-search-provider-info">
      <span className="settings-label-help">按量计费 · ¥0.01–0.05/次<SettingsHelp label="智谱计费与限制">search_std ¥0.01/次；search_pro ¥0.03/次；search_pro_sogou 与 search_pro_quark ¥0.05/次。Coding Plan 的 MCP 搜索与此处按量计费的搜索 API 分开，不代表包含本接口额度。搜索问题最多 70 个字符；Sogou 请求 10 条后按设置数量显示。</SettingsHelp></span>
      {officialLink("https://bigmodel.cn", "获取智谱 API Key")}{officialLink("https://docs.bigmodel.cn/cn/guide/tools/web-search", "智谱官方搜索文档")}
    </div>}
    {error && <p className="error-banner" role="alert">{error}</p>}
    {feedback && <p className="muted-text" role="status">{feedback}</p>}
    {test && <div aria-label={name + " 测试搜索结果"}><SearchResults search={test} showCitationNotice={false} /></div>}
  </section>;
}

export function NetworkSearchSettings() {
  const [initial, setInitial] = useState<SearchConfiguration>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [feedback, setFeedback] = useState("");
  const saved = useRef<SearchConfiguration>(defaultSearchConfiguration());
  const repairing = useRef(false);
  function load() {
    setLoadFailed(false);
    try {
      const configuration = loadSearchConfiguration();
      saved.current = configuration; repairing.current = false; setInitial(configuration);
    } catch { setLoadFailed(true); }
  }
  useEffect(() => {
    load();
  }, []);
  function saveProfile(provider: ExternalSearchProvider, settings: SearchProfile) {
    const key = searchProfileKeys[provider];
    const current = repairing.current ? saved.current : loadSearchConfiguration();
    const result = saveSearchConfiguration({ ...current, [key]: settings });
    saved.current = result; repairing.current = false;
    return result[key];
  }
  return <section className="settings-page network-search-page" aria-labelledby="network-search-title">
    <header className="settings-page-heading"><h2 id="network-search-title">网络搜索</h2><p className="muted-text">配置外部搜索服务，在聊天中选择使用。各服务独立保存；测试使用当前填写的内容，不会保存设置。</p></header>
    {!initial && !loadFailed && <p role="status">正在读取搜索设置…</p>}
    {loadFailed && <section className="settings-card network-search-card">
      <p className="error-banner" role="alert">无法读取搜索设置，请重试。</p>
      <div className="network-search-actions"><button type="button" className="settings-button" onClick={load}>重新读取设置</button>
        <button type="button" className="settings-button" onClick={() => {
          const defaults = defaultSearchConfiguration(); saved.current = defaults; repairing.current = true; setInitial(defaults); setLoadFailed(false);
          setFeedback("已载入默认草稿，原本机配置保持不变；首次保存后才以默认配置和已填写的卡片覆盖。");
        }}>使用默认设置编辑</button></div>
    </section>}
    {feedback && <p className="muted-text" role="status">{feedback}</p>}
    {initial && <div className="network-search-cards">
      <SearchProfileCard provider="exa-api" initial={initial.exaApi} onSave={(profile) => saveProfile("exa-api", profile)} />
      <SearchProfileCard provider="exa-mcp" initial={initial.exaMcp} onSave={(profile) => saveProfile("exa-mcp", profile)} />
      <SearchProfileCard provider="tavily" initial={initial.tavily} onSave={(profile) => saveProfile("tavily", profile)} />
      <SearchProfileCard provider="zhipu" initial={initial.zhipu} onSave={(profile) => saveProfile("zhipu", profile)} />
    </div>}
  </section>;
}
