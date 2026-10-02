import { useState, useSyncExternalStore } from "react";

export interface ConversationNavigationSnapshot {
  readonly open: boolean;
  readonly assistantExpanded: boolean;
  readonly conversationsOpen: boolean;
}

export interface ConversationNavigationController {
  getSnapshot(): ConversationNavigationSnapshot;
  subscribe(listener: () => void): () => void;
  setOpen(open: boolean): void;
  expandAssistant(): void;
  closeConversations(): void;
  activateDraft(): void;
}

/** Pure, in-memory controller; creating one does not subscribe or persist. */
export function createConversationNavigationController(viewportWidth: number): ConversationNavigationController {
  let snapshot: ConversationNavigationSnapshot = Object.freeze({
    open: viewportWidth > 860,
    assistantExpanded: false,
    conversationsOpen: true,
  });
  const listeners = new Set<() => void>();
  function update(patch: Partial<ConversationNavigationSnapshot>) {
    const next = { ...snapshot, ...patch };
    if (next.open === snapshot.open && next.assistantExpanded === snapshot.assistantExpanded
      && next.conversationsOpen === snapshot.conversationsOpen) return;
    snapshot = Object.freeze(next);
    for (const listener of [...listeners]) listener();
  }
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setOpen: (open: boolean) => update({ open }),
    expandAssistant: () => update({ assistantExpanded: true, conversationsOpen: true }),
    closeConversations: () => update({ assistantExpanded: true, conversationsOpen: false }),
    activateDraft: () => {
      if (snapshot.open && snapshot.assistantExpanded) update({ assistantExpanded: false });
    },
  });
}

/** App owns the stable controller across page switches without subscribing. */
export function useConversationNavigation(): ConversationNavigationController {
  const [controller] = useState(() => createConversationNavigationController(window.innerWidth));
  return controller;
}

/** Only navigation UI subscribes; input activation invokes a stable command. */
export function useConversationNavigationSnapshot(controller: ConversationNavigationController): ConversationNavigationSnapshot {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot);
}
