/// <reference lib="es2022.intl" />
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { AlertCircle, ChevronRight, X } from "lucide-react";

import { changeNumericSetting, type ConfigErrors, type NumericField, type NumericSetting, type SessionConfig } from "../../chat/sessionConfig";
import { parameterCapability } from "../../chat/requestMapping";
import type { ChatProtocol } from "../../chat/types";
import { SelectField } from "../SelectField";
import "./AssistantConfig.css";

type ConfigTab = "general" | "prompt";

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function countGraphemes(text: string): number {
  let count = 0;
  for (const _ of graphemeSegmenter.segment(text)) count += 1;
  return count;
}

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
  generalBlocker?: string;
  generalWarning?: boolean;
  globalError?: string;
  protocol?: ChatProtocol;
  model: string;
  onChange(config: SessionConfig): void;
  resetLabel?: string;
  resetHint?: string;
  initialFocusId?: string;
  onClose(): void;
  onReset(): void;
}

function getFocusableControls(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>(
    "input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled)",
  )].filter((element) => !element.closest("[hidden]") && !element.matches(":disabled") && element.tabIndex >= 0);
}

function ensureFocusedControlVisible(scroller: HTMLElement | null, target: EventTarget | null) {
  if (!scroller || !(target instanceof HTMLElement)) return;
  if (!scroller.contains(target) || target.closest("dialog") || target.closest("[hidden]")) return;
  const scrollerRect = scroller.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  if (scrollerRect.height <= 0 || targetRect.height <= 0) return;
  const pad = 12;
  const viewTop = scrollerRect.top + pad;
  const viewBottom = scrollerRect.bottom - pad;
  const available = viewBottom - viewTop;
  if (available <= 0) return;
  if (targetRect.height <= available) {
    if (targetRect.top < viewTop) {
      scroller.scrollTop += targetRect.top - viewTop;
    } else if (targetRect.bottom > viewBottom) {
      scroller.scrollTop += targetRect.bottom - viewBottom;
    }
  } else if (targetRect.top > viewBottom || targetRect.bottom < viewTop) {
    scroller.scrollTop += targetRect.top - viewTop;
  }
}

