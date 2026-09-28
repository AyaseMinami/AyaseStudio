import Dexie, { type EntityTable } from "dexie";

export interface AvatarCrop { x: number; y: number; zoom: number }
export interface UserAvatar { original: Blob; thumbnail: Blob; crop: AvatarCrop }
export interface AvatarRepository {
  load(): Promise<UserAvatar | undefined>;
  save(avatar: UserAvatar): Promise<void>;
  remove(): Promise<void>;
}

// Separate from transcripts: avatar bytes never become message attachments.
export function createAvatarRepository(name = "ayase-studio-avatars"): AvatarRepository {
  const db = new Dexie(name) as Dexie & { avatars: EntityTable<UserAvatar & { id: string }, "id"> };
  db.version(1).stores({ avatars: "id" });
  return {
    load: () => db.avatars.get("user"),
    save: async (avatar) => { await db.avatars.put({ ...avatar, id: "user" }); },
    remove: () => db.avatars.delete("user"),
  };
}
