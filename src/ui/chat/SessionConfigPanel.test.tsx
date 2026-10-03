// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { defaultSessionConfig } from "../../chat/sessionConfig";
import { SessionConfigPanel } from "./SessionConfigPanel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("keeps the stream switch controlled and within the disabled panel", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const change = vi.fn(); const config = defaultSessionConfig();
  const render = (stream: boolean, disabled = false) => root.render(<SessionConfigPanel config={{ ...config, stream }} errors={{}} model="synthetic" disabled={disabled}
    onChange={change} onClose={() => {}} onReset={() => {}} />);
  try {
    await act(async () => render(false));
    const stream = host.querySelector<HTMLInputElement>("#session-stream")!;
    expect(stream.getAttribute("role")).toBe("switch");
    expect(stream.checked).toBe(false);
    expect(stream.labels?.[0]?.textContent).toContain("流式输出");
    await act(async () => stream.click());
    expect(change).toHaveBeenLastCalledWith({ ...config, stream: true });
    await act(async () => render(true, true));
    expect(stream.checked).toBe(true);
    expect(stream.closest("fieldset")?.disabled).toBe(true);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("maps numeric modes, cancels the popup before the dialog, and preserves errors", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const change = vi.fn(); const close = vi.fn(); const config = defaultSessionConfig();
  try {
    await act(async () => root.render(<SessionConfigPanel config={config} errors={{ temperature: "Synthetic error" }} model="synthetic"
      onChange={change} onClose={close} onReset={() => {}} />));
    const trigger = host.querySelector<HTMLButtonElement>("#config-temperature")!;
    expect(trigger.getAttribute("aria-label")).toBe("Temperature");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Synthetic error");
    await act(async () => trigger.click());
    expect(document.querySelector('[role="listbox"]')?.id).toBe(trigger.getAttribute("aria-controls"));
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(close).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled();
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(change).toHaveBeenLastCalledWith({ ...config, temperature: { mode: "custom", value: "" } });
    await act(async () => root.render(<SessionConfigPanel config={{ ...config, temperature: { mode: "custom", value: "0.7" } }} errors={{}} model="synthetic"
      onChange={change} onClose={close} onReset={() => {}} />));
    await act(async () => trigger.click());
    await act(async () => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === "自动")!.click());
    expect(change).toHaveBeenLastCalledWith(config);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("keeps unsupported custom values visible, blocks custom selection, and disables modes with the panel", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const change = vi.fn(); const config = { ...defaultSessionConfig(), topK: { mode: "custom" as const, value: "12" } };
  const render = (disabled = false) => root.render(<SessionConfigPanel config={config} errors={{}} protocol="openai-chat" model="synthetic" disabled={disabled}
    onChange={change} onClose={() => {}} onReset={() => {}} />);
  try {
    await act(async () => render());
    const trigger = host.querySelector<HTMLButtonElement>("#config-topK")!;
    expect(trigger.textContent).toBe("自定义");
    expect(host.querySelector<HTMLInputElement>('[aria-label="Top-K 自定义值"]')?.value).toBe("12");
    expect(host.querySelector<HTMLInputElement>('[aria-label="Top-K 自定义值"]')?.disabled).toBe(true);
    await act(async () => trigger.click());
    const custom = document.querySelector<HTMLElement>('[role="option"][aria-disabled="true"]')!;
    expect(custom.textContent).toBe("自定义");
    await act(async () => custom.click()); expect(change).not.toHaveBeenCalled();
    await act(async () => render(true));
    expect(trigger.disabled).toBe(true); expect(document.querySelector('[role="listbox"]')).toBeNull();
    await act(async () => trigger.click()); expect(document.querySelector('[role="listbox"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