export function SessionConfigPanel({
  presentation = "drawer",
  disabled = false,
  title = "会话配置",
  description = "当前对话独立保存，修改立即写入本地。",
  children,
  footer,
  config,
  errors,
  generalBlocker,
  generalWarning = false,
  globalError,
  protocol,
  model,
  onChange,
  onClose,
  onReset,
  resetLabel = "恢复默认配置",
  resetHint,
  initialFocusId,
}: SessionConfigPanelProps) {
  const panel = useRef<HTMLElement>(null);
  const scrollContainer = useRef<HTMLDivElement>(null);
  const generalTabButton = useRef<HTMLButtonElement>(null);
  const promptTabButton = useRef<HTMLButtonElement>(null);
  const tabScrollTop = useRef<Record<ConfigTab, number>>({ general: 0, prompt: 0 });
  const keyboardFocus = useRef(false);
  const [activeTab, setActiveTab] = useState<ConfigTab>("general");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [resetTick, setResetTick] = useState(0);
  const showAdvanced = advancedOpen || !!errors.customJson;

  const promptText = typeof config.systemInstruction === "string" ? config.systemInstruction : "";
  const promptCount = useMemo(() => countGraphemes(promptText), [promptText]);
  const hasPromptContent = promptText.trim().length > 0;
  const hasPromptError = Boolean(errors.systemInstruction);
  const hasGeneralConfigError = Object.entries(errors).some(
    ([key, value]) => key !== "systemInstruction" && key !== "stored" && Boolean(value),
  );
  const showGeneralBlocker = activeTab !== "general" && Boolean(generalBlocker);
  const hasGeneralIssue = hasGeneralConfigError || showGeneralBlocker || generalWarning;

  function selectTab(next: ConfigTab, moveFocus = false) {
    if (next !== activeTab) {
      if (scrollContainer.current) {
        tabScrollTop.current[activeTab] = scrollContainer.current.scrollTop;
      }
      setActiveTab(next);
    }
    if (moveFocus) {
      (next === "general" ? generalTabButton : promptTabButton).current?.focus();
    }
  }

  function handleTabListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      selectTab(activeTab === "general" ? "prompt" : "general", true);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectTab("general", true);
    } else if (event.key === "End") {
      event.preventDefault();
      selectTab("prompt", true);
    }
  }

  useLayoutEffect(() => {
    if (scrollContainer.current) {
      scrollContainer.current.scrollTop = tabScrollTop.current[activeTab];
    }
  }, [activeTab]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const requested = initialFocusId ? document.getElementById(initialFocusId) : null;
    const validRequested = requested && panel.current?.contains(requested)
      && !requested.closest("[hidden]") && !requested.matches(":disabled") && requested.tabIndex >= 0
      ? requested
      : undefined;
    (validRequested ?? getFocusableControls(panel.current)[0])?.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    function escape(event: KeyboardEvent) { if (event.key === "Escape" && !event.defaultPrevented) onClose(); }
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);

  function handleReset() {
    onReset();
    setResetTick((tick) => tick + 1);
  }

  function settingRow(field: NumericField, label: string) {
    const setting: NumericSetting = config[field] ?? { mode: "auto" };
    const capability = protocol ? parameterCapability(protocol, model, field, config) : undefined;
    const unsupported = capability?.support === "unsupported";
    const fieldError = errors[field];
    const hasError = Boolean(fieldError);
    const showUnsupportedHint = Boolean(unsupported && capability && fieldError !== capability.reason);
    const hintId = showUnsupportedHint ? `config-${field}-hint` : undefined;
    const anthropicHintId = field === "maxOutput" && protocol === "anthropic-native" && setting.mode === "auto" ? "session-anthropic-max-output-hint" : undefined;
    const errorId = hasError ? `config-${field}-error` : undefined;
    const describedBy = [hintId, anthropicHintId, errorId].filter(Boolean).join(" ") || undefined;
    return (
      <div className="session-config-field" key={field}>
        <label htmlFor={`config-${field}`}>{label}</label>
        <div className="session-config-number-row">
          <SelectField
            id={`config-${field}`}
            label={label}
            disabled={disabled}
            describedBy={describedBy}
            invalid={hasError && (setting.mode !== "custom" || unsupported)}
            value={setting.mode}
            options={[{ value: "auto", label: "自动" }, { value: "custom", label: "自定义", disabled: unsupported }]}
            onChange={value => onChange(changeNumericSetting(config, field,
              value === "auto" ? { mode: "auto" } : { mode: "custom", value: "" },
            ))}
          />
          {setting.mode === "custom" && (
            <input
              aria-label={`${label} 自定义值`}
              aria-invalid={hasError && !unsupported ? true : undefined}
              aria-describedby={describedBy}
              type="text"
              inputMode="decimal"
              value={typeof setting.value === "string" ? setting.value : ""}
              disabled={unsupported}
              onChange={(event) => onChange(changeNumericSetting(config, field, { mode: "custom", value: event.target.value }))}
            />
          )}
        </div>
        {showUnsupportedHint && capability && <small id={hintId} className="session-config-hint">{capability.reason}</small>}
        {fieldError && <small id={errorId} className="session-config-error" role="alert">{fieldError}</small>}
      </div>
    );
  }

  return (
    <div className={`session-config-backdrop${presentation === "modal" ? " session-config-modal" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside ref={panel} className="session-config-panel" role="dialog" aria-modal="true" aria-label={title}
        onPointerDownCapture={() => { keyboardFocus.current = false; }}
        onKeyDownCapture={(event) => {
          if (["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Enter", " "].includes(event.key)) {
            keyboardFocus.current = true;
          }
        }}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const fields = getFocusableControls(panel.current);
          if (!fields.length) return;
          const first = fields[0];
          const last = fields[fields.length - 1];
          const active = document.activeElement as HTMLElement | null;
          if (!active || !fields.includes(active)) {
            event.preventDefault();
            (event.shiftKey ? last : first)?.focus();
          } else if (event.shiftKey && active === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first?.focus();
          }
        }}>
        <header className="session-config-panel-header">
          <div className="session-config-panel-title"><h2>{title}</h2>{description && <p className="muted-text">{description}</p>}</div>
          <button type="button" className="session-config-close" aria-label="关闭" title="关闭" disabled={disabled} onClick={onClose}><X size={18} aria-hidden="true" /></button>
        </header>
        <div className="session-config-tabs" role="tablist" aria-label="配置分区" onKeyDown={handleTabListKeyDown}>
          <button
            ref={generalTabButton}
            id="session-config-tab-general"
            type="button"
            role="tab"
            className="session-config-tab"
            aria-selected={activeTab === "general"}
            aria-controls="session-config-tabpanel-general"
            tabIndex={activeTab === "general" ? 0 : -1}
            onClick={() => selectTab("general")}
          >
            <span>常规配置</span>
            {hasGeneralIssue && (
              <span className="session-config-tab-alert" title="常规配置包含待处理项">
                <AlertCircle size={13} aria-hidden="true" />
                <span className="sr-only">（含待处理项）</span>
              </span>
            )}
          </button>
          <button
            ref={promptTabButton}
            id="session-config-tab-prompt"
            type="button"
            role="tab"
            className="session-config-tab"
            aria-selected={activeTab === "prompt"}
            aria-controls="session-config-tabpanel-prompt"
            tabIndex={activeTab === "prompt" ? 0 : -1}
            onClick={() => selectTab("prompt")}
          >
            <span>系统提示词</span>
            {hasPromptError ? (
              <span className="session-config-tab-alert" title="系统提示词存在错误">
                <AlertCircle size={13} aria-hidden="true" />
                <span className="sr-only">（有错误）</span>
              </span>
            ) : hasPromptContent ? (
              <span className="session-config-tab-meta">已填写</span>
            ) : null}
          </button>
        </div>
        <div
          ref={scrollContainer}
          className="session-config-panel-scroll"
          data-tab={activeTab}
          onFocus={(event) => {
            if (keyboardFocus.current) {
              ensureFocusedControlVisible(scrollContainer.current, event.target);
            }
          }}
        >
          <fieldset disabled={disabled} className="session-config-fieldset">
            <div className="session-config-panel-body">
              <div
                id="session-config-tabpanel-general"
                role="tabpanel"
                aria-labelledby="session-config-tab-general"
                className="session-config-tabpanel session-config-general-panel"
                hidden={activeTab !== "general"}
              >
                {children}
                <section className="session-config-section session-config-sampling-section">
                  <h3>生成与上下文</h3>
                  <div className="session-config-grid session-config-params-grid">
                    {numericFields.map((item) => settingRow(item.field, item.label))}
                    <div className="session-config-field session-config-stream-cell">
                      <label className="session-config-switch-inline" data-disabled={disabled ? "true" : undefined}>
                        <span>流式输出</span>
                        <input
                          id="session-stream"
                          className="ui-switch"
                          type="checkbox"
                          role="switch"
                          aria-invalid={errors.stream ? true : undefined}
                          aria-describedby={errors.stream ? "session-stream-error" : undefined}
                          checked={config.stream === true}
                          onChange={(event) => onChange({ ...config, stream: event.target.checked })}
                        />
                      </label>
                    </div>
                  </div>
                  <p className="session-config-hint">采样与最大输出按当前协议发送；历史预算仅裁剪本地请求副本（估算 Token，保留完整聊天记录）。</p>
                  {protocol === "anthropic-native" && config.maxOutput?.mode === "auto" &&
                    <small id="session-anthropic-max-output-hint" className="session-config-hint">Anthropic 必填输出上限：Ayase 回退值 4096，非官方默认。</small>}
                  {errors.stream && <small id="session-stream-error" className="session-config-error" role="alert">{errors.stream}</small>}
                </section>
                <section className="session-config-section session-config-advanced-section">
                  <div className="session-config-disclosure-box" data-open={showAdvanced || undefined}>
                    <button type="button" className="session-config-disclosure" disabled={disabled} aria-expanded={showAdvanced} aria-controls="session-advanced-json" onClick={() => { if (!errors.customJson) setAdvancedOpen(!showAdvanced); }}><ChevronRight size={16} aria-hidden="true" /><span>高级 JSON</span></button>
                    {showAdvanced && <div id="session-advanced-json" className="session-config-advanced">
                      <p id="session-custom-json-hint" className="session-config-hint">按四种协议分别保存；只允许安全补充字段，受保护字段和工具/远端状态会被拒绝。</p>
                      {protocol ? (
                        <>
                          <label htmlFor="session-custom-json">当前协议：{protocol}</label>
                          <textarea
                            id="session-custom-json"
                            spellCheck={false}
                            aria-invalid={errors.customJson ? true : undefined}
                            aria-describedby={["session-custom-json-hint", errors.customJson ? "session-custom-json-error" : ""].filter(Boolean).join(" ")}
                            value={config.customJson?.[protocol] ?? ""}
                            onChange={(event) => onChange({ ...config, customJson: { ...config.customJson, [protocol]: event.target.value } })}
                          />
                        </>
                      ) : <p className="session-config-hint">选择模型后显示当前协议的 JSON。</p>}
                      {errors.customJson && <small id="session-custom-json-error" className="session-config-error" role="alert">{errors.customJson}</small>}
                    </div>}
                  </div>
                </section>
              </div>
              <div
                id="session-config-tabpanel-prompt"
                role="tabpanel"
                aria-labelledby="session-config-tab-prompt"
                className="session-config-tabpanel session-config-prompt-panel"
                hidden={activeTab !== "prompt"}
              >
                <section className="session-config-section session-config-system-section">
                  <div className="session-config-prompt-header">
                    <h3><label htmlFor="session-system">系统提示词</label></h3>
                    <span className="session-config-prompt-count">{promptCount > 0 ? `${promptCount} 字` : "未填写"}</span>
                  </div>
                  <textarea
                    id="session-system"
                    aria-invalid={errors.systemInstruction ? true : undefined}
                    aria-describedby={errors.systemInstruction ? "session-system-error" : undefined}
                    value={promptText}
                    onChange={(event) => onChange({ ...config, systemInstruction: event.target.value })}
                    placeholder="留空则不发送系统提示词，按模型默认行为回复；可在此设定角色、语气或输出要求"
                  />
                  {errors.systemInstruction && <small id="session-system-error" className="session-config-error" role="alert">{errors.systemInstruction}</small>}
                </section>
              </div>
              {!footer && <button type="button" className="settings-button" onClick={handleReset}>{resetLabel}</button>}
            </div>
          </fieldset>
        </div>
        {(errors.stored || globalError || showGeneralBlocker) && (
          <div className="session-config-global-alerts">
            {errors.stored && <p className="session-config-error" role="alert">{errors.stored}</p>}
            {globalError && <p className="session-config-error" role="alert">{globalError}</p>}
            {showGeneralBlocker && <p className="session-config-error" role="status">{generalBlocker}</p>}
          </div>
        )}
        <span className="sr-only" role="status" aria-live="polite">{resetTick > 0 ? "已恢复到草稿" : ""}</span>
        {footer && (
          <footer className="session-config-panel-footer">
            {resetHint && <p id="session-config-reset-hint" className="session-config-footer-note">{resetHint}</p>}
            <div className="session-config-footer-actions">
              <button
                type="button"
                className="settings-button session-config-reset"
                disabled={disabled}
                aria-describedby={resetHint ? "session-config-reset-hint" : undefined}
                onClick={handleReset}
              >{resetLabel}</button>
              <div className="session-config-footer-primary">{footer}</div>
            </div>
          </footer>
        )}
      </aside>
    </div>
  );
}
