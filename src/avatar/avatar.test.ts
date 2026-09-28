import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createAvatarRepository, type UserAvatar } from "./repository";
import { centeredCrop, cropRectangle } from "./image";

describe("local user avatar", () => {
  it("retains the original and crop across repository instances and replaces/removes the whole record", async () => {
    const name = `avatar-test-${crypto.randomUUID()}`;
    const store = createAvatarRepository(name);
    const first: UserAvatar = { original: new Blob(["original"]), thumbnail: new Blob(["crop"]), crop: centeredCrop };
    await store.save(first);
    const reopened = createAvatarRepository(name);
    expect((await reopened.load())?.original.size).toBe(8);
    const changed = { ...first, original: new Blob(["replacement"]), crop: { x: 0.2, y: 0.7, zoom: 2 } };
    await reopened.save(changed);
    expect((await store.load())?.crop).toEqual(changed.crop);
    expect((await store.load())?.original.size).toBe(11);
    await store.remove();
    expect(await reopened.load()).toBeUndefined();
  });
  it("centers landscape and portrait crops without stretching", () => {
    expect(cropRectangle(1200, 800, centeredCrop)).toEqual({ x: 200, y: 0, side: 800 });
    expect(cropRectangle(800, 1200, centeredCrop)).toEqual({ x: 0, y: 200, side: 800 });
  });
  it("keeps zoomed crops inside the original at all edges", () => {
    expect(cropRectangle(1200, 800, { x: 1, y: 0, zoom: 2 })).toEqual({ x: 800, y: 0, side: 400 });
    expect(cropRectangle(800, 1200, { x: 0, y: 1, zoom: 4 })).toEqual({ x: 0, y: 1000, side: 200 });
  });
});
