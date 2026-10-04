import { beforeEach, expect, it, vi } from "vitest";
import { ApplicationLifecycle, type ExitGuard } from "./lifecycle";
import type { GeneralSettingsState } from "./preferences";
import type { ConfirmationOptions } from "../ui/useConfirmation";

let settings: GeneralSettingsState;
let closeHandler: (event: { preventDefault(): void }) => void;
let trayExit: () => void;
const runtime = { hide: vi.fn(), close: vi.fn(), onClose: vi.fn(), onExit: vi.fn() };
const confirm = vi.fn<(options: ConfirmationOptions) => Promise<boolean>>();
const report = vi.fn(), canExit = vi.fn();
let guard: ExitGuard, owner: ApplicationLifecycle;
beforeEach(() => {
  vi.resetAllMocks();
  settings = { preferences: { version: 2, backgroundResident: true, confirmBeforeExit: true, checkUpdatesOnStartup: true }, error: null, setPreference: vi.fn().mockResolvedValue(true) };
  guard = { prepare: vi.fn().mockResolvedValue(true), cancel: vi.fn() };
  canExit.mockReturnValue(true); confirm.mockResolvedValue(true);
  runtime.onClose.mockImplementation(async handler => { closeHandler = handler; return vi.fn(); });
  runtime.onExit.mockImplementation(async handler => { trayExit = handler; return vi.fn(); });
  runtime.close.mockResolvedValue(undefined); runtime.hide.mockResolvedValue(undefined);
  owner = new ApplicationLifecycle(runtime, () => settings, confirm, report, canExit);
  owner.registerExitGuard(guard);
});
it("hides a resident window without confirming, settling, or cancelling running work", async () => {
  await owner.request(false);
  expect(runtime.hide).toHaveBeenCalledOnce(); expect(confirm).not.toHaveBeenCalled();
  expect(guard.prepare).not.toHaveBeenCalled(); expect(runtime.close).not.toHaveBeenCalled();
});
it("requires ordinary confirmation when residency is off, and cancellation writes nothing", async () => {
  settings.preferences.backgroundResident = false; confirm.mockResolvedValue(false);
  await owner.request(false);
  expect(confirm).toHaveBeenCalledOnce(); expect(guard.prepare).not.toHaveBeenCalled();
  expect(settings.setPreference).not.toHaveBeenCalled(); expect(runtime.close).not.toHaveBeenCalled();
});
it("explicit exit bypasses residency and persists opt-out only after the data guard accepts", async () => {
  const order: string[] = [];
  confirm.mockImplementation(async options => { options.checkbox?.onChange(true); return true; });
  vi.mocked(guard.prepare).mockImplementation(async () => { order.push("guard"); return true; });
  vi.mocked(settings.setPreference).mockImplementation(async () => { order.push("save"); return true; });
  runtime.close.mockImplementation(async () => { order.push("close"); });
  await owner.request(true);
  expect(order).toEqual(["guard", "save", "close"]); expect(runtime.hide).not.toHaveBeenCalled();
  expect(settings.setPreference).toHaveBeenCalledWith("confirmBeforeExit", false);
});
it("does not remember an opt-out when a separate loss guard is cancelled", async () => {
  confirm.mockImplementation(async options => { options.checkbox?.onChange(true); return true; });
  vi.mocked(guard.prepare).mockResolvedValue(false); await owner.request(true);
  expect(settings.setPreference).not.toHaveBeenCalled(); expect(runtime.close).not.toHaveBeenCalled();
});
it("continues to use the data guard with ordinary reminders disabled", async () => {
  settings.preferences.confirmBeforeExit = false;
  await owner.request(true); expect(confirm).not.toHaveBeenCalled(); expect(guard.prepare).toHaveBeenCalledOnce();
  expect(runtime.close).toHaveBeenCalledOnce();
});
it("serializes repeated close and tray requests while a decision is pending", async () => {
  let answer!: (value: boolean) => void;
  confirm.mockImplementation(() => new Promise(resolve => { answer = resolve; }));
  const first = owner.request(true); await owner.request(true); await owner.request(false);
  expect(confirm).toHaveBeenCalledOnce(); expect(runtime.hide).not.toHaveBeenCalled();
  answer(false); await first; await owner.request(false); expect(runtime.hide).toHaveBeenCalledOnce();
});
it("does not mutate or close from a disposed decision", async () => {
  let answer!: (value: boolean) => void;
  confirm.mockImplementation(options => { options.checkbox?.onChange(true); return new Promise(resolve => { answer = resolve; }); });
  const pending = owner.request(true); owner.dispose(); answer(true); await pending;
  expect(guard.prepare).not.toHaveBeenCalled(); expect(settings.setPreference).not.toHaveBeenCalled();
  expect(runtime.close).not.toHaveBeenCalled();
});
it("keeps a window available on hide failure and releases the guard on final close failure", async () => {
  runtime.hide.mockRejectedValue(new Error("hide failed")); await owner.request(false);
  expect(report).toHaveBeenCalledWith("hide failed"); expect(runtime.close).not.toHaveBeenCalled();
  runtime.close.mockRejectedValue(new Error("close failed")); await owner.request(true);
  expect(guard.cancel).toHaveBeenCalledOnce(); expect(report).toHaveBeenCalledWith("close failed");
});
it("blocks true exit during data maintenance but allows hiding", async () => {
  canExit.mockReturnValue(false); await owner.request(true); expect(report).toHaveBeenCalledOnce();
  expect(guard.prepare).not.toHaveBeenCalled(); await owner.request(false); expect(runtime.hide).toHaveBeenCalledOnce();
});
it("routes native close and tray exit through one listener owner and releases both on disposal", async () => {
  const releaseClose = vi.fn(), releaseTray = vi.fn();
  runtime.onClose.mockImplementation(async handler => { closeHandler = handler; return releaseClose; });
  runtime.onExit.mockImplementation(async handler => { trayExit = handler; return releaseTray; });
  await owner.start(); const preventDefault = vi.fn(); closeHandler({ preventDefault });
  await vi.waitFor(() => expect(runtime.hide).toHaveBeenCalledOnce()); expect(preventDefault).toHaveBeenCalledOnce();
  trayExit(); await vi.waitFor(() => expect(runtime.close).toHaveBeenCalledOnce());
  const finalPrevent = vi.fn(); closeHandler({ preventDefault: finalPrevent }); expect(finalPrevent).not.toHaveBeenCalled();
  owner.dispose(); expect(releaseClose).toHaveBeenCalledOnce(); expect(releaseTray).toHaveBeenCalledOnce();
});
it("preserves unreadable settings while still allowing a confirmed explicit exit", async () => {
  settings.error = "unsupported"; await owner.request(true);
  expect(confirm.mock.calls[0][0].checkbox).toBeUndefined(); expect(settings.setPreference).not.toHaveBeenCalled();
  expect(runtime.close).toHaveBeenCalledOnce();
});

