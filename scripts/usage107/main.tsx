import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/App.css";
import { ChatWorkspace } from "../../src/ui/chat/ChatWorkspace";
import { createChatRepository, type StoredChatMessage } from "../../src/chat/repository";
import type { GenerationMetrics } from "../../src/chat/generationMetrics";
import { applyInitialAppearance, defaultAppearancePreferences } from "../../src/appearance/appearance";

const repository = createChatRepository("Usage107Synthetic");
await repository.initializeWorkspace(null, []);
const base: GenerationMetrics = { version: 1, protocol: "openai-chat", streaming: true,
  status: "complete", elapsedMs: 2500, firstTextMs: 600, firstThinkingMs: 180, usageComplete: true,
  usage: { inputTokens: 10000, outputTokens: 340, totalTokens: 10340, cacheReadTokens: 9900, reasoningTokens: 240 } };
function omit(metric: GenerationMetrics, fields: ("usage" | "firstTextMs" | "firstThinkingMs")[]) {
  const copy = { ...metric };
  for (const field of fields) delete copy[field];
  return copy;
}
const cases: Record<string, GenerationMetrics[] | undefined> = {
  "开始生成": [omit({ ...base, status: "streaming", elapsedMs: 0, usageComplete: false }, ["usage", "firstTextMs", "firstThinkingMs"])],
  "缓存命中": [base],
  "零命中": [{ ...base, usage: { ...base.usage, cacheReadTokens: 0 } }],
  "缺失用量": [omit({ ...base, usageComplete: false }, ["usage"])],
  "停止": [{ ...base, status: "aborted", usageComplete: false }],
  "非流式": [omit({ ...base, streaming: false }, ["firstTextMs", "firstThinkingMs"])],
  "继续生成": [{ ...base, status: "paused" }, { ...base, elapsedMs: 3000, usage: { inputTokens: 30000, outputTokens: 600 } }],
  "旧消息": undefined,
};
function messagesFor(name: string): StoredChatMessage[] {
  const metrics = cases[name];
  return [
    { id: `u-${name}`, role: "user", content: "检查输入框下方的生成统计。", status: "complete" },
    { id: `a-${name}`, role: "assistant", content: "这是一条合成回复。点击输入框下方统计可查看 Token、缓存、首字时间和请求速度。\n\n" + "这是阅读区的合成内容。\n\n".repeat(8),
      status: metrics?.[metrics.length - 1].status ?? "complete", ...(metrics ? { generationMetrics: metrics } : {}) },
  ];
}
if (!(await repository.load("current"))?.messages.length) await repository.save({ id: "current", updatedAt: 0, messages: messagesFor("缓存命中") });
const initial = (await repository.load("current"))!.messages;
function theme(dark: boolean) {
  applyInitialAppearance({ storage: { getItem: () => JSON.stringify({ ...defaultAppearancePreferences, themeMode: dark ? "dark" : "light" }), setItem: () => {} }, systemPrefersDark: false, target: document.documentElement });
}
theme(false);
function Review() {
  const [messages, setMessages] = useState(initial);
  const [draft, setDraft] = useState("");
  const [dark, setDark] = useState(false);
  const [narrow, setNarrow] = useState(false);
  return <div style={{ height: "100dvh", display: "flex", flexDirection: "column", margin: "0 auto", width: narrow ? "min(520px,100%)" : "100%" }}>
    <div style={{ flexShrink: 0, display: "flex", flexWrap: "wrap", gap: 6, padding: 8 }}>
      {Object.keys(cases).map(name => <button key={name} className="settings-button" onClick={async () => {
        const next = messagesFor(name); await repository.save({ id: "current", updatedAt: Date.now(), messages: next }); setMessages(next);
      }}>{name}</button>)}
      <button className="settings-button" onClick={() => { theme(!dark); setDark(!dark); }}>切换主题</button>
      <button className="settings-button" onClick={() => setNarrow(!narrow)}>切换宽度</button>
      <button className="settings-button" onClick={async () => setMessages((await repository.load("current"))!.messages)}>重新读取</button>
    </div>
    <div style={{ flex: 1, minHeight: 0, display: "flex" }}><ChatWorkspace title="#107 隔离验收" draft={draft}
      messages={messages} isHydrated isGenerating={messages[messages.length - 1]?.status === "streaming"} protocolLabel="合成数据" onDraftChange={setDraft}
      onClear={() => {}} onSend={() => {}} onStop={() => {}} /></div>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Review />);
