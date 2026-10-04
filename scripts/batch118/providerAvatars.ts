import type { UserAvatar } from "../../src/avatar/repository";
const images = new Map<string, UserAvatar>();
export const providerAvatarRepository = {
  get: async (id: string) => images.get(id),
  save: async (value: UserAvatar) => { const id = crypto.randomUUID(); images.set(id, value); return id; },
};
