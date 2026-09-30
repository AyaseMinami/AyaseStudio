import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { defaultSearchConfiguration, loadSearchConfiguration, saveSearchConfiguration, validateSearchSettings, type SearchSettings, type SearchConfiguration, type ExternalSearchProvider } from "../../search/settings";
import { searchExa } from "../../search/runtime";
import { validateExaApiSettings } from "../../search/exaApi";
import type { SearchRecord } from "../../chat/nativeSearch";
import { SearchResults } from "../chat/SearchResults";
import "./NetworkSearchSettings.css";

const TEST_QUERY = "What is the Exa search API?";
const profileName = (provider: ExternalSearchProvider) => provider === "exa-api" ? "Exa API" : "Exa MCP";
const profileKey = (provider: ExternalSearchProvider) => provider === "exa-api" ? "exaApi" : "exaMcp";

function SearchProfileCard({ provider, initial, onSave }: {
  provider: ExternalSearchProvider; initial: SearchSettings; onSave(settings: SearchSettings): SearchSettings;
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
  const name = profileName(provider);
  const api = provider === "exa-api";
  const id = provider;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); request.current = null; };
  }, []);

  function snapshot(): SearchSettings | undefined {
    try {
      const candidate = { ...draft, numResults: Number(numResults) };
      const settings = api ? validateExaApiSettings(candidate) : validateSearchSettings(candidate);
      return settings;
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
    const settings = snapshot();
    if (!settings) return;
    const controller = new AbortController(); request.current = controller;
    setTest({ enabled: true, provider, status: "searching", queries: [TEST_QUERY], sources: [], citations: [] });
    try {
      const result = await searchExa(settings, TEST_QUERY, controller.signal, provider);
      if (!mounted.current || request.current !== controller) return;
      setTest({ enabled: true, provider, status: "completed", queries: [TEST_QUERY], sources: result.sources, citations: [], warning: result.warning });
    } catch (cause) {
      if (!mounted.current || request.current !== controller) return;
      setTest({ enabled: true, provider, status: controller.signal.aborted ? "cancelled" : "failed",
        queries: [TEST_QUERY], sources: [], citations: [], error: controller.signal.aborted ? undefined
          : cause instanceof Error ? cause.message : "测试搜索失败，请检查地址、Key、网络或服务限流后重试。" });
    } finally { if (request.current === controller) request.current = null; }
  }
  function stopTest() {
    request.current?.abort(); request.current = null;
    setTest((current) => current ? { ...current, status: "cancelled", error: undefined } : current);
  }
  const testing = test?.status === "searching";
  const busy = saving || testing;
  return <section className="settings-card network-search-card" aria-labelledby={id + "-title"}>
    <h3 id={id + "-title"}>{name}</h3>
    <p className="muted-text">{api ? "直接调用 Exa 搜索 API，需要 API Key。" : "通过 Exa MCP 搜索，Key 选填；匿名额度和限流由 Exa 决定。"}查询会发送给所配置的搜索服务。</p>
    <fieldset disabled={busy} className="network-search-fields">
      <label className="field-label" htmlFor={id + "-base-url"}>服务地址</label>
      <input id={id + "-base-url"} className="field" type="url" value={draft.baseUrl} spellCheck={false}
        onChange={(event) => { setDraft({ ...draft, baseUrl: event.target.value }); setFeedback(""); }} />
      <div><button type="button" className="settings-button" onClick={() => {
        setDraft({ ...draft, baseUrl: defaultSearchConfiguration()[profileKey(provider)].baseUrl }); setFeedback("");
      }}>恢复官方地址</button></div>
      <label className="field-label" htmlFor={id + "-api-key"}>搜索 API Key（{api ? "必填" : "选填"}）</label>
      <div className="network-search-key">
        <input id={id + "-api-key"} className="field" type={showKey ? "text" : "password"} autoComplete="off" value={draft.apiKey} required={api}
          onChange={(event) => { setDraft({ ...draft, apiKey: event.target.value }); setFeedback(""); }} />
        <button type="button" className="icon-button" aria-label={showKey ? "隐藏 " + name + " Key" : "显示 " + name + " Key"} aria-pressed={showKey}
          onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}</button>
        <button type="button" className="settings-button" disabled={!draft.apiKey} onClick={() => { setDraft({ ...draft, apiKey: "" }); setFeedback(""); }}>清空 Key</button>
      </div>
      <p className="field-hint">此 Key 与聊天连接及另一搜索配置独立；{api ? "Exa API 不支持匿名方式。" : "留空使用匿名方式。"}当前在本机以明文保存，尚未加密。</p>
      <label className="field-label" htmlFor={id + "-num-results"}>结果数量（1–10）</label>
      <input id={id + "-num-results"} className="field network-search-count" type="number" min="1" max="10" step="1" value={numResults}
        onChange={(event) => { setNumResults(event.target.value); setFeedback(""); }} />
      <div className="network-search-actions">
        <button type="button" className="settings-button" onClick={() => void save()}>{saving ? "正在保存…" : "保存搜索设置"}</button>
        <button type="button" className="settings-button" onClick={() => void runTest()}>测试搜索</button>
      </div>
    </fieldset>
    <p className="field-hint">测试使用本卡片当前草稿发送固定公开问题“{TEST_QUERY}”，不保存设置，也不使用聊天记录或附件。打开页面与保存均不会联网。</p>
    {testing && <button type="button" className="settings-button" onClick={stopTest}>停止测试</button>}
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
  function load() {
    setLoadFailed(false);
    try {
      const configuration = loadSearchConfiguration();
      saved.current = configuration; setInitial(configuration);
    } catch { setLoadFailed(true); }
  }
  useEffect(() => {
    load();
  }, []);
  function saveProfile(provider: ExternalSearchProvider, settings: SearchSettings) {
    const key = profileKey(provider);
    const result = saveSearchConfiguration({ ...saved.current, [key]: settings });
    saved.current = result;
    return result[key];
  }
  return <section className="settings-page network-search-page" aria-labelledby="network-search-title">
    <header className="settings-page-heading"><h2 id="network-search-title">网络搜索</h2><p className="muted-text">独立配置 Exa API 与 Exa MCP；聊天中选择所需搜索方式。</p></header>
    {!initial && !loadFailed && <p role="status">正在读取搜索设置…</p>}
    {loadFailed && <section className="settings-card network-search-card">
      <p className="error-banner" role="alert">无法读取搜索设置，请重试。</p>
      <div className="network-search-actions"><button type="button" className="settings-button" onClick={load}>重新读取设置</button>
        <button type="button" className="settings-button" onClick={() => {
          const defaults = defaultSearchConfiguration(); saved.current = defaults; setInitial(defaults); setLoadFailed(false);
          setFeedback("已载入两项默认草稿，原本机配置保持不变；首次保存后才以默认配置和已填写的卡片覆盖。");
        }}>使用默认设置编辑</button></div>
    </section>}
    {feedback && <p className="muted-text" role="status">{feedback}</p>}
    {initial && <div className="network-search-cards">
      <SearchProfileCard provider="exa-api" initial={initial.exaApi} onSave={(profile) => saveProfile("exa-api", profile)} />
      <SearchProfileCard provider="exa-mcp" initial={initial.exaMcp} onSave={(profile) => saveProfile("exa-mcp", profile)} />
    </div>}
  </section>;
}
