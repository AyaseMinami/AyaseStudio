import { useEffect, useRef, useState } from "react";
import type { DrawingImageInput } from "../../drawing/types";

/** Only the supplied thumbnail reader is used; an original is never a fallback. */
export function DrawingResultThumbnail({ reference, label, read }: {
  reference: string; label: string; read?: (reference: string) => Promise<DrawingImageInput>;
}) {
  const container = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!container.current || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let alive = true;
    let objectUrl: string | undefined;
    setUrl(null);
    setError(false);
    if (visible && read) {
      void read(reference).then(image => {
        if (!alive) return;
        const bytes = Uint8Array.from(atob(image.data), char => char.charCodeAt(0));
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: image.mime }));
        setUrl(objectUrl);
      }).catch(() => { if (alive) setError(true); });
    }
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [reference, read, visible]);
  return <span ref={container} className="drawing-result-thumbnail">
    {error ? <span role="status">缩略图读取失败</span> : url
      ? <img src={url} alt={label} onError={() => setError(true)} />
      : <span>{read && visible ? "正在读取缩略图…" : "缩略图"}</span>}
  </span>;
}
