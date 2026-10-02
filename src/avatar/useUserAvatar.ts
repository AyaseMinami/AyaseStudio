import { useEffect, useRef, useState } from "react";
import { createAvatarRepository, type AvatarRepository, type UserAvatar } from "./repository";
import { decodeAvatar } from "./image";

const repository = createAvatarRepository();
export function useUserAvatar(store: AvatarRepository = repository) {
  const [value, setValue] = useState<UserAvatar>();
  const [url, setUrl] = useState<string>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string>();
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    void store.load().then(async (saved) => {
      if (saved) await decodeAvatar(saved.thumbnail);
      if (active) setValue(saved);
    }).catch(() => { if (active) setError("头像无法读取，已使用默认样式。你可以重新选择或移除头像。"); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [store]);
  useEffect(() => {
    const next = value ? URL.createObjectURL(value.thumbnail) : undefined;
    setUrl(next);
    return () => { if (next) URL.revokeObjectURL(next); };
  }, [value]);
  async function save(next?: UserAvatar) {
    if (lock.current || busy) return false;
    lock.current = true; setBusy(true); setError(undefined);
    try {
      if (next) await store.save(next); else await store.remove();
      setValue(next); return true;
    } catch { setError("头像保存失败，原头像已保留，请重试。"); return false; }
    finally { lock.current = false; setBusy(false); }
  }
  return { value, url, busy, error, save };
}
export type UserAvatarState = ReturnType<typeof useUserAvatar>;
