import { RotateCcw } from "lucide-react";
import { defaultAppearancePreferences, type BackgroundFit } from "../../appearance/appearance";

export function BackgroundDisplayControls({ fit, mask, blur, disabled, onFitChange, onMaskChange, onBlurChange }: {
  fit: BackgroundFit; mask: number; blur: number; disabled?: boolean;
  onFitChange(fit: BackgroundFit): void; onMaskChange(mask: number): void; onBlurChange(blur: number): void;
}) {
  return <div className="appearance-rows appearance-background-rows">
    <label className="appearance-row"><span className="appearance-row-copy"><strong>图片适配方式</strong></span><select className="field" disabled={disabled} value={fit} onChange={(event) => onFitChange(event.currentTarget.value as BackgroundFit)}><option value="cover">填充</option><option value="contain">适应</option></select></label>
    <div className="appearance-row appearance-range-row"><span className="appearance-row-copy"><strong>遮罩强度</strong></span><RangeControl value={`${mask}%`} ariaLabel="背景遮罩强度" valueNumber={mask} onChange={onMaskChange} onReset={() => onMaskChange(defaultAppearancePreferences.backgroundMask)} disabled={disabled} max="90" min="35" /></div>
    <div className="appearance-row appearance-range-row"><span className="appearance-row-copy"><strong>模糊程度</strong></span><RangeControl value={`${blur}px`} ariaLabel="背景模糊程度" valueNumber={blur} onChange={onBlurChange} onReset={() => onBlurChange(defaultAppearancePreferences.backgroundBlur)} disabled={disabled} max="32" min="0" /></div>
  </div>;
}

export function RangeControl({ ariaLabel, disabled, max, min, onChange, onReset, value, valueNumber }: { ariaLabel: string; disabled?: boolean; max: string; min: string; onChange(value: number): void; onReset(): void; value: string; valueNumber: number }) {
  const resetLabel = ariaLabel === "统一透明度" ? "恢复各区域默认透明度" : `恢复${ariaLabel}默认值`;
  return <span className="appearance-range-actions"><span className="appearance-range-control"><output>{value}</output><input aria-label={ariaLabel} disabled={disabled} max={max} min={min} step="1" type="range" value={valueNumber} onChange={(event) => onChange(Number(event.currentTarget.value))} /></span><button className="settings-button appearance-color-reset" type="button" disabled={disabled} title={resetLabel} aria-label={resetLabel} onClick={onReset}><RotateCcw size={15} aria-hidden="true" /></button></span>;
}
