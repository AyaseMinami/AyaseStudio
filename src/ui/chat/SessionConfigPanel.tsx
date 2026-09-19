import { useEffect, useRef, type ReactNode } from "react";

import { changeNumericSetting, type ConfigErrors, type NumericField, type NumericSetting, type SessionConfig } from "../../chat/sessionConfig";
import { parameterCapability } from "../../chat/requestMapping";
import type { ChatProtocol } from "../../chat/types";

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
  onClose(): void;
  onReset(): void;
}

export function SessionConfigPanel({ presentation = "drawer", disabled = false, title = "会话配置", description = "当前对话独立保存，修改立即写入本地。", children, footer, config, errors, protocol, model, onChange, onClose, onReset }: SessionConfigPanelProps) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("input:not(:disabled), textarea, button")?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    function escape(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
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
          <select
            id={`config-${field}`}
            value={setting.mode}
            onChange={(event) => onChange(changeNumericSetting(config, field,
              event.target.value === "auto" ? { mode: "auto" } : { mode: "custom", value: "" },
            ))}
          >
            <option value="auto">自动</option>
            <option value="custom" disabled={unsupported}>自定义</option>
          </select>
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
        {capability && <small className="muted-text">{capability.reason}</small>}
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
          <button type="button" className="settings-button" onClick={onClose}>关闭</button>
        </header>
        <fieldset disabled={disabled} className="session-config-panel-scroll">
          {children}
          {errors.stored && <p className="session-config-error" role="alert">{errors.stored}</p>}
          <section className="session-config-section">
            <h3>系统指令</h3>
            <label htmlFor="session-system">System Instruction</label>
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
            {numericFields.filter((item) => item.group === "sampling").map((item) => settingRow(item.field, item.label))}
            <label className="session-config-check">
              <input id="session-stream" type="checkbox" checked={config.stream === true} onChange={(event) => onChange({ ...config, stream: event.target.checked })} />
              流式输出（Ayase 推荐，默认开启）
            </label>
            {errors.stream && <small className="session-config-error" role="alert">{errors.stream}</small>}
          </section>
          <section className="session-config-section">
            <h3>上下文与输出</h3>
            <p className="muted-text">预算只裁剪本次请求副本；完整聊天记录会保留。Token 计数为估算。</p>
            {numericFields.filter((item) => item.group === "context").map((item) => settingRow(item.field, item.label))}
            {protocol === "anthropic-native" && config.maxOutput?.mode === "auto" &&
              <small className="muted-text">Anthropic 必填输出上限：Ayase 回退值 4096，非官方默认。</small>}
          </section>
          <section className="session-config-section">
            <h3>高级 JSON</h3>
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
          </section>
          <button type="button" className="settings-button" onClick={onReset}>恢复默认配置</button>
          {footer}
        </fieldset>
      </aside>
    </div>
  );
}
