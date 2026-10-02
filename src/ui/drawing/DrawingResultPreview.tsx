import { useEffect, useRef, useState } from "react";
import { Image } from "lucide-react";

export function DrawingResultPreview({ id, url, error, width, height }: {
  id: string | null; url: string | null; error: string | null; width?: number; height?: number;
}) {
  const [transform, setTransform] = useState({ zoom: 1, x: 0, y: 0 });
  const [decodeError, setDecodeError] = useState(false);
  const drag = useRef<{ pointer: number; x: number; y: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  function limits(zoom: number) {
    const bounds = stage.current?.getBoundingClientRect();
    const stageWidth = bounds?.width ?? 0, stageHeight = bounds?.height ?? 0;
    const scale = width && height ? Math.min(stageWidth / width, stageHeight / height) : 1;
    return { x: Math.max(0, ((width ? width * scale : stageWidth) * zoom - stageWidth) / 2),
      y: Math.max(0, ((height ? height * scale : stageHeight) * zoom - stageHeight) / 2) };
  }
  function fit() { drag.current = null; setTransform({ zoom: 1, x: 0, y: 0 }); }
  useEffect(() => { fit(); setDecodeError(false); }, [id, url]);
  function zoomBy(factor: number) {
    setTransform(current => {
      const zoom = Math.max(1, Math.min(8, current.zoom * factor));
      const limit = limits(zoom);
      return { zoom, x: Math.max(-limit.x, Math.min(limit.x, current.x)),
        y: Math.max(-limit.y, Math.min(limit.y, current.y)) };
    });
  }
  function pan(x: number, y: number) {
    setTransform(current => {
      const limit = limits(current.zoom);
      return { ...current, x: Math.max(-limit.x, Math.min(limit.x, current.x + x)),
        y: Math.max(-limit.y, Math.min(limit.y, current.y + y)) };
    });
  }
  // A native non-passive listener prevents the page scrolling while zooming.
  useEffect(() => {
    const element = stage.current;
    if (!element || !url || error || decodeError) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomBy(event.deltaY < 0 ? 1.2 : 1 / 1.2);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [url, error, decodeError, width, height]);
  const failure = error || (decodeError ? "原图解码失败，请重新选择成果重试。" : null);
  return <>
    <div ref={stage} className="drawing-result-stage drawing-preview-stage" tabIndex={url && !failure ? 0 : undefined}
      role="region" aria-label="成果大图预览" aria-describedby="drawing-preview-help"
      onKeyDown={event => {
        if (!url || failure) return;
        if (["+", "=", "-", "0", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) event.preventDefault();
        if (event.key === "+" || event.key === "=") zoomBy(1.2);
        if (event.key === "-") zoomBy(1 / 1.2);
        if (event.key === "0") fit();
        if (event.key === "ArrowLeft") pan(-40, 0);
        if (event.key === "ArrowRight") pan(40, 0);
        if (event.key === "ArrowUp") pan(0, -40);
        if (event.key === "ArrowDown") pan(0, 40);
      }}
      onPointerDown={event => {
        if (event.button !== 0 || transform.zoom === 1 || failure) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY };
      }} onPointerMove={event => {
        if (!drag.current || drag.current.pointer !== event.pointerId) return;
        pan(event.clientX - drag.current.x, event.clientY - drag.current.y);
        drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY };
      }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
      onLostPointerCapture={() => { drag.current = null; }}>
      {failure ? <div className="drawing-empty"><p className="drawing-error" role="alert">{failure}</p></div>
        : url ? <img src={url} alt="当前绘图成果" draggable={false}
          style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})` }}
          onError={() => setDecodeError(true)} />
          : <div className="drawing-empty"><Image size={32} strokeWidth={1.5} aria-hidden="true" />
            <p>{id ? "正在加载图片…" : "生成后的图片会自动显示在这里"}</p></div>}
    </div>
    <div className="drawing-preview-tools">
      <p id="drawing-preview-help" className="drawing-muted">滚轮缩放，放大后拖动；键盘 + / − 缩放、方向键移动、0 适应窗口。</p>
      <button type="button" className="drawing-button" disabled={!url || Boolean(failure)} onClick={fit}>适应窗口</button>
    </div>
  </>;
}
