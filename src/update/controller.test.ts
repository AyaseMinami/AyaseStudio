import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UpdateController, UpdateInstallBlocked, STARTUP_UPDATE_DELAY_MS, type UpdateMetadata, type UpdateRuntime } from "./controller";

const metadata: UpdateMetadata = { session: "opaque", version: "0.1.0-beta.4", notes: "合成测试" };
const deferred = <T>() => { let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
let runtime: UpdateRuntime, controller: UpdateController;
const prepare = vi.fn<(install: () => Promise<void>) => Promise<boolean>>();
beforeEach(async () => {
  vi.resetAllMocks();
  runtime = { available: vi.fn().mockResolvedValue(true), check: vi.fn().mockResolvedValue(metadata),
    download: vi.fn().mockResolvedValue(undefined), cancel: vi.fn().mockResolvedValue(undefined), install: vi.fn().mockResolvedValue(undefined) };
  prepare.mockImplementation(async install => { await install(); return true; });
  controller = new UpdateController(runtime, prepare); await controller.start();
});
afterEach(() => { controller.dispose(); vi.useRealTimers(); });
it("only reads local availability at startup; checks are explicit and duplicate checks suppressed", async () => {
  expect(runtime.check).not.toHaveBeenCalled();
  const pending = deferred<UpdateMetadata | null>(); vi.mocked(runtime.check).mockReturnValue(pending.promise);
  const first = controller.check(); await controller.check(); expect(runtime.check).toHaveBeenCalledOnce();
  pending.resolve(metadata); await first; expect(controller.getSnapshot().phase).toBe("available");
});
it("reports no update and sanitized network/manifest errors without affecting app data", async () => {
  vi.mocked(runtime.check).mockResolvedValueOnce(null); await controller.check(); expect(controller.getSnapshot().phase).toBe("current");
  vi.mocked(runtime.check).mockRejectedValueOnce(new Error("PRIVATE-URL-DETAIL")); await controller.check();
  expect(controller.getSnapshot()).toEqual({ phase: "error", message: "检查更新失败，请检查网络或稍后重试。" });
});
it("ignores late checks after disposal and releases their native session", async () => {
  const pending = deferred<UpdateMetadata | null>(); vi.mocked(runtime.check).mockReturnValue(pending.promise);
  const task = controller.check(); controller.dispose(); pending.resolve(metadata); await task;
  expect(controller.getSnapshot().phase).toBe("checking"); expect(runtime.cancel).toHaveBeenCalledWith("opaque");
  expect(runtime.download).not.toHaveBeenCalled();
});
it("waits for actual download settlement on cancel, rejects duplicate actions and never installs cancelled data", async () => {
  await controller.check(); const pending = deferred<void>(); vi.mocked(runtime.download).mockReturnValue(pending.promise);
  const task = controller.download(); await controller.download();
  vi.mocked(runtime.download).mock.calls[0][1](2048); expect(controller.getSnapshot().downloaded).toBe(2048);
  const cancelling = controller.cancel(); await controller.cancel();
  expect(controller.getSnapshot().phase).toBe("downloading"); expect(runtime.cancel).toHaveBeenCalledOnce();
  vi.mocked(runtime.download).mock.calls[0][1](4096, 8192); expect(controller.getSnapshot().downloaded).toBe(2048);
  pending.reject(new Error("cancelled")); await Promise.all([task, cancelling]);
  expect(controller.getSnapshot().phase).toBe("cancelled"); await controller.install(); expect(runtime.install).not.toHaveBeenCalled();
});
it("a failed cancel keeps the running download available and does not claim success", async () => {
  await controller.check(); const pending = deferred<void>(); vi.mocked(runtime.download).mockReturnValue(pending.promise);
  const task = controller.download(); vi.mocked(runtime.cancel).mockRejectedValueOnce(new Error("failed"));
  await controller.cancel(); expect(controller.getSnapshot().phase).toBe("downloading");
  expect(controller.getSnapshot().message).toContain("取消失败"); pending.resolve(); await task;
  expect(controller.getSnapshot().phase).toBe("ready");
});
it("signature/download failure cannot reach install; explicit recheck is required", async () => {
  await controller.check(); vi.mocked(runtime.download).mockRejectedValueOnce(new Error("invalid signature")); await controller.download();
  expect(controller.getSnapshot().phase).toBe("error"); await controller.install(); expect(prepare).not.toHaveBeenCalled();
  await controller.check(); expect(controller.getSnapshot().phase).toBe("available");
});
it("preserves the verified package when install confirmation is cancelled, and serializes installation", async () => {
  await controller.check(); await controller.download(); prepare.mockResolvedValueOnce(false); await controller.install();
  expect(controller.getSnapshot().phase).toBe("ready"); expect(runtime.install).not.toHaveBeenCalled();
  const decision = deferred<boolean>(); prepare.mockReturnValueOnce(decision.promise);
  const task = controller.install(); await controller.install(); await controller.check();
  expect(prepare).toHaveBeenCalledTimes(2); expect(runtime.check).toHaveBeenCalledOnce(); decision.resolve(false); await task;
  await controller.install(); expect(runtime.install).toHaveBeenCalledExactlyOnceWith("opaque");
});
it("refuses updater actions in a browser or unsigned development build", async () => {
  controller.dispose(); vi.mocked(runtime.available).mockResolvedValueOnce(false); await controller.start();
  await controller.check(); await controller.download(); await controller.install();
  expect(controller.getSnapshot().phase).toBe("unavailable"); expect(runtime.check).not.toHaveBeenCalled();
});
it("explains task blocking while retaining the verified package for a later install", async () => {
  await controller.check(); await controller.download();
  prepare.mockRejectedValueOnce(new UpdateInstallBlocked("请等待任务结束后再次安装。"));
  await controller.install();
  expect(controller.getSnapshot()).toEqual({ phase: "ready", update: metadata, message: "请等待任务结束后再次安装。" });
  expect(runtime.install).not.toHaveBeenCalled(); expect(runtime.cancel).not.toHaveBeenCalled();
  await controller.install(); expect(runtime.install).toHaveBeenCalledExactlyOnceWith("opaque");
  expect(runtime.download).toHaveBeenCalledOnce();
});
it("rechecking disposes an existing verified package before acquiring a new one", async () => {
  await controller.check(); await controller.download(); await controller.check();
  expect(runtime.cancel).toHaveBeenCalledWith("opaque"); expect(runtime.check).toHaveBeenCalledTimes(2);
});
it("waits for a ready main view, checks once after ten seconds, and only offers a notice", async () => {
  vi.useFakeTimers(); controller.configureStartupCheck(true, false);
  await vi.advanceTimersByTimeAsync(20_000); expect(runtime.check).not.toHaveBeenCalled();
  controller.configureStartupCheck(true, true);
  await vi.advanceTimersByTimeAsync(STARTUP_UPDATE_DELAY_MS - 1); expect(runtime.check).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(controller.getSnapshot()).toEqual({ phase: "available", update: metadata, startupNotice: true });
  expect(runtime.download).not.toHaveBeenCalled(); expect(runtime.install).not.toHaveBeenCalled();
  controller.dismissNotice(); expect(controller.getSnapshot().startupNotice).toBe(false);
  controller.configureStartupCheck(true, false); controller.configureStartupCheck(true, true);
  await vi.advanceTimersByTimeAsync(86_400_000); expect(runtime.check).toHaveBeenCalledOnce();
});
it("disabled preferences and unavailable builds never perform a startup request", async () => {
  vi.useFakeTimers(); controller.configureStartupCheck(false, true);
  await vi.advanceTimersByTimeAsync(20_000); expect(runtime.check).not.toHaveBeenCalled();
  controller.dispose(); vi.mocked(runtime.available).mockResolvedValueOnce(false);
  await controller.start(); controller.configureStartupCheck(true, true);
  await vi.advanceTimersByTimeAsync(20_000); expect(runtime.check).not.toHaveBeenCalled();
});
it("cancels pending startup checks on disable, disposal and a winning manual check", async () => {
  vi.useFakeTimers(); controller.configureStartupCheck(true, true);
  controller.configureStartupCheck(false, true); await vi.advanceTimersByTimeAsync(20_000);
  expect(runtime.check).not.toHaveBeenCalled();
  controller.configureStartupCheck(true, true); await controller.check();
  await vi.advanceTimersByTimeAsync(20_000); expect(runtime.check).toHaveBeenCalledOnce();
  expect(controller.getSnapshot().startupNotice).toBeUndefined();
  controller.dispose();
  controller = new UpdateController(runtime, prepare); await controller.start();
  controller.configureStartupCheck(true, true); controller.dispose();
  await vi.advanceTimersByTimeAsync(20_000); expect(runtime.check).toHaveBeenCalledOnce();
});
it("startup failure remains quiet with no automatic retry, while manual failure remains visible", async () => {
  vi.useFakeTimers(); vi.mocked(runtime.check).mockRejectedValue(new Error("synthetic network failure"));
  controller.configureStartupCheck(true, true); await vi.advanceTimersByTimeAsync(STARTUP_UPDATE_DELAY_MS);
  expect(controller.getSnapshot()).toEqual({ phase: "idle" });
  controller.configureStartupCheck(true, true); await vi.advanceTimersByTimeAsync(86_400_000);
  expect(runtime.check).toHaveBeenCalledOnce(); await controller.check();
  expect(controller.getSnapshot().phase).toBe("error");
});
it("turning the switch off during a startup request suppresses and releases a late offer", async () => {
  vi.useFakeTimers(); const pending = deferred<UpdateMetadata | null>(); vi.mocked(runtime.check).mockReturnValueOnce(pending.promise);
  controller.configureStartupCheck(true, true); await vi.advanceTimersByTimeAsync(STARTUP_UPDATE_DELAY_MS);
  expect(controller.getSnapshot().phase).toBe("checking"); controller.configureStartupCheck(false, true);
  pending.resolve(metadata); await vi.advanceTimersByTimeAsync(0);
  expect(controller.getSnapshot()).toEqual({ phase: "idle" }); expect(runtime.cancel).toHaveBeenCalledWith(metadata.session);
});
it("StrictMode-style effect replay owns only one startup timer and ignores late local availability", async () => {
  vi.useFakeTimers(); controller.configureStartupCheck(true, true); controller.dispose(); await controller.start();
  controller.configureStartupCheck(true, true); await vi.advanceTimersByTimeAsync(STARTUP_UPDATE_DELAY_MS);
  expect(runtime.check).toHaveBeenCalledOnce();
});
