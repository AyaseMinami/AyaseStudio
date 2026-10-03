// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ThinkingSummary } from "./ThinkingSummary";
import { ThinkingControl, ThinkingToolbarControl } from "./ThinkingControl";
import { Composer } from "./Composer";
import { defaultGeminiThinking } from "../../chat/geminiThinking";
import { thinkingLabels, type ThinkingSettings } from "../../chat/thinking";
import type { StoredChatMessage } from "../../chat/repository";

async function optionsFor(host: HTMLElement, label: string) {
  const trigger = host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
  await act(async () => trigger.click());
  const labels = [...document.querySelectorAll('[role="option"]')].map(option => option.textContent);
  await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  return labels;
}

const labelsFor = (...choices: Array<keyof typeof thinkingLabels>) => choices.map(choice => thinkingLabels[choice]);

it("streams summaries, folds for the answer, respects manual expansion and shows interrupted content safely", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const message: StoredChatMessage = { id: "a", role: "assistant", content: "", thinkingSummary: "summary <script>bad()</script>", status: "streaming" };
  const render = async (update: Partial<StoredChatMessage>) => act(async () => root.render(<ThinkingSummary message={{ ...message, ...update }} />));
  try {
    await render({});
    expect(host.querySelector("section")?.getAttribute("aria-label")).toBe("思考内容");
    expect(host.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector("script")).toBeNull();
    await render({ content: "answer" });
    expect(host.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => host.querySelector("button")!.click());
    await render({ content: "answer updated", status: "aborted" });
    expect(host.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
    expect(host.textContent).toContain("已中断");
    expect(host.textContent).toContain("summary");
    await render({ thinkingSummary: undefined }); expect(host.textContent).toBe("");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("shows protocol-specific options for arbitrary model IDs", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<ThinkingControl model="gemini-3.8-flash" disabled={false} onChange={() => {}} />));
    expect(await optionsFor(host, "思考强度（当前助手）")).toEqual(labelsFor("default", "off", "minimal", "low", "medium", "high", "dynamic", "budget"));
    await act(async () => root.render(<ThinkingControl model="relay-alias" disabled={false} onChange={() => {}} />));
    expect(host.querySelector<HTMLButtonElement>('[role="combobox"]')?.disabled).toBe(false);
    expect(await optionsFor(host, "思考强度（当前助手）")).toEqual(labelsFor("default", "off", "minimal", "low", "medium", "high", "dynamic", "budget"));
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("uses Anthropic choices and its independent effort selector", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<ThinkingControl protocol="anthropic-native" model="claude-opus-5" disabled={false} onChange={() => {}} />));
    expect(await optionsFor(host, "思考模式（当前助手）")).toEqual(labelsFor("default", "off", "adaptive", "budget"));
    expect(await optionsFor(host, "思考力度（当前助手）")).toEqual(labelsFor("default", "low", "medium", "high", "xhigh", "max"));
    expect(host.textContent).toContain("显示思考内容");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("allows OpenAI Chat compatible reasoning display in the shared control", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  let changes = 0;
  try {
    await act(async () => root.render(<ThinkingControl protocol="openai-chat" model="gpt-5.6-sol"
      value={{ ...defaultGeminiThinking, includeSummary: true }} disabled={false} onChange={() => { changes++; }} />));
    expect(await optionsFor(host, "思考强度（当前助手）")).toEqual(labelsFor("default", "off", "minimal", "low", "medium", "high", "xhigh", "max"));
    const summary = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(summary?.disabled).toBe(false);
    expect(summary?.checked).toBe(true);
    await act(async () => summary?.click());
    expect(changes).toBe(1);
    expect(host.textContent).toContain("显示思考内容");
    expect(host.textContent).toContain("OpenAI 官方 Chat Completions 不保证返回此内容");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("maps keyboard choices and effort clicks, cancels without changes, and respects disabled thinking", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); const change = vi.fn();
  const settings = { ...defaultGeminiThinking, choice: "adaptive" as const, effort: "high" as const };
  try {
    await act(async () => root.render(<ThinkingControl protocol="anthropic-native" model="synthetic" value={settings} disabled={false} onChange={change} />));
    const strength = host.querySelector<HTMLButtonElement>('[aria-label="思考模式（当前助手）"]')!;
    await act(async () => strength.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    await act(async () => strength.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(change).not.toHaveBeenCalled();
    await act(async () => strength.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    await act(async () => strength.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    await act(async () => strength.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(change).toHaveBeenLastCalledWith({ ...settings, choice: "default" });
    const effort = host.querySelector<HTMLButtonElement>('[aria-label="思考力度（当前助手）"]')!;
    await act(async () => effort.click());
    await act(async () => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === thinkingLabels.max)!.click());
    expect(change).toHaveBeenLastCalledWith({ ...settings, effort: "max" });
    await act(async () => root.render(<ThinkingControl protocol="anthropic-native" model="synthetic" value={settings} disabled onChange={change} />));
    expect(strength.disabled).toBe(true); expect(effort.disabled).toBe(true);
    await act(async () => strength.click());
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("preserves unavailable thinking choices as disabled labels without changing saved settings", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); const change = vi.fn();
  const settings = { ...defaultGeminiThinking, choice: "dynamic" as const };
  try {
    await act(async () => root.render(<ThinkingControl protocol="anthropic-native" model="synthetic" value={settings} disabled={false} onChange={change} />));
    const strength = host.querySelector<HTMLButtonElement>('[aria-label="思考模式（当前助手）"]')!;
    expect(strength.textContent).toBe(`${thinkingLabels.dynamic}（当前协议不可用）`);
    await act(async () => strength.click());
    const option = document.querySelector<HTMLElement>('[role="option"][aria-disabled="true"]')!;
    expect(option.getAttribute("aria-selected")).toBe("true");
    await act(async () => option.click()); expect(change).not.toHaveBeenCalled();
    await act(async () => strength.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(strength.textContent).toContain(thinkingLabels.dynamic);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("owns an effort popup outside the filtered toolbar and cancels it before closing the toolbar", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); const change = vi.fn();
  try {
    await act(async () => root.render(<ThinkingToolbarControl protocol="anthropic-native" model="synthetic" disabled={false} onChange={change} />));
    const toolbar = host.querySelector<HTMLButtonElement>('[aria-label="思考设置"]')!;
    await act(async () => toolbar.click());
    const effort = host.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    await act(async () => effort.click());
    const option = document.querySelector<HTMLElement>('[role="option"]')!;
    expect(option.closest('[role="dialog"]')).toBeNull();
    await act(async () => option.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => effort.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(host.querySelector('[role="dialog"]')).not.toBeNull(); expect(change).not.toHaveBeenCalled();
    await act(async () => effort.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(toolbar);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("keeps tools on one row and hides thinking settings until opened; supports choice, summary and dismissal", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  let settings: ThinkingSettings = { ...defaultGeminiThinking };
  const render = () => root.render(<Composer draft="" isHydrated isGenerating={false}
    onDraftChange={() => {}} onSend={() => {}} onStop={() => {}}
    thinkingControl={<ThinkingToolbarControl model="gemini-3.8-flash" value={settings} disabled={false}
      onChange={(next) => { settings = next; render(); }} />} />);
  try {
    await act(async () => render());
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="思考设置"]')!;
    expect(trigger.closest(".composer-tools")).toBe(host.querySelector('[aria-label="添加附件"]')?.parentElement);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.textContent).not.toContain("显示思考内容");
    await act(async () => trigger.click());
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(host.querySelector("select")).toBeNull();
    await act(async () => host.querySelector<HTMLInputElement>('input[value="high"]')!.click());
    expect(settings.choice).toBe("high");
    expect(trigger.classList.contains("is-active")).toBe(true);
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(settings.includeSummary).toBe(true);
    await act(async () => host.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await act(async () => trigger.click());
    await act(async () => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
