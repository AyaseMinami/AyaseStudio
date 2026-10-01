// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useDrawingWorkspace } from "./useDrawingWorkspace";
import { initialDrawingDraft } from "./types";
import type { ConnectionSettingsState } from "../chat/settings";

const mocks = vi.hoisted(() => ({ load: vi.fn(), enqueue: vi.fn(), saveDraft: vi.fn(), saveTask: vi.fn(), complete: vi.fn(),
  save: vi.fn(), recover: vi.fn(), read: vi.fn(), export: vi.fn(), generate: vi.fn(),
  onCloseRequested: vi.fn(), close: vi.fn(), release: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => mocks }));
vi.mock("./runtime", () => ({ createRuntimeImageTransport: async () => ({ generate: mocks.generate }), runtimeDrawingFiles: mocks }));
vi.mock("./repository", () => ({ DexieDrawingRepository: class { load = mocks.load; enqueue = mocks.enqueue; saveDraft = mocks.saveDraft; saveTask = mocks.saveTask; complete = mocks.complete; } }));

const settings: ConnectionSettingsState = { version: 3, activeModelId: null, providers: [{ id: "p", name: "test", connections: [
  { id: "c", name: "test", protocol: "gemini-image", baseUrl: "https://example.test", apiKey: "synthetic-key", models: [{ id: "m", modelId: "test" }] },
] }] };
let state: ReturnType<typeof useDrawingWorkspace>, host: HTMLDivElement, root: ReturnType<typeof createRoot>;
let closeListener: (event: { preventDefault(): void }) => void;
const files = [{ id: "image", reference: "drawing/test/image.png", mime: "image/png", size: 3, width: 1, height: 1 }];
function Harness() { state = useDrawingWorkspace(); return <output>{state.error}</output>; }
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
  Object.assign(window, { confirm: vi.fn().mockReturnValue(false), alert: vi.fn() });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("尚未保存"));
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
  vi.mocked(window.confirm).mockReturnValueOnce(true).mockReturnValueOnce(false);
  await act(async () => closeListener({ preventDefault: vi.fn() }));
  expect(state.closing).toBe(true);
  await act(async () => { failSave(new Error("disk")); await generation; });
  expect(window.confirm).toHaveBeenCalledTimes(2);
  expect(mocks.close).not.toHaveBeenCalled(); expect(state.closing).toBe(false);
  expect(state.controller.hasUnsavedImages()).toBe(true);
});

it("closes only after explicit loss confirmation and releases owned preview URLs/listeners", async () => {
  mocks.save.mockRejectedValueOnce(new Error("disk"));
  await act(async () => state.controller.generate(settings));
  vi.mocked(window.confirm).mockReturnValue(true);
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
