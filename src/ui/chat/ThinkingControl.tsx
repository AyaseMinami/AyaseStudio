import { useEffect, useId, useRef, useState } from "react";
import { Check, Eye, Lightbulb } from "lucide-react";
import { containsSelectFieldTarget, SelectField } from "../SelectField";
import type { ChatProtocol } from "../../chat/types";
import { defaultThinking, isThinkingSettings, thinkingOptions, thinkingLabels,
  validateThinkingSelection, type ThinkingSettings, type ThinkingChoice } from "../../chat/thinking";

interface ThinkingControlProps {
  busyOnly?: boolean;
  protocol?: ChatProtocol; model: string; value?: ThinkingSettings; disabled: boolean;
  hint?: string;
  optionList?: boolean;
  scope?: string;
  onChange(value: ThinkingSettings): void;
}

export function ThinkingToolbarControl(props: ThinkingControlProps) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const settings = isThinkingSettings(props.value) ? props.value : defaultThinking;
  const active = settings.choice !== "default" && settings.choice !== "off";
  useEffect(() => {
    if (!open) return;
    container.current?.querySelector<HTMLElement>('[role="dialog"] input:checked, [role="dialog"] input:not(:disabled), [role="dialog"] button:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => {
      if (!containsSelectFieldTarget(container.current, event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div className="thinking-toolbar-control" ref={container} onKeyDown={(event) => {
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  }} onBlur={(event) => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
  }}>
    <button ref={trigger} type="button" className={`composer-tool-button${active ? " is-active" : ""}`}
      aria-label="思考设置" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined}
      title={`思考：${thinkingLabels[settings.choice]}`}
      disabled={props.disabled}
      data-busy-only={props.disabled && props.busyOnly === true}
      onClick={() => setOpen((current) => !current)}><Lightbulb size={18} aria-hidden="true" />
    </button>
    {open && <div id={panelId} className="thinking-popover" role="dialog" aria-label="思考设置">
      <ThinkingControl key={settings.budget} {...props} optionList />
    </div>}
  </div>;
}

export function ThinkingControl({ protocol = "gemini-native", value, disabled, hint = "当前助手 · 自动保存", optionList, onChange, scope = "当前助手" }: ThinkingControlProps) {
  const settings = isThinkingSettings(value) ? value : defaultThinking;
  const capability = thinkingOptions(protocol);
  const choiceLabel = protocol === "anthropic-native" ? "思考模式" : "思考强度";
  const [budget, setBudget] = useState(settings.budget);
  const [budgetError, setBudgetError] = useState("");
  const invalid = value !== undefined && !isThinkingSettings(value);
  const groupName = useId();
  const choiceId = useId();
  const effortId = useId();
  const budgetId = useId();
  const budgetErrorId = useId();
  function choose(choice: ThinkingChoice) {
    const next = { ...settings, choice, budget: settings.budget };
    setBudget(next.budget); setBudgetError(""); onChange(next);
  }
  const summaryDisabled = disabled || !capability.summary;
  const summaryActive = capability.summary && settings.includeSummary;
  const summaryToggle = optionList ? (
    <label className="thinking-summary-toggle">
      <input className="ui-switch" type="checkbox" role="switch" checked={summaryActive}
        disabled={summaryDisabled} onChange={(event) => onChange({ ...settings, includeSummary: event.target.checked })} />
      <span>显示思考内容</span>
    </label>
  ) : (
    <label className="thinking-summary-toggle" data-disabled={summaryDisabled ? "true" : undefined}>
      <Eye size={15} aria-hidden="true" />
      <span>显示思考内容</span>
      <input className="ui-switch" type="checkbox" role="switch" checked={summaryActive}
        disabled={summaryDisabled} onChange={(event) => onChange({ ...settings, includeSummary: event.target.checked })} />
    </label>
  );
  return <div className={`thinking-control${optionList ? "" : " thinking-control-inline"}`}>
    <div className="thinking-field thinking-choice-field">
    {optionList ? <fieldset className="thinking-options" disabled={disabled}>
      <legend>{choiceLabel}</legend>
      {capability.choices.map((choice) => <label className="thinking-option" key={choice}>
        <input type="radio" name={groupName} value={choice} checked={settings.choice === choice}
          onChange={() => choose(choice)} />
        <span>{thinkingLabels[choice]}</span><Check size={15} aria-hidden="true" />
      </label>)}
    </fieldset> : <div className="thinking-select">
      <label className="thinking-select-label" htmlFor={choiceId}><Lightbulb size={15} aria-hidden="true" /><span>{choiceLabel}</span></label>
      <SelectField id={choiceId} label={`${choiceLabel}（${scope}）`} disabled={disabled}
        value={settings.choice}
        options={[...capability.choices.map(choice => ({ value: choice, label: thinkingLabels[choice] })),
          ...(!capability.choices.includes(settings.choice) ? [{ value: settings.choice, label: `${thinkingLabels[settings.choice]}（当前协议不可用）`, disabled: true }] : [])]}
        onChange={value => choose(value as ThinkingChoice)} />
    </div>}
    </div>
    {capability.efforts && <div className="thinking-field thinking-effort-field"><div className="thinking-select">
      <label className="thinking-select-label" htmlFor={effortId}><span>思考力度</span></label>
      <SelectField id={effortId} label={`思考力度（${scope}）`}
        disabled={disabled} value={settings.effort ?? "default"}
        options={[...capability.efforts.map(effort => ({ value: effort, label: thinkingLabels[effort] })),
          ...(settings.effort && !capability.efforts.includes(settings.effort) ? [{ value: settings.effort, label: `${thinkingLabels[settings.effort]}（当前协议不可用）`, disabled: true }] : [])]}
        onChange={value => onChange({ ...settings, effort: value as ThinkingSettings["effort"] })} />
    </div></div>}
    {!optionList && <div className="thinking-field thinking-summary-field">{summaryToggle}</div>}
    {settings.choice === "budget" && <div className="thinking-field thinking-budget-field"><div className="thinking-budget">
      <label className="thinking-budget-label" htmlFor={budgetId}>Token 预算</label>
      <div className="thinking-budget-controls">
        <input id={budgetId} type="number" aria-label="思考 Token 预算"
          aria-invalid={budgetError ? true : undefined}
          aria-describedby={budgetError ? budgetErrorId : undefined}
          step="1" value={budget} disabled={disabled}
          onChange={(event) => { setBudget(event.target.value); setBudgetError(""); }} />
        <button type="button" className="thinking-budget-apply" disabled={disabled || budget === settings.budget} onClick={() => {
          const next = { ...settings, budget };
          const error = validateThinkingSelection(protocol, next);
          setBudgetError(error ?? "");
          if (!error && budget !== settings.budget) onChange(next);
        }}>应用预算</button>
        <span className="thinking-budget-applied">已应用：{settings.budget}</span>
      </div>
    </div></div>}
    {optionList && <div className="thinking-field thinking-summary-field">{summaryToggle}</div>}
    <span className="thinking-hint">{disabled ? "暂不可修改" : capability.summaryHint ?? hint}</span>
    {invalid && <button type="button" className="thinking-reset-button settings-button" disabled={disabled} onClick={() => onChange(defaultThinking)}>恢复思考默认配置</button>}
    {budgetError && <span id={budgetErrorId} className="thinking-notice" role="status">{budgetError}</span>}
  </div>;
}
