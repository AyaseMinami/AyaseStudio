// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ChatHeader } from "./ChatHeader";

it("drops a clear confirmation on identity change, including same-title conversations", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const clearA = vi.fn(), clearB = vi.fn();
  const render = (conversationId: string, onClear: () => void) => root.render(<ChatHeader
    conversationId={conversationId} title="同名对话" isHydrated isGenerating={false} onClear={onClear} />);
  try {
    await act(async () => render("a", clearA));
    const clearButton = host.querySelector<HTMLButtonElement>('.clear-button')!;
    await act(async () => clearButton.click());
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => render("b", clearB));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('.clear-button')).toBe(clearButton);
    await act(async () => render("a", clearA));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(clearA).not.toHaveBeenCalled(); expect(clearB).not.toHaveBeenCalled();
    await act(async () => clearButton.click());
    await act(async () => host.querySelector<HTMLButtonElement>('.message-confirm-actions button:last-child')!.click());
    expect(clearA).toHaveBeenCalledOnce(); expect(clearB).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
