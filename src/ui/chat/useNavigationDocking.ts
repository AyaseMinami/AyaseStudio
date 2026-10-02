import { useLayoutEffect, useRef, useState } from "react";
import type { ConversationNavigationSnapshot } from "./useConversationNavigation";

const MIN_CHAT_WIDTH = 560;
const RETURN_BUFFER = 16;

export function shouldDockNavigation(available: number, occupied: number, previous?: boolean): boolean {
  if (occupied === 0) return true;
  return available - occupied >= MIN_CHAT_WIDTH + (previous === false ? RETURN_BUFFER : 0);
}

/** Measure the full workspace and a non-animated CSS width probe, never the shrinking chat. */
export function useNavigationDocking(snapshot: ConversationNavigationSnapshot) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const previous = useRef<boolean | undefined>(undefined);
  const [docked, setDocked] = useState(false);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const probe = body?.querySelector<HTMLElement>(".navigation-space-probe");
    if (!body || !probe) return;
    let active = true;
    const measure = () => {
      if (!active) return;
      const available = body.getBoundingClientRect().width;
      if (available <= 0) return;
      const next = shouldDockNavigation(available, probe.getBoundingClientRect().width, previous.current);
      previous.current = next;
      setDocked(next);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(body);
    observer?.observe(probe);
    window.addEventListener("resize", measure);
    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [snapshot.open, snapshot.assistantExpanded, snapshot.conversationsOpen]);
  return { bodyRef, docked };
}
