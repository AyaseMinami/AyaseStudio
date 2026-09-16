import { useEffect, useId, useRef, useState } from "react";
import { Check, Lightbulb } from "lucide-react";
import { defaultGeminiThinking, geminiThinkingCapability, isGeminiThinkingSettings, thinkingLabels,
  validateGeminiThinking, type GeminiThinkingSettings, type ThinkingChoice } from "../../chat/geminiThinking";

interface ThinkingControlProps {
  model: string; value?: GeminiThinkingSettings; disabled: boolean; notice?: string;
  hint?: string;
  optionList?: boolean;
  onChange(value: GeminiThinkingSettings): void;
}

export function ThinkingToolbarControl(props: ThinkingControlProps) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const settings = isGeminiThinkingSettings(props.value) ? props.value : defaultGeminiThinking;
  const known = !!geminiThinkingCapability(props.model);
  const active = known && settings.choice !== "default" && settings.choice !== "off";
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
      title={known ? `思考：${thinkingLabels[settings.choice]}${props.notice ? ` · ${props.notice}` : ""}` : "思考设置：模型能力未识别"}
      onClick={() => setOpen((current) => !current)}><Lightbulb size={18} />
      {props.notice && <span className="thinking-notice-dot" aria-label="思考设置有提示" />}
    </button>
    {open && <div id={panelId} className="thinking-popover" role="dialog" aria-label="思考设置">
      <ThinkingControl key={settings.budget} {...props} optionList />
    </div>}
  </div>;
}

export function ThinkingControl({ model, value, disabled, notice, hint = "当前助手 · 自动保存", optionList, onChange }: ThinkingControlProps) {
  const settings = isGeminiThinkingSettings(value) ? value : defaultGeminiThinking;
  const capability = geminiThinkingCapability(model);
  const [budget, setBudget] = useState(settings.budget);
  const [budgetError, setBudgetError] = useState("");
  const invalid = value !== undefined && !isGeminiThinkingSettings(value);
  const groupName = useId();
  function choose(choice: ThinkingChoice) {
    const next = { ...settings, choice, budget: choice === "budget" ? "1024" : settings.budget };
    setBudget(next.budget); setBudgetError(""); onChange(next);
  }
  return <div className="thinking-control">
    {optionList ? <fieldset className="thinking-options" disabled={disabled || !capability}>
      <legend>思考强度</legend>
      {(capability?.choices ?? ["default"]).map((choice) => <label className="thinking-option" key={choice}>
        <input type="radio" name={groupName} value={choice} checked={settings.choice === choice}
          onChange={() => choose(choice)} />
        <span>{thinkingLabels[choice]}</span><Check size={15} aria-hidden="true" />
      </label>)}
    </fieldset> : <label className="thinking-select"><Lightbulb size={16} />
      <span>思考</span>
      <select aria-label="思考强度（当前助手）" disabled={disabled || !capability}
        value={capability?.choices.includes(settings.choice) ? settings.choice : "default"}
        onChange={(event) => choose(event.target.value as ThinkingChoice)}>
        {(capability?.choices ?? ["default"]).map((choice) => <option key={choice} value={choice}>{thinkingLabels[choice]}</option>)}
      </select>
    </label>}
    {capability && <label className="thinking-summary-toggle"><input type="checkbox" checked={settings.includeSummary}
      disabled={disabled} onChange={(event) => onChange({ ...settings, includeSummary: event.target.checked })} />显示思考摘要</label>}
    {settings.choice === "budget" && capability?.minBudget !== undefined && <label className="thinking-budget">
      Token 预算<input type="number" aria-label="思考 Token 预算" min={capability.minBudget} max={capability.maxBudget}
        value={budget} disabled={disabled} onChange={(event) => { setBudget(event.target.value); setBudgetError(""); }} />
      <button type="button" disabled={disabled || budget === settings.budget} onClick={() => {
          const next = { ...settings, budget };
          const error = validateGeminiThinking(model, next);
          setBudgetError(error ?? "");
          if (!error && budget !== settings.budget) onChange(next);
        }}>应用预算</button><span>已应用：{settings.budget}</span>
    </label>}
    <span className="thinking-hint">{capability ? disabled ? "暂不可修改" : hint : "模型思考能力未识别，不发送思考参数"}</span>
    {invalid && <button type="button" disabled={disabled} onClick={() => onChange(defaultGeminiThinking)}>恢复思考默认配置</button>}
    {(notice || budgetError) && <span className="thinking-notice" role="status">{budgetError || notice}</span>}
  </div>;
}
