// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import type { GenerationMetrics } from "../../chat/generationMetrics";
import type { StoredChatMessage } from "../../chat/repository";
import { GenerationStats, averageSpeed, cacheHit } from "./GenerationStats";

const metrics: GenerationMetrics = { version: 1, protocol: "openai-chat", streaming: true, status: "complete",
  elapsedMs: 2000, firstTextMs: 800, firstThinkingMs: 200, usageComplete: true,
  usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheReadTokens: 80, reasoningTokens: 15 } };
function reply(id: string, generationMetrics?: GenerationMetrics[]): StoredChatMessage {
  return { id, role: "assistant", content: "Synthetic", status: "complete", generationMetrics };
}

it("distinguishes missing cache from explicit zero, avoids zero-division and excludes partial speed", () => {
  expect(cacheHit(metrics)).toBe("80%");
  expect(cacheHit({ ...metrics, usage: { inputTokens: 100 } })).toBe("未提供");
  expect(cacheHit({ ...metrics, usage: { inputTokens: 100, cacheReadTokens: 0 } })).toBe("0%");
  expect(cacheHit({ ...metrics, usage: { inputTokens: 0, cacheReadTokens: 0 } })).toBe("未提供");
  expect(cacheHit({ ...metrics, usage: { inputTokens: 10000, cacheReadTokens: 9999 } })).toBe("<100%");
  expect(averageSpeed(metrics)).toBe("10.0 tok/s");
  expect(averageSpeed({ ...metrics, status: "failed" })).toBe("未提供");
  expect(averageSpeed({ ...metrics, usageComplete: false })).toBe("未提供");
  expect(averageSpeed({ ...metrics, elapsedMs: 0 })).toBe("未提供");
});

it("shows latest reply below composer, browses earlier/continued requests, and resets across conversations", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<GenerationStats messages={[reply("old"), reply("a", [metrics]),
      reply("b", [{ ...metrics, status: "paused" }, { ...metrics, streaming: false, firstTextMs: undefined, firstThinkingMs: undefined,
        usage: { inputTokens: 200, outputTokens: 10 } }])]} />));
    const summary = host.querySelector("summary")!;
    expect(summary.textContent).toContain("输入 200");
    expect(summary.textContent).toContain("缓存 未提供");
    expect(summary.textContent).toContain("首字 非流式");
    const details = host.querySelector("details")!; details.open = true;
    const invocation = host.querySelector<HTMLButtonElement>('[aria-label="选择生成请求"]')!;
    await act(async () => invocation.click());
    await act(async () => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === "第 1 次 · 已暂停")!.click());
    expect(host.querySelector(".generation-stats-state")!.textContent).toContain("已暂停");
    const select = host.querySelector<HTMLButtonElement>('[aria-label="选择回复统计"]')!;
    await act(async () => select.click());
    await act(async () => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === "第 1 条回复")!.click());
    expect(host.querySelector(".generation-stats-panel")!.textContent).toContain("80%");
    await act(async () => select.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(details.open).toBe(false); expect(document.activeElement).toBe(summary);
    await act(async () => root.render(<GenerationStats messages={[reply("other", [{ ...metrics, usage: { inputTokens: 9 } }])]} />));
    expect(host.querySelector("summary")!.textContent).toContain("输入 9");
    expect(host.querySelector("summary")!.textContent).not.toContain("200");
    await act(async () => root.render(<GenerationStats messages={[reply("legacy")]} />));
    expect(host.querySelector("details")).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("keeps nested selector clicks in stats, cancels the selector before details, and closes on outside pointer", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<GenerationStats messages={[reply("a", [metrics]), reply("b", [metrics])]} />));
    const details = host.querySelector("details")!; details.open = true;
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="选择回复统计"]')!;
    await act(async () => trigger.click());
    const option = document.querySelector<HTMLElement>('[role="option"]')!;
    expect(details.contains(option)).toBe(false);
    await act(async () => option.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(details.open).toBe(true);
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(details.open).toBe(true); expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(trigger.textContent).toContain("第 2 条回复（最近）");
    await act(async () => trigger.click());
    await act(async () => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(details.open).toBe(false); expect(document.querySelector('[role="listbox"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("keeps the explanation in external help and the expanded panel limited to data", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<GenerationStats messages={[reply("a", [metrics])]} />));
    const details = host.querySelector("details")!;
    const help = host.querySelector<HTMLButtonElement>('[aria-label="生成统计说明"]')!;
    expect(details.contains(help)).toBe(false);
    expect(host.querySelector(".generation-stats-panel")!.textContent).not.toContain("不按正文长度估算");
    expect(host.querySelectorAll("dl > div")).toHaveLength(12);
    await act(async () => help.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    const tooltip = document.querySelector('[role="tooltip"]')!;
    expect(tooltip.textContent!.split("\n\n").map(item => item.split("：")[0])).toEqual([
      "输入 Token", "输出 Token", "缓存命中率", "正文首字时间", "思考首字时间", "请求总耗时", "平均速度", "继续生成",
    ]);
    expect(tooltip.textContent).toContain("平均速度：输出 Token ÷ 请求总耗时");
    expect(help.getAttribute("aria-describedby")).toBe(tooltip.id);
    await act(async () => help.click());
    expect(details.open).toBe(false);
    await act(async () => help.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    await act(async () => help.focus());
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
    await act(async () => help.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
