import { automaticAvatar } from "./automaticAvatar";
import { brandIds, type BrandId } from "./brandIds";
import { centeredCrop, decodeAvatar } from "./image";
import type { UserAvatar } from "./repository";

const assets = import.meta.glob<string>("./brands/*.{svg,png,webp,jpg,ico}", { eager: true, query: "?url", import: "default" });
const labels: Record<BrandId, string> = {
  openai: "OpenAI", anthropic: "Anthropic", gemini: "Google Gemini", xai: "xAI", openrouter: "OpenRouter",
  deepseek: "DeepSeek", zhipu: "智谱", qwen: "千问", moonshot: "月之暗面", doubao: "豆包", minimax: "MiniMax",
};

export const brandAvatars: readonly { id: BrandId; label: string; src?: string }[] = brandIds.map((id) => ({
  id, label: labels[id], src: Object.entries(assets).find(([path]) => path.startsWith(`./brands/${id}.`))?.[1],
}));

/** Snapshot only bundled artwork into the existing local user/assistant image format. */
export async function materializeBrandAvatar(id: BrandId): Promise<UserAvatar> {
  const brand = brandAvatars.find((item) => item.id === id);
  if (!brand) throw new Error("未找到此内置头像。");
  const theme = document.documentElement.dataset.theme;
  const invert = theme === "dark" ? ["openai", "anthropic", "xai"].includes(id)
    : theme === "light" && ["zhipu", "moonshot"].includes(id);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建头像图片，请重试。");
  let image: HTMLImageElement | undefined;
  if (brand.src) {
    try {
      const response = await fetch(brand.src);
      if (response.ok) image = await decodeAvatar(await response.blob());
      if (image && (!image.naturalWidth || !image.naturalHeight)) image = undefined;
    } catch { /* Missing or unreadable bundled artwork uses the same display fallback. */ }
  }
  if (image) {
    context.filter = invert ? "invert(1)" : "none";
    const scale = 216 / Math.max(image.naturalWidth, image.naturalHeight);
    const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
    context.drawImage(image, (256 - width) / 2, (256 - height) / 2, width, height);
  } else {
    const automatic = automaticAvatar(brand.label, brand.id);
    context.fillStyle = automatic.background;
    context.fillRect(0, 0, 256, 256);
    context.fillStyle = automatic.color;
    context.font = "600 128px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(automatic.initial, 128, 128);
  }
  const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("无法保存内置头像，请重试。")), "image/png"));
  return { original: png, thumbnail: png, crop: { ...centeredCrop } };
}
