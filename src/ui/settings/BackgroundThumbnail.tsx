import { useEffect, useRef, useState } from "react";
import type { BackgroundLibraryDialogProps } from "./BackgroundLibraryDialog";

/** Grid tiles never request original pixels. Offscreen entries do not resolve files. */
export function BackgroundThumbnail({ reference, resolve, attempt, onUnavailable, onReady }: {
  reference: string;
  resolve: BackgroundLibraryDialogProps["onResolve"];
  attempt: number;
  onUnavailable(): void;
  onReady(): void;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const callbacks = useRef({ resolve, onUnavailable, onReady });
  callbacks.current = { resolve, onUnavailable, onReady };
  const [visible, setVisible] = useState(typeof IntersectionObserver === "undefined");
  const [result, setResult] = useState<{ reference: string; url?: string; failed?: boolean }>();
  const failed = useRef(false);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting);
    }, { rootMargin: "200px" });
    observer.observe(host.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const refresh = failed.current && attempt > 0;
    void callbacks.current.resolve(reference, { thumbnail: true, refresh }).then((resource) => {
      if (cancelled) return;
      failed.current = false;
      setResult({ reference, url: resource.url });
      callbacks.current.onReady();
    }).catch(() => {
      if (cancelled) return;
      failed.current = true;
      setResult({ reference, failed: true });
      callbacks.current.onUnavailable();
    });
    return () => { cancelled = true; };
  }, [reference, visible, attempt]);
  const current = result?.reference === reference ? result : undefined;
  return <span ref={host} style={{ display: "block", width: "100%", height: "100%" }}>
    {visible && current?.url ? <img src={current.url} alt="" decoding="async" onError={() => {
      failed.current = true;
      setResult({ reference, failed: true });
      callbacks.current.onUnavailable();
    }} /> : <span className="background-library-placeholder">{current?.failed ? "图片不可用" : visible ? "读取中…" : "待加载"}</span>}
  </span>;
}
