import type { AvatarLibraryEntry, AvatarLibraryRepository } from "../../src/avatar/library";
const entries = new Map<string, AvatarLibraryEntry>();
function get(id: string) { const entry = entries.get(id); if (!entry) throw new Error("未找到头像"); return entry; }
export const avatarLibrary: AvatarLibraryRepository = {
  list: async () => [...entries.values()], usages: async () => [],
  import: async (name, avatar) => { const id = crypto.randomUUID(); const entry = { id, name, avatar, version: crypto.randomUUID() }; entries.set(id, entry); return entry; },
  select: async id => get(id).avatar,
  rename: async (id, name) => { get(id).name = name; },
  replace: async (id, avatar) => { const entry = { ...get(id), avatar, version: crypto.randomUUID() }; entries.set(id, entry); return entry; },
  remove: async id => { entries.delete(id); }, removeMany: async ids => { ids.forEach(id => entries.delete(id)); },
};