it("update install has explicit confirmation even when ordinary reminders are off and runs the data guard first", async () => {
  settings.preferences.confirmBeforeExit = false;
  const order: string[] = [];
  vi.mocked(guard.prepare).mockImplementation(async () => { order.push("guard"); return true; });
  const install = vi.fn(async () => { order.push("install"); });
  expect(await owner.runForUpdate(install)).toBe(true);
  expect(confirm.mock.calls[0][0].title).toBe("安装更新并重启");
  expect(order).toEqual(["guard", "install"]);
  expect(runtime.hide).not.toHaveBeenCalled(); expect(runtime.close).not.toHaveBeenCalled();
  expect(settings.setPreference).not.toHaveBeenCalled();
});
it("cancelled or failed update preparation never invokes the installer and releases the drawing guard", async () => {
  const install = vi.fn(); confirm.mockResolvedValueOnce(false);
  expect(await owner.runForUpdate(install)).toBe(false); expect(guard.prepare).not.toHaveBeenCalled();
  vi.mocked(guard.prepare).mockResolvedValueOnce(false);
  expect(await owner.runForUpdate(install)).toBe(false); expect(guard.cancel).toHaveBeenCalledOnce();
  install.mockRejectedValueOnce(new Error("failed"));
  await expect(owner.runForUpdate(install)).rejects.toThrow("failed");
  expect(guard.cancel).toHaveBeenCalledTimes(2);
});
it("update confirmation shares the close/tray lock and rejects disposed or maintenance decisions", async () => {
  const decision = (() => { let resolve!: (value: boolean) => void; const promise = new Promise<boolean>(r => { resolve = r; }); return { promise, resolve }; })();
  confirm.mockReturnValueOnce(decision.promise); const install = vi.fn();
  const pending = owner.runForUpdate(install); await owner.request(false); await owner.runForUpdate(install);
  expect(runtime.hide).not.toHaveBeenCalled(); expect(confirm).toHaveBeenCalledOnce();
  canExit.mockReturnValue(false); decision.resolve(true); expect(await pending).toBe(false); expect(install).not.toHaveBeenCalled();
  canExit.mockReturnValue(true); owner.dispose(); expect(await owner.runForUpdate(install)).toBe(false);
});
