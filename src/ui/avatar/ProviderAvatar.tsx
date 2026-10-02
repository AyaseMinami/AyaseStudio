import { useEffect, useState } from "react";
import type { ProviderGroup } from "../../chat/settings";
import type { UserAvatar } from "../../avatar/repository";
import { providerAvatarRepository } from "../../avatar/providerAvatars";
import { AssistantAvatar } from "../chat/AssistantAvatar";
import { BrandAvatar } from "./BrandAvatar";

export function ProviderAvatar({ provider, className = "" }: { provider: ProviderGroup; className?: string }) {
  const imageId = provider.avatar?.kind === "image" ? provider.avatar.id : undefined;
  const [image, setImage] = useState<{ id: string; value: UserAvatar }>();
  useEffect(() => {
    let active = true;
    if (imageId) void providerAvatarRepository.get(imageId).then(value => {
      if (active) setImage(value ? { id: imageId, value } : undefined);
    }).catch(() => { if (active) setImage(undefined); });
    return () => { active = false; };
  }, [imageId]);
  const brand = provider.avatar?.kind === "builtin" ? provider.avatar.id : !imageId ? provider.presetId : undefined;
  return brand ? <BrandAvatar id={brand} className={className} />
    : <AssistantAvatar assistantName={provider.name} assistantId={provider.id} className={className} avatar={imageId && image?.id === imageId ? image.value : undefined} />;
}
