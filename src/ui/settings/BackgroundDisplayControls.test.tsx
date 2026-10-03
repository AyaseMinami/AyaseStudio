// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { BackgroundDisplayControls } from "./BackgroundDisplayControls";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("chooses background fit by keyboard while keeping the controlled value until its owner updates", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const onFitChange = vi.fn();
  const props = { fit: "cover" as const, mask: 65, blur: 0, onFitChange, onMaskChange: vi.fn(), onBlurChange: vi.fn() };
  try {
    await act(async () => root.render(<BackgroundDisplayControls {...props} />));
    const trigger = host.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="图片适配方式"]')!;
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })));
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true })));
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(onFitChange).toHaveBeenCalledExactlyOnceWith("contain");
    expect(trigger.textContent).toBe("填充");
    await act(async () => root.render(<BackgroundDisplayControls {...props} fit="contain" />));
    expect(trigger.textContent).toBe("适应");
    expect(props.onMaskChange).not.toHaveBeenCalled();
    expect(props.onBlurChange).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("disables the background fit choice while background operations are busy", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const onFitChange = vi.fn();
  try {
    await act(async () => root.render(<BackgroundDisplayControls fit="cover" mask={65} blur={0} disabled
      onFitChange={onFitChange} onMaskChange={vi.fn()} onBlurChange={vi.fn()} />));
    const trigger = host.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    expect(trigger.disabled).toBe(true);
    await act(async () => trigger.click());
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(onFitChange).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
