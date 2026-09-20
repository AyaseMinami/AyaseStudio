// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { ThinkingSummary } from "./ThinkingSummary";
import { ThinkingControl, ThinkingToolbarControl } from "./ThinkingControl";
import { Composer } from "./Composer";
import { defaultGeminiThinking } from "../../chat/geminiThinking";
import type { ThinkingSettings } from "../../chat/thinking";
import type { StoredChatMessage } from "../../chat/repository";

it("streams summaries, folds for the answer, respects manual expansion and shows interrupted content safely", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const message: StoredChatMessage = { id: "a", role: "assistant", content: "", thinkingSummary: "summary <script>bad()</script>", status: "streaming" };
  const render = async (update: Partial<StoredChatMessage>) => act(async () => root.render(<ThinkingSummary message={{ ...message, ...update }} />));
  try {
    await render({});
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
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<ThinkingControl model="gemini-3.8-flash" disabled={false} onChange={() => {}} />));
    expect([...host.querySelectorAll("option")].map((option) => option.value)).toEqual(["default", "off", "minimal", "low", "medium", "high", "dynamic", "budget"]);
    await act(async () => root.render(<ThinkingControl model="relay-alias" disabled={false} onChange={() => {}} />));
    expect(host.querySelector("select")?.disabled).toBe(false);
    expect([...host.querySelectorAll("option")].map((option) => option.value)).toEqual(["default", "off", "minimal", "low", "medium", "high", "dynamic", "budget"]);
  } finally { await act(async () => root.unmount()); }
});

it("uses Anthropic choices and its independent effort selector", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<ThinkingControl protocol="anthropic-native" model="claude-opus-5" disabled={false} onChange={() => {}} />));
    expect([...host.querySelectorAll("option")].map((option) => option.value)).toEqual([
      "default", "off", "adaptive", "budget", "default", "low", "medium", "high", "xhigh", "max",
    ]);
    expect(host.textContent).toContain("显示思考摘要");
  } finally { await act(async () => root.unmount()); }
});

it("keeps OpenAI Chat summary unavailable in the shared control", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); const root = createRoot(host);
  let changes = 0;
  try {
    await act(async () => root.render(<ThinkingControl protocol="openai-chat" model="gpt-5.6-sol"
      value={{ ...defaultGeminiThinking, includeSummary: true }} disabled={false} onChange={() => { changes++; }} />));
    expect([...host.querySelectorAll("option")].map((option) => option.value)).toEqual(["default", "off", "minimal", "low", "medium", "high", "xhigh", "max"]);
    const summary = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(summary?.disabled).toBe(true);
    expect(summary?.checked).toBe(false);
    await act(async () => summary?.click());
    expect(changes).toBe(0);
    expect(host.textContent).toContain("尚未接入 Chat Completions 的思考摘要扩展");
  } finally { await act(async () => root.unmount()); }
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
    expect(host.textContent).not.toContain("显示思考摘要");
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
