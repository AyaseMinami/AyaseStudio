import { useState } from "react";
import { automaticAvatar } from "../../avatar/automaticAvatar";
import { brandAvatars } from "../../avatar/brandCatalog";
import type { BrandId } from "../../avatar/brandIds";
import "../chat/AssistantAvatar.css";
import "./BrandAvatar.css";

export function BrandAvatar({ id, className = "" }: { id: BrandId; className?: string }) {
  const brand = brandAvatars.find((item) => item.id === id);
  const [failedSrc, setFailedSrc] = useState<string>();
  const src = brand?.src;
  const generated = automaticAvatar(brand?.label ?? id, id);
  const showImage = !!src && src !== failedSrc;
  return <span className={`assistant-avatar brand-avatar ${className}`} data-brand={id} aria-hidden="true"
    style={showImage ? undefined : { background: generated.background, color: generated.color }}>
    {showImage ? <img key={src} src={src} alt="" onError={() => setFailedSrc(src)} />
      : <span className="assistant-avatar-initial">{generated.initial}</span>}
  </span>;
}
