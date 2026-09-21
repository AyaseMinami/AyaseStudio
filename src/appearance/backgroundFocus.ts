export interface BackgroundFocus {
  x: number;
  y: number;
  zoom?: number;
}

export const centerBackgroundFocus: Readonly<BackgroundFocus> = { x: 0.5, y: 0.5 };

/** Viewport in original-image coordinates; deliberately allows space beyond image edges. */
export function backgroundViewport(imageWidth: number, imageHeight: number, aspectRatio: number, focus: BackgroundFocus, fit: "cover" | "contain" = "cover") {
  const baseWidth = fit === "cover" ? Math.min(imageWidth, imageHeight * aspectRatio) : Math.max(imageWidth, imageHeight * aspectRatio);
  const width = baseWidth / (focus.zoom ?? 1);
  const height = width / aspectRatio;
  return {
    x: focus.x * imageWidth - width / 2,
    y: focus.y * imageHeight - height / 2,
    width,
    height,
  };
}

export function normalizeBackgroundFocus(value: unknown): BackgroundFocus | null {
  if (!value || typeof value !== "object") return null;
  const { x, y, zoom } = value as Partial<BackgroundFocus>;
  if (typeof x !== "number" || !Number.isFinite(x) || typeof y !== "number" || !Number.isFinite(y)) return null;
  if (zoom === undefined) return { x, y };
  return typeof zoom === "number" && Number.isFinite(zoom) && zoom >= 0.25 && zoom <= 4 ? { x, y, zoom } : null;
}

/** Preserve the subject position from the earlier, unreleased crop preference. */
export function focusFromLegacyCrop(value: unknown): BackgroundFocus | null {
  if (!value || typeof value !== "object") return null;
  const { x, y, width, height } = value as Record<string, unknown>;
  if (typeof x !== "number" || typeof y !== "number" || typeof width !== "number" || typeof height !== "number") return null;
  return normalizeBackgroundFocus({ x: x + width / 2, y: y + height / 2 });
}
