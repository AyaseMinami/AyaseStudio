import { useEffect, useId, useRef, useState } from "react";
import { Copy, Maximize, Minus, Plus } from "lucide-react";
import type { RequestAttachment } from "../../chat/attachments";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
type Size = { width: number; height: number };
type View = { zoom: number; x: number; y: number };
const INITIAL_VIEW: View = { zoom: 1, x: 0, y: 0 };

// All dimensions and translations are CSS pixels; zoom is relative to the fitted image.
function constrain(view: View, fitted: Size, viewport: Size): View {
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom));
  const limitX = Math.max(0, (fitted.width * zoom - viewport.width) / 2);
  const limitY = Math.max(0, (fitted.height * zoom - viewport.height) / 2);
  return { zoom, x: Math.max(-limitX, Math.min(limitX, view.x)), y: Math.max(-limitY, Math.min(limitY, view.y)) };
}

export function PreviewImage({ item, onError }: { item: RequestAttachment; onError(): void }) {
  const stage = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const copying = useRef(false);
  const alive = useRef(true);
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "failed" | "unsupported">("idle");
  const hintId = useId();
  const [natural, setNatural] = useState<Size>({ width: 0, height: 0 });
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [view, setView] = useState(INITIAL_VIEW);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointer: number; x: number; y: number; view: View } | null>(null);
  const fit = natural.width && natural.height ? Math.min(1, viewport.width / natural.width, viewport.height / natural.height) : 0;
  const fitted = { width: natural.width * fit, height: natural.height * fit };
  const current = constrain(view, fitted, viewport);
  const canPan = fitted.width * current.zoom > viewport.width || fitted.height * current.zoom > viewport.height;
  const ready = fit > 0;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const copyImage = async () => {
    const source = image.current;
    if (!ready || !source || copying.current) return;
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined"
      || ClipboardItem.supports?.("image/png") === false) {
      setCopyState("unsupported");
      return;
    }
    copying.current = true;
    setCopyState("copying");
    try {
      const png = new Promise<Blob>((resolve, reject) => {
        const canvas = document.createElement("canvas");
        canvas.width = source.naturalWidth;
        canvas.height = source.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) { reject(new Error("Image canvas unavailable")); return; }
        // Copy original pixels, independent of viewport fit, zoom and panning.
        context.drawImage(source, 0, 0);
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PNG encoding failed")), "image/png");
      });
      // A rejected clipboard constructor/write must not leave an unobserved encoder rejection.
      void png.catch(() => undefined);
      // Begin the clipboard operation in the click's user-activation scope.
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      if (alive.current) setCopyState("copied");
    } catch {
      if (alive.current) setCopyState("failed");
    } finally {
      copying.current = false;
    }
  };

  useEffect(() => {
    setView((old) => constrain(old, fitted, viewport));
  }, [fitted.width, fitted.height, viewport]);

  useEffect(() => {
    const element = stage.current!;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      setViewport({ width: bounds.width, height: bounds.height });
      drag.current = null;
      setDragging(false);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  // Use a non-passive listener so wheel zoom never scrolls the underlying conversation.
  useEffect(() => {
    const element = stage.current!;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (!ready || !event.deltaY) return;
      const bounds = element.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1);
      const factor = Math.exp(-Math.max(-200, Math.min(200, delta)) * 0.002);
      const anchor = { x: event.clientX - bounds.left - bounds.width / 2, y: event.clientY - bounds.top - bounds.height / 2 };
      drag.current = null;
      setDragging(false);
      setView((old) => {
        const previous = constrain(old, fitted, viewport);
        const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, previous.zoom * factor));
        const ratio = zoom / previous.zoom;
        return constrain({ zoom, x: anchor.x - (anchor.x - previous.x) * ratio, y: anchor.y - (anchor.y - previous.y) * ratio }, fitted, viewport);
      });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [ready, fitted.width, fitted.height, viewport]);

  const zoomBy = (factor: number) => {
    drag.current = null;
    setDragging(false);
    setView((old) => {
      const previous = constrain(old, fitted, viewport);
      return constrain({ ...previous, zoom: previous.zoom * factor }, fitted, viewport);
    });
  };
  const reset = () => { drag.current = null; setDragging(false); setView(INITIAL_VIEW); };
  const stopDrag = () => { drag.current = null; setDragging(false); };

  return <>
    <div className="attachment-preview-zoom" role="group" aria-label="图片缩放">
      <button type="button" aria-label="缩小图片" aria-disabled={!ready || current.zoom <= MIN_ZOOM}
        onClick={() => { if (ready) zoomBy(1 / 1.25); }}><Minus size={18} /></button>
      <output aria-label="图片缩放比例">{Math.round(current.zoom * 100)}%</output>
      <button type="button" aria-label="放大图片" aria-disabled={!ready || current.zoom >= MAX_ZOOM}
        onClick={() => { if (ready) zoomBy(1.25); }}><Plus size={18} /></button>
      <button type="button" onClick={reset}><Maximize size={16} />适配窗口</button>
      <button type="button" aria-label="复制图片" title="复制原尺寸图片" aria-disabled={!ready || copyState === "copying"}
        aria-busy={copyState === "copying"} onClick={() => void copyImage()}>
        <Copy size={16} />{copyState === "copying" ? "正在复制…" : "复制图片"}
      </button>
    </div>
    {copyState === "copied" && <p className="attachment-preview-copy-status" role="status">图片已复制</p>}
    {(copyState === "failed" || copyState === "unsupported") && <p className="attachment-preview-copy-status" role="alert">
      {copyState === "unsupported" ? "当前环境暂不支持复制图片。" : "复制图片失败，请检查剪贴板权限后重试。"}
    </p>}
    <div ref={stage} className="attachment-preview-stage" tabIndex={0} role="group" aria-label="图片查看区域"
      aria-describedby={hintId} data-pannable={canPan} data-dragging={dragging}
      onKeyDown={(event) => {
        if (["+", "=", "-", "0", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          if (event.key === "0") reset();
          else if (event.key === "+" || event.key === "=") { if (ready) zoomBy(1.25); }
          else if (event.key === "-") { if (ready) zoomBy(1 / 1.25); }
          else {
            const step = event.shiftKey ? 100 : 40;
            setView((old) => {
              const previous = constrain(old, fitted, viewport);
              return constrain({ ...previous,
                x: previous.x + (event.key === "ArrowLeft" ? step : event.key === "ArrowRight" ? -step : 0),
                y: previous.y + (event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0) }, fitted, viewport);
            });
          }
        }
      }}
      onPointerDown={(event) => {
        if (!canPan || event.button !== 0 || drag.current) return;
        event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture?.(event.pointerId);
        drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, view: current };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start || start.pointer !== event.pointerId) return;
        setView(constrain({ ...start.view, x: start.view.x + event.clientX - start.x, y: start.view.y + event.clientY - start.y }, fitted, viewport));
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointer !== event.pointerId) return;
        stopDrag();
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }} onPointerCancel={stopDrag} onLostPointerCapture={stopDrag}>
      <img ref={image} className="attachment-preview-image" alt={item.name} draggable={false}
        src={`data:${item.mimeType};base64,${item.data}`} onError={onError}
        onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        style={{ width: fitted.width, height: fitted.height, visibility: ready ? "visible" : "hidden",
          transform: `translate(-50%, -50%) translate(${current.x}px, ${current.y}px) scale(${current.zoom})` }} />
    </div>
    <p id={hintId} className="attachment-preview-hint">滚轮缩放 · 放大后拖动查看 · 聚焦图片区域后用方向键移动，+ / − 缩放，0 适配</p>
  </>;
}
