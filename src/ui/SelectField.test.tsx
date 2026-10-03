// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SelectField } from "./SelectField";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("keeps focus in its dialog, skips disabled choices, commits explicitly and closes without committing", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); const change = vi.fn();
  const options = [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta", disabled: true }, { value: "c", label: "Charlie" }];
  const render = (disabled = false) => act(async () => root.render(<div role="dialog"><SelectField label="选择" value="a" options={options} disabled={disabled} onChange={change} /></div>));
  try {
    await render();
    const trigger = host.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    const key = (key: string) => act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
    await act(async () => { trigger.focus(); trigger.click(); });
    expect(document.activeElement).toBe(trigger);
    expect(document.querySelector('[role="listbox"]')?.id).toBe(trigger.getAttribute("aria-controls"));
    await key("ArrowDown");
    expect(document.getElementById(trigger.getAttribute("aria-activedescendant")!)?.textContent).toBe("Charlie");
    expect(change).not.toHaveBeenCalled();
    await key("Enter"); expect(change).toHaveBeenCalledExactlyOnceWith("c");
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    await act(async () => trigger.click()); await key("End"); await key("Escape");
    expect(change).toHaveBeenCalledTimes(1); expect(document.activeElement).toBe(trigger);
    await act(async () => trigger.click()); await key("Tab");
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    await act(async () => trigger.click());
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    await act(async () => trigger.click()); await render(true);
    expect(trigger.disabled).toBe(true); expect(document.querySelector('[role="listbox"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("retains an unavailable value without committing when options are removed and while disabled", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host), change = vi.fn();
  const render = (options: Array<{ value: string; label: string; disabled?: boolean }>, disabled = false) => act(async () => root.render(
    <details open data-select-surface><SelectField id="field" label="回复" value="missing" options={options} disabled={disabled} onChange={change} /></details>));
  try {
    await render([{ value: "a", label: "Alpha" }, { value: "missing", label: "旧值（不可用）", disabled: true }]);
    const trigger = host.querySelector<HTMLButtonElement>("#field")!;
    await act(async () => { trigger.focus(); trigger.click(); });
    expect(document.querySelector("[role=listbox]")?.id).toBe(trigger.getAttribute("aria-controls"));
    expect(trigger.textContent).toContain("旧值（不可用）");
    await render([{ value: "b", label: "Beta" }]);
    expect(document.getElementById(trigger.getAttribute("aria-activedescendant")!)?.textContent).toBe("Beta");
    expect(change).not.toHaveBeenCalled();
    await render([{ value: "b", label: "Beta" }], true);
    expect(document.querySelector("[role=listbox]")).toBeNull(); expect(change).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
