// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useDrawingWorkspace } from "./useDrawingWorkspace";
import { initialDrawingDraft } from "./types";
import type { ConnectionSettingsState } from "../chat/settings";
import { useConfirmation } from "../ui/useConfirmation";
import type { ExitGuard } from "../general/lifecycle";

const mocks = vi.hoisted(() => ({ load: vi.fn(), enqueue: vi.fn(), saveDraft: vi.fn(), saveTask: vi.fn(), complete: vi.fn(),
  save: vi.fn(), recover: vi.fn(), read: vi.fn(), export: vi.fn(), generate: vi.fn(),
  onCloseRequested: vi.fn(), close: vi.fn(), release: vi.fn(), confirm: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => mocks }));
vi.mock("./runtime", () => ({ createRuntimeImageTransport: async () => ({ generate: mocks.generate }), runtimeDrawingFiles: mocks }));
vi.mock("./repository", () => ({ DexieDrawingRepository: class { load = mocks.load; enqueue = mocks.enqueue; saveDraft = mocks.saveDraft; saveTask = mocks.saveTask; complete = mocks.complete; } }));
vi.mock("./presets", () => ({ DexieDrawingPresetRepository: class { load = async () => []; } }));

const settings: ConnectionSettingsState = { version: 3, activeModelId: null, providers: [{ id: "p", name: "test", connections: [
  { id: "c", name: "test", protocol: "gemini-image", baseUrl: "https://example.test", apiKey: "synthetic-key", models: [{ id: "m", modelId: "test" }] },
] }] };
let state: ReturnType<typeof useDrawingWorkspace>, host: HTMLDivElement, root: ReturnType<typeof createRoot>;
let closeListener: (event: { preventDefault(): void }) => void;
const files = [{ id: "image", reference: "drawing/test/image.png", mime: "image/png", size: 3, width: 1, height: 1 }];
function Harness() { state = useDrawingWorkspace(true, mocks.confirm); return <output>{state.error}</output>; }
function DialogHarness() {
  const { confirm, dialog } = useConfirmation();
  state = useDrawingWorkspace(true, confirm);
  return <>{dialog}<output>{state.error}</output></>;
}
function DefaultHarness() { state = useDrawingWorkspace(); return <output>{state.error}</output>; }
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  mocks.load.mockResolvedValue({ draft: { ...initialDrawingDraft, modelId: "m", prompt: "synthetic" }, tasks: [], results: [] });
  mocks.saveDraft.mockResolvedValue(undefined); mocks.saveTask.mockResolvedValue(undefined); mocks.complete.mockResolvedValue(undefined);
  mocks.enqueue.mockImplementation(async tasks => tasks);
  mocks.recover.mockResolvedValue(null); mocks.save.mockResolvedValue(files); mocks.generate.mockResolvedValue([{ mime: "image/png", data: "AQID" }]);
  mocks.read.mockResolvedValue({ mime: "image/png", data: "AQID" }); mocks.close.mockResolvedValue(undefined);
  mocks.onCloseRequested.mockImplementation(async listener => { closeListener = listener; return mocks.release; });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic"); vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  mocks.confirm.mockResolvedValue(false);
  Object.assign(window, { confirm: vi.fn(), alert: vi.fn() });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("registers a managed exit guard without owning native close or hiding requests", async () => {
  let guard!: ExitGuard;
  const release = vi.fn();
  const register = vi.fn((value: ExitGuard) => { guard = value; return release; });
  function ManagedHarness() { state = useDrawingWorkspace(true, mocks.confirm, register); return null; }
  await act(async () => root.render(<ManagedHarness />));
  mocks.onCloseRequested.mockClear(); mocks.close.mockClear();
  const settle = vi.spyOn(state.controller, "settleForClose");
  expect(register).toHaveBeenCalledOnce(); expect(settle).not.toHaveBeenCalled();
  let prepared = false;
  await act(async () => { prepared = await guard.prepare(); });
  expect(prepared).toBe(true); expect(settle).toHaveBeenCalledOnce();
  expect(mocks.close).not.toHaveBeenCalled(); expect(mocks.onCloseRequested).not.toHaveBeenCalled();
  await act(async () => guard.cancel()); expect(state.closing).toBe(false);
  await act(async () => root.unmount()); expect(release).toHaveBeenCalledOnce();
});

