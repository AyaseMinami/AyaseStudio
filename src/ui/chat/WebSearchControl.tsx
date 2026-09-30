import { useEffect, useId, useRef, useState } from "react";
import { Check, Globe } from "lucide-react";
import type { SessionConfig } from "../../chat/sessionConfig";
import { resolveSearchMode, withSearchMode, type SearchMode } from "../../search/mode";
import "./WebSearchControl.css";

const choices: Array<{ mode: SearchMode; label: string }> = [
  { mode: "off", label: "关闭" }, { mode: "native", label: "模型原生" }, { mode: "exa-api", label: "Exa API" }, { mode: "exa-mcp", label: "Exa MCP" },
];
const labelFor = (mode: SearchMode) => choices.find((choice) => choice.mode === mode)!.label;

export function WebSearchControl({ config, disabled, onChange }: {
  config: SessionConfig; disabled: boolean; onChange(config: SessionConfig): void;
}) {
  return <label className="session-config-web-search web-search-inline">
    <Globe size={16} aria-hidden="true" /><span>联网搜索</span>
    <select aria-label="联网搜索" disabled={disabled} value={resolveSearchMode(config)}
      onChange={(event) => onChange(withSearchMode(config, event.target.value as SearchMode))}>
      {choices.map(({ mode, label }) => <option key={mode} value={mode}>{label}</option>)}
    </select>
  </label>;
}

export function WebSearchToolbarControl({ mode, disabled, onChange }: {
  mode: SearchMode; disabled: boolean; onChange(mode: SearchMode): void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  function close() { setOpen(false); trigger.current?.focus(); }
  useEffect(() => {
    if (!open) return;
    container.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return <div className="web-search-toolbar" ref={container} onBlur={(event) => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
  }} onKeyDown={(event) => {
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <button ref={trigger} type="button" className={`composer-tool-button${mode !== "off" ? " is-active" : ""}`}
      aria-label={`联网搜索：${labelFor(mode)}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? panelId : undefined}
      title={`联网搜索：${labelFor(mode)}。修改仅影响当前会话下次请求。搜索可能产生费用；搜索专用模型可能始终联网。`}
      disabled={disabled} onClick={() => setOpen((value) => !value)} onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); }
      }}><Globe size={17} aria-hidden="true" /></button>
    {open && <div id={panelId} className="web-search-popover" role="menu" aria-label="联网搜索" onKeyDown={(event) => {
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
        : event.key === "ArrowDown" ? (current + 1) % items.length
        : event.key === "ArrowUp" ? (current + items.length - 1) % items.length : undefined;
      if (next !== undefined) { event.preventDefault(); items[next]?.focus(); }
    }}>
      {choices.map((choice) => <button key={choice.mode} type="button" role="menuitemradio"
        tabIndex={mode === choice.mode ? 0 : -1} aria-checked={mode === choice.mode} onClick={() => { onChange(choice.mode); close(); }}>
        <span>{choice.label}</span>{mode === choice.mode && <Check size={15} aria-hidden="true" />}
      </button>)}
      <p>当前会话 · 自动保存，下次请求生效</p>
    </div>}
  </div>;
}
