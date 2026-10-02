import { useLayoutEffect, useRef, useState } from "react";
import { Bot, Sparkles, Sprout, UserRound } from "lucide-react";
import { isAssistantDefaultAvatar } from "../../avatar/assistantDefaults";
import { automaticAvatar } from "../../avatar/automaticAvatar";
import type { UserAvatar } from "../../avatar/repository";
import { avatarPreviewCache, type AvatarPreviewLease } from "../../avatar/previewCache";
import "./AssistantAvatar.css";

export interface AssistantAvatarProps {
  avatar?: UserAvatar;
  defaultAvatar?: string;
  legacyIcon?: string;
  assistantName?: string;
  assistantId?: string;
  className?: string;
}

export function AssistantAvatar({ avatar, defaultAvatar, legacyIcon, assistantName, assistantId, className = "" }: AssistantAvatarProps) {
  const thumbnail = avatar?.thumbnail;
  const [preview, setPreview] = useState<{ identity?: string; url: string }>();
  const lease = useRef<AvatarPreviewLease | undefined>(undefined);
  const [failedThumbnail, setFailedThumbnail] = useState<Blob>();
  const [failedUrl, setFailedUrl] = useState<string>();
  useLayoutEffect(() => {
    let active = true;
    if (!thumbnail) {
      lease.current?.release(); lease.current = undefined;
      setPreview(undefined);
    } else {
      void avatarPreviewCache.acquire(thumbnail).then(next => {
        if (!active) { next.release(); return; }
        const previous = lease.current;
        lease.current = next;
        setFailedThumbnail(undefined);
        setPreview(value => value && value.identity === assistantId && value.url === next.url ? value : { identity: assistantId, url: next.url });
        previous?.release();
      }).catch(() => {
        if (!active) return;
        lease.current?.release(); lease.current = undefined;
        setPreview(undefined); setFailedThumbnail(thumbnail);
      });
    }
    return () => { active = false; };
  }, [thumbnail, assistantId]);
  useLayoutEffect(() => () => { lease.current?.release(); lease.current = undefined; }, []);
  // Keep this owner's decoded image until its replacement is ready. Never carry
  // an old assistant's picture into a new assistant or an explicit removal.
  const url = thumbnail && failedThumbnail !== thumbnail && preview?.identity === assistantId
    && preview?.url !== failedUrl ? preview?.url : undefined;
  const showFallback = !thumbnail || failedThumbnail === thumbnail
    || (preview?.identity === assistantId && !!preview && preview.url === failedUrl);
  const selected = isAssistantDefaultAvatar(defaultAvatar) ? defaultAvatar : undefined;
  const automatic = !selected && !legacyIcon;
  const generated = automaticAvatar(assistantName, assistantId);
  const variant = selected ?? (automatic ? "automatic" : "system");
  const Icon = variant === "blue" ? UserRound : variant === "green" ? Sprout : variant === "violet" ? Sparkles : Bot;
  return <span className={`assistant-avatar assistant-avatar-${variant}${!showFallback ? " assistant-avatar-image" : ""} ${className}`} aria-hidden="true"
    style={automatic && generated.initial && showFallback ? { background: generated.background, color: generated.color } : undefined}>
    {url ? <img src={url} alt="" onError={() => setFailedUrl(url)} />
      : !showFallback ? null
      : !selected && legacyIcon ? <span className="assistant-avatar-legacy">{legacyIcon}</span>
      : automatic ? generated.initial ? <span className="assistant-avatar-initial">{generated.initial}</span> : <UserRound size={20} strokeWidth={1.6} />
      : <Icon size={20} strokeWidth={1.6} />}
  </span>;
}
