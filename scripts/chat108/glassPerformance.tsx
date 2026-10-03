import { useState } from "react";
import type { StoredChatMessage } from "../../src/chat/repository";

export const glassPerformanceEnabled = new URLSearchParams(location.search).has("glass-performance");
const resizeOnly = new URLSearchParams(location.search).get("glass-scenario") === "workspace-resize";
const paragraph = "这是一段合成阅读材料，用来观察玻璃开关前后的滚动和布局成本。保留代码、表格与中文换行。".repeat(12);
export const performanceMessages: StoredChatMessage[] = Array.from({ length: 80 }, (_, index) => ({
  id: `glass98-${index}`, role: index % 2 ? "assistant" : "user", status: "complete",
  content: index % 2 ? `## 第 ${index + 1} 条合成回复\n\n${paragraph}\n\n${paragraph}\n\n| 项目 | 值 |\n| --- | --- |\n| 示例 | 98 |\n\n\`\`\`typescript\nconst values = Array.from({ length: 20 }, (_, i) => i * 2);\n\`\`\`` : `第 ${index / 2 + 1} 轮合成问题`,
}));
type Scenario = "idle" | "scroll" | "stream" | "workspace-resize";
type Result = {
  theme: string; mode: string; scenario: Scenario; repetition: number; elapsedMs: number;
  frames: number; meanMs: number; p95Ms: number; maxMs: number; over32: number;
  longTasks: number; longTaskMs: number; updates: number;
  sidebarFilter: string; composerFilter: string; sidebarVisible: boolean;
  shellWidth: number; scrollHeight: number; messageCount: number; characters: number;
};
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const modes = [
  { name: "off", sidebar: false, composer: false },
  { name: "composer", sidebar: false, composer: true },
  { name: "sidebar", sidebar: true, composer: false },
  { name: "both", sidebar: true, composer: true },
];

export function GlassPerformance({ ready, onMessages, onGlass, onTheme, onPrepare }: {
  ready: boolean;
  onMessages(messages: StoredChatMessage[], generating: boolean): void;
  onGlass(sidebar: boolean, composer: boolean): void;
  onTheme(theme: "light" | "dark"): void;
  onPrepare(): void;
}) {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("待运行：80 条合成消息，生产构建，四种玻璃组合。");
  const [output, setOutput] = useState("");
  async function run(theme: "light" | "dark") {
    setRunning(true); setOutput(""); onPrepare(); onTheme(theme);
    const shell = document.querySelector<HTMLElement>(".app-shell")!;
    const previousWidth = shell.style.width;
    const results: Result[] = [];
    try {
      for (let repetition = 0; repetition < 3; repetition++) {
        // Alternate order to reduce a fixed warmup / time-order bias.
        for (const mode of repetition % 2 ? [...modes].reverse() : modes) {
          onGlass(mode.sidebar, mode.composer);
          for (const scenario of (resizeOnly ? ["workspace-resize"] : ["idle", "scroll", "stream", "workspace-resize"]) as Scenario[]) {
            setStatus(`${theme} / ${mode.name} / ${scenario} / ${repetition + 1}`);
            onMessages(performanceMessages, scenario === "stream");
            shell.style.width = "100%";
            await pause(800);
            const scroll = document.querySelector<HTMLElement>(".message-scroll-region")!;
            scroll.scrollTop = scenario === "scroll" ? 0 : scroll.scrollHeight;
            const navigation = document.querySelector<HTMLElement>(".conversation-workspace-body")!;
            const sidebarFilter = getComputedStyle(navigation, "::before").backdropFilter;
            const composerFilter = getComputedStyle(document.querySelector(".composer-frame")!).backdropFilter;
            const sidebarVisible = navigation.dataset.navigationOpen === "true";
            const intervals: number[] = [];
            const tasks: PerformanceEntry[] = [];
            const observer = PerformanceObserver.supportedEntryTypes.includes("longtask")
              ? new PerformanceObserver(list => tasks.push(...list.getEntries())) : null;
            observer?.observe({ type: "longtask" });
            let last: number | undefined, start: number | undefined, lastUpdate = 0, updates = 0;
            const streamBase = performanceMessages.slice(0, -1);
            await new Promise<void>(resolve => {
              const tick = (now: number) => {
                if (start === undefined) start = now;
                if (last !== undefined) intervals.push(now - last);
                last = now;
                const elapsed = now - start;
                if (elapsed >= 2500) { resolve(); return; }
                if (scenario === "scroll") {
                  scroll.scrollTop = (scroll.scrollHeight - scroll.clientHeight) * (0.5 - 0.5 * Math.cos(elapsed / 2500 * Math.PI * 4));
                  updates++;
                } else if (scenario === "stream" && elapsed - lastUpdate >= 50) {
                  lastUpdate = elapsed; updates++;
                  onMessages([...streamBase, { ...performanceMessages[79], status: "streaming", content: paragraph.repeat(2).slice(0, updates * 24) }], true);
                } else if (scenario === "workspace-resize") {
                  shell.style.width = `${680 + (innerWidth - 680) * (0.5 + 0.5 * Math.cos(elapsed / 2500 * Math.PI * 4))}px`;
                  updates++;
                }
                requestAnimationFrame(tick);
              };
              requestAnimationFrame(tick);
            });
            tasks.push(...(observer?.takeRecords() ?? [])); observer?.disconnect();
            const elapsedMs = last! - start!;
            const measuredTasks = tasks.filter(task => task.startTime >= start! && task.startTime < last!);
            const sorted = [...intervals].sort((a, b) => a - b);
            results.push({ theme, mode: mode.name, scenario, repetition: repetition + 1, elapsedMs,
              frames: intervals.length, meanMs: elapsedMs / intervals.length,
              p95Ms: sorted[Math.ceil(sorted.length * .95) - 1], maxMs: sorted[sorted.length - 1],
              over32: intervals.filter(value => value > 32).length,
              longTasks: measuredTasks.length, longTaskMs: measuredTasks.reduce((sum, task) => sum + task.duration, 0),
              updates, sidebarFilter, composerFilter, sidebarVisible,
              shellWidth: shell.getBoundingClientRect().width, scrollHeight: scroll.scrollHeight,
              messageCount: performanceMessages.length, characters: performanceMessages.reduce((sum, message) => sum + message.content.length, 0),
            });
            shell.style.width = "100%";
          }
        }
      }
      setOutput(JSON.stringify({ version: 1, build: import.meta.env.PROD ? "production" : "development",
        viewport: [innerWidth, innerHeight], userAgent: navigator.userAgent,
        longTaskSupported: PerformanceObserver.supportedEntryTypes.includes("longtask"),
        visibility: document.visibilityState, results }, null, 2));
      setStatus(`${theme} 完成：${results.length} 个采样窗口。`);
    } catch (error) { setStatus(`采集失败：${String(error)}`); }
    finally {
      shell.style.width = previousWidth;
      onMessages(performanceMessages, false); onGlass(false, true); setRunning(false);
    }
  }
  return <section className="glass98-performance" aria-label="玻璃性能采集">
    <p role="status">{status}</p>
    <button type="button" disabled={!ready || running} onClick={() => void run("light")}>采集浅色性能</button>
    <button type="button" disabled={!ready || running} onClick={() => void run("dark")}>采集深色性能</button>
    {!running && <textarea aria-label="玻璃性能结果 JSON" readOnly value={output} />}
  </section>;
}
