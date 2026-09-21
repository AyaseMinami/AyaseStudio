import { useState } from "react";

export type ChatLayout = "narrow" | "wide";
const STORAGE_KEY = "ayase-studio.chat-layout.v1";

export function useChatLayout() {
  const [layout, setLayout] = useState<ChatLayout>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "wide" ? "wide" : "narrow";
    } catch {
      return "narrow";
    }
  });

  function toggleLayout() {
    const next = layout === "narrow" ? "wide" : "narrow";
    setLayout(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The layout remains usable when local preference storage is unavailable.
    }
  }

  return { layout, toggleLayout };
}
