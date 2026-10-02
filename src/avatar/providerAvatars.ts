import { AyaseDatabase } from "../storage/database";
import { withoutAvatarSource, type UserAvatar } from "./repository";
import { decodeAvatar } from "./image";
import { dataCheck, dataRecord } from "../storage/dataContract";

export interface ProviderAvatarEntry { id: string; value: UserAvatar }
/** Strict clone-based read seam for local rows and backup source projections. */
export function readProviderAvatarEntry(raw: unknown): ProviderAvatarEntry {
  dataRecord(raw);
  dataCheck(Object.keys(raw).every(k => ["id", "value"].includes(k)) && typeof raw.id === "string" && !!raw.id.trim());
  dataRecord(raw.value);
  dataCheck(Object.keys(raw.value).every(k => ["original", "thumbnail", "crop"].includes(k)));
  const { original, thumbnail, crop } = raw.value;
  dataCheck(original instanceof Blob && thumbnail instanceof Blob && original.size > 0 && thumbnail.size > 0
    && [original, thumbnail].every(b => b.size <= 20 * 1024 * 1024 && ["image/png", "image/jpeg", "image/webp"].includes(b.type)), "供应商头像数据不受支持，原记录已保留。");
  dataRecord(crop);
  dataCheck(Object.keys(crop).every(k => ["x", "y", "zoom"].includes(k))
    && typeof crop.x === "number" && Number.isFinite(crop.x) && crop.x >= 0 && crop.x <= 1
    && typeof crop.y === "number" && Number.isFinite(crop.y) && crop.y >= 0 && crop.y <= 1
    && typeof crop.zoom === "number" && Number.isFinite(crop.zoom) && crop.zoom >= 1 && crop.zoom <= 4);
  return structuredClone(raw) as unknown as ProviderAvatarEntry;
}
/** Immutable image snapshots, kept independently from removable library originals. */
export function createProviderAvatarRepository(name = "AyaseStudio") {
  const db = new AyaseDatabase(name);
  return {
    async get(id: string) { const row = await db.providerAvatars.get(id); return row ? readProviderAvatarEntry(row).value : undefined; },
    async save(value: UserAvatar): Promise<string> {
      const { original, thumbnail, crop } = value;
      if (!(original instanceof Blob) || !(thumbnail instanceof Blob) || !original.size || !thumbnail.size
        || [original, thumbnail].some(b => b.size > 20 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(b.type))
        || !crop || !Number.isFinite(crop.x) || !Number.isFinite(crop.y) || !Number.isFinite(crop.zoom)
        || crop.x < 0 || crop.x > 1 || crop.y < 0 || crop.y > 1 || crop.zoom < 1 || crop.zoom > 4) throw new Error("供应商头像损坏，请重新选择。");
      const id = crypto.randomUUID();
      const entry = readProviderAvatarEntry({ id, value: withoutAvatarSource(value) });
      await decodeAvatar(entry.value.original); await decodeAvatar(entry.value.thumbnail);
      await db.providerAvatars.add(entry);
      return id;
    },
    close() { db.close(); },
  };
}
export const providerAvatarRepository = createProviderAvatarRepository();
