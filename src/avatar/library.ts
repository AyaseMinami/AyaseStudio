import { AyaseDatabase } from "../storage/database";
import { decodeAvatar } from "./image";
import { withoutAvatarSource, type UserAvatar } from "./repository";

export interface AvatarLibraryEntry { id: string; name: string; version: string; avatar: UserAvatar }
export interface AvatarUsage { id: string; name: string }
export interface AvatarLibraryRepository {
  list(): Promise<AvatarLibraryEntry[]>;
  import(name: string, avatar: UserAvatar): Promise<AvatarLibraryEntry>;
  rename(id: string, name: string): Promise<void>;
  replace(id: string, avatar: UserAvatar): Promise<AvatarLibraryEntry>;
  usages(id: string): Promise<AvatarUsage[]>;
  remove(id: string): Promise<void>;
  removeMany(ids: string[]): Promise<void>;
  select(id: string): Promise<UserAvatar>;
}

function resourceName(name: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 100) throw new Error("请输入 1–100 个字符的头像名称。");
  return trimmed;
}

async function checkedImage(avatar: UserAvatar): Promise<UserAvatar> {
  const { original, thumbnail, crop } = avatar;
  if (!(original instanceof Blob) || !["image/png", "image/jpeg", "image/webp"].includes(original.type)
    || original.size === 0 || original.size > 20 * 1024 * 1024)
    throw new Error("请选择 20 MB 以内的 PNG、JPEG 或 WebP 图片。");
  if (!(thumbnail instanceof Blob) || thumbnail.size === 0 || !crop
    || !Number.isFinite(crop.x) || !Number.isFinite(crop.y) || !Number.isFinite(crop.zoom)
    || crop.x < 0 || crop.x > 1 || crop.y < 0 || crop.y > 1 || crop.zoom < 1 || crop.zoom > 4)
    throw new Error("头像或裁切数据损坏，请重新导入。");
  await decodeAvatar(original);
  await decodeAvatar(thumbnail);
  return { original, thumbnail, crop: { ...crop } };
}

export function createAvatarLibraryRepository(name = "AyaseStudio"): AvatarLibraryRepository {
  const db = new AyaseDatabase(name);
  async function requireEntry(id: string) {
    const entry = await db.avatarLibrary.get(id);
    if (!entry) throw new Error("这张头像已不存在，请重新选择。");
    return entry;
  }
  async function usages(id: string): Promise<AvatarUsage[]> {
    const user = (await db.userAvatar.get("user"))?.value;
    const assistants = await db.assistants.toArray();
    return [
      ...(user?.source?.resourceId === id ? [{ id: "user", name: "用户头像" }] : []),
      ...assistants.filter(item => item.avatar?.source?.resourceId === id)
        .map(item => ({ id: `assistant:${item.id}`, name: `助手 · ${item.name}` })),
    ];
  }
  async function removeMany(ids: string[]): Promise<void> {
    const selectedIds = new Set(ids);
    if (selectedIds.size === 0) return;
    await db.transaction("rw", [db.avatarLibrary, db.userAvatar, db.assistants], async () => {
      for (const id of selectedIds) await requireEntry(id);
      const user = await db.userAvatar.get("user");
      if (user?.value?.source && selectedIds.has(user.value.source.resourceId))
        await db.userAvatar.put({ ...user, value: withoutAvatarSource(user.value) });
      for (const assistant of await db.assistants.toArray()) {
        if (assistant.avatar?.source && selectedIds.has(assistant.avatar.source.resourceId))
          await db.assistants.update(assistant.id, { avatar: withoutAvatarSource(assistant.avatar) });
      }
      await db.avatarLibrary.bulkDelete([...selectedIds]);
    });
  }
  return {
    list: () => db.avatarLibrary.toArray(),
    import: async (name, avatar) => {
      const title = resourceName(name);
      const image = await checkedImage(avatar);
      const entry = { id: crypto.randomUUID(), name: title, version: crypto.randomUUID(), avatar: image };
      await db.avatarLibrary.add(entry);
      return entry;
    },
    rename: async (id, name) => {
      const title = resourceName(name);
      await db.transaction("rw", db.avatarLibrary, async () => {
        await requireEntry(id);
        await db.avatarLibrary.update(id, { name: title });
      });
    },
    replace: async (id, avatar) => {
      const image = await checkedImage(avatar);
      return db.transaction("rw", db.avatarLibrary, async () => {
        const entry = { ...await requireEntry(id), version: crypto.randomUUID(), avatar: image };
        await db.avatarLibrary.put(entry);
        return entry;
      });
    },
    usages: async (id) => {
      // Legacy standalone avatars cannot reference library entries; their migration need not gate browsing.
      return db.transaction("r", [db.userAvatar, db.assistants], () => usages(id));
    },
    remove: (id) => removeMany([id]),
    removeMany,
    select: async (id) => {
      const entry = await requireEntry(id);
      const image = await checkedImage(entry.avatar);
      return { ...image, source: { resourceId: id, version: entry.version } };
    },
  };
}

export const avatarLibrary = createAvatarLibraryRepository();
