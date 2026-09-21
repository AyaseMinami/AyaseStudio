import { useEffect, useId, useState } from "react";

import { backgroundViewport, centerBackgroundFocus, normalizeBackgroundFocus, type BackgroundFocus } from "../../appearance/backgroundFocus";
import "./backgroundFocus.css";

export interface BackgroundImageProps {
  url: string | null;
  focus: BackgroundFocus | null;
  fit: "cover" | "contain";
  className?: string;
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

export function BackgroundImage({ url, focus, fit, className }: BackgroundImageProps) {
  const [dimensions, setDimensions] = useState<ImageDimensions | null>(null);
  const clipId = useId().replace(/:/g, "");
  const viewportRatio = useViewportAspectRatio();

  useEffect(() => {
    if (!url) { setDimensions(null); return; }
    const image = new Image();
    image.onload = () => setDimensions({ url, width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => setDimensions(null);
    image.src = url;
    return () => { image.onload = null; image.onerror = null; };
  }, [url]);

  if (!url) return null;
  if (!dimensions || dimensions.url !== url) return null;
  const { x, y, width, height } = backgroundViewport(dimensions.width, dimensions.height, viewportRatio, normalizeBackgroundFocus(focus) ?? centerBackgroundFocus, fit);
  return <svg aria-hidden="true" className={`background-image ${className ?? ""}`} viewBox={`${x} ${y} ${width} ${height}`} preserveAspectRatio={fit === "cover" ? "xMidYMid slice" : "xMidYMid meet"}>
    <defs><clipPath id={clipId}><rect x={x} y={y} width={width} height={height} /></clipPath></defs>
    <image href={url} x="0" y="0" width={dimensions.width} height={dimensions.height} clipPath={`url(#${clipId})`} preserveAspectRatio="none" />
  </svg>;
}
