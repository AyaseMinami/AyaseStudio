export interface UpdateMetadata { session: string; version: string; notes: string; date?: string }
export interface UpdateState {
  phase: "unavailable" | "idle" | "checking" | "current" | "available" | "downloading" | "ready" | "installing" | "cancelled" | "error";
  update?: UpdateMetadata;
  downloaded?: number;
  total?: number;
  message?: string;
  startupNotice?: boolean;
}
export interface UpdateActions {
  state: UpdateState;
  check(): Promise<void>;
  download(): Promise<void>;
  cancel(): Promise<void>;
  install(): Promise<void>;
}
export interface UpdateRuntime {
  available(): Promise<boolean>;
  check(): Promise<UpdateMetadata | null>;
  download(session: string, progress: (downloaded: number, total?: number) => void): Promise<void>;
  cancel(session: string): Promise<void>;
  install(session: string): Promise<void>;
}
export type PrepareUpdateInstall = (install: () => Promise<void>) => Promise<boolean>;
export class UpdateInstallBlocked extends Error {}
export const STARTUP_UPDATE_DELAY_MS = 10_000;

/** Root-owned, memory-only update session; navigation never restarts a check or download. */
export class UpdateController {
  private state: UpdateState = { phase: "unavailable" };
  private listeners = new Set<() => void>();
  private epoch = 0;
  private alive = false;
  private cancelling = false;
  private downloadTask?: Promise<void>;
  private startupTimer?: ReturnType<typeof setTimeout>;
  private startupConsumed = false;
  private startupEnabled = false;
  private startupReady = false;
  constructor(private runtime: UpdateRuntime, private prepareInstall: PrepareUpdateInstall) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: UpdateState) { this.state = state; this.listeners.forEach(listener => listener()); }
  async start(): Promise<void> {
    this.alive = true;
    const epoch = ++this.epoch;
    try {
      const enabled = await this.runtime.available();
      if (this.alive && epoch === this.epoch) {
        this.publish({ phase: enabled ? "idle" : "unavailable" });
        this.scheduleStartupCheck();
      }
    } catch { if (this.alive && epoch === this.epoch) this.publish({ phase: "unavailable", message: "应用内更新暂不可用，请使用官方下载入口。" }); }
  }
  dispose(): void {
    this.clearStartupTimer();
    this.alive = false; this.epoch++;
    const session = this.state.update?.session;
    if (session && this.state.phase !== "installing") void this.runtime.cancel(session).catch(() => undefined);
  }
  configureStartupCheck(enabled: boolean, ready: boolean): void {
    this.startupEnabled = enabled; this.startupReady = ready;
    if (!enabled || !ready) this.clearStartupTimer();
    else this.scheduleStartupCheck();
  }
  private clearStartupTimer(): void {
    if (this.startupTimer !== undefined) clearTimeout(this.startupTimer);
    this.startupTimer = undefined;
  }
  private scheduleStartupCheck(): void {
    if (!this.alive || !this.startupEnabled || !this.startupReady || this.startupConsumed || this.startupTimer !== undefined || this.state.phase !== "idle") return;
    this.startupTimer = setTimeout(() => {
      this.startupTimer = undefined;
      if (this.alive && this.startupEnabled && this.startupReady && !this.startupConsumed && this.state.phase === "idle")
        void this.checkForUpdates(true);
    }, STARTUP_UPDATE_DELAY_MS);
  }
  dismissNotice = (): void => {
    if (this.state.startupNotice) this.publish({ ...this.state, startupNotice: false });
  };
  check = (): Promise<void> => this.checkForUpdates(false);
  private async checkForUpdates(background: boolean): Promise<void> {
    if (!this.alive || ["unavailable", "checking", "downloading", "installing"].includes(this.state.phase)) return;
    this.startupConsumed = true;
    this.clearStartupTimer();
    const previous = this.state.update?.session, epoch = ++this.epoch;
    this.publish({ phase: "checking" });
    try {
      if (previous) await this.runtime.cancel(previous);
      if (!this.alive || epoch !== this.epoch) return;
      const update = await this.runtime.check();
      if (!this.alive || epoch !== this.epoch) {
        if (update) await this.runtime.cancel(update.session);
        return;
      }
      if (background && (!this.startupEnabled || !this.startupReady)) {
        if (update) await this.runtime.cancel(update.session);
        this.publish({ phase: "idle" }); return;
      }
      this.publish(update ? { phase: "available", update, ...(background ? { startupNotice: true } : {}) } : { phase: "current" });
    } catch { if (this.alive && epoch === this.epoch) this.publish(background
      ? { phase: "idle" }
      : { phase: "error", message: "检查更新失败，请检查网络或稍后重试。" }); }
  }
  download = async (): Promise<void> => {
    if (!this.alive || this.state.phase !== "available" || !this.state.update) return;
    const update = this.state.update, epoch = ++this.epoch;
    this.cancelling = false;
    this.publish({ phase: "downloading", update, downloaded: 0 });
    const task = this.runtime.download(update.session, (downloaded, total) => {
      if (this.alive && epoch === this.epoch && this.state.phase === "downloading" && !this.cancelling) {
        this.publish({ phase: "downloading", update, downloaded: Math.max(this.state.downloaded ?? 0, downloaded),
          ...(total && total > 0 ? { total } : {}) });
      }
    });
    this.downloadTask = task;
    try {
      await task;
      if (this.alive && epoch === this.epoch) this.publish(this.cancelling ? { phase: "cancelled" } : { phase: "ready", update });
    } catch {
      if (this.alive && epoch === this.epoch) this.publish(this.cancelling ? { phase: "cancelled" } : { phase: "error", message: "更新下载或签名校验失败，请重新检查更新后重试。" });
    } finally { if (this.downloadTask === task) this.downloadTask = undefined; }
  };
  cancel = async (): Promise<void> => {
    if (!this.alive || this.state.phase !== "downloading" || !this.state.update || this.cancelling) return;
    const session = this.state.update.session;
    this.cancelling = true;
    this.publish({ ...this.state, message: "正在取消下载…" });
    try { await this.runtime.cancel(session); }
    catch {
      this.cancelling = false;
      if (this.alive && this.state.phase === "downloading") this.publish({ ...this.state, message: "取消失败，请等待下载结束或重试。" });
      return;
    }
    // Do not report cancellation until native download has actually settled.
    await this.downloadTask?.catch(() => undefined);
  };
  install = async (): Promise<void> => {
    if (!this.alive || this.state.phase !== "ready" || !this.state.update) return;
    const update = this.state.update, epoch = ++this.epoch;
    this.publish({ phase: "installing", update });
    try {
      const accepted = await this.prepareInstall(async () => {
        if (!this.alive || epoch !== this.epoch) throw new Error("stale update operation");
        await this.runtime.install(update.session);
      });
      if (this.alive && epoch === this.epoch && !accepted) this.publish({ phase: "ready", update });
    } catch (error) {
      if (this.alive && epoch === this.epoch) this.publish(error instanceof UpdateInstallBlocked
        ? { phase: "ready", update, message: error.message }
        : { phase: "error", message: "更新尚未安装。请等待当前操作完成并保存内容后重新检查，或使用官方下载入口。" });
    }
  };
}
