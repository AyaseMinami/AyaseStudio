import { useEffect, useRef, useState } from "react";
import { Database, Gauge, Hash, Timer } from "lucide-react";
import type { StoredChatMessage } from "../../chat/repository";
import type { GenerationMetrics } from "../../chat/generationMetrics";
import "./GenerationStats.css";

const unavailable = "未提供";
const count = (value?: number) => value === undefined ? unavailable : value.toLocaleString("zh-CN");
const duration = (value?: number) => value === undefined ? unavailable : `${(value / 1000).toFixed(2)} s`;
const statusLabels = { streaming: "生成中", complete: "已完成", incomplete: "未完整", paused: "已暂停", aborted: "已停止", failed: "失败" };

export function cacheHit(metrics: GenerationMetrics): string {
  const { inputTokens, cacheReadTokens } = metrics.usage ?? {};
  if (inputTokens === undefined || inputTokens <= 0 || cacheReadTokens === undefined) return unavailable;
  const percent = cacheReadTokens / inputTokens * 100;
  if (percent < 100 && Number(percent.toFixed(1)) === 100) return "<100%";
  return `${Number(percent.toFixed(1))}%`;
}

export function averageSpeed(metrics: GenerationMetrics): string {
  const output = metrics.usage?.outputTokens;
  if (!metrics.usageComplete || !["complete", "incomplete", "paused"].includes(metrics.status) || output === undefined || metrics.elapsedMs <= 0) return unavailable;
  return `${(output / (metrics.elapsedMs / 1000)).toFixed(1)} tok/s`;
}

export function GenerationStats({ messages }: { messages: StoredChatMessage[] }) {
  const replies = messages.filter(message => message.role === "assistant" && message.generationMetrics?.length);
  const latest = replies[replies.length - 1];
  return latest ? <StatsBar key={latest.id} replies={replies} latest={latest} /> : null;
}

function StatsBar({ replies, latest }: { replies: StoredChatMessage[]; latest: StoredChatMessage }) {
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const [selectedReply, setSelectedReply] = useState(latest.id);
  const [selectedInvocation, setSelectedInvocation] = useState<number>();
  const latestMetrics = latest.generationMetrics!;
  const latestMetric = latestMetrics[latestMetrics.length - 1];
  const reply = replies.find(item => item.id === selectedReply) ?? latest;
  const invocations = reply.generationMetrics!;
  const index = Math.min(selectedInvocation ?? invocations.length - 1, invocations.length - 1);
  const metrics = invocations[index];
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (details.current?.open && !details.current.contains(event.target as Node)) details.current.open = false;
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  const usage = metrics.usage;
  const rows = [
    ["输入 Token（含缓存）", count(usage?.inputTokens)], ["输出 Token（含思考）", count(usage?.outputTokens)],
    ["总 Token", count(usage?.totalTokens)], ["思考 Token", count(usage?.reasoningTokens)],
    ["普通输入 Token", count(usage?.uncachedInputTokens)], ["缓存读取 Token", count(usage?.cacheReadTokens)],
    ["缓存写入 Token", count(usage?.cacheWriteTokens)], ["缓存命中率", cacheHit(metrics)],
    ["请求总耗时", duration(metrics.elapsedMs)],
    ["正文首字时间", metrics.streaming ? duration(metrics.firstTextMs) : "非流式不可测"],
    ["思考首字时间", metrics.streaming ? duration(metrics.firstThinkingMs) : "非流式不可测"],
    ["平均速度（端到端）", averageSpeed(metrics)],
  ];
  return <details ref={details} className="generation-stats" onKeyDown={event => {
    if (event.key === "Escape" && details.current?.open) {
      event.preventDefault(); event.stopPropagation(); details.current.open = false; summary.current?.focus();
    }
  }}>
    <summary ref={summary} aria-label="查看生成统计" title="当前对话最近一次生成；点击查看详情">
      <span><Hash size={14} aria-hidden="true" />输入 {count(latestMetric.usage?.inputTokens)} · 输出 {count(latestMetric.usage?.outputTokens)}</span>
      <span><Gauge size={14} aria-hidden="true" />{averageSpeed(latestMetric)}</span>
      <span><Database size={14} aria-hidden="true" />缓存 {cacheHit(latestMetric)}</span>
      <span><Timer size={14} aria-hidden="true" />首字 {latestMetric.streaming ? duration(latestMetric.firstTextMs) : "非流式"}</span>
      {latestMetric.status === "streaming" && <span>生成中</span>}
      {latestMetric.status !== "streaming" && !latestMetric.usageComplete && <span>用量不完整</span>}
    </summary>
    <section className="generation-stats-panel" aria-label="生成统计详情">
      <div className="generation-stats-selectors">
        <label>回复<select aria-label="选择回复统计" value={reply.id} onChange={event => {
          setSelectedReply(event.target.value); setSelectedInvocation(undefined);
        }}>{replies.map((item, position) => <option key={item.id} value={item.id}>第 {position + 1} 条回复{item.id === latest.id ? "（最近）" : ""}</option>)}</select></label>
        {invocations.length > 1 && <label>请求<select aria-label="选择生成请求" value={index} onChange={event => setSelectedInvocation(Number(event.target.value))}>
          {invocations.map((item, position) => <option key={position} value={position}>第 {position + 1} 次 · {statusLabels[item.status]}</option>)}
        </select></label>}
      </div>
      <p className="generation-stats-state">{statusLabels[metrics.status]} · {metrics.streaming ? "流式" : "非流式"} · {metrics.usageComplete ? "供应商终态用量" : metrics.usage ? "供应商部分用量" : "供应商未返回用量"}</p>
      <dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <p className="generation-stats-note">Token 用量来自接口返回，不按正文长度估算。缓存命中率为缓存读取 ÷ 总输入，缺失字段与零不同。</p>
      <p className="generation-stats-note">首字从聊天请求开始计时，取首个非空正文增量；思考单独记录。非流式、没有正文或被隐藏的思考没有对应首字时间。</p>
      <p className="generation-stats-note">平均速度为输出 Token ÷ 请求总耗时，含等待、思考与模型搜索，不是纯正文输出速度。外部检索与本地准备不计入。停止／失败仅保留已返回用量，不计算平均速度；继续生成逐次记录。</p>
    </section>
  </details>;
}
