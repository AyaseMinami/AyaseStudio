import { useState } from "react";
import { ChevronRight, Lightbulb } from "lucide-react";
import { SafeMarkdown } from "../../chat/SafeMarkdown";
import type { StoredChatMessage } from "../../chat/repository";

export function ThinkingSummary({ message }: { message: StoredChatMessage }) {
  const [userExpanded, setUserExpanded] = useState<boolean>();
  if (!message.thinkingSummary) return null;
  const receiving = message.status === "streaming" && !message.content;
  const expanded = userExpanded ?? receiving;
  const interrupted = message.status === "aborted" || message.status === "failed" || message.status === "incomplete";
  return <section className="thinking-summary" aria-label="思考摘要">
    <button type="button" className="thinking-summary-heading" aria-expanded={expanded}
      aria-controls={`thinking-${message.id}`} onClick={() => setUserExpanded(!expanded)}>
      <Lightbulb size={16} /><span>{receiving ? "正在接收思考摘要…" : interrupted ? "思考摘要 · 已中断" : "思考摘要"}</span>
      <ChevronRight size={16} className={expanded ? "thinking-chevron-open" : ""} />
    </button>
    {expanded && <div className="thinking-summary-content markdown" id={`thinking-${message.id}`}>
      <SafeMarkdown>{message.thinkingSummary}</SafeMarkdown>
    </div>}
  </section>;
}
