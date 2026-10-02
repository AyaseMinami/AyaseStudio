import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AyaseDatabase } from "../storage/database";
import { createAvatarLibraryRepository } from "./library";
import { createProviderAvatarRepository, readProviderAvatarEntry } from "./providerAvatars";
import type { UserAvatar } from "./repository";

const decode = vi.hoisted(() => vi.fn());
vi.mock("./image", () => ({ decodeAvatar: decode }));
const names: string[] = [], handles: Dexie[] = [];
const track = (db: Dexie) => { handles.push(db); };
beforeEach(() => { decode.mockReset().mockResolvedValue({}); Dexie.addons.push(track); });
afterEach(async () => {
  vi.restoreAllMocks();
  Dexie.addons.splice(Dexie.addons.indexOf(track), 1);
  for (const db of handles.splice(0)) db.close();
  for (const name of names.splice(0)) await Dexie.delete(name);
});
function fixture(mime = "image/png"): UserAvatar {
  const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII="), c => c.charCodeAt(0));
  return { original: new Blob([bytes], { type: mime }), thumbnail: new Blob([bytes], { type: mime }), crop: { x: .5, y: .5, zoom: 1 } };
}
function setup() {
  const name = `provider-avatar100-${crypto.randomUUID()}`; names.push(name);
  return { name, db: new AyaseDatabase(name), repository: createProviderAvatarRepository(name), library: createAvatarLibraryRepository(name) };
}

describe("Issue 100 immutable supplier image snapshots", () => {
  it("reads supported snapshot rows repeatedly through a pure clone without sharing mutable crop data", () => {
    const row = { id: "owned-image", value: fixture() }, original = structuredClone(row);
    const read = readProviderAvatarEntry(row);
    expect(read).toEqual(original);
    expect(read).not.toBe(row);
    expect(read.value.crop).not.toBe(row.value.crop);
    expect(readProviderAvatarEntry(read)).toEqual(original);
    read.value.crop.x = .25;
    expect(row).toEqual(original);
    expect(decode).not.toHaveBeenCalled();
  });

  it("keeps an independent image/crop snapshot after library replacement and deletion, with no library provenance", async () => {
    const { repository, library, db } = setup();
    const imported = await library.import("Synthetic PNG", fixture()), selected = await library.select(imported.id);
    const snapshotId = await repository.save(selected);
    const expectedBytes = await selected.original.arrayBuffer();
    selected.crop.x = .1;
    await library.replace(imported.id, { ...fixture(), crop: { x: .8, y: .8, zoom: 2 } });
    await library.remove(imported.id);
    expect(await library.list()).toEqual([]);
    const saved = await repository.get(snapshotId);
    expect(saved?.source).toBeUndefined();
    expect(saved?.crop).toEqual({ x: .5, y: .5, zoom: 1 });
    expect(await saved!.original.arrayBuffer()).toEqual(expectedBytes);
    expect(await saved!.thumbnail.arrayBuffer()).toEqual(expectedBytes);
    expect(await db.providerAvatars.count()).toBe(1);
    saved!.crop.zoom = 4;
    expect((await repository.get(snapshotId))?.crop.zoom).toBe(1);
    repository.close();
    expect(await createProviderAvatarRepository(db.name).get(snapshotId)).toEqual(await db.providerAvatars.get(snapshotId).then(row => row?.value));
  });

  it("each save allocates an immutable identity instead of replacing an existing snapshot", async () => {
    const { repository, db } = setup(), first = fixture();
    const firstId = await repository.save(first);
    const secondId = await repository.save({ ...first, crop: { x: .25, y: .75, zoom: 2 } });
    expect(secondId).not.toBe(firstId);
    expect(await db.providerAvatars.count()).toBe(2);
    expect((await repository.get(firstId))?.crop).toEqual({ x: .5, y: .5, zoom: 1 });
    expect((await repository.get(secondId))?.crop).toEqual({ x: .25, y: .75, zoom: 2 });
  });

  it.each(["row", "value", "crop"])("refuses future %s fields on local reads while preserving the original durable row", async scope => {
    const { repository, db } = setup(), row: any = { id: "future-image", value: fixture() };
    const target = scope === "row" ? row : scope === "value" ? row.value : row.value.crop;
    target.futureImageMetadata = { version: 2, retained: "synthetic-future-data" };
    await db.providerAvatars.put(row);
    const original = await db.providerAvatars.get(row.id);
    await expect(repository.get(row.id)).rejects.toThrow();
    expect(await db.providerAvatars.get(row.id)).toEqual(original);
    expect(await db.providerAvatars.count()).toBe(1);
    expect(decode).not.toHaveBeenCalled();
  });

  it.each(["value", "crop"])("refuses future %s fields before a new snapshot save writes or decodes", async scope => {
    const { repository, db } = setup(), value: any = fixture();
    const target = scope === "value" ? value : value.crop;
    target.futureImageMetadata = { version: 2, retained: "synthetic-future-data" };
    const original = structuredClone(value);
    await expect(repository.save(value)).rejects.toThrow();
    expect(value).toEqual(original);
    expect(await db.providerAvatars.count()).toBe(0);
    expect(decode).not.toHaveBeenCalled();
  });

  it.each(["image/png", "image/jpeg", "image/webp"])("accepts the supported %s MIME after checking original and thumbnail decoding", async mime => {
    const { repository } = setup(), avatar = fixture(mime);
    const id = await repository.save(avatar);
    expect((await repository.get(id))?.original.type).toBe(mime);
    expect(decode).toHaveBeenCalledWith(avatar.original);
    expect(decode).toHaveBeenCalledWith(avatar.thumbnail);
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["unsupported original", (v: UserAvatar) => ({ ...v, original: new Blob(["gif"], { type: "image/gif" }) })],
    ["empty original", (v: UserAvatar) => ({ ...v, original: new Blob([], { type: "image/png" }) })],
    ["unsupported thumbnail", (v: UserAvatar) => ({ ...v, thumbnail: new Blob(["svg"], { type: "image/svg+xml" }) })],
    ["empty thumbnail", (v: UserAvatar) => ({ ...v, thumbnail: new Blob([], { type: "image/png" }) })],
    ["invalid crop", (v: UserAvatar) => ({ ...v, crop: { x: -.01, y: .5, zoom: 1 } })],
    ["nonfinite crop", (v: UserAvatar) => ({ ...v, crop: { x: .5, y: .5, zoom: Number.NaN } })],
    ["oversized original", (v: UserAvatar) => ({ ...v, original: new Blob([new Uint8Array(20 * 1024 * 1024 + 1)], { type: "image/png" }) })],
    ["oversized thumbnail", (v: UserAvatar) => ({ ...v, thumbnail: new Blob([new Uint8Array(20 * 1024 * 1024 + 1)], { type: "image/png" }) })],
  ] as const)("rejects %s before any row writes", async (_label, invalid) => {
    const { repository, db } = setup();
    await expect(repository.save(invalid(fixture()))).rejects.toThrow();
    expect(await db.providerAvatars.count()).toBe(0);
    expect(decode).not.toHaveBeenCalled();
  });

  it.each([1, 2])("refuses undecodable image part %s before any row writes", async part => {
    const { repository, db } = setup();
    if (part === 2) decode.mockResolvedValueOnce({});
    decode.mockRejectedValueOnce(new Error("Synthetic decode failure"));
    await expect(repository.save(fixture())).rejects.toThrow("Synthetic decode failure");
    expect(await db.providerAvatars.count()).toBe(0);
  });
});
