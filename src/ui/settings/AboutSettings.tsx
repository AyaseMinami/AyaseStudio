import { ArrowUpRight, Copy } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import appIcon from "../../../assets/branding/ayase-icon.svg";
import { version } from "../../../src-tauri/tauri.conf.json";
import { openExternal } from "../../chat/externalLinks";
import type { UpdateActions, UpdateState } from "../../update/controller";
import { SettingsHelp } from "./SettingsHelp";
import "./AboutSettings.css";

const projectUrl = "https://github.com/AyaseMinami/AyaseStudio";
const releaseChannel = /-beta(?:[.-]|$)/i.test(version) ? "Beta" : /-alpha(?:[.-]|$)/i.test(version) ? "Alpha" : "Stable";
const email = "ayasechikage@gmail.com";
const feedbackUrl = `${projectUrl}/issues/new?${new URLSearchParams({
  body: `### 应用版本\n${version}\n\n### 问题或建议\n\n### 补充说明（复现步骤、预期表现或截图）\n\n请勿附带 API Key 等敏感信息。\n`,
})}`;

export function AboutSettings({ update, downloadMirror }: {
  update?: UpdateActions;
  downloadMirror?: { url: string; code?: string };
}) {
  const [notice, setNotice] = useState({ target: "", text: "" });
  const [pending, setPending] = useState<string[]>([]);
  const [actionError, setActionError] = useState("");
  const actionBusy = useRef(new Set<string>());
  const state: UpdateState = update?.state ?? { phase: "unavailable" };
  const busy = pending.length > 0 || ["checking", "downloading", "installing"].includes(state.phase);
  const statusText = {
    unavailable: "当前环境暂不支持应用内更新，请使用官方下载。",
    idle: "手动检查新版本，下载后由你确认安装。",
    checking: "正在检查更新…",
    current: "当前已是最新版本。",
    available: "发现新版本。",
    downloading: pending.includes("cancel") ? "正在取消下载…" : state.message || "正在下载更新…",
    ready: state.message || "更新已下载，可以安装。",
    installing: "正在准备安装并重启…",
    cancelled: "已取消下载。",
    error: state.message || "更新失败，请重试或使用官方下载。",
  }[state.phase];
  async function run(action: "check" | "download" | "cancel" | "install") {
    if (!update || actionBusy.current.has(action) || (action !== "cancel" && actionBusy.current.size > 0)) return;
    actionBusy.current.add(action);
    setPending([...actionBusy.current]);
    setActionError("");
    try { await update[action](); }
    catch { setActionError("更新操作未完成，请重试或使用官方下载。"); }
    finally { actionBusy.current.delete(action); setPending([...actionBusy.current]); }
  }
  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setNotice({ target: label, text: `已复制${label}` }); }
    catch { setNotice({ target: label, text: "复制失败，请手动复制" }); }
  }
  function link(url: string, className: string, children: ReactNode) {
    return <a href={url} className={className} target="_blank" rel="noopener noreferrer"
      onClick={(event) => {
        event.preventDefault();
        void openExternal(url).catch(() => setNotice({ target: "link", text: "无法打开链接，请复制链接后在浏览器中打开。" }));
      }}>{children}</a>;
  }
  return <section className="settings-page about-page" aria-label="关于 Ayase Studio">
    <div className="about-card">
    <header className="about-brand">
      <img src={appIcon} alt="" width="80" height="80" />
      <h2>Ayase Studio</h2>
      <p>简洁、本地优先的 AI 桌面聊天客户端</p>
      <div className="about-version">
        <span>v{version}</span><span className="about-alpha">{releaseChannel}</span>
        <span className="about-copy-anchor"><button type="button" title="复制版本信息" aria-label="复制版本信息"
          onClick={() => void copy(`Ayase Studio ${version}${releaseChannel === "Stable" ? "" : ` (${releaseChannel})`}`, "版本信息")}><Copy size={14} /></button>
          {notice.target === "版本信息" && <span className="about-copy-notice" role="status">{notice.text}</span>}
        </span>
      </div>
    </header>

    <section className="about-update" aria-label="应用更新">
      <div className="about-update-heading"><h3>应用更新</h3>
        {state.update && <span>新版本 v{state.update.version}</span>}
      </div>
      <p className="about-update-status" role={state.phase === "error" ? "alert" : "status"}>{statusText}</p>
      {state.phase === "downloading" && <div className="about-update-progress">
        <progress aria-label="更新下载进度" max={state.total && state.total > 0 ? state.total : undefined}
          value={state.total && state.total > 0 ? Math.min(state.downloaded ?? 0, state.total) : undefined} />
        <span>{formatBytes(state.downloaded ?? 0)}{state.total && state.total > 0 ? ` / ${formatBytes(state.total)}` : " · 总大小未知"}</span>
      </div>}
      {state.update?.notes && <details className="about-release-notes" open>
        <summary>更新说明</summary><div>{state.update.notes}</div>
      </details>}
      {state.phase === "ready" && <p className="about-install-warning">安装将退出并重启应用，请先保存未发送的内容。</p>}
      <div className="about-update-actions">
        {!["unavailable", "available", "ready", "downloading", "installing"].includes(state.phase) &&
          <button type="button" className="settings-button" disabled={busy} onClick={() => void run("check")}>{state.phase === "checking" ? "检查中…" : "检查更新"}</button>}
        {state.phase === "available" && <button type="button" className="settings-button about-update-primary" disabled={busy} onClick={() => void run("download")}>下载更新</button>}
        {state.phase === "downloading" && <button type="button" className="settings-button" disabled={pending.includes("cancel")} onClick={() => void run("cancel")}>{pending.includes("cancel") ? "取消中…" : "取消下载"}</button>}
        {state.phase === "ready" && <button type="button" className="settings-button about-update-primary" disabled={busy} onClick={() => void run("install")}>安装并重启</button>}
      </div>
      {actionError && <p className="about-update-status" role="alert">{actionError}</p>}
      <div className="about-download-links">
        {link(`${projectUrl}/releases`, "about-footer-link", <>官方下载 (GitHub)<ArrowUpRight size={15} /></>)}
        {downloadMirror && <>
          {link(downloadMirror.url, "about-footer-link", <>网盘下载<ArrowUpRight size={15} /></>)}
          {downloadMirror.code && <span className="about-mirror-code">提取码：{downloadMirror.code}
            <button type="button" aria-label="复制提取码" className="settings-button" onClick={() => void copy(downloadMirror.code!, "提取码")}>复制</button>
          </span>}
        </>}
      </div>
      {notice.target === "提取码" && <p className="about-notice" role="status">{notice.text}</p>}
    </section>

    <section className="about-feedback" aria-label="反馈渠道">
      <div className="about-feedback-row">
        <div className="about-feedback-label"><span>反馈与建议</span>
          <SettingsHelp label="反馈与建议">反馈不会自动附带聊天记录、日志或附件。</SettingsHelp>
        </div>
        {link(feedbackUrl, "about-feedback-link", <span className="about-link-detail">GitHub Issues <ArrowUpRight size={15} /></span>)}
      </div>
      <div className="about-email"><span>联系邮箱</span><div>
        <span>{email}</span><button type="button" title="复制邮箱" aria-label="复制邮箱"
          onClick={() => void copy(email, "邮箱地址")}><Copy size={14} /></button>
          {notice.target === "邮箱地址" && <span className="about-email-notice" role="status">{notice.text}</span>}
        </div></div>
    </section>

    <footer className="about-footer">
      <div className="about-info-row"><span>项目主页</span>
        {link(projectUrl, "about-footer-link", <>GitHub<ArrowUpRight size={15} /></>)}
      </div>
      <div className="about-info-row"><span>作者</span>
        {link("https://github.com/AyaseMinami", "about-footer-link", <>AyaseMinami<ArrowUpRight size={15} /></>)}
      </div>
    </footer>
    {notice.target === "link" && <p className="about-notice" role="status">{notice.text}</p>}
    </div>
  </section>;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
