// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Composer } from "./Composer";

it("retains the full multiline provider error and status as inert text", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  const error = '<html><script>alert(1)</script></html>\n' + "details ".repeat(1000) + "\nrequest-id: final-line (400)";
  try {
    await act(async () => root.render(<Composer draft="" error={error} isHydrated isGenerating={false}
      onDraftChange={() => {}} onSend={() => {}} onStop={() => {}} />));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(error);
    expect(host.querySelector("script")).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});

it("sends on Enter or Ctrl+Enter and preserves composition and multiline input", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  const onSend = vi.fn();
  try {
    await act(async () => root.render(<Composer draft="hello" isHydrated isGenerating={false}
      onDraftChange={() => {}} onSend={onSend} onStop={() => {}} />));
    const textarea = host.querySelector("textarea")!;
    const press = (options: KeyboardEventInit) => textarea.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...options }));
    await act(async () => {
      press({ key: "Enter", shiftKey: true });
      press({ key: "Enter", isComposing: true });
      press({ key: "Enter", repeat: true });
      press({ key: "Enter", altKey: true });
      press({ key: "Enter", metaKey: true });
    });
    expect(onSend).not.toHaveBeenCalled();
    await act(async () => { press({ key: "Enter" }); press({ key: "Enter", ctrlKey: true }); });
    expect(onSend).toHaveBeenCalledTimes(2);
    expect(textarea.getAttribute("placeholder")).toContain("Ctrl+Enter");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
