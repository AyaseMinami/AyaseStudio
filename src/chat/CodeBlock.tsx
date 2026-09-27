import { memo, useMemo, useState, type ReactNode } from "react";
import { Copy, Check, WrapText } from "lucide-react";
import { common, createLowlight } from "lowlight";
import powershell from "highlight.js/lib/languages/powershell";
import type { RootContent } from "hast";

const highlighter = createLowlight({ ...common, powershell });

function tokens(nodes: RootContent[]): ReactNode {
  return nodes.map((node, index) => node.type === "text" ? node.value
    : node.type === "element" ? <span key={index} className={(node.properties.className as string[] | undefined)?.join(" ")}>{tokens(node.children)}</span> : null);
}

export const CodeBlock = memo(function CodeBlock({ code, language }: { code: string; language: string }) {
  const [wrap, setWrap] = useState(true);
  const [feedback, setFeedback] = useState<{ code: string; message: string }>();
  const highlighted = useMemo(() => highlighter.registered(language.toLowerCase())
    ? tokens(highlighter.highlight(language.toLowerCase(), code).children) : code, [code, language]);
  const message = feedback?.code === code ? feedback.message : "";
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setFeedback({ code, message: "已复制" });
    } catch { setFeedback({ code, message: "复制失败，请重试" }); }
  }
  return <div className="code-block" data-wrap={wrap}>
    <div className="code-block-toolbar"><span className="code-block-language">{language || "纯文本"}</span>
      <div className="code-block-actions">
      <button type="button" aria-label="自动换行" aria-pressed={wrap}
        title={wrap ? "关闭自动换行，横向滚动" : "开启自动换行"} onClick={() => setWrap((value) => !value)}>
        <WrapText size={14} /><span>换行</span>
      </button>
      <button type="button" aria-label="复制代码" onClick={() => void copy()}>
        {message === "已复制" ? <Check size={14} /> : <Copy size={14} />}<span aria-live="polite">{message || "复制"}</span>
      </button>
      </div>
    </div>
    <pre><code>{highlighted}</code></pre>
  </div>;
});
