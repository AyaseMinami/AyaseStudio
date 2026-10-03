import { expect, it, vi } from "vitest";
import { GeneralPreferencesStore, generalPreferencesKey, readGeneralPreferences } from "./preferences";
import { persistentPreferences } from "../storage/dataRegistry";
import { preferenceKeys } from "../backup/types";

function storage(initial: string | null = null) {
  let raw = initial;
  return { getItem: vi.fn(() => raw), setItem: vi.fn((_key: string, value: string) => { raw = value; }) };
}
it("defaults both policies on without persisting a missing preference, and retains choices across reopening", async () => {
  const source = storage(); const first = new GeneralPreferencesStore(source);
  expect(first.getSnapshot().preferences).toEqual({ version: 1, backgroundResident: true, confirmBeforeExit: true });
  expect(source.setItem).not.toHaveBeenCalled();
  expect(await first.setPreference("backgroundResident", false)).toBe(true);
  expect(await first.setPreference("confirmBeforeExit", false)).toBe(true);
  expect(new GeneralPreferencesStore(source).getSnapshot().preferences).toEqual({ version: 1, backgroundResident: false, confirmBeforeExit: false });
});
it("clones current/omitted fields repeatedly without modifying the source", () => {
  const raw = { version: 1, backgroundResident: false };
  const before = structuredClone(raw);
  const first = readGeneralPreferences(raw);
  expect(readGeneralPreferences(first)).toEqual(first); expect(raw).toEqual(before);
  first.backgroundResident = true; expect(raw.backgroundResident).toBe(false);
});
it.each(["{", "null", JSON.stringify({ version: 2 }), JSON.stringify({ version: 0 }),
  JSON.stringify({ version: 1, futureOption: true }), JSON.stringify({ version: 1, backgroundResident: 0 }),
  JSON.stringify({ version: 1, confirmBeforeExit: "false" })])("preserves unsupported original preferences with zero writes: %s", async raw => {
  const source = storage(raw); const store = new GeneralPreferencesStore(source);
  expect(store.getSnapshot().error).toBeTruthy();
  expect(await store.setPreference("backgroundResident", false)).toBe(false);
  expect(source.getItem()).toBe(raw); expect(source.setItem).not.toHaveBeenCalled();
});
it("revalidates externally changed original data before saving and preserves its bytes", async () => {
  const source = storage(); const store = new GeneralPreferencesStore(source);
  source.setItem(generalPreferencesKey, '{"version":99,"private":"preserve"}'); source.setItem.mockClear();
  expect(await store.setPreference("confirmBeforeExit", false)).toBe(false);
  expect(source.setItem).not.toHaveBeenCalled();
  expect(source.getItem()).toBe('{"version":99,"private":"preserve"}');
});
it("keeps the last successful selection when durable storage fails", async () => {
  const source = storage(); const store = new GeneralPreferencesStore(source);
  source.setItem.mockImplementation(() => { throw new Error("disk full"); });
  expect(await store.setPreference("backgroundResident", false)).toBe(false);
  expect(store.getSnapshot().preferences.backgroundResident).toBe(true);
});
it("registers device policy as excluded and does not add it to portable backup projections", () => {
  expect(persistentPreferences[generalPreferencesKey].backup).toBe("excluded");
  expect(preferenceKeys).not.toContain(generalPreferencesKey);
});
