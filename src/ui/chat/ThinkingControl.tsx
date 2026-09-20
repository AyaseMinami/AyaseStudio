import { useEffect, useId, useRef, useState } from "react";
import { Check, Lightbulb } from "lucide-react";
import type { ChatProtocol } from "../../chat/types";
import { defaultThinking, isThinkingSettings, thinkingOptions, thinkingLabels,
  validateThinkingSelection, type ThinkingSettings, type ThinkingChoice } from "../../chat/thinking";

interface ThinkingControlProps {
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
      if (!container.current?.contains(event.target as Node)) setOpen(false);
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
      onClick={() => setOpen((current) => !current)}><Lightbulb size={18} />
    </button>
    {open && <div id={panelId} className="thinking-popover" role="dialog" aria-label="思考设置">
      <ThinkingControl key={settings.budget} {...props} optionList />
    </div>}
  </div>;
}

export function ThinkingControl({ protocol = "gemini-native", value, disabled, hint = "当前助手 · 自动保存", optionList, onChange, scope = "当前助手" }: ThinkingControlProps) {
  const settings = isThinkingSettings(value) ? value : defaultThinking;
  const capability = thinkingOptions(protocol);
  const [budget, setBudget] = useState(settings.budget);
  const [budgetError, setBudgetError] = useState("");
  const invalid = value !== undefined && !isThinkingSettings(value);
  const groupName = useId();
  function choose(choice: ThinkingChoice) {
    const next = { ...settings, choice, budget: settings.budget };
    setBudget(next.budget); setBudgetError(""); onChange(next);
  }
  return <div className={`thinking-control${optionList ? "" : " thinking-control-inline"}`}>
    <div className="thinking-field">
    {optionList ? <fieldset className="thinking-options" disabled={disabled}>
      <legend>思考强度</legend>
      {capability.choices.map((choice) => <label className="thinking-option" key={choice}>
        <input type="radio" name={groupName} value={choice} checked={settings.choice === choice}
          onChange={() => choose(choice)} />
        <span>{thinkingLabels[choice]}</span><Check size={15} aria-hidden="true" />
      </label>)}
    </fieldset> : <label className="thinking-select"><Lightbulb size={16} />
      <span>思考</span>
      <select aria-label={`思考强度（${scope}）`} disabled={disabled}
        value={settings.choice}
        onChange={(event) => choose(event.target.value as ThinkingChoice)}>
        {capability.choices.map((choice) => <option key={choice} value={choice}>{thinkingLabels[choice]}</option>)}
      </select>
    </label>}

    </div>
    <div className="thinking-field"><label className="thinking-summary-toggle"><input type="checkbox" checked={capability.summary && settings.includeSummary}
      disabled={disabled || !capability.summary} onChange={(event) => onChange({ ...settings, includeSummary: event.target.checked })} />显示思考摘要</label>
    </div>
    {capability.efforts && <div className="thinking-field"><label className="thinking-select"><span>思考力度</span><select aria-label={`思考力度（${scope}）`}
      disabled={disabled} value={settings.effort ?? "default"} onChange={(event) => onChange({ ...settings, effort: event.target.value as ThinkingSettings["effort"] })}>
      {capability.efforts.map((effort) => <option key={effort} value={effort}>{thinkingLabels[effort]}</option>)}
    </select></label>
    </div>}
    {settings.choice === "budget" && <div className="thinking-field"><label className="thinking-budget">
      Token 预算<input type="number" aria-label="思考 Token 预算" step="1"
        value={budget} disabled={disabled} onChange={(event) => { setBudget(event.target.value); setBudgetError(""); }} />
      <button type="button" disabled={disabled || budget === settings.budget} onClick={() => {
          const next = { ...settings, budget };
          const error = validateThinkingSelection(protocol, next);
          setBudgetError(error ?? "");
          if (!error && budget !== settings.budget) onChange(next);
        }}>应用预算</button><span>已应用：{settings.budget}</span>
    </label>
    </div>}
    <span className="thinking-hint">{disabled ? "暂不可修改" : capability.summaryHint ?? hint}</span>
    {invalid && <button type="button" disabled={disabled} onClick={() => onChange(defaultThinking)}>恢复思考默认配置</button>}
    {budgetError && <span className="thinking-notice" role="status">{budgetError}</span>}
  </div>;
}
