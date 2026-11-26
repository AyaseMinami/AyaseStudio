import { useEffect, useId, useRef, useState } from "react";
import { Check, Globe } from "lucide-react";
import type { SessionConfig } from "../../chat/sessionConfig";
import type { ChatProtocol } from "../../chat/types";
import {
  resolveDeepSeekWebTools,
  resolveSearchMode,
  withDeepSeekWebTools,
  withSearchMode,
  type DeepSeekWebToolsSelection,
  type SearchMode,
} from "../../search/mode";
import { loadSearchConfiguration, SEARCH_SETTINGS_CHANGED, SEARCH_SETTINGS_KEY } from "../../search/settings";
import "./WebSearchControl.css";
import { SelectField } from "../SelectField";

const baseChoices: Array<{ mode: SearchMode; label: string }> = [
  { mode: "off", label: "关闭" },
  { mode: "native", label: "模型原生" },
  { mode: "deepseek-server", label: "DeepSeek 服务端联网" },
  { mode: "exa-api", label: "Exa API" },
  { mode: "exa-mcp", label: "Exa MCP" },
];

const labelFor = (mode: SearchMode) =>
  mode === "tavily" ? "Tavily"
    : mode === "zhipu" ? "智谱"
    : mode === "deepseek" ? "DeepSeek Search API"
    : baseChoices.find((choice) => choice.mode === mode)!.label;

function deepSeekUnsupportedReason(protocol: ChatProtocol | undefined): string | undefined {
  if (protocol === "openai-chat") {
    return "Chat Completions 不支持 DeepSeek 服务端联网工具；请改用 Responses / Anthropic 连接，或改用 DeepSeek Search API。";
  }
  if (protocol === "gemini-native") {
    return "当前协议不支持 DeepSeek 服务端联网工具；仅支持 Responses 与 Anthropic 协议。";
  }
  return undefined;
}

const DEEPSEEK_SERVER_HINT = "仅适用于 DeepSeek 兼容服务（如 deepseek-flash），仅支持 Responses / Anthropic 协议；开启后采样参数将被服务端忽略且回复不可续写；开启思考且勾选搜索时进入深度思考搜索。「模型原生」为标准协议内置搜索。";

function readAvailability() {
  try {
    if (typeof localStorage === "undefined") return { tavily: false, zhipu: false, deepseek: false, error: false };
    const config = loadSearchConfiguration();
    return { tavily: config.tavily.enabled, zhipu: config.zhipu.enabled, deepseek: config.deepseek.enabled, error: false };
  } catch { return { tavily: false, zhipu: false, deepseek: false, error: true }; }
}

function useSearchChoices() {
  const [available, setAvailable] = useState(readAvailability);
  useEffect(() => {
    const refresh = () => setAvailable(readAvailability());
    const storage = (event: StorageEvent) => { if (event.key === SEARCH_SETTINGS_KEY || event.key === null) refresh(); };
    refresh();
    window.addEventListener(SEARCH_SETTINGS_CHANGED, refresh);
    window.addEventListener("storage", storage);
    return () => { window.removeEventListener(SEARCH_SETTINGS_CHANGED, refresh); window.removeEventListener("storage", storage); };
  }, []);
  return { error: available.error, choices: [...baseChoices,
    ...(available.tavily ? [{ mode: "tavily" as const, label: "Tavily" }] : []),
    ...(available.zhipu ? [{ mode: "zhipu" as const, label: "智谱" }] : []),
    ...(available.deepseek ? [{ mode: "deepseek" as const, label: "DeepSeek Search API" }] : [])] };
}

