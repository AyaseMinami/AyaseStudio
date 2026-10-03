// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SearchChoiceDialog, SearchSelectField, type SearchSelectOption } from "./SearchSelectField";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const options: SearchSelectOption[] = [
  { value: "", label: "不选择" },
  { value: "a", label: "Alpha", description: "model-a", group: "第一连接" },
  { value: "b", label: "Beta", description: "model-b", group: "第二连接", disabled: true },
  { value: "c", label: "Charlie", description: "model-c", group: "第二连接" },
];
const key = (element: Element, key: string, shiftKey = false) => act(async () => element.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true })));
const click = (element: HTMLElement) => act(async () => element.click());

it("searches labels, identifiers and groups; navigates without writes and commits explicitly", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host), change = vi.fn();
  try {
    await act(async () => root.render(<SearchSelectField label="绘图模型" value="a" options={options} onChange={change} />));
    const trigger = host.querySelector<HTMLButtonElement>("button")!;
    trigger.focus(); await click(trigger);
    expect(host.inert).toBe(true);
    const input = document.querySelector<HTMLInputElement>(".model-picker-search input")!;
    expect(document.activeElement).toBe(input);
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", isComposing: true, keyCode: 229, bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(input); expect(change).not.toHaveBeenCalled();
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true })));
    expect(document.querySelector(".model-picker")).not.toBeNull();
    const type = async (value: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await type("第二连接");
    expect(document.querySelectorAll(".model-picker-option")).toHaveLength(2);
    await key(input, "ArrowDown");
    expect(document.activeElement?.textContent).toContain("Charlie");
    expect(change).not.toHaveBeenCalled();
    await type("model-c");
    expect(document.querySelectorAll(".model-picker-option")).toHaveLength(1);
    await click(document.querySelector<HTMLButtonElement>('.model-picker-option[data-value="c"]')!);
    expect(change).toHaveBeenCalledExactlyOnceWith("c");
    expect(document.querySelector(".model-picker")).toBeNull();
    expect(host.inert).toBe(false); expect(document.activeElement).toBe(trigger);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("preserves an unavailable value through cancel and dynamically removed/disabled choices", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host), change = vi.fn();
  const render = (items = options, disabled = false) => act(async () => root.render(<SearchSelectField label="预设" value="missing" options={items} disabled={disabled} onChange={change} />));
  try {
    await render(); const trigger = host.querySelector<HTMLButtonElement>("button")!; trigger.focus(); await click(trigger);
    expect(document.querySelector('[role="status"]')?.textContent).toContain("已失效");
    await render(options.filter(option => option.value !== "c"));
    expect(document.querySelector('[data-value="c"]')).toBeNull();
    await click(document.querySelector<HTMLButtonElement>('[data-value="b"]')!); expect(change).not.toHaveBeenCalled();
    await key(document.activeElement!, "Escape");
    expect(change).not.toHaveBeenCalled(); expect(trigger.textContent).toContain("已失效");
    await click(trigger); await render(options, true);
    expect(document.querySelector(".model-picker")).toBeNull(); expect(change).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("keeps a search panel in a native dialog, traps focus, isolates paste/drop and restores prior inert", async () => {
  const host = document.createElement("dialog"); host.open = true; document.body.append(host);
  const root = createRoot(host), change = vi.fn(), paste = vi.fn(), drop = vi.fn(), escape = vi.fn();
  try {
    await act(async () => root.render(<><div inert /><div onPaste={paste} onDrop={drop} onKeyDown={escape}><SearchSelectField label="选择" value="a" options={options} onChange={change} /></div></>));
    const trigger = host.querySelector<HTMLButtonElement>("button")!; trigger.focus(); await click(trigger);
    const panel = host.querySelector<HTMLElement>(".model-picker")!;
    expect(panel).not.toBeNull(); expect(host.querySelector(":scope > .model-picker-backdrop")).not.toBeNull();
    await act(async () => panel.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true })));
    expect(escape).not.toHaveBeenCalled(); expect(host.querySelector(".model-picker")).not.toBeNull();
    const close = panel.querySelector<HTMLButtonElement>("button")!;
    close.focus(); await key(close, "Tab", true); expect(document.activeElement?.textContent).toContain("Charlie");
    await key(document.activeElement!, "Tab"); expect(document.activeElement).toBe(close);
    panel.dispatchEvent(new Event("paste", { bubbles: true }));
    panel.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
    expect(paste).not.toHaveBeenCalled(); expect(drop).not.toHaveBeenCalled();
    await key(close, "Escape"); expect(escape).not.toHaveBeenCalled();
    expect(host.firstElementChild?.hasAttribute("inert")).toBe(true); expect(change).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("serializes asynchronous selection and retains a failed panel for retry", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host), close = vi.fn();
  let finish!: (value: boolean) => void;
  const select = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
  try {
    await act(async () => root.render(<SearchChoiceDialog label="选择模型" value="a" options={options} onSelect={select} onClose={close} />));
    const row = document.querySelector<HTMLButtonElement>('[data-value="c"]')!;
    await click(row); await click(row); expect(select).toHaveBeenCalledTimes(1);
    await key(document.activeElement!, "Escape"); expect(close).not.toHaveBeenCalled();
    await act(async () => finish(false)); expect(row.disabled).toBe(false); expect(close).not.toHaveBeenCalled();
    await click(row); await act(async () => finish(true)); expect(close).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