it("releases originals when preview is hidden and reads only when it becomes visible again", async () => {
  await act(async () => state.controller.generate(settings));
  expect(mocks.read).toHaveBeenCalledOnce(); expect(state.previewUrl).toBe("blob:synthetic");
  await act(async () => state.setPreviewActive(false));
  expect(state.previewUrl).toBeNull(); expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic");
  await act(async () => state.controller.generate(settings));
  expect(mocks.read).toHaveBeenCalledOnce(); expect(state.previewUrl).toBeNull();
  await act(async () => state.setPreviewActive(true));
  expect(mocks.read).toHaveBeenCalledTimes(2); expect(state.previewUrl).toBe("blob:synthetic");
});
it("plays one completion tone, honors mute, and releases audio resources", async () => {
  const disconnect = vi.fn(), start = vi.fn(), stop = vi.fn();
  const oscillator = { frequency: { value: 0 }, connect: vi.fn(), disconnect, start, stop, onended: null as null | (() => void) };
  const gain = { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect };
  const close = vi.fn(async () => undefined), createOscillator = vi.fn(() => oscillator);
  vi.stubGlobal("AudioContext", class {
    state = "running"; currentTime = 0; destination = {};
    resume = vi.fn(async () => undefined); close = close;
    createOscillator = createOscillator; createGain = () => gain;
  });
  document.dispatchEvent(new Event("pointerdown"));
  expect(start).not.toHaveBeenCalled();
  await act(async () => state.controller.generate(settings));
  expect(start).toHaveBeenCalledOnce(); expect(oscillator.frequency.value).toBe(660);
  oscillator.onended?.(); expect(disconnect).toHaveBeenCalledTimes(2);
  await act(async () => state.controller.setDraft({ ...state.draft, completionSound: false }));
  await act(async () => state.controller.generate(settings));
  expect(start).toHaveBeenCalledOnce();
  await act(async () => state.controller.setDraft({ ...state.draft, completionSound: true }));
  expect(start).toHaveBeenCalledOnce();
  mocks.save.mockRejectedValueOnce(new Error("disk"));
  await act(async () => state.controller.generate(settings));
  expect(start).toHaveBeenCalledTimes(2); expect(oscillator.frequency.value).toBe(330);
  await act(async () => root.render(null));
  expect(close).toHaveBeenCalledOnce();
});

it("keeps failed-save pixels alive when the user declines losing them and restores generation controls", async () => {
  mocks.save.mockRejectedValueOnce(new Error("disk"));
  await act(async () => state.controller.generate(settings));
  const event = { preventDefault: vi.fn() };
  await act(async () => closeListener(event));
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("尚未保存") }));
  expect(window.confirm).not.toHaveBeenCalled();
  expect(mocks.close).not.toHaveBeenCalled();
  expect(state.closing).toBe(false); expect(state.controller.hasUnsavedImages()).toBe(true);
  await act(async () => state.controller.retrySave(state.tasks[0].id));
  expect(state.tasks[0].status).toBe("completed"); expect(mocks.generate).toHaveBeenCalledOnce();
  await act(async () => closeListener(event));
  expect(mocks.close).toHaveBeenCalledOnce();
});

it("keeps local retry terminal in memory even when its failure status cannot be persisted", async () => {
  mocks.save.mockRejectedValue(new Error("disk"));
  await act(async () => state.controller.generate(settings));
  mocks.saveTask.mockImplementation(async task => { if (task.status === "save-failed") throw new Error("db"); });
  await act(async () => state.controller.retrySave(state.tasks[0].id));
  expect(state.tasks[0].status).toBe("save-failed");
  expect(state.busy).toBe(false); expect(mocks.generate).toHaveBeenCalledOnce();
});

it("requires the separate loss confirmation if a saving task fails during close preparation", async () => {
  let failSave!: (error: Error) => void;
  mocks.save.mockImplementationOnce(() => new Promise((_, reject) => { failSave = reject; }));
  let generation!: Promise<void>;
  await act(async () => { generation = state.controller.generate(settings); });
  expect(state.tasks[0].status).toBe("saving");
  mocks.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await act(async () => closeListener({ preventDefault: vi.fn() }));
  expect(state.closing).toBe(true);
  await act(async () => { failSave(new Error("disk")); await generation; });
  expect(mocks.confirm).toHaveBeenCalledTimes(2);
  expect(mocks.close).not.toHaveBeenCalled(); expect(state.closing).toBe(false);
  expect(state.controller.hasUnsavedImages()).toBe(true);
});