function DeepSeekSubTools({
  tools,
  disabled,
  compact = false,
  onChange,
}: {
  tools: DeepSeekWebToolsSelection;
  disabled: boolean;
  compact?: boolean;
  onChange(tools: DeepSeekWebToolsSelection): void;
}) {
  const hintId = useId();
  const onlySearch = tools.search && !tools.readUrl;
  const onlyReadUrl = !tools.search && tools.readUrl;
  return (
    <div className={compact ? "web-search-popover-tools" : "web-search-subtools"} role="group" aria-label="DeepSeek 服务端联网工具">
      <label className="web-search-tool-check" data-disabled={disabled || onlySearch ? "true" : undefined} title={onlySearch ? "至少保留一项联网工具" : undefined}>
        <input
          type="checkbox"
          className="ui-checkbox"
          checked={tools.search}
          disabled={disabled || onlySearch}
          aria-describedby={onlySearch ? hintId : undefined}
          onChange={(event) => {
            const next = event.target.checked;
            if (!next && !tools.readUrl) return;
            onChange({ search: next, readUrl: tools.readUrl });
          }}
        />
        <span>联网 / 深度思考搜索</span>
      </label>
      <label className="web-search-tool-check" data-disabled={disabled || onlyReadUrl ? "true" : undefined} title={onlyReadUrl ? "至少保留一项联网工具" : undefined}>
        <input
          type="checkbox"
          className="ui-checkbox"
          checked={tools.readUrl}
          disabled={disabled || onlyReadUrl}
          aria-describedby={onlyReadUrl ? hintId : undefined}
          onChange={(event) => {
            const next = event.target.checked;
            if (!next && !tools.search) return;
            onChange({ search: tools.search, readUrl: next });
          }}
        />
        <span>阅读消息链接</span>
      </label>
      {(onlySearch || onlyReadUrl) && <small id={hintId} className="web-search-tool-guard">至少保留一项联网工具</small>}
    </div>
  );
}

export function WebSearchControl({ config, disabled, protocol, onChange }: {
  config: SessionConfig; disabled: boolean; protocol?: ChatProtocol; customSelect?: boolean; onChange(config: SessionConfig): void;
}) {
  const { choices, error } = useSearchChoices();
  const mode = resolveSearchMode(config);
  const deepseekReason = deepSeekUnsupportedReason(protocol);
  const unavailable = !choices.some(choice => choice.mode === mode);
  const protocolBlocked = mode === "deepseek-server" && Boolean(deepseekReason);
  const selectId = useId();
  const tools = resolveDeepSeekWebTools(config);
  const options = [
    ...choices.map(choice => {
      const blocked = choice.mode === "deepseek-server" && Boolean(deepseekReason);
      return {
        value: choice.mode,
        label: blocked && mode === "deepseek-server" ? `${choice.label}（当前协议不支持）` : choice.label,
        ...(blocked ? { disabled: true } : {}),
      };
    }),
    ...(unavailable ? [{ value: mode, label: `${labelFor(mode)}（已关闭或不可用）`, disabled: true }] : []),
  ];
  return (
    <>
      <div className="session-config-web-search web-search-inline">
        <label className="session-config-capability-label" htmlFor={selectId}><Globe size={15} aria-hidden="true" /><span>联网搜索</span></label>
        <SelectField id={selectId} label="联网搜索" disabled={disabled} value={mode}
          invalid={protocolBlocked}
          title={deepseekReason && mode === "deepseek-server" ? deepseekReason : error ? "网络搜索设置无法读取，请到设置中检查。" : undefined}
          options={options}
          onChange={value => {
            const selected = options.find(option => option.value === value);
            if (selected && !selected.disabled) onChange(withSearchMode(config, value as SearchMode));
          }} />
      </div>
      {mode === "deepseek-server" && (
        <div className="web-search-details">
          <DeepSeekSubTools
            tools={tools}
            disabled={disabled}
            onChange={(nextTools) => onChange(withDeepSeekWebTools(config, nextTools))}
          />
          {deepseekReason && <p className="session-config-error" role="alert">{deepseekReason}</p>}
          {!protocol && <p className="session-config-hint" role="status">未选择模型；请先选择 Responses 或 Anthropic 协议模型。</p>}
          <p className="session-config-hint">{DEEPSEEK_SERVER_HINT}</p>
        </div>
      )}
    </>
  );
}

