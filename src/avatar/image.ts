import type { AvatarCrop } from "./repository";

export const centeredCrop: AvatarCrop = { x: 0.5, y: 0.5, zoom: 1 };
export function cropRectangle(width: number, height: number, crop: AvatarCrop) {
  const side = Math.min(width, height) / Math.max(1, Math.min(4, crop.zoom));
  return { x: Math.max(0, Math.min(width - side, crop.x * width - side / 2)),
    y: Math.max(0, Math.min(height - side, crop.y * height - side / 2)), side };
}
export async function decodeAvatar(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  try { image.src = url; await image.decode(); return image; }
  catch { throw new Error("无法读取这张图片，请选择有效的 PNG、JPEG 或 WebP 图片。"); }
  finally { URL.revokeObjectURL(url); }
}
export async function renderAvatar(image: HTMLImageElement, crop: AvatarCrop): Promise<Blob> {
  const { x, y, side } = cropRectangle(image.naturalWidth, image.naturalHeight, crop);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法裁切图片，请重新选择。");
  context.drawImage(image, x, y, side, side, 0, 0, 256, 256);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("裁切失败，原头像已保留。")), "image/png"));
}
