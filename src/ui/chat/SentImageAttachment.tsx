import { useEffect, useRef, useState } from "react";
import type { RequestAttachment, SentAttachment } from "../../chat/attachments";

export function SentImageAttachment({ item, read, scrollRoot, onOpen }: {
  item: SentAttachment;
  read: (item: SentAttachment) => Promise<RequestAttachment>;
  scrollRoot: React.RefObject<HTMLDivElement | null>;
  onOpen: (button: HTMLButtonElement) => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [near, setNear] = useState(false);
  const [loaded, setLoaded] = useState<RequestAttachment>();
  const [error, setError] = useState("");
  const [decoded, setDecoded] = useState(false);

  useEffect(() => {
    const element = button.current;
    const root = scrollRoot.current;
    if (!element || !root) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), {
      root, rootMargin: "300px 0px", threshold: 0,
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [scrollRoot]);

  useEffect(() => {
    setLoaded(undefined);
    setError("");
    setDecoded(false);
    if (!near) return;
    let alive = true;
    void read(item).then((value) => {
      if (alive) setLoaded(value);
    }).catch(() => { if (alive) setError("图片读取失败，无法显示缩略图。"); });
    return () => { alive = false; };
  }, [item, read, near]);

  return <button ref={button} type="button" className="sent-image-attachment"
    aria-label={`预览附件 ${item.name}`} title={item.name} onClick={(event) => onOpen(event.currentTarget)}>
    {loaded && !error && <img src={`data:${loaded.mimeType};base64,${loaded.data}`} alt="" style={{ visibility: decoded ? "visible" : "hidden" }}
      onLoad={() => setDecoded(true)} onError={() => { setLoaded(undefined); setError("图片加载失败，无法显示缩略图。"); }} />}
    {(!loaded || !decoded || error) && <span className="sent-image-placeholder" role={error ? "alert" : "status"}>
      {error || (near ? "正在读取图片…" : "图片预览")}
    </span>}
  </button>;
}
