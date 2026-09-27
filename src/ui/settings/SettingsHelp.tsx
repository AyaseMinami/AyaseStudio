import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CircleHelp } from "lucide-react";
import "./SettingsHelp.css";

export function SettingsHelp({ label, children, icon = <CircleHelp size={14} aria-hidden="true" /> }: { label: string; children: string; icon?: ReactNode }) {
  const id = useId();
  const tooltip = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; above: number } | null>(null);
  useLayoutEffect(() => {
    if (!position || !tooltip.current) return;
    const height = tooltip.current.getBoundingClientRect().height;
    tooltip.current.style.top = `${Math.max(8, position.top + height > window.innerHeight - 8 ? position.above - height : position.top)}px`;
  }, [position]);
  function show(element: HTMLButtonElement) {
    const rect = element.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 296)), top: rect.bottom + 6, above: rect.top - 6 });
  }
  return <span className="settings-help">
    <button type="button" className="settings-help-trigger" aria-label={`${label}说明`} aria-describedby={position ? id : undefined}
      onMouseEnter={(event) => show(event.currentTarget)} onMouseLeave={() => setPosition(null)}
      onFocus={(event) => show(event.currentTarget)} onBlur={() => setPosition(null)}
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setPosition(null); } }}>
      {icon}
    </button>
    {position && createPortal(<span ref={tooltip} id={id} role="tooltip" className="settings-help-tooltip" style={{ left: position.left, top: position.top }}>{children}</span>, document.body)}
  </span>;
}
