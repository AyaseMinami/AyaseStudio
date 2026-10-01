// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { connectionSettingsStorageKey } from "../chat/settings";
const mocks = vi.hoisted(() => ({ recover: vi.fn(async () => false), appearance: vi.fn() }));
vi.mock("../backup/runtime", () => ({ recoverBackupAtStartup: mocks.recover }));
vi.mock("./browser", () => ({ applyBrowserInitialAppearance: mocks.appearance }));
afterEach(() => { localStorage.clear(); window.location.hash = ""; mocks.recover.mockClear(); mocks.appearance.mockClear(); vi.resetModules(); });
it("checks unsupported connections before appearance and controllers can mount, without changing storage", async () => {
  const encoded = JSON.stringify({ version: 4, providers: [], activeModelId: null });
  localStorage.setItem(connectionSettingsStorageKey, encoded);
  const boot = await import("./bootstrap");
  await expect(boot.startup).rejects.toThrow();
  expect(localStorage.getItem(connectionSettingsStorageKey)).toBe(encoded);
  expect(mocks.appearance).not.toHaveBeenCalled(); expect(mocks.recover).toHaveBeenCalledOnce();
  localStorage.setItem(connectionSettingsStorageKey, JSON.stringify({ version: 3, providers: [], activeModelId: null }));
  expect(() => boot.verifyStartupConfiguration()).not.toThrow();
});
it("allows the separate maintenance workspace to inspect an explicit replacement without mounting normal controllers", async () => {
  window.location.hash = "backup";
  const encoded = JSON.stringify({ version: 4, providers: [], activeModelId: null });
  localStorage.setItem(connectionSettingsStorageKey, encoded);
  const boot = await import("./bootstrap"); await boot.startup;
  expect(localStorage.getItem(connectionSettingsStorageKey)).toBe(encoded);
  expect(mocks.appearance).toHaveBeenCalledOnce();
});
