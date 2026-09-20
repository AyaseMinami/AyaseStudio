import { useEffect, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";
import type { ConnectionSettingsState } from "../../chat/settings";
import { getProtocolOption } from "../../chat/protocolOptions";

export interface ModelPickerProps {
  settings: ConnectionSettingsState;
  selectedModelId: string | null;
  disabled: boolean;
  error?: string;
  onSelect(modelId: string): Promise<boolean>;
  onClose(): void;
}

export function ModelPicker({ settings, selectedModelId, disabled, error, onSelect, onClose }: ModelPickerProps) {
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector("input")?.focus();
    return () => previous?.focus();
  }, []);
  const needle = query.trim().toLocaleLowerCase();
  const groups = settings.providers.flatMap((provider) => provider.connections.map((connection) => ({
    provider, connection,
    models: connection.models.filter((model) =>
      [provider.name, connection.name, getProtocolOption(connection.protocol).label, model.modelId, model.displayName ?? ""]
        .some((value) => value.toLocaleLowerCase().includes(needle))),
  }))).filter((group) => group.models.length);
  async function select(id: string) {
    setSaving(true);
    try { if (await onSelect(id)) onClose(); }
    finally { setSaving(false); }
  }
  return <div className="model-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <div className="model-picker" role="dialog" aria-modal="true" aria-labelledby="model-picker-title" ref={panel}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!saving) onClose(); }
        if (event.key === "Tab") {
          const items = panel.current?.querySelectorAll<HTMLElement>("input:not(:disabled), button:not(:disabled)");
          if (!items?.length) return;
          const first = items[0], last = items[items.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }}>
      <div className="model-picker-heading"><h2 id="model-picker-title">选择模型</h2>
        <button type="button" aria-label="关闭模型选择" disabled={saving} onClick={onClose}><X size={18} /></button></div>
      <label className="model-picker-search"><Search size={18} aria-hidden="true" />
        <input aria-label="搜索模型" placeholder="搜索模型、供应商或连接…" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <p className="muted-text model-picker-hint">仅当前对话 · 自动保存，下次请求生效</p>
      {error && <p className="model-picker-error" role="alert">{error}</p>}
      {selectedModelId && !settings.providers.some((p) => p.connections.some((c) => c.models.some((m) => m.id === selectedModelId))) &&
        <p className="model-picker-error" role="status">当前模型已失效，请重新选择。</p>}
      <div className="model-picker-results">
        {groups.map(({ provider, connection, models }) => <section key={connection.id} aria-label={`${provider.name} · ${connection.name}`}>
          <h3>{provider.name} · {connection.name}<span>{getProtocolOption(connection.protocol).label}</span></h3>
          {models.map((model) => <button type="button" className="model-picker-option" key={model.id}
            aria-pressed={model.id === selectedModelId} disabled={disabled || saving} onClick={() => void select(model.id)}>
            <span><strong>{model.displayName || model.modelId}</strong>{model.displayName && <small>{model.modelId}</small>}</span>
            {model.id === selectedModelId && <Check size={18} aria-label="当前模型" />}
          </button>)}
        </section>)}
        {!groups.length && <p className="muted-text model-picker-empty">{needle ? "没有匹配的模型。" : "还没有已配置模型，请先到设置中添加。"}</p>}
      </div>
    </div>
  </div>;
}
