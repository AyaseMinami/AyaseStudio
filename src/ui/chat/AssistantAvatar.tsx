import { useEffect, useState } from "react";
import { Bot, Sparkles, Sprout, UserRound } from "lucide-react";
import { isAssistantDefaultAvatar } from "../../avatar/assistantDefaults";
import type { UserAvatar } from "../../avatar/repository";
import "./AssistantAvatar.css";

export interface AssistantAvatarProps {
  avatar?: UserAvatar;
  defaultAvatar?: string;
  legacyIcon?: string;
  className?: string;
}

export function AssistantAvatar({ avatar, defaultAvatar, legacyIcon, className = "" }: AssistantAvatarProps) {
  const thumbnail = avatar?.thumbnail;
  const [preview, setPreview] = useState<{ thumbnail: Blob; url: string }>();
  const [failedUrl, setFailedUrl] = useState<string>();
  useEffect(() => {
    if (!thumbnail) { setPreview(undefined); return; }
    try {
      const url = URL.createObjectURL(thumbnail);
      setPreview({ thumbnail, url });
      return () => URL.revokeObjectURL(url);
    } catch { setPreview(undefined); }
  }, [thumbnail]);
  const url = preview?.thumbnail === thumbnail && preview?.url !== failedUrl ? preview?.url : undefined;
  const selected = isAssistantDefaultAvatar(defaultAvatar) ? defaultAvatar : undefined;
  const variant = selected ?? "system";
  const Icon = variant === "blue" ? UserRound : variant === "green" ? Sprout : variant === "violet" ? Sparkles : Bot;
  return <span className={`assistant-avatar assistant-avatar-${variant} ${className}`} aria-hidden="true">
    {url ? <img src={url} alt="" onError={() => setFailedUrl(url)} />
      : !selected && legacyIcon ? <span className="assistant-avatar-legacy">{legacyIcon}</span>
      : <Icon size={20} strokeWidth={1.6} />}
  </span>;
}
