import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { backgroundViewport, centerBackgroundFocus, normalizeBackgroundFocus, type BackgroundFocus } from "../../appearance/backgroundFocus";
import "./backgroundFocus.css";

export interface BackgroundImageProps {
  url: string | null;
  focus: BackgroundFocus | null;
  fit: "cover" | "contain";
  blur?: number;
  className?: string;
  aspectRatio?: number;
  onError?(): void;
}

interface ImageDimensions { url: string; width: number; height: number; }

function viewportAspectRatio(): number {
  if (typeof window === "undefined" || window.innerHeight === 0) return 16 / 9;
  return window.innerWidth / window.innerHeight;
}

/** Keeps settings previews on the same aspect ratio as the application canvas. */
export function useViewportAspectRatio(): number {
  const [ratio, setRatio] = useState(viewportAspectRatio);
  useEffect(() => {
    const update = () => setRatio(viewportAspectRatio());
    window.addEventListener("resize", update);
    update();
    return () => window.removeEventListener("resize", update);
  }, []);
  return ratio;
}

export function BackgroundImage({ url, focus, fit, blur = 0, className, aspectRatio, onError }: BackgroundImageProps) {
  const failure = useRef(onError);
  failure.current = onError;
  const [dimensions, setDimensions] = useState<ImageDimensions | null>(null);
  const filterId = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const [renderWidth, setRenderWidth] = useState(0);
  const viewportRatio = useViewportAspectRatio();

  useEffect(() => {
    if (!url) { setDimensions(null); return; }
    const image = new Image();
    image.onload = () => setDimensions({ url, width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => { setDimensions(null); failure.current?.(); };
    image.src = url;
    return () => { image.onload = null; image.onerror = null; };
  }, [url]);

  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg || blur <= 0) return;
    // Layout width excludes the preview stage's transform, preserving its 1080p blur scale.
    const update = () => setRenderWidth(svg.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [dimensions, blur, url]);

  if (!url) return null;
  if (!dimensions || dimensions.url !== url) return null;
  const ratio = aspectRatio && Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : viewportRatio;
  const { x, y, width, height } = backgroundViewport(dimensions.width, dimensions.height, ratio, normalizeBackgroundFocus(focus) ?? centerBackgroundFocus, fit);
  const deviation = renderWidth > 0 ? Math.max(0, blur) * width / renderWidth : 0;
  const padding = Math.ceil(deviation * 3) + 1;
  const imageWidth = dimensions.width;
  const imageHeight = dimensions.height;
  // Repeat the outermost pixel strips explicitly: Chromium does not reliably
  // implement feGaussianBlur's edgeMode. Padding supplies blur samples without
  // scaling the picture; clipping after filtering preserves contain/empty areas.
  const columns = [[-padding, padding, 0, 1], [0, imageWidth, 0, imageWidth], [imageWidth, padding, imageWidth - 1, 1]];
  const rows = [[-padding, padding, 0, 1], [0, imageHeight, 0, imageHeight], [imageHeight, padding, imageHeight - 1, 1]];
  const source = <image href={url} x="0" y="0" width={imageWidth} height={imageHeight} preserveAspectRatio="none" />;
  return <svg ref={svgRef} aria-hidden="true" className={`background-image ${className ?? ""}`} viewBox={`${x} ${y} ${width} ${height}`} preserveAspectRatio={fit === "cover" ? "xMidYMid slice" : "xMidYMid meet"}>
    {blur > 0 && <defs><clipPath id={`${filterId}-clip`}><rect width={imageWidth} height={imageHeight} /></clipPath>
    <filter id={filterId} filterUnits="userSpaceOnUse" x={-padding} y={-padding} width={imageWidth + padding * 2} height={imageHeight + padding * 2} colorInterpolationFilters="sRGB">
      <feGaussianBlur stdDeviation={deviation} edgeMode="duplicate" />
    </filter></defs>}
    {blur > 0 ? <g clipPath={`url(#${filterId}-clip)`}><g filter={`url(#${filterId})`}>
      {source}
      {rows.flatMap(([destY, destHeight, sourceY, sourceHeight], row) => columns.map(([destX, destWidth, sourceX, sourceWidth], column) => row === 1 && column === 1 ? null :
        <svg key={`${row}-${column}`} x={destX} y={destY} width={destWidth} height={destHeight} viewBox={`${sourceX} ${sourceY} ${sourceWidth} ${sourceHeight}`} preserveAspectRatio="none" overflow="hidden">{source}</svg>))}
    </g></g> : source}
  </svg>;
}
