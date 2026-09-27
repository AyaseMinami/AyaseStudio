import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { CircleHelp } from "lucide-react";
import "./SettingsHelp.css";

export function SettingsHelp({ label, children }: { label: string; children: string }) {
  const id = useId();
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  function show(element: HTMLButtonElement) {
    const rect = element.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 296)), top: rect.bottom + 6 });
  }
  return <span className="settings-help">
    <button type="button" className="settings-help-trigger" aria-label={`${label}说明`} aria-describedby={position ? id : undefined}
      onMouseEnter={(event) => show(event.currentTarget)} onMouseLeave={() => setPosition(null)}
      onFocus={(event) => show(event.currentTarget)} onBlur={() => setPosition(null)}
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setPosition(null); } }}>
      <CircleHelp size={14} aria-hidden="true" />
    </button>
    {position && createPortal(<span id={id} role="tooltip" className="settings-help-tooltip" style={position}>{children}</span>, document.body)}
  </span>;
}
