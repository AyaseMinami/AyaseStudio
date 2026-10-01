// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNavigationListDrag } from "./useNavigationListDrag";

describe("navigation list drag gestures", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const onMove = vi.fn();
  const onStart = vi.fn();
  const onClick = vi.fn();
  function Harness({ disabled = false, hidden = false, source = true, dialog = false }) {
    const drag = useNavigationListDrag({ disabled, onMove, onStart });
    return <div onClickCapture={drag.suppressClick}>
      {dialog && <div role="dialog" />}
      <ul className="chat-navigation-list" inert={hidden}>
        {source && <li data-navigation-sort-id="a" data-navigation-sort-kind="conversation" data-navigation-sort-scope="owner">
          <button className="handle" onPointerDown={event => drag.begin(event, { kind: "conversation", id: "a", assistantId: "owner" }, "A", true)} />
          <button className="name" onClick={onClick} onPointerDown={event => drag.begin(event, { kind: "conversation", id: "a", assistantId: "owner" }, "A", false)} />
        </li>}
        <li className="target" data-navigation-sort-id="b" data-navigation-sort-kind="conversation" data-navigation-sort-scope="owner" />
      </ul>
      <span data-active={!!drag.drag}>{drag.announcement}</span>
    </div>;
  }
  async function render(props = {}) { await act(async () => root.render(<Harness {...props} />)); }
  function pointer(target: EventTarget, type: string, y = 10, id = 1) {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, isPrimary: true, button: 0, clientX: 25, clientY: y }));
  }
  function mouseClick(button: HTMLButtonElement) { button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })); }
  const active = () => container.querySelector('[data-active="true"]') !== null;
  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers(); onMove.mockReset(); onStart.mockReset(); onClick.mockReset();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await render();
    const target = container.querySelector<HTMLElement>(".target")!;
    vi.spyOn(document, "elementFromPoint").mockReturnValue(target);
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 50, 100, 40));
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it("starts handles at six pixels and saves only on release of the original pointer", async () => {
    const button = container.querySelector<HTMLButtonElement>(".handle")!;
    await act(async () => { pointer(button, "pointerdown"); pointer(window, "pointermove", 15); });
    expect(active()).toBe(false);
    await act(async () => pointer(window, "pointermove", 16));
    expect(active()).toBe(true); expect(onMove).not.toHaveBeenCalled();
    await act(async () => pointer(window, "pointerup", 60, 2));
    expect(active()).toBe(true); expect(onMove).not.toHaveBeenCalled();
    await act(async () => pointer(window, "pointerup", 60));
    expect(onMove).toHaveBeenCalledExactlyOnceWith({ kind: "conversation", id: "a", assistantId: "owner" }, "b", "before");
  });

  it("keeps short clicks, waits four hundred milliseconds for name holds, and suppresses drag clicks", async () => {
    const button = container.querySelector<HTMLButtonElement>(".name")!;
    await act(async () => { pointer(button, "pointerdown"); vi.advanceTimersByTime(100); pointer(window, "pointerup"); mouseClick(button); });
    expect(onClick).toHaveBeenCalledTimes(1);
    await act(async () => { pointer(button, "pointerdown"); vi.advanceTimersByTime(399); });
    expect(active()).toBe(false);
    await act(async () => vi.advanceTimersByTime(1));
    expect(active()).toBe(true);
    await act(async () => { pointer(window, "pointerup", 80); mouseClick(button); });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledExactlyOnceWith({ kind: "conversation", id: "a", assistantId: "owner" }, "b", "after");
  });

  it("cancels early name movement together with its click", async () => {
    const button = container.querySelector<HTMLButtonElement>(".name")!;
    await act(async () => { pointer(button, "pointerdown"); pointer(window, "pointermove", 16); vi.advanceTimersByTime(500); pointer(window, "pointerup", 60); mouseClick(button); });
    expect(active()).toBe(false); expect(onStart).not.toHaveBeenCalled(); expect(onMove).not.toHaveBeenCalled(); expect(onClick).not.toHaveBeenCalled();
  });

  it.each(["Escape", "blur", "resize", "pointercancel", "hidden", "missing", "busy", "dialog"])("cancels an active hold on %s and does not select or save", async reason => {
    const button = container.querySelector<HTMLButtonElement>(".name")!;
    await act(async () => { pointer(button, "pointerdown"); vi.advanceTimersByTime(400); });
    expect(active()).toBe(true);
    if (reason === "hidden") await render({ hidden: true });
    else if (reason === "missing") await render({ source: false });
    else if (reason === "busy") await render({ disabled: true });
    else if (reason === "dialog") await render({ dialog: true });
    await act(async () => {
      if (reason === "Escape") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      else if (reason === "blur" || reason === "resize") window.dispatchEvent(new Event(reason));
      else if (reason === "pointercancel") pointer(window, "pointercancel");
      if (reason !== "pointercancel") vi.advanceTimersByTime(20);
      pointer(window, "pointerup", 60); mouseClick(button);
    });
    expect(active()).toBe(false); expect(onMove).not.toHaveBeenCalled(); expect(onClick).not.toHaveBeenCalled();
  });

  it("rejects another assistant scope and stops edge scrolling on release", async () => {
    const list = container.querySelector<HTMLElement>(".chat-navigation-list")!;
    const target = container.querySelector<HTMLElement>(".target")!;
    target.dataset.navigationSortScope = "other";
    vi.spyOn(list, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 120));
    await act(async () => { pointer(container.querySelector(".handle")!, "pointerdown", 50); pointer(window, "pointermove", 115); vi.advanceTimersByTime(50); });
    expect(list.scrollTop).toBeGreaterThan(0);
    await act(async () => pointer(window, "pointerup", 115));
    const scrollTop = list.scrollTop;
    await act(async () => vi.advanceTimersByTime(100));
    expect(list.scrollTop).toBe(scrollTop); expect(onMove).not.toHaveBeenCalled();
  });

  it("cleans up a hold on unmount", async () => {
    await act(async () => { pointer(container.querySelector(".name")!, "pointerdown"); root.unmount(); vi.advanceTimersByTime(500); pointer(window, "pointerup", 60); });
    expect(onStart).not.toHaveBeenCalled(); expect(onMove).not.toHaveBeenCalled();
    root = createRoot(container);
    await render();
  });
});
