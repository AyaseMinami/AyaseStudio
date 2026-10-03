import { useState, useSyncExternalStore } from "react";
import { dataCheck, dataRecord, migrateData } from "../storage/dataContract";

export interface GeneralPreferences {
  version: 1;
  backgroundResident: boolean;
  confirmBeforeExit: boolean;
}
export interface GeneralSettingsState {
  preferences: GeneralPreferences;
  error: string | null;
  setPreference(key: "backgroundResident" | "confirmBeforeExit", value: boolean): Promise<boolean>;
}
export const generalPreferencesKey = "ayase-studio.general.v1";
export const defaultGeneralPreferences: GeneralPreferences = { version: 1, backgroundResident: true, confirmBeforeExit: true };

/** Local reads share the clone-based migration seam. This device policy is not portable. */
export function readGeneralPreferences(raw: unknown): GeneralPreferences {
  dataRecord(raw);
  const value = migrateData(raw, { version: 1, oldestVersion: 1, migrations: {} });
  dataCheck(Object.keys(value).every(key => ["version", "backgroundResident", "confirmBeforeExit"].includes(key)));
  dataCheck(value.backgroundResident === undefined || typeof value.backgroundResident === "boolean");
  dataCheck(value.confirmBeforeExit === undefined || typeof value.confirmBeforeExit === "boolean");
  return { version: 1, backgroundResident: typeof value.backgroundResident === "boolean" ? value.backgroundResident : true,
    confirmBeforeExit: typeof value.confirmBeforeExit === "boolean" ? value.confirmBeforeExit : true };
}

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;
export class GeneralPreferencesStore {
  private snapshot: Pick<GeneralSettingsState, "preferences" | "error">;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly storage: PreferenceStorage) {
    try { this.snapshot = { preferences: this.read(), error: null }; }
    catch { this.snapshot = { preferences: { ...defaultGeneralPreferences }, error: "常规设置无法安全读取，原数据已保留；请修复后重新打开应用。" }; }
  }
  private read(): GeneralPreferences {
    const raw = this.storage.getItem(generalPreferencesKey);
    return raw === null ? { ...defaultGeneralPreferences } : readGeneralPreferences(JSON.parse(raw));
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  /** Revalidate the source before any write; a display fallback never authorizes replacement. */
  setPreference = async (key: "backgroundResident" | "confirmBeforeExit", value: boolean): Promise<boolean> => {
    try {
      dataCheck(typeof value === "boolean");
      dataCheck(key === "backgroundResident" || key === "confirmBeforeExit");
      const preferences = readGeneralPreferences({ ...this.read(), [key]: value });
      this.storage.setItem(generalPreferencesKey, JSON.stringify(preferences));
      this.snapshot = { preferences, error: null };
      this.listeners.forEach(listener => listener());
      return true;
    } catch {
      this.snapshot = { ...this.snapshot, error: "常规设置保存失败，原设置已保留。请检查本地存储或重新打开应用。" };
      this.listeners.forEach(listener => listener());
      return false;
    }
  };
}

export function useGeneralSettings(): GeneralSettingsState {
  const [store] = useState(() => new GeneralPreferencesStore({
    getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value),
  }));
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { ...snapshot, setPreference: store.setPreference };
}
