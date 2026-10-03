import type { GeneralSettingsState } from "./preferences";
import type { ConfirmationOptions } from "../ui/useConfirmation";

export interface ExitGuard { prepare(): Promise<boolean>; cancel(): void }
export type RegisterExitGuard = (guard: ExitGuard) => () => void;
export interface LifecycleRuntime {
  hide(): Promise<void>;
  close(): Promise<void>;
  onClose(handler: (event: { preventDefault(): void }) => void): Promise<() => void>;
  onExit(handler: () => void): Promise<() => void>;
}

/** One owner for every ordinary close and explicit tray exit. Hidden windows retain their tasks. */
export class ApplicationLifecycle {
  private busy = false;
  private approved = false;
  private alive = true;
  private guard?: ExitGuard;
  private releases: (() => void)[] = [];
  constructor(private readonly runtime: LifecycleRuntime,
    private readonly settings: () => GeneralSettingsState,
    private readonly confirm: (options: ConfirmationOptions) => Promise<boolean>,
    private readonly reportError: (message: string) => void,
    private readonly canExit: () => boolean) {}
  registerExitGuard: RegisterExitGuard = guard => {
    this.guard = guard;
    return () => { if (this.guard === guard) this.guard = undefined; };
  };
  async start(): Promise<void> {
    const attach = async (registration: Promise<() => void>) => {
      const release = await registration;
      if (this.alive) this.releases.push(release); else release();
    };
    await Promise.all([attach(this.runtime.onClose(event => {
      if (this.approved && this.alive) return;
      event.preventDefault();
      void this.request(false);
    })), attach(this.runtime.onExit(() => { void this.request(true); }))]);
  }
  dispose(): void { this.alive = false; this.releases.splice(0).forEach(release => release()); }
  async request(explicitExit: boolean): Promise<void> {
    if (!this.alive || this.busy || this.approved) return;
    this.busy = true;
    let prepared = false;
    const guard = this.guard;
    try {
      const settings = this.settings();
      if (!explicitExit && settings.preferences.backgroundResident) { await this.runtime.hide(); return; }
      if (!this.canExit()) {
        this.reportError("正在检查或维护本地数据，请等待完成并返回应用后再退出。");
        return;
      }
      let dontRemind = false;
      // An unreadable preference is preserved; explicit exit still remains available with confirmation.
      if (settings.error || settings.preferences.confirmBeforeExit) {
        const accepted = await this.confirm({ title: "退出应用", message: "确定退出 Ayase Studio？退出后应用将停止运行。", confirmLabel: "退出",
          ...(settings.error ? {} : { checkbox: { label: "不再提醒", onChange: checked => { dontRemind = checked; } } }) });
        if (!this.alive || !accepted) return;
      }
      if (!this.canExit() || this.guard !== guard) return;
      if (guard) {
        prepared = true;
        if (!await guard.prepare() || !this.alive) return;
      }
      if (dontRemind && !await this.settings().setPreference("confirmBeforeExit", false)) throw new Error("退出确认设置保存失败，请检查常规设置后重试。");
      if (!this.alive) return;
      this.approved = true;
      await this.runtime.close();
    } catch (error) {
      this.approved = false;
      if (this.alive) this.reportError(error instanceof Error ? error.message : "窗口操作失败，请重试。");
    } finally {
      if (!this.approved && prepared) guard?.cancel();
      this.busy = false;
    }
  }
}
