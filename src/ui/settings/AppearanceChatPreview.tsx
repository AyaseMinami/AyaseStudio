import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { BackgroundFocus } from "../../appearance/backgroundFocus";
import type { BackgroundFit } from "../../appearance/appearance";
import { BackgroundImage } from "./BackgroundImage";
import { AssistantAvatar } from "../chat/AssistantAvatar";
import { Copy, RefreshCw, UserRound } from "lucide-react";
import "./AppearanceSettings.css";

export function AppearanceChatPreview({ url, focus, fit, mask, blur, onImageError }: {
  url: string | null; focus: BackgroundFocus | null; fit: BackgroundFit; mask: number; blur: number;
  onImageError?(): void;
}) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const element = previewRef.current;
    if (!element) return;
    const update = () => setScale(element.clientWidth / 1920);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const style = { "--appearance-background-mask": String(mask / 100), "--appearance-background-blur": `${blur}px` } as CSSProperties;
  return <div ref={previewRef} style={style} aria-label="聊天界面预览" className="appearance-background-preview" data-has-image={url ? "true" : undefined}>
    <div className="appearance-preview-stage" style={{ transform: `scale(${scale})` }}>
      <div className="appearance-background-art"><BackgroundImage url={url} focus={focus} fit={fit} blur={blur} aspectRatio={16 / 9} onError={onImageError} /></div>{url && <div className="appearance-background-preview-mask" />}
      <div className="appearance-preview-rail" aria-hidden="true"><strong>A</strong><span>聊天</span><span>设置</span></div>
      <div className="appearance-preview-titlebar"><span>☰</span><strong>今天的阅读笔记</strong><span>−　□　×</span></div>
      <div className="appearance-background-preview-content">
        <div className="appearance-preview-navigation">
        <aside className="appearance-preview-sidebar" aria-label="助手侧栏预览"><strong>助手</strong><span style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 8px" }}><AssistantAvatar assistantName="默认助手" assistantId="appearance-default" /> 默认助手</span><span style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 8px" }}><AssistantAvatar assistantName="写作助手" assistantId="appearance-writing" /> 写作助手</span></aside>
        <aside className="appearance-preview-sidebar" aria-label="对话侧栏预览"><strong>对话</strong><span>今天的阅读笔记</span><span>新的对话</span></aside>
        </div>
        <div className="appearance-preview-chat">
          <div className="user-message-group message-surface user-bubble-preview">
            <div className="message-identity message-identity-user"><span className="message-user-avatar message-avatar-fallback" aria-hidden="true"><UserRound size={20} /></span></div>
            <div className="user-message message-body">帮我整理一下今天的阅读笔记。</div>
            <div className="message-actions" aria-hidden="true"><Copy size={15} /></div>
          </div>
          <div className="assistant-message-group message-surface assistant-bubble-preview">
            <div className="message-identity"><AssistantAvatar className="message-assistant-avatar" assistantName="默认助手" assistantId="appearance-default" /><span className="message-author">默认助手<span className="message-model"> · 示例模型</span></span></div>
            <div className="assistant-message message-body"><strong>这是一条助手回复</strong><p>我整理了三个重点，方便稍后回顾。</p><p>先确定阅读主题，再记录核心观点和支持它的证据，最后留下值得继续思考的问题。</p></div>
            <div className="message-actions" aria-hidden="true"><Copy size={15} /><RefreshCw size={15} /></div>
          </div>
          <div className="appearance-preview-composer composer-frame"><span>发送消息…</span><div className="appearance-preview-tools">＋　⌕　✦　选择模型 <span>➤</span></div></div>
        </div>
      </div>
    </div>
  </div>;
}