export function WebSearchToolbarControl({
  mode,
  disabled,
  busyOnly = false,
  protocol,
  deepseekWebTools,
  onChange,
  onDeepSeekWebToolsChange,
}: {
  mode: SearchMode;
  disabled: boolean;
  busyOnly?: boolean;
  protocol?: ChatProtocol;
  deepseekWebTools?: DeepSeekWebToolsSelection;
  onChange(mode: SearchMode): void;
  onDeepSeekWebToolsChange?(tools: DeepSeekWebToolsSelection): void;
}) {
  const { choices, error } = useSearchChoices();
  const deepseekReason = deepSeekUnsupportedReason(protocol);
  const unavailable = !choices.some(choice => choice.mode === mode);
  const protocolBlocked = mode === "deepseek-server" && Boolean(deepseekReason);
  const label = labelFor(mode) + (protocolBlocked ? "（当前协议不支持）" : unavailable ? "（已关闭或不可用）" : "");
  const choiceModes = choices.map(choice => choice.mode).join(",");
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const tools = deepseekWebTools ?? { search: true, readUrl: true };

  function close() { setOpen(false); trigger.current?.focus(); }

  useEffect(() => {
    if (!open) return;
    (container.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]:not(:disabled)')
      ?? container.current?.querySelector<HTMLElement>('[role="menuitemradio"]:not(:disabled)'))?.focus();
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, unavailable, choiceModes]);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  return <div className="web-search-toolbar" ref={container} onBlur={(event) => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
  }} onKeyDown={(event) => {
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <button ref={trigger} type="button" className={`composer-tool-button${mode !== "off" ? " is-active" : ""}`}
      aria-label={`联网搜索：${label}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? panelId : undefined}
      title={`联网搜索：${label}。修改仅影响当前会话下次请求。搜索可能产生费用；搜索专用模型可能始终联网。${deepseekReason && mode === "deepseek-server" ? ` ${deepseekReason}` : ""}${error ? "网络搜索设置无法读取，请到设置中检查。" : ""}`}
      disabled={disabled} data-busy-only={disabled && busyOnly} onClick={() => setOpen((value) => !value)} onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); }
      }}><Globe size={17} aria-hidden="true" /></button>
    {open && <div id={panelId} className="web-search-popover" role="menu" aria-label="联网搜索" onKeyDown={(event) => {
      const target = event.target as HTMLElement | null;
      if (!target || target.getAttribute("role") !== "menuitemradio") return;
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)')];
      if (!items.length) return;
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
        : event.key === "ArrowDown" ? (current + 1) % items.length
        : event.key === "ArrowUp" ? (current + items.length - 1) % items.length : undefined;
      if (next !== undefined) { event.preventDefault(); items[next]?.focus(); }
    }}>
      {choices.map((choice) => {
        const optionBlocked = choice.mode === "deepseek-server" && Boolean(deepseekReason);
        const checked = mode === choice.mode;
        return (
          <button
            key={choice.mode}
            type="button"
            role="menuitemradio"
            disabled={optionBlocked}
            aria-disabled={optionBlocked || undefined}
            title={optionBlocked ? deepseekReason : undefined}
            tabIndex={checked && !optionBlocked ? 0 : -1}
            aria-checked={checked}
            onClick={() => {
              if (optionBlocked) return;
              onChange(choice.mode);
              if (choice.mode !== "deepseek-server") close();
            }}
          >
            <span>{optionBlocked && checked ? `${choice.label}（当前协议不支持）` : choice.label}</span>
            {checked && <Check size={15} aria-hidden="true" />}
          </button>
        );
      })}
      {mode === "deepseek-server" && (
        <div className="web-search-popover-section">
          {onDeepSeekWebToolsChange && (
            <DeepSeekSubTools
              tools={tools}
              disabled={disabled}
              compact
              onChange={onDeepSeekWebToolsChange}
            />
          )}
          {deepseekReason && <p className="web-search-popover-alert" role="alert">{deepseekReason}</p>}
          {!protocol && <p role="status">未选择模型；请先选择 Responses 或 Anthropic 协议模型。</p>}
          <p>{DEEPSEEK_SERVER_HINT}</p>
        </div>
      )}
      {mode !== "deepseek-server" && deepseekReason && (
        <p className="web-search-popover-note">{deepseekReason}</p>
      )}
      <p>当前会话 · 自动保存，下次请求生效</p>
      {error && <p role="status">网络搜索设置无法读取，请到设置中检查。</p>}
    </div>}
  </div>;
}
