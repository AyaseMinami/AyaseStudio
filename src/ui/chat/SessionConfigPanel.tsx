import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight, X } from "lucide-react";

import { changeNumericSetting, type ConfigErrors, type NumericField, type NumericSetting, type SessionConfig } from "../../chat/sessionConfig";
import { parameterCapability } from "../../chat/requestMapping";
import type { ChatProtocol } from "../../chat/types";
import { SelectField } from "../SelectField";

const numericFields: Array<{ field: NumericField; label: string; group: "sampling" | "context" }> = [
  { field: "temperature", label: "Temperature", group: "sampling" },
  { field: "topP", label: "Top-P", group: "sampling" },
  { field: "topK", label: "Top-K", group: "sampling" },
  { field: "contextBudget", label: "本地输入历史预算 (Token)", group: "context" },
  { field: "maxOutput", label: "最大输出 (Token)", group: "context" },
];

export interface SessionConfigPanelProps {
  presentation?: "drawer" | "modal";
  disabled?: boolean;
  title?: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  config: SessionConfig;
  errors: ConfigErrors;
  protocol?: ChatProtocol;
  model: string;
  onChange(config: SessionConfig): void;
  resetLabel?: string;
  initialFocusId?: string;
  onClose(): void;
  onReset(): void;
}

export function SessionConfigPanel({ presentation = "drawer", disabled = false, title = "会话配置", description = "当前对话独立保存，修改立即写入本地。", children, footer, config, errors, protocol, model, onChange, onClose, onReset, resetLabel = "恢复默认配置", initialFocusId }: SessionConfigPanelProps) {
  const panel = useRef<HTMLElement>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const showAdvanced = advancedOpen || !!errors.customJson;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const requested = initialFocusId ? document.getElementById(initialFocusId) : null;
    (requested && panel.current?.contains(requested) ? requested : panel.current?.querySelector<HTMLElement>("input:not(:disabled), textarea, button"))?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    function escape(event: KeyboardEvent) { if (event.key === "Escape" && !event.defaultPrevented) onClose(); }
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);

  function settingRow(field: NumericField, label: string) {
    const setting: NumericSetting = config[field] ?? { mode: "auto" };
    const capability = protocol ? parameterCapability(protocol, model, field, config) : undefined;
    const unsupported = capability?.support === "unsupported";
    return (
      <div className="session-config-field" key={field}>
        <label htmlFor={`config-${field}`}>{label}</label>

        <div className="session-config-number-row">
          <SelectField
            id={`config-${field}`}
            label={label}
            disabled={disabled}
            value={setting.mode}
            options={[{ value: "auto", label: "自动" }, { value: "custom", label: "自定义", disabled: unsupported }]}
            onChange={value => onChange(changeNumericSetting(config, field,
              value === "auto" ? { mode: "auto" } : { mode: "custom", value: "" },
            ))}
          />
          {setting.mode === "custom" && (
            <input
              aria-label={`${label} 自定义值`}
              type="text"
              inputMode="decimal"
              value={typeof setting.value === "string" ? setting.value : ""}
              disabled={unsupported}
              onChange={(event) => onChange(changeNumericSetting(config, field, { mode: "custom", value: event.target.value }))}
            />
          )}
        </div>
        {capability && (unsupported || field === "contextBudget" || field === "maxOutput") && <small className="muted-text">{capability.reason}</small>}
        {errors[field] && <small className="session-config-error" role="alert">{errors[field]}</small>}
      </div>
    );
  }

  return (
    <div className={`session-config-backdrop${presentation === "modal" ? " session-config-modal" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside ref={panel} className="session-config-panel" role="dialog" aria-modal="true" aria-label={title} onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const fields = [...(panel.current?.querySelectorAll<HTMLElement>("input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled)") ?? [])];
        const first = fields[0]; const last = fields[fields.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
        <header className="session-config-panel-header">
          <div><h2>{title}</h2><p className="muted-text">{description}</p></div>
          <button type="button" className="settings-button session-config-close" aria-label="关闭" title="关闭" disabled={disabled} onClick={onClose}><X size={18} aria-hidden="true" /></button>
        </header>
        <fieldset disabled={disabled} className="session-config-panel-scroll">
          {children}
          {errors.stored && <p className="session-config-error" role="alert">{errors.stored}</p>}
          <section className="session-config-section">
            <h3><label htmlFor="session-system">系统提示词</label></h3>

            <textarea
              id="session-system"
              value={typeof config.systemInstruction === "string" ? config.systemInstruction : ""}
              onChange={(event) => onChange({ ...config, systemInstruction: event.target.value })}
              placeholder="输入系统指令"
            />
            {errors.systemInstruction && <small className="session-config-error" role="alert">{errors.systemInstruction}</small>}
          </section>
          <section className="session-config-section">
            <h3>生成参数</h3>
            <div className="session-config-grid">{numericFields.filter((item) => item.group === "sampling").map((item) => settingRow(item.field, item.label))}</div>
            <p className="muted-text">按当前协议发送，参数支持情况由供应商判断。</p>
            <label className="session-config-check">
              <input id="session-stream" type="checkbox" checked={config.stream === true} onChange={(event) => onChange({ ...config, stream: event.target.checked })} />
              流式输出
            </label>

            {errors.stream && <small className="session-config-error" role="alert">{errors.stream}</small>}
          </section>
          <section className="session-config-section">
            <h3>上下文与输出</h3>
            <p className="muted-text">预算只裁剪本次请求副本；完整聊天记录会保留。Token 计数为估算。</p>
            <div className="session-config-grid session-config-context-grid">{numericFields.filter((item) => item.group === "context").map((item) => settingRow(item.field, item.label))}</div>
            {protocol === "anthropic-native" && config.maxOutput?.mode === "auto" &&
              <small className="muted-text">Anthropic 必填输出上限：Ayase 回退值 4096，非官方默认。</small>}
          </section>
          <section className="session-config-section">
            <button type="button" className="session-config-disclosure" disabled={disabled} aria-expanded={showAdvanced} aria-controls="session-advanced-json" onClick={() => { if (!errors.customJson) setAdvancedOpen(!showAdvanced); }}><ChevronRight size={16} aria-hidden="true" />高级 JSON</button>
            {showAdvanced && <div id="session-advanced-json" className="session-config-advanced">
            <p className="muted-text">按四种协议分别保存；只允许安全补充字段，受保护字段和工具/远端状态会被拒绝。</p>
            {protocol ? (
              <>
                <label htmlFor="session-custom-json">当前协议：{protocol}</label>

                <textarea
                  id="session-custom-json"
                  spellCheck={false}
                  value={config.customJson?.[protocol] ?? ""}
                  onChange={(event) => onChange({ ...config, customJson: { ...config.customJson, [protocol]: event.target.value } })}
                />
                {errors.customJson && <small className="session-config-error" role="alert">{errors.customJson}</small>}
              </>
            ) : <p className="muted-text">选择模型后显示当前协议的 JSON。</p>}
            </div>}
          </section>
          {!footer && <button type="button" className="settings-button" onClick={onReset}>{resetLabel}</button>}
        </fieldset>
        {footer && <footer className="session-config-panel-footer"><button type="button" className="settings-button session-config-reset" disabled={disabled} onClick={onReset}>{resetLabel}</button>{footer}</footer>}
      </aside>
    </div>
  );
}
