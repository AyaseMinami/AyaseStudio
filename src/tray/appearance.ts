import { APPEARANCE_STORAGE_KEY, applyInitialAppearance } from "../appearance/appearance";

// This window only reads appearance preferences; no controller or resource bootstrap.
export function installTrayAppearance(): () => void {
  let media: MediaQueryList | undefined;
  try { media = window.matchMedia("(prefers-color-scheme: dark)"); } catch { /* Light fallback. */ }
  const apply = () => applyInitialAppearance({
    storage: { getItem: key => window.localStorage.getItem(key), setItem: () => {} },
    systemPrefersDark: media?.matches ?? false,
    target: document.documentElement,
  });
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === APPEARANCE_STORAGE_KEY) apply();
  };
  apply();
  window.addEventListener("storage", onStorage);
  window.addEventListener("focus", apply);
  media?.addEventListener("change", apply);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("focus", apply);
    media?.removeEventListener("change", apply);
  };
}
