import { expect, it, vi } from "vitest";
import { GeneralPreferencesStore, generalPreferencesKey, readGeneralPreferences } from "./preferences";
import { dataModules, nativePersistentFiles, persistentPreferences } from "../storage/dataRegistry";
import { dataPolicies } from "../storage/dataPolicies";
import { backupFields } from "../storage/dataContract";
import { preferenceKeys } from "../backup/types";

function storage(initial: string | null = null) {
  let raw = initial;
  return { getItem: vi.fn(() => raw), setItem: vi.fn((_key: string, value: string) => { raw = value; }) };
}
it("defaults all device policies on without persisting a missing preference, and retains choices across reopening", async () => {
  const source = storage(); const first = new GeneralPreferencesStore(source);
  expect(first.getSnapshot().preferences).toEqual({ version: 2, backgroundResident: true, confirmBeforeExit: true, checkUpdatesOnStartup: true });
  expect(source.setItem).not.toHaveBeenCalled();
  expect(await first.setPreference("backgroundResident", false)).toBe(true);
  expect(await first.setPreference("confirmBeforeExit", false)).toBe(true);
  expect(await first.setPreference("checkUpdatesOnStartup", false)).toBe(true);
  expect(new GeneralPreferencesStore(source).getSnapshot().preferences).toEqual({ version: 2, backgroundResident: false, confirmBeforeExit: false, checkUpdatesOnStartup: false });
  expect(JSON.parse(source.getItem()!)).toEqual({ version: 2, backgroundResident: false, confirmBeforeExit: false, checkUpdatesOnStartup: false });
});
it.each([{ version: 1, backgroundResident: false }, { version: 2, backgroundResident: false }])("clones old/current omitted fields repeatedly without modifying the source: %j", raw => {
  const before = structuredClone(raw);
  const first = readGeneralPreferences(raw);
  expect(first).toEqual({ version: 2, backgroundResident: false, confirmBeforeExit: true, checkUpdatesOnStartup: true });
  expect(readGeneralPreferences(first)).toEqual(first); expect(raw).toEqual(before);
  first.backgroundResident = true; expect(raw.backgroundResident).toBe(false);
});
it("migrates v1 in pure reads under the same storage key and keeps existing window policies", () => {
  const raw = '{"version":1,"backgroundResident":false,"confirmBeforeExit":false}';
  const source = storage(raw);
  const expected = { version: 2, backgroundResident: false, confirmBeforeExit: false, checkUpdatesOnStartup: true };
  expect(new GeneralPreferencesStore(source).getSnapshot().preferences).toEqual(expected);
  expect(new GeneralPreferencesStore(source).getSnapshot().preferences).toEqual(expected);
  expect(source.getItem).toHaveBeenCalledWith(generalPreferencesKey);
  expect(generalPreferencesKey).toBe("ayase-studio.general.v1");
  expect(source.getItem()).toBe(raw);
  expect(source.setItem).not.toHaveBeenCalled();
});
it("defaults missing v2 fields on and preserves explicit startup-check false across repeated reads", () => {
  expect(readGeneralPreferences({ version: 2 })).toEqual({ version: 2, backgroundResident: true, confirmBeforeExit: true, checkUpdatesOnStartup: true });
  const raw = '{"version":2,"checkUpdatesOnStartup":false}';
  const source = storage(raw);
  const first = new GeneralPreferencesStore(source).getSnapshot().preferences;
  expect(first.checkUpdatesOnStartup).toBe(false);
  expect(readGeneralPreferences(first)).toEqual(first);
  expect(new GeneralPreferencesStore(source).getSnapshot().preferences).toEqual(first);
  expect(source.getItem()).toBe(raw);
  expect(source.setItem).not.toHaveBeenCalled();
});
it.each(["{", "null", "[]", "{}", JSON.stringify({ version: 3 }), JSON.stringify({ version: 0 }),
  JSON.stringify({ version: "2" }), JSON.stringify({ version: 2.5 }),
  JSON.stringify({ version: 1, futureOption: true }), JSON.stringify({ version: 1, backgroundResident: 0 }),
  JSON.stringify({ version: 1, confirmBeforeExit: "false" }),
  JSON.stringify({ version: 1, checkUpdatesOnStartup: true }), JSON.stringify({ version: 1, checkUpdatesOnStartup: false }),
  JSON.stringify({ version: 2, futureOption: true }), JSON.stringify({ version: 2, backgroundResident: null }),
  JSON.stringify({ version: 2, confirmBeforeExit: 0 }), JSON.stringify({ version: 2, checkUpdatesOnStartup: "false" }),
  JSON.stringify({ version: 2, checkUpdatesOnStartup: null }), JSON.stringify({ version: 2, checkUpdatesOnStartup: 0 })])("preserves unsupported original preferences with zero writes: %s", async raw => {
  const source = storage(raw); const store = new GeneralPreferencesStore(source);
  expect(store.getSnapshot().error).toBeTruthy();
  expect(await store.setPreference("checkUpdatesOnStartup", false)).toBe(false);
  expect(source.getItem()).toBe(raw); expect(source.setItem).not.toHaveBeenCalled();
});
it("rejects a v1 declaration with the new field even when its value is undefined", () => {
  const raw = { version: 1, checkUpdatesOnStartup: undefined };
  expect(() => readGeneralPreferences(raw)).toThrow();
  expect(raw).toEqual({ version: 1, checkUpdatesOnStartup: undefined });
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
  expect(await store.setPreference("backgroundResident", false)).toBe(true);
  const previous = store.getSnapshot().preferences;
  const raw = source.getItem();
  const listener = vi.fn(() => store.getSnapshot().preferences);
  store.subscribe(listener);
  source.setItem.mockImplementation(() => { throw new Error("disk full"); });
  expect(await store.setPreference("checkUpdatesOnStartup", false)).toBe(false);
  expect(store.getSnapshot().preferences).toBe(previous);
  expect(store.getSnapshot().preferences).toEqual({ version: 2, backgroundResident: false, confirmBeforeExit: true, checkUpdatesOnStartup: true });
  expect(store.getSnapshot().error).toBeTruthy();
  expect(listener).toHaveReturnedWith(previous);
  expect(source.getItem()).toBe(raw);
});
it("rejects unsupported preference keys and nonboolean values before storage writes", async () => {
  const source = storage(); const store = new GeneralPreferencesStore(source);
  expect(await Reflect.apply(store.setPreference, store, ["futureOption", false])).toBe(false);
  expect(await Reflect.apply(store.setPreference, store, ["checkUpdatesOnStartup", "false"])).toBe(false);
  expect(source.setItem).not.toHaveBeenCalled();
  expect(store.getSnapshot().preferences.checkUpdatesOnStartup).toBe(true);
});
it("registers device policy as excluded and does not add it to portable backup projections", () => {
  expect(dataModules.general.version).toBe(2);
  expect(dataModules.general.capabilities).toEqual([]);
  expect(persistentPreferences[generalPreferencesKey].backup).toBe("excluded");
  expect(dataPolicies.general.checkUpdatesOnStartup).toBe("exclude");
  expect(backupFields(dataPolicies.general)).toEqual([]);
  expect(backupFields(dataPolicies.general, true)).toEqual([]);
  expect(preferenceKeys).not.toContain(generalPreferencesKey);
  expect(nativePersistentFiles["drawing-output.json"].version).toBe(1);
  expect(nativePersistentFiles["drawing-output.json"].minimumReaderVersion).toBe(1);
});
