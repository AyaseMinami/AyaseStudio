// @vitest-environment happy-dom
import { act, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  createConversationNavigationController,
  useConversationNavigation,
  useConversationNavigationSnapshot,
} from "./useConversationNavigation";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mounted: Array<{ root: ReturnType<typeof createRoot>; host: HTMLDivElement }> = [];
const originalWidth = window.innerWidth;

afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
  vi.restoreAllMocks();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
});

describe("conversation navigation subscriptions", () => {
  it.each([false, true])("opens only conversations with assistantExpanded=%s", assistantExpanded => {
    const controller = createConversationNavigationController(1200);
    if (assistantExpanded) controller.expandAssistant();
    controller.closeConversations();
    controller.openConversations();
    expect(controller.getSnapshot()).toEqual({ open: true, assistantExpanded, conversationsOpen: true });
  });
  it.each([false, true])("closing conversations preserves assistant expansion (%s)", expanded => {
    const controller = createConversationNavigationController(1200);
    if (expanded) controller.expandAssistant();
    controller.closeConversations();
    expect(controller.getSnapshot()).toEqual({ open: true, assistantExpanded: expanded, conversationsOpen: false });
    controller.expandAssistant();
    expect(controller.getSnapshot().conversationsOpen).toBe(true);
  });

  it.each([861, 860, 600])("creates an immutable viewport snapshot at %i without browser or storage access", width => {
    const storage = vi.spyOn(Storage.prototype, "getItem");
    const controller = createConversationNavigationController(width);
    const snapshot = controller.getSnapshot();
    expect(snapshot).toEqual({ open: width > 860, conversationsOpen: true, assistantExpanded: false });
    expectTypeOf(snapshot).toEqualTypeOf<{
      readonly open: boolean;
      readonly conversationsOpen: boolean;
      readonly assistantExpanded: boolean;
    }>();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Reflect.set(snapshot, "open", !snapshot.open)).toBe(false);
    expect(controller.getSnapshot()).toBe(snapshot);
    expect(storage).not.toHaveBeenCalled();
  });

  it("keeps snapshot identity for no-ops, publishes immutable replacements and unsubscribes independently", () => {
    const controller = createConversationNavigationController(1200);
    const first = controller.getSnapshot();
    const primary = vi.fn();
    const secondary = vi.fn();
    const removePrimary = controller.subscribe(primary);
    const removeSecondary = controller.subscribe(secondary);
    controller.setOpen(true);
    controller.activateDraft();
    expect(controller.getSnapshot()).toBe(first);
    expect(primary).not.toHaveBeenCalled();
    controller.expandAssistant();
    const expanded = controller.getSnapshot();
    expect(expanded).not.toBe(first);
    expect(first.assistantExpanded).toBe(false);
    expect(Object.isFrozen(expanded)).toBe(true);
    expect(primary).toHaveBeenCalledTimes(1);
    expect(secondary).toHaveBeenCalledTimes(1);
    controller.expandAssistant();
    expect(controller.getSnapshot()).toBe(expanded);
    expect(primary).toHaveBeenCalledTimes(1);
    removePrimary();
    removePrimary();
    controller.closeConversations();
    const closed = controller.getSnapshot();
    controller.closeConversations();
    expect(controller.getSnapshot()).toBe(closed);
    expect(primary).toHaveBeenCalledTimes(1);
    expect(secondary).toHaveBeenCalledTimes(2);
    controller.setOpen(false);
    const hidden = controller.getSnapshot();
    controller.activateDraft();
    expect(controller.getSnapshot()).toBe(hidden);
    removeSecondary();
    controller.setOpen(true);
    expect(secondary).toHaveBeenCalledTimes(3);
  });

  it.each([false, true])("updates only subscribed consumers and retains its controller across page switches (StrictMode=%s)", async strict => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
    const parentRender = vi.fn();
    const siblingRender = vi.fn();
    const consumerRender = vi.fn();
    let controller!: ReturnType<typeof useConversationNavigation>;
    let switchPage!: (value: boolean) => void;
    const identities: Array<ReturnType<typeof useConversationNavigation>> = [];
    function Consumer() {
      const state = useConversationNavigationSnapshot(controller);
      consumerRender();
      return <output>{`${state.open}/${state.assistantExpanded}/${state.conversationsOpen}`}</output>;
    }
    function Sibling() { siblingRender(); return <p>历史正文</p>; }
    function AppOwner() {
      parentRender();
      controller = useConversationNavigation();
      identities.push(controller);
      const [visible, setVisible] = useState(true);
      switchPage = setVisible;
      return <><Sibling />{visible && <Consumer />}</>;
    }
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host); mounted.push({ root, host });
    await act(async () => root.render(strict ? <StrictMode><AppOwner /></StrictMode> : <AppOwner />));
    const mountedController = controller;
    const initialParent = parentRender.mock.calls.length;
    const initialSibling = siblingRender.mock.calls.length;
    const initialConsumer = consumerRender.mock.calls.length;
    await act(async () => controller.expandAssistant());
    expect(host.querySelector("output")?.textContent).toBe("true/true/true");
    expect(parentRender).toHaveBeenCalledTimes(initialParent);
    expect(siblingRender).toHaveBeenCalledTimes(initialSibling);
    expect(consumerRender.mock.calls.length).toBeGreaterThan(initialConsumer);
    const afterExpansion = consumerRender.mock.calls.length;
    await act(async () => controller.expandAssistant());
    expect(consumerRender).toHaveBeenCalledTimes(afterExpansion);
    await act(async () => switchPage(false));
    expect(host.querySelector("output")).toBeNull();
    const hiddenConsumer = consumerRender.mock.calls.length;
    await act(async () => controller.closeConversations());
    expect(consumerRender).toHaveBeenCalledTimes(hiddenConsumer);
    await act(async () => switchPage(true));
    expect(controller).toBe(mountedController);
    expect(identities.slice(strict ? 2 : 1).every(identity => identity === mountedController)).toBe(true);
    expect(host.querySelector("output")?.textContent).toBe("true/true/false");
  });

  it("cleans every useSyncExternalStore subscription during StrictMode checks, page unmount and final unmount", async () => {
    const controller = createConversationNavigationController(1200);
    const subscribe = controller.subscribe;
    const active = new Set<() => void>();
    const cleanup = vi.fn();
    const observedController = { ...controller, subscribe: (listener: () => void) => {
      active.add(listener);
      const unsubscribe = subscribe(listener);
      return () => { active.delete(listener); cleanup(); unsubscribe(); };
    } };
    function Consumer() {
      const snapshot = useConversationNavigationSnapshot(observedController);
      return <output>{String(snapshot.assistantExpanded)}</output>;
    }
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host); mounted.push({ root, host });
    await act(async () => root.render(<StrictMode><Consumer /></StrictMode>));
    expect(active.size).toBe(1);
    expect(cleanup.mock.calls.length).toBeGreaterThan(0);
    await act(async () => root.render(<StrictMode />));
    expect(active.size).toBe(0);
    await act(async () => controller.expandAssistant());
    await act(async () => root.render(<StrictMode><Consumer /></StrictMode>));
    expect(active.size).toBe(1);
    expect(host.textContent).toBe("true");
    await act(async () => root.unmount());
    expect(active.size).toBe(0);
    mounted.splice(mounted.findIndex(item => item.root === root), 1);
    host.remove();
  });
});
