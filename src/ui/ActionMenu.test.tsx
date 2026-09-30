// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ActionMenu, bindDefaultContextMenuPolicy, useActionMenu, useDefaultContextMenuPolicy } from "./ActionMenu";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const selected = vi.fn();
function Owner({ name, disabled = false }: { name: string; disabled?: boolean }) {
  const menu = useActionMenu<string>();
  return <><button aria-label={name} onClick={(event) => menu.open(name, event.currentTarget, { x: 10000, y: 10000 })}>{name}</button>
    {menu.state && <ActionMenu state={menu.state} label={`${name} menu`} onClose={menu.close} items={[
      { id: "first", label: "first", disabled, onSelect: () => selected(name) },
      { id: "unavailable", label: "unavailable", disabled: true, onSelect: selected },
      { id: "last", label: "last", onSelect: () => selected(name) },
    ]} />}</>;
}
function Policy() { useDefaultContextMenuPolicy(); return <><p>body</p><input /><textarea /><div contentEditable><span>editable</span></div><div contentEditable={false}>fixed</div></>; }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  selected.mockReset(); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
async function click(name: string) { await act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)!.click()); }
async function press(key: string) { await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))); }

it("suppresses default menus while preserving nested editable targets and removes the listener on unmount", async () => {
  await act(async () => root.render(<Policy />));
  for (const [selector, prevented] of [["p", true], ["input", false], ["textarea", false], ['[contenteditable="true"] span', false], ['[contenteditable="false"]', true]] as const) {
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    host.querySelector(selector)!.dispatchEvent(event); expect(event.defaultPrevented, selector).toBe(prevented);
  }
  await act(async () => root.render(<p>unmounted policy</p>));
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true }); host.querySelector("p")!.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});

it("applies the same policy to a separate frame document and cleans it up", () => {
  const frame = document.createElement("iframe"); host.append(frame);
  const frameDocument = frame.contentDocument!;
  const text = frameDocument.createElement("p"), input = frameDocument.createElement("textarea");
  frameDocument.body.append(text, input);
  const unbind = bindDefaultContextMenuPolicy(frameDocument);
  for (const [target, prevented] of [[text, true], [input, false]] as const) {
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    target.dispatchEvent(event); expect(event.defaultPrevented).toBe(prevented);
  }
  unbind(); const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  text.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
});

it("keeps one menu across owners, clamps edges and navigates enabled items with focus restoration", async () => {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(192);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(120);
  await act(async () => root.render(<><Owner name="A" /><Owner name="B" /></>));
  await click("A"); await click("B");
  expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
  const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
  expect(menu.getAttribute("aria-label")).toBe("B menu");
  expect(parseFloat(menu.style.left) + 192).toBeLessThanOrEqual(window.innerWidth - 8);
  expect(parseFloat(menu.style.top) + 120).toBeLessThanOrEqual(window.innerHeight - 8);
  expect(document.activeElement?.textContent).toBe("first");
  await press("ArrowDown"); expect(document.activeElement?.textContent).toBe("last");
  await press("ArrowDown"); expect(document.activeElement?.textContent).toBe("first");
  await press("End"); expect(document.activeElement?.textContent).toBe("last");
  await press("Home"); expect(document.activeElement?.textContent).toBe("first");
  await press("Escape"); expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement?.getAttribute("aria-label")).toBe("B"); expect(selected).not.toHaveBeenCalled();
});

it("uses current disabled state and dismisses without stealing outside focus", async () => {
  await act(async () => root.render(<><Owner name="A" /><input /></>));
  await click("A");
  await act(async () => root.render(<><Owner name="A" disabled /><input /></>));
  expect(document.activeElement?.textContent).toBe("last");
  await act(async () => document.querySelector<HTMLButtonElement>('[role="menu"] button')!.click());
  expect(selected).not.toHaveBeenCalled();
  const input = host.querySelector("input")!;
  await act(async () => { input.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); input.focus(); });
  expect(document.querySelector('[role="menu"]')).toBeNull(); expect(document.activeElement).toBe(input);
});

it("closes before executing an action and restores the opener for the next dialog", async () => {
  await act(async () => root.render(<Owner name="A" />)); await click("A");
  await act(async () => document.querySelector<HTMLButtonElement>('[role="menu"] button')!.click());
  expect(selected).toHaveBeenCalledExactlyOnceWith("A"); expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement?.getAttribute("aria-label")).toBe("A");
});

it("closes on external scroll, resize, window blur and Tab", async () => {
  await act(async () => root.render(<Owner name="A" />));
  for (const type of ["scroll", "resize", "blur"]) {
    await click("A"); await act(async () => (type === "scroll" ? document : window).dispatchEvent(new Event(type)));
    expect(document.querySelector('[role="menu"]'), type).toBeNull();
  }
  await click("A"); await press("Tab"); expect(document.querySelector('[role="menu"]')).toBeNull();
});