it("closes only after explicit loss confirmation and releases owned preview URLs/listeners", async () => {
  mocks.save.mockRejectedValueOnce(new Error("disk"));
  await act(async () => state.controller.generate(settings));
  mocks.confirm.mockResolvedValue(true);
  await act(async () => closeListener({ preventDefault: vi.fn() }));
  expect(mocks.close).toHaveBeenCalledOnce(); expect(state.controller.hasUnsavedImages()).toBe(false);
  const event = { preventDefault: vi.fn() }; closeListener(event);
  expect(event.preventDefault).not.toHaveBeenCalled();
  // A fresh successful preview remains transient and is revoked on unmount.
  await act(async () => { state.controller.cancelClose(); state.controller.resume(); });
  await act(async () => state.controller.generate(settings));
  expect(state.previewUrl).toBe("blob:synthetic");
  await act(async () => root.render(null));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic");
  expect(mocks.release).toHaveBeenCalledOnce();
});

it("declining the initial busy close preserves an active request and doesn't set the close gate", async () => {
  let finish!: () => void;
  mocks.generate.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve([{ mime: "image/png", data: "AQID" }]); }));
  let generation!: Promise<void>;
  await act(async () => { generation = state.controller.generate(settings); });
  await act(async () => closeListener({ preventDefault: vi.fn() }));
  expect(mocks.generate.mock.calls[0][2].aborted).toBe(false);
  expect(state).toMatchObject({ busy: true, closing: false });
  await act(async () => { finish(); await generation; });
});

it("guards repeated close requests before the initial asynchronous confirmation resolves", async () => {
  let finish!: () => void, answer!: (accepted: boolean) => void;
  mocks.generate.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve([{ mime: "image/png", data: "AQID" }]); }));
  mocks.confirm.mockImplementationOnce(() => new Promise<boolean>(resolve => { answer = resolve; }));
  const settle = vi.spyOn(state.controller, "settleForClose");
  let generation!: Promise<void>;
  await act(async () => { generation = state.controller.generate(settings); });
  const first = { preventDefault: vi.fn() }, second = { preventDefault: vi.fn() };
  await act(async () => { closeListener(first); closeListener(second); });
  expect(first.preventDefault).toHaveBeenCalledOnce(); expect(second.preventDefault).toHaveBeenCalledOnce();
  expect(mocks.confirm).toHaveBeenCalledOnce(); expect(settle).not.toHaveBeenCalled();
  expect(mocks.generate.mock.calls[0][2].aborted).toBe(false);
  await act(async () => answer(false));
  expect(state.closing).toBe(false); expect(mocks.close).not.toHaveBeenCalled();
  await act(async () => closeListener({ preventDefault: vi.fn() }));
  expect(mocks.confirm).toHaveBeenCalledTimes(2);
  await act(async () => { finish(); await generation; });
});

it("guards repeated close requests during the separate unsaved-image confirmation", async () => {
  let answer!: (accepted: boolean) => void;
  mocks.save.mockRejectedValueOnce(new Error("disk"));
  await act(async () => state.controller.generate(settings));
  mocks.confirm.mockImplementationOnce(() => new Promise<boolean>(resolve => { answer = resolve; }));
  const settle = vi.spyOn(state.controller, "settleForClose");
  await act(async () => closeListener({ preventDefault: vi.fn() }));
  expect(state.closing).toBe(true);
  await act(async () => closeListener({ preventDefault: vi.fn() }));
  expect(mocks.confirm).toHaveBeenCalledOnce(); expect(settle).toHaveBeenCalledOnce();
  await act(async () => answer(false));
  expect(state.closing).toBe(false); expect(state.controller.hasUnsavedImages()).toBe(true);
  expect(mocks.close).not.toHaveBeenCalled();
});

it("does not stop a request or close from an initial confirmation resolved after unmount", async () => {
  let finish!: () => void, answer!: (accepted: boolean) => void;
  mocks.generate.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve([{ mime: "image/png", data: "AQID" }]); }));
  mocks.confirm.mockImplementationOnce(() => new Promise<boolean>(resolve => { answer = resolve; }));
  const settle = vi.spyOn(state.controller, "settleForClose");
  let generation!: Promise<void>;
  await act(async () => { generation = state.controller.generate(settings); });
  await act(async () => closeListener({ preventDefault: vi.fn() }));
  await act(async () => root.render(null));
  await act(async () => answer(true));
  expect(settle).not.toHaveBeenCalled(); expect(mocks.close).not.toHaveBeenCalled();
  expect(mocks.generate.mock.calls[0][2].aborted).toBe(false);
  const staleEvent = { preventDefault: vi.fn() }; closeListener(staleEvent);
  expect(staleEvent.preventDefault).toHaveBeenCalledOnce(); expect(mocks.confirm).toHaveBeenCalledOnce();
  await act(async () => { finish(); await generation; });
});

