import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { AboutSettings } from "../../src/ui/settings/AboutSettings";
import { GeneralSettings } from "../../src/ui/settings/GeneralSettings";
import { UpdateNotice } from "../../src/ui/UpdateNotice";
import { GeneralPreferencesStore, type GeneralSettingsState } from "../../src/general/preferences";
import { UpdateController, type UpdateRuntime } from "../../src/update/controller";
import "../../src/App.css";
import "./preview.css";

const scenarios = {
  update: "发现更新", current: "没有更新", checkFailure: "检查失败", downloadFailure: "下载失败",
  signatureFailure: "签名校验失败", unknownSize: "未知下载大小", unavailable: "更新不可用",
};
type Scenario = keyof typeof scenarios;
const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

function syntheticRuntime(scenario: Scenario, log: (message: string) => void): UpdateRuntime {
  let timer: ReturnType<typeof setInterval> | undefined;
  let rejectDownload: ((reason: Error) => void) | undefined;
  return {
    async available() { return scenario !== "unavailable"; },
    async check() {
      log("模拟检查开始");
      await delay(600);
      if (scenario === "checkFailure") throw new Error("synthetic check failure");
      if (scenario === "current") return null;
      return { session: "fixture-update-76", version: "0.2.0-beta.1", date: "2026-10-04",
        notes: "更新演示（合成内容）\n\n• 更清晰的手动更新操作。\n• 下载完成后单独确认安装。\n\n" +
          "这是一段用于检查换行和滚动的更新说明。\n".repeat(12) + "\n<script>neverExecuted()</script>\n" + "长地址/".repeat(40) };
    },
    download(_session, progress) {
      log("模拟下载开始");
      return new Promise<void>((resolve, reject) => {
        rejectDownload = reject;
        let step = 0;
        const total = 8 * 1024 * 1024;
        timer = setInterval(() => {
          step++;
          progress(total * step / 16, scenario === "unknownSize" ? undefined : total);
          if ((scenario === "downloadFailure" && step === 4) || step === 16) {
            clearInterval(timer); timer = undefined; rejectDownload = undefined;
            if (scenario === "downloadFailure" || scenario === "signatureFailure") {
              log(scenario === "signatureFailure" ? "模拟签名校验失败" : "模拟下载失败");
              reject(new Error("synthetic download or signature failure"));
            } else { log("模拟下载和签名校验完成"); resolve(); }
          }
        }, 400);
      });
    },
    async cancel() {
      if (!timer) return;
      log("模拟取消开始（等待下载真正停止）");
      clearInterval(timer); timer = undefined;
      await delay(300);
      rejectDownload?.(new Error("synthetic cancellation")); rejectDownload = undefined;
      log("模拟下载已停止");
    },
    async install() { log("安装模拟完成：没有安装文件，也没有退出或重启。"); },
  };
}

document.documentElement.dataset.theme = "light";
const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (url.origin !== location.origin && !["data:", "blob:"].includes(url.protocol)) throw new Error("Fixture blocks external requests");
  return originalFetch(input, init);
};

function Session({ scenario }: { scenario: Scenario }) {
  const [events, setEvents] = useState<string[]>([]);
  const [page, setPage] = useState<"about" | "general">("about");
  const [ready, setReady] = useState(true);
  const [preferencesStore] = useState(() => {
    let raw: string | null = null;
    return new GeneralPreferencesStore({ getItem: () => raw, setItem: (_key, value) => { raw = value; } });
  });
  const preferences = useSyncExternalStore(preferencesStore.subscribe, preferencesStore.getSnapshot);
  const general: GeneralSettingsState = { ...preferences, setPreference: preferencesStore.setPreference };
  const [confirmInstall, setConfirmInstall] = useState<((accepted: boolean) => void) | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [controller] = useState(() => new UpdateController(syntheticRuntime(scenario, message => setEvents(items => [...items, message])), async install => {
    const accepted = await new Promise<boolean>(resolve => setConfirmInstall(() => resolve));
    if (accepted) await install();
    return accepted;
  }));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => { void controller.start(); return () => controller.dispose(); }, [controller]);
  useEffect(() => { controller.configureStartupCheck(general.preferences.checkUpdatesOnStartup, ready); }, [controller, general.preferences.checkUpdatesOnStartup, ready]);
  useEffect(() => {
    function onLink(event: Event) { setEvents(items => [...items, `链接已拦截：${(event as CustomEvent<string>).detail}`]); }
    window.addEventListener("fixture76:external-link", onLink);
    return () => window.removeEventListener("fixture76:external-link", onLink);
  }, []);
  useEffect(() => { if (confirmInstall) dialog.current?.showModal(); }, [confirmInstall]);
  function answer(accepted: boolean) { confirmInstall?.(accepted); setConfirmInstall(null); }
  return <>
    <div className="fixture-toolbar">
      <button className="settings-button" onClick={() => setPage("general")}>常规设置</button>
      <button className="settings-button" onClick={() => setPage("about")}>关于</button>
      <label><input type="checkbox" checked={ready} onChange={event => setReady(event.target.checked)} />模拟主界面就绪</label>
      <span>启动检查使用真实 10 秒延迟</span>
    </div>
    <div className="fixture-about-content">
      {page === "general" ? <GeneralSettings general={general} /> : <AboutSettings update={{ state, check: controller.check, download: controller.download, cancel: controller.cancel, install: controller.install }}
        downloadMirror={{ url: "https://pan.baidu.com/s/1nj359REFcGMwTbf7PWD4OQ?pwd=ayas", code: "ayas" }} />}
    </div>
    {state.startupNotice && state.update && <UpdateNotice version={state.update.version} onDismiss={controller.dismissNotice}
      onOpen={() => { controller.dismissNotice(); setPage("about"); }} />}
    <aside className="fixture-events" aria-label="模拟事件记录"><strong>模拟状态：{state.phase}</strong>
      <ol>{events.map((event, index) => <li key={index}>{event}</li>)}</ol>
    </aside>
    {confirmInstall && <dialog ref={dialog} className="fixture-confirm" aria-labelledby="fixture-confirm-title" onCancel={event => { event.preventDefault(); answer(false); }}>
      <h2 id="fixture-confirm-title">确认模拟安装</h2>
      <p>这是隔离页面的确认框。确认只记录一次模拟安装，不会退出或重启。</p>
      <div><button className="settings-button" autoFocus onClick={() => answer(false)}>取消</button>
        <button className="settings-button settings-button-primary" onClick={() => answer(true)}>确认模拟安装</button></div>
    </dialog>}
  </>;
}

function Preview() {
  const [scenario, setScenario] = useState<Scenario>("update");
  const [generation, setGeneration] = useState(0);
  const [dark, setDark] = useState(false);
  return <main className="fixture-update76">
    <header className="fixture-toolbar"><strong>#76 更新 · 隔离验收</strong>
      <label>场景 <select aria-label="模拟场景" value={scenario} onChange={event => { setScenario(event.target.value as Scenario); setGeneration(value => value + 1); }}>
        {Object.entries(scenarios).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <button className="settings-button" onClick={() => setGeneration(value => value + 1)}>重置场景</button>
      <button className="settings-button" onClick={() => { document.documentElement.dataset.theme = dark ? "light" : "dark"; setDark(!dark); }}>{dark ? "浅色主题" : "深色主题"}</button>
      <span>合成数据 · 外链已拦截 · 不安装或重启</span>
    </header>
    <Session key={generation} scenario={scenario} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
