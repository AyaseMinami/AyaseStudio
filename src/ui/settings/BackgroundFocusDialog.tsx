import { useEffect, useRef, useState, type PointerEvent } from "react";
import { backgroundViewport, centerBackgroundFocus, normalizeBackgroundFocus, type BackgroundFocus } from "../../appearance/backgroundFocus";
import { BackgroundImage, useViewportAspectRatio } from "./BackgroundImage";
import "./backgroundFocus.css";

interface BackgroundFocusDialogProps {
  url: string;
  focus: BackgroundFocus | null;
  fit: "cover" | "contain";
  onConfirm(focus: BackgroundFocus): void;
  onCancel(): void;
}

export function BackgroundFocusDialog({ url, focus, fit, onConfirm, onCancel }: BackgroundFocusDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<SVGSVGElement>(null);
  const cancelRef = useRef(onCancel);
  const drag = useRef<{ x: number; y: number; focus: BackgroundFocus; bounds: { x: number; y: number; width: number; height: number } } | null>(null);
  const [draft, setDraft] = useState(() => normalizeBackgroundFocus(focus) ?? { ...centerBackgroundFocus });
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const viewportRatio = useViewportAspectRatio();
  cancelRef.current = onCancel;

  useEffect(() => {
    const image = new Image();
    image.onload = () => setSize({ width: image.naturalWidth, height: image.naturalHeight });
    image.src = url;
    return () => { image.onload = null; };
  }, [url]);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    node.showModal();
    const cancel = (event: Event) => { event.preventDefault(); cancelRef.current(); };
    node.addEventListener("cancel", cancel);
    return () => { node.removeEventListener("cancel", cancel); if (node.open) node.close(); };
  }, []);

  function setFocus(x: number, y: number) {
    setDraft((current) => ({ ...current, x, y }));
  }
  function imagePoint(event: PointerEvent<SVGSVGElement>) {
    const matrix = stage.current?.getScreenCTM();
    return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : null;
  }
  function beginDrag(event: PointerEvent<SVGSVGElement>) {
    const point = imagePoint(event);
    if (!point || !size || !editorBounds) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const onFrame = (event.target as Element).closest(".background-focus-frame");
    const next = onFrame ? draft : { x: point.x / size.width, y: point.y / size.height };
    setFocus(next.x, next.y);
    drag.current = { x: point.x, y: point.y, focus: next, bounds: editorBounds };
  }
  function updateDrag(event: PointerEvent<SVGSVGElement>) {
    const point = imagePoint(event);
    const active = drag.current;
    if (!active || !point || !size) return;
    setFocus(active.focus.x + (point.x - active.x) / size.width, active.focus.y + (point.y - active.y) / size.height);
  }
  const frame = size ? backgroundViewport(size.width, size.height, 16 / 9, draft, fit) : null;
  const padding = size ? Math.max(size.width, size.height) * 0.04 : 0;
  const left = frame ? Math.min(0, frame.x) - padding : 0;
  const top = frame ? Math.min(0, frame.y) - padding : 0;
  const editorBounds = size && frame ? drag.current?.bounds ?? {
    x: left, y: top,
    width: Math.max(size.width, frame.x + frame.width) + padding - left,
    height: Math.max(size.height, frame.y + frame.height) + padding - top,
  } : null;
  function finishDrag() { drag.current = null; setDraft((current) => ({ ...current })); }

  return <dialog ref={dialog} className="background-crop-dialog" aria-labelledby="background-focus-title">
    <div className="background-crop-scroll">
      <header><div><h2 id="background-focus-title">背景中心取景</h2><p>拖动 16:9 参考框选择中心，缩放图片调整范围。允许超出图片边缘；实际背景随窗口比例显示。</p></div><button autoFocus className="settings-button" type="button" onClick={onCancel}>取消</button></header>
      <div className="background-crop-stage-wrap">
        {size && frame && editorBounds && <svg ref={stage} className="background-focus-editor" aria-label="原图与取景参考框"
          viewBox={`${editorBounds.x} ${editorBounds.y} ${editorBounds.width} ${editorBounds.height}`}
          onPointerDown={beginDrag} onPointerMove={updateDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
          <image href={url} width={size.width} height={size.height} />
          <rect className="background-focus-frame" x={frame.x} y={frame.y} width={frame.width} height={frame.height} vectorEffect="non-scaling-stroke" />
          <path d={`M ${frame.x + frame.width / 3} ${frame.y} v ${frame.height} M ${frame.x + frame.width * 2 / 3} ${frame.y} v ${frame.height} M ${frame.x} ${frame.y + frame.height / 3} h ${frame.width} M ${frame.x} ${frame.y + frame.height * 2 / 3} h ${frame.width}`} fill="none" stroke="#ffffff80" vectorEffect="non-scaling-stroke" pointerEvents="none" />
          <circle cx={draft.x * size.width} cy={draft.y * size.height} r={editorBounds.width * 0.009} fill="rgb(var(--color-accent))" stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke" pointerEvents="none" />
        </svg>}
      </div>
      <label className="background-crop-zoom">图片缩放 <input aria-label="图片缩放" type="range" min="25" max="400" step="1" value={Math.round((draft.zoom ?? 1) * 100)} onChange={(event) => setDraft((current) => ({ ...current, zoom: Number(event.currentTarget.value) / 100 }))} /><output>{Math.round((draft.zoom ?? 1) * 100)}%</output></label>
      <fieldset className="background-crop-fields"><legend>取景中心</legend>{([['x', '横向位置'], ['y', '纵向位置']] as const).map(([field, label]) => <label key={field}>{label}<input aria-label={label} type="number" step="1" value={Number((draft[field] * 100).toFixed(1))} onChange={(event) => { const value = event.currentTarget.valueAsNumber / 100; if (Number.isFinite(value)) setFocus(field === 'x' ? value : draft.x, field === 'y' ? value : draft.y); }} />%</label>)}</fieldset>
      <section className="background-crop-preview" aria-label="当前窗口取景预览" style={{ aspectRatio: viewportRatio }}><div className="appearance-background-art"><BackgroundImage url={url} focus={draft} fit={fit} /></div><span className="background-crop-preview-mask" /><strong>当前窗口效果</strong></section>
      <p className="field-hint">填充和适应决定基础图片大小，缩放与中心偏移在此基础上生效。超出原图的区域显示画布底色，不会自动吸附或限制在边缘内。</p>
    </div>
    <footer><button className="settings-button" type="button" onClick={() => setDraft({ ...centerBackgroundFocus })}>恢复居中</button><span /><button className="settings-button" type="button" onClick={onCancel}>取消</button><button className="settings-button settings-button-primary" type="button" disabled={!size} onClick={() => onConfirm(draft)}>应用取景</button></footer>
  </dialog>;
}
