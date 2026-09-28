import Dexie, { type EntityTable } from "dexie";
import { AyaseDatabase } from "../storage/database";

export interface AvatarCrop { x: number; y: number; zoom: number }
export interface UserAvatar {
  original: Blob; thumbnail: Blob; crop: AvatarCrop;
  source?: { resourceId: string; version: string };
}
export interface AvatarRepository {
  load(): Promise<UserAvatar | undefined>;
  save(avatar: UserAvatar): Promise<void>;
  remove(): Promise<void>;
}

// A persisted tombstone also marks migration complete, so removal never resurrects legacy data.
export async function migrateUserAvatar(db: AyaseDatabase, legacyName: string): Promise<void> {
  if (await db.userAvatar.get("user")) return;
  let value: UserAvatar | undefined;
  if (await Dexie.exists(legacyName)) {
    const legacy = new Dexie(legacyName) as Dexie & { avatars: EntityTable<UserAvatar & { id: string }, "id"> };
    legacy.version(1).stores({ avatars: "id" });
    try {
      const saved = await legacy.avatars.get("user");
      if (saved) value = { original: saved.original, thumbnail: saved.thumbnail, crop: saved.crop };
    } finally { legacy.close(); }
  }
  await db.transaction("rw", db.userAvatar, async () => {
    if (!await db.userAvatar.get("user")) await db.userAvatar.put({ id: "user", value });
  });
}

export function withoutAvatarSource(avatar: UserAvatar): UserAvatar {
  const { source: _source, ...snapshot } = avatar;
  return snapshot;
}

// Provenance is optional: every owner already holds its own original, crop and thumbnail.
// A draft selected before library deletion remains usable as a standalone image.
export async function resolveAvatarSource(db: AyaseDatabase, avatar?: UserAvatar): Promise<UserAvatar | undefined> {
  return avatar?.source && !await db.avatarLibrary.get(avatar.source.resourceId)
    ? withoutAvatarSource(avatar) : avatar;
}

export function legacyAvatarDatabaseName(name: string) {
  return name === "AyaseStudio" ? "ayase-studio-avatars" : `${name}-legacy`;
}

// Dedicated tables share a transaction with library and assistant references, never transcripts.
export function createAvatarRepository(name = "AyaseStudio", legacyName = legacyAvatarDatabaseName(name)): AvatarRepository {
  const db = new AyaseDatabase(name);
  const ready = () => migrateUserAvatar(db, legacyName);
  return {
    load: async () => {
      await ready();
      return db.transaction("r", [db.userAvatar, db.avatarLibrary], async () => {
        const value = (await db.userAvatar.get("user"))?.value;
        return resolveAvatarSource(db, value);
      });
    },
    save: async (avatar) => {
      const value = structuredClone(avatar);
      // An explicit choice supersedes migration, even if the untouched legacy backup is unreadable.
      await db.transaction("rw", [db.userAvatar, db.avatarLibrary], async () => {
        await db.userAvatar.put({ id: "user", value: await resolveAvatarSource(db, value) });
      });
    },
    remove: async () => { await db.userAvatar.put({ id: "user" }); },
  };
}