it("retains unsaved images when a loss confirmation resolves after unmount", async () => {
  let answer!: (accepted: boolean) => void;
  mocks.save.mockRejectedValueOnce(new Error("disk"));
  await act(async () => state.controller.generate(settings));
  mocks.confirm.mockImplementationOnce(() => new Promise<boolean>(resolve => { answer = resolve; }));
  const discard = vi.spyOn(state.controller, "discardUnsavedForClose");
  await act(async () => closeListener({ preventDefault: vi.fn() }));
  expect(state.closing).toBe(true);
  await act(async () => root.render(null));
  await act(async () => answer(true));
  expect(discard).not.toHaveBeenCalled(); expect(mocks.close).not.toHaveBeenCalled();
  expect(state.controller.hasUnsavedImages()).toBe(true);
  expect(state.controller.getSnapshot().closing).toBe(false); expect(window.alert).not.toHaveBeenCalled();
});

it("does not close when local close preparation finishes after unmount", async () => {
  let finish!: () => void;
  vi.spyOn(state.controller, "settleForClose").mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await act(async () => closeListener({ preventDefault: vi.fn() }));
  await act(async () => root.render(null));
  await act(async () => finish());
  expect(mocks.close).not.toHaveBeenCalled(); expect(window.alert).not.toHaveBeenCalled();
});

it("restores the close gate before reporting a native close failure and permits retry", async () => {
  mocks.close.mockRejectedValueOnce(new Error("native close failed"));
  vi.mocked(window.alert).mockImplementation(() => { expect(state.controller.getSnapshot().closing).toBe(false); });
  await act(async () => closeListener({ preventDefault: vi.fn() }));
  expect(window.alert).toHaveBeenCalledOnce(); expect(state.closing).toBe(false);
  await act(async () => closeListener({ preventDefault: vi.fn() }));
  expect(mocks.close).toHaveBeenCalledTimes(2);
});

it("uses the mounted app confirmation for cancel and explicit unsaved-image exit", async () => {
  await act(async () => root.render(<DialogHarness />));
  mocks.save.mockRejectedValueOnce(new Error("disk"));
  await act(async () => state.controller.generate(settings));
  await act(async () => closeListener({ preventDefault: vi.fn() }));
  expect(document.querySelector(".confirmation-dialog")?.textContent).toContain("退出并丢弃未保存图片");
  await act(async () => document.querySelector<HTMLButtonElement>(".confirmation-dialog .confirmation-button")?.click());
  expect(document.querySelector(".confirmation-dialog")).toBeNull();
  expect(state.closing).toBe(false); expect(state.controller.hasUnsavedImages()).toBe(true);
  expect(mocks.close).not.toHaveBeenCalled();
  await act(async () => closeListener({ preventDefault: vi.fn() }));
  await act(async () => document.querySelector<HTMLButtonElement>(".confirmation-dialog .confirmation-accept")?.click());
  expect(mocks.close).toHaveBeenCalledOnce(); expect(state.controller.hasUnsavedImages()).toBe(false);
  expect(window.confirm).not.toHaveBeenCalled();
});

it("refuses unsaved-image loss without an injected confirmation while allowing an idle close", async () => {
  await act(async () => root.render(<DefaultHarness />));
  mocks.save.mockRejectedValueOnce(new Error("disk"));
  await act(async () => state.controller.generate(settings));
  await act(async () => closeListener({ preventDefault: vi.fn() }));
  expect(mocks.confirm).not.toHaveBeenCalled(); expect(window.confirm).not.toHaveBeenCalled();
  expect(state.closing).toBe(false); expect(state.controller.hasUnsavedImages()).toBe(true);
  expect(mocks.close).not.toHaveBeenCalled();
  await act(async () => state.controller.retrySave(state.tasks[0].id));
  await act(async () => closeListener({ preventDefault: vi.fn() }));
  expect(mocks.close).toHaveBeenCalledOnce();
});
