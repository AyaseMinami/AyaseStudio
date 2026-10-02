import { ArrowUpRight, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import appIcon from "../../../assets/branding/ayase-icon.svg";
import { version } from "../../../src-tauri/tauri.conf.json";
import { openExternal } from "../../chat/externalLinks";
import { SettingsHelp } from "./SettingsHelp";
import "./AboutSettings.css";

const projectUrl = "https://github.com/AyaseMinami/AyaseStudio";
const email = "ayasechikage@gmail.com";
const feedbackUrl = `${projectUrl}/issues/new?${new URLSearchParams({
  body: `### 应用版本\n${version}\n\n### 问题或建议\n\n### 补充说明（复现步骤、预期表现或截图）\n\n请勿附带 API Key 等敏感信息。\n`,
})}`;

export function AboutSettings() {
  const [notice, setNotice] = useState({ target: "", text: "" });
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
        <span>v{version}</span><span className="about-alpha">Beta</span>
        <span className="about-copy-anchor"><button type="button" title="复制版本信息" aria-label="复制版本信息"
          onClick={() => void copy(`Ayase Studio ${version} (Beta)`, "版本信息")}><Copy size={14} /></button>
          {notice.target === "版本信息" && <span className="about-copy-notice" role="status">{notice.text}</span>}
        </span>
      </div>
    </header>

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
