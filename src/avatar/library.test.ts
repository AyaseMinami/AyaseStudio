import "fake-indexeddb/auto";
import Dexie, { type Table } from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChatRepository } from "../chat/repository";
import { defaultSessionConfig } from "../chat/sessionConfig";
import type { AssistantInput } from "../chat/workspace";
import { AyaseDatabase } from "../storage/database";
import { createAvatarLibraryRepository } from "./library";
import { createAvatarRepository, type UserAvatar } from "./repository";

const decode = vi.hoisted(() => vi.fn());
vi.mock("./image", () => ({ decodeAvatar: decode }));

const databaseNames: string[] = [];
const databaseHandles: Dexie[] = [];
const testAddons: ((db: Dexie) => void)[] = [];
const trackDatabase = (db: Dexie) => { databaseHandles.push(db); };
function interceptLegacyReads(name: string, read: (original: () => ReturnType<Table["get"]>) => ReturnType<Table["get"]>) {
  const addon = (db: Dexie) => {
    if (db.name !== name) return;
    const originalGet = db.Table.prototype.get;
    vi.spyOn(db.Table.prototype, "get").mockImplementation(function (this: Table, key, callback) {
      return this.name === "avatars" ? read(() => originalGet.call(this, key, callback))
        : originalGet.call(this, key, callback);
    });
  };
  Dexie.addons.push(addon);
  testAddons.push(addon);
}
function image(text = "original"): UserAvatar {
  return { original: new Blob([text], { type: "image/png" }),
    thumbnail: new Blob([`${text}-thumbnail`], { type: "image/png" }),
    crop: { x: 0.5, y: 0.5, zoom: 1 } };
}
function standalone(avatar: UserAvatar): UserAvatar {
  const { source: _source, ...owned } = avatar;
  return owned;
}
function input(avatar?: UserAvatar, name = "Assistant"): AssistantInput {
  return { name, icon: "", avatar, defaultModelId: null, defaultConfig: defaultSessionConfig() };
}
function stores() {
  const name = `avatar-library-test-${crypto.randomUUID()}`;
  const legacyName = `${name}-old-user`;
  databaseNames.push(name, legacyName);
  return { name, legacyName, library: createAvatarLibraryRepository(name),
    user: createAvatarRepository(name, legacyName), workspace: createChatRepository(name), db: new AyaseDatabase(name) };
}
async function expectImage(actual: UserAvatar | undefined, expected: UserAvatar) {
  expect(actual).toBeDefined();
  expect(await actual!.original.text()).toBe(await expected.original.text());
  expect(await actual!.thumbnail.text()).toBe(await expected.thumbnail.text());
  expect(actual!.crop).toEqual(expected.crop);
  expect(actual!.source).toEqual(expected.source);
}

beforeEach(() => {
  decode.mockReset().mockResolvedValue({});
  Dexie.addons.push(trackDatabase);
  testAddons.push(trackDatabase);
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const addon of testAddons.splice(0)) Dexie.addons.splice(Dexie.addons.indexOf(addon), 1);
  for (const db of databaseHandles.splice(0)) db.close();
  await Promise.all(databaseNames.splice(0).map(name => Dexie.delete(name)));
});

describe("avatar library validation", () => {
  it.each(["", "   ", "a".repeat(101)])("rejects invalid name %j without a partial write", async name => {
    const { library } = stores();
    await expect(library.import(name, image())).rejects.toThrow("1–100");
    expect(await library.list()).toEqual([]);
    expect(decode).not.toHaveBeenCalled();
  });

  it.each([
    new Blob(["gif"], { type: "image/gif" }),
    new Blob([], { type: "image/png" }),
    new Blob([new Uint8Array(20 * 1024 * 1024 + 1)], { type: "image/png" }),
  ])("rejects unsupported, empty, or oversized originals", async original => {
    const { library } = stores();
    await expect(library.import("Photo", { ...image(), original })).rejects.toThrow("20 MB");
    expect(await library.list()).toEqual([]);
    expect(decode).not.toHaveBeenCalled();
  });

  it.each([
    { x: -0.1, y: 0.5, zoom: 1 }, { x: 1.1, y: 0.5, zoom: 1 },
    { x: 0.5, y: -0.1, zoom: 1 }, { x: 0.5, y: 1.1, zoom: 1 },
    { x: 0.5, y: 0.5, zoom: 0.9 }, { x: 0.5, y: 0.5, zoom: 4.1 },
    { x: NaN, y: 0.5, zoom: 1 }, { x: 0.5, y: Infinity, zoom: 1 },
    { x: 0.5, y: 0.5, zoom: NaN },
  ])("rejects damaged crop %j", async crop => {
    const { library } = stores();
    await expect(library.import("Photo", { ...image(), crop })).rejects.toThrow("裁切数据损坏");
    expect(await library.list()).toEqual([]);
  });

  it("rejects empty thumbnail and failed original/thumbnail decoding without writes", async () => {
    const { library } = stores();
    await expect(library.import("Photo", { ...image(), thumbnail: new Blob() })).rejects.toThrow("损坏");
    for (const failAt of [1, 2]) {
      decode.mockReset().mockResolvedValue({});
      if (failAt === 1) decode.mockRejectedValueOnce(new Error("invalid image"));
      else decode.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("invalid thumbnail"));
      await expect(library.import("Photo", image())).rejects.toThrow("invalid");
      expect(await library.list()).toEqual([]);
    }
  });

  it("validates replacement before writing and preserves the existing entry on failure", async () => {
    const { library } = stores();
    const original = image();
    const entry = await library.import("Photo", original);
    decode.mockRejectedValueOnce(new Error("broken replacement"));
    await expect(library.replace(entry.id, image("new"))).rejects.toThrow("broken replacement");
    const retained = (await library.list())[0];
    expect(retained.version).toBe(entry.version);
    await expectImage(retained.avatar, original);
  });

  it("rejects selecting a corrupt stored image", async () => {
    const { library, db } = stores();
    const entry = await library.import("Photo", image());
    await db.avatarLibrary.update(entry.id, { avatar: { ...image(), crop: { x: NaN, y: 0, zoom: 1 } } });
    await expect(library.select(entry.id)).rejects.toThrow("损坏");
    await db.avatarLibrary.update(entry.id, { avatar: image() });
    decode.mockRejectedValueOnce(new Error("unreadable stored image"));
    await expect(library.select(entry.id)).rejects.toThrow("unreadable stored image");
  });
});

describe("avatar snapshots and ownership", () => {
  it("selects a source snapshot and keeps user and assistant crops independent across reload", async () => {
    const { name, legacyName, library, user, workspace } = stores();
    await workspace.initializeWorkspace(null, []);
    const entry = await library.import("  Photo  ", image());
    expect(entry.name).toBe("Photo");
    const selected = await library.select(entry.id);
    expect(selected.source).toEqual({ resourceId: entry.id, version: entry.version });
    const userImage = { ...selected, crop: { x: 0.1, y: 0.2, zoom: 2 } };
    const assistantImage = { ...selected, crop: { x: 0.8, y: 0.9, zoom: 3 } };
    await user.save(userImage);
    await workspace.execute({ type: "create-assistant", id: "a", input: input(assistantImage) });
    await workspace.execute({ type: "create-assistant", id: "b", input: input(selected) });
    await expectImage(await createAvatarRepository(name, legacyName).load(), userImage);
    const restored = await createChatRepository(name).initializeWorkspace(null, []);
    await expectImage(restored.assistants.find(item => item.id === "a")?.avatar, assistantImage);
    await expectImage(restored.assistants.find(item => item.id === "b")?.avatar, selected);
    await expectImage((await createAvatarLibraryRepository(name).list())[0].avatar, image());
    expect(await library.usages(entry.id)).toEqual([
      { id: "user", name: "用户头像" }, { id: "assistant:a", name: "助手 · Assistant" },
      { id: "assistant:b", name: "助手 · Assistant" },
    ]);
  });

  it("renames metadata without changing bytes, crop, version, or existing selections", async () => {
    const { library } = stores();
    const entry = await library.import("Photo", image());
    const selected = await library.select(entry.id);
    await library.rename(entry.id, "  Renamed  ");
    const renamed = (await library.list())[0];
    expect(renamed.name).toBe("Renamed");
    expect(renamed.version).toBe(entry.version);
    await expectImage(renamed.avatar, entry.avatar);
    await expectImage(await library.select(entry.id), selected);
    await expect(library.rename(entry.id, " ")).rejects.toThrow("1–100");
    expect((await library.list())[0].name).toBe("Renamed");
  });

  it("detaches every owned version on library deletion while preserving image bytes, crops, defaults, and unrelated entries", async () => {
    const { name, legacyName, library, user, workspace, db } = stores();
    await workspace.initializeWorkspace(null, []);
    const entry = await library.import("Photo", image("old"));
    const old = await library.select(entry.id);
    await user.save(old);
    await workspace.execute({ type: "create-assistant", id: "a", input: input(old) });
    const replacement = await library.replace(entry.id, image("new"));
    expect(replacement.version).not.toBe(entry.version);
    expect(replacement.id).toBe(entry.id);
    await expectImage(await user.load(), old);
    await expectImage((await db.assistants.get("a"))?.avatar, old);
    expect((await library.select(entry.id)).source?.version).toBe(replacement.version);
    const latest = await library.select(entry.id);
    latest.crop = { x: 0.1, y: 0.9, zoom: 3 };
    await workspace.execute({ type: "create-assistant", id: "b", input: { ...input(latest, "Newest"), defaultAvatar: "person" } });
    const unrelated = await library.import("Unrelated", image("unrelated"));
    const unrelatedAvatar = await library.select(unrelated.id);
    await workspace.execute({ type: "create-assistant", id: "c", input: input(unrelatedAvatar) });
    const previousAssistants = await db.assistants.toArray();
    await library.remove(entry.id);
    expect((await library.list()).map(item => item.id)).toEqual([unrelated.id]);
    await expectImage(await user.load(), standalone(old));
    await expectImage(await createAvatarRepository(name, legacyName).load(), standalone(old));
    const restored = await createChatRepository(name).initializeWorkspace(null, []);
    await expectImage(restored.assistants.find(item => item.id === "a")?.avatar, standalone(old));
    await expectImage(restored.assistants.find(item => item.id === "b")?.avatar, standalone(latest));
    for (const previous of previousAssistants) {
      expect(await db.assistants.get(previous.id)).toEqual(previous.avatar?.source?.resourceId === entry.id
        ? { ...previous, avatar: standalone(previous.avatar) } : previous);
    }
    await expectImage((await db.assistants.get("c"))?.avatar, unrelatedAvatar);
    expect(await library.usages(entry.id)).toEqual([]);
    const recropped = { ...standalone(old), crop: { x: 0.25, y: 0.75, zoom: 2 }, thumbnail: new Blob(["new crop"], { type: "image/png" }) };
    await user.save(recropped);
    await expectImage(await createAvatarRepository(name, legacyName).load(), recropped);
    const assistantRecrop = { ...standalone(latest), crop: { x: 0.8, y: 0.2, zoom: 4 },
      thumbnail: new Blob(["assistant new crop"], { type: "image/png" }) };
    await workspace.execute({ type: "edit-assistant", id: "b", input: { ...input(assistantRecrop, "Newest"), defaultAvatar: "person" } });
    const recropReload = await createChatRepository(name).initializeWorkspace(null, []);
    await expectImage(recropReload.assistants.find(item => item.id === "b")?.avatar, assistantRecrop);
    await expect(library.select(entry.id)).rejects.toThrow("已不存在");
  });

  it("does not detach unrelated user provenance or change a standalone assistant image", async () => {
    const { library, user, workspace, db } = stores();
    await workspace.initializeWorkspace(null, []);
    const removed = await library.import("Removed", image("removed"));
    const retained = await library.import("Retained", image("retained"));
    const userImage = await library.select(retained.id);
    const assistantImage = image("standalone");
    await user.save(userImage);
    await workspace.execute({ type: "create-assistant", id: "a", input: input(assistantImage) });
    const assistant = await db.assistants.get("a");
    await library.remove(removed.id);
    await expectImage(await user.load(), userImage);
    expect(await db.assistants.get("a")).toEqual(assistant);
    expect(await db.avatarLibrary.get(retained.id)).toEqual(retained);
  });

  it("deletes multiple entries while preserving owned snapshots and unrelated resources and owners", async () => {
    const { name, legacyName, library, user, workspace, db } = stores();
    await workspace.initializeWorkspace(null, []);
    const first = await library.import("First", image("first"));
    const second = await library.import("Second", image("second"));
    const retained = await library.import("Retained", image("retained"));
    const userImage = { ...await library.select(first.id), crop: { x: 0.2, y: 0.8, zoom: 2 } };
    const assistantImage = { ...await library.select(second.id), crop: { x: 0.7, y: 0.3, zoom: 3 } };
    const retainedImage = await library.select(retained.id);
    await user.save(userImage);
    await workspace.execute({ type: "create-assistant", id: "a", input: input(assistantImage) });
    await workspace.execute({ type: "create-assistant", id: "b", input: input(userImage) });
    await workspace.execute({ type: "create-assistant", id: "c", input: input(retainedImage) });
    const assistants = await db.assistants.toArray();

    await library.removeMany([first.id, second.id]);

    expect(await library.list()).toEqual([retained]);
    await expectImage(await createAvatarRepository(name, legacyName).load(), standalone(userImage));
    const restored = await createChatRepository(name).initializeWorkspace(null, []);
    await expectImage(restored.assistants.find(item => item.id === "a")?.avatar, standalone(assistantImage));
    await expectImage(restored.assistants.find(item => item.id === "b")?.avatar, standalone(userImage));
    await expectImage(restored.assistants.find(item => item.id === "c")?.avatar, retainedImage);
    for (const assistant of assistants) {
      expect(await db.assistants.get(assistant.id)).toEqual(assistant.avatar?.source
        && [first.id, second.id].includes(assistant.avatar.source.resourceId)
        ? { ...assistant, avatar: standalone(assistant.avatar) } : assistant);
    }
  });

  it("validates every requested entry before detaching owners or deleting any entries", async () => {
    const { name, library, user, workspace, db } = stores();
    await workspace.initializeWorkspace(null, []);
    const first = await library.import("First", image("first"));
    const second = await library.import("Second", image("second"));
    const selected = await library.select(first.id);
    await user.save(selected);
    await workspace.execute({ type: "create-assistant", id: "a", input: input(selected) });
    const libraryDatabase = databaseHandles.find(handle => handle.name === name)!;
    const put = vi.spyOn(libraryDatabase.Table.prototype, "put");
    const update = vi.spyOn(libraryDatabase.Table.prototype, "update");
    const bulkDelete = vi.spyOn(libraryDatabase.Table.prototype, "bulkDelete");

    await expect(library.removeMany([first.id, second.id, "missing"])).rejects.toThrow("这张头像已不存在，请重新选择。");

    expect(put).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(bulkDelete).not.toHaveBeenCalled();
    expect(await db.avatarLibrary.get(first.id)).toEqual(first);
    expect(await db.avatarLibrary.get(second.id)).toEqual(second);
    await expectImage((await db.userAvatar.get("user"))?.value, selected);
    await expectImage((await db.assistants.get("a"))?.avatar, selected);
  });

  it("rolls back all owner detachment and entry deletions when a batch deletion fails", async () => {
    const { name, library, user, workspace, db } = stores();
    await workspace.initializeWorkspace(null, []);
    const first = await library.import("First", image("first"));
    const second = await library.import("Second", image("second"));
    const userImage = await library.select(first.id);
    const assistantImage = await library.select(second.id);
    await user.save(userImage);
    await workspace.execute({ type: "create-assistant", id: "a", input: input(assistantImage) });
    const libraryDatabase = databaseHandles.find(handle => handle.name === name)!;
    const originalBulkDelete = libraryDatabase.Table.prototype.bulkDelete;
    vi.spyOn(libraryDatabase.Table.prototype, "bulkDelete")
      .mockImplementationOnce(function (this: Table, keys) {
        return originalBulkDelete.call(this, keys).then(() => { throw new Error("batch delete failed"); });
      });

    await expect(library.removeMany([first.id, second.id])).rejects.toThrow("batch delete failed");

    expect(await db.avatarLibrary.get(first.id)).toEqual(first);
    expect(await db.avatarLibrary.get(second.id)).toEqual(second);
    await expectImage((await db.userAvatar.get("user"))?.value, userImage);
    await expectImage((await db.assistants.get("a"))?.avatar, assistantImage);
  });

  it("deduplicates requested ids and treats an empty batch as a no-op", async () => {
    const { name, library, db } = stores();
    const first = await library.import("First", image("first"));
    const second = await library.import("Second", image("second"));
    const libraryDatabase = databaseHandles.find(handle => handle.name === name)!;
    const transaction = vi.spyOn(libraryDatabase, "transaction");
    const bulkDelete = vi.spyOn(libraryDatabase.Table.prototype, "bulkDelete");

    await library.removeMany([]);
    expect(transaction).not.toHaveBeenCalled();
    expect(bulkDelete).not.toHaveBeenCalled();
    expect(await db.avatarLibrary.count()).toBe(2);

    await library.removeMany([first.id, first.id, second.id, second.id]);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(bulkDelete).toHaveBeenCalledExactlyOnceWith([first.id, second.id]);
    expect(await library.list()).toEqual([]);
  });

  it("releasing an assistant image retains the assistant but releases its snapshot ownership", async () => {
    const { library, workspace, db } = stores();
    await workspace.initializeWorkspace(null, []);
    const entry = await library.import("Photo", image());
    await workspace.execute({ type: "create-assistant", id: "a", input: input(await library.select(entry.id)) });
    await workspace.execute({ type: "edit-assistant", id: "a", input: input() });
    expect((await db.assistants.get("a"))?.avatar).toBeUndefined();
    await library.remove(entry.id);
    expect(await db.assistants.get("a")).toBeDefined();
  });

  it("rolls back snapshot detachment if deleting the library entry fails", async () => {
    const { name, library, user, workspace, db } = stores();
    await workspace.initializeWorkspace(null, []);
    const entry = await library.import("Photo", image());
    const selected = await library.select(entry.id);
    await user.save(selected);
    await workspace.execute({ type: "create-assistant", id: "a", input: input(selected) });
    const libraryDatabase = databaseHandles.find(handle => handle.name === name)!;
    vi.spyOn(libraryDatabase.Table.prototype, "bulkDelete")
      .mockImplementationOnce(() => Dexie.Promise.reject(new Error("delete failed")));
    await expect(library.remove(entry.id)).rejects.toThrow("delete failed");
    expect(await db.avatarLibrary.get(entry.id)).toEqual(entry);
    await expectImage((await db.userAvatar.get("user"))?.value, selected);
    await expectImage((await db.assistants.get("a"))?.avatar, selected);
    expect(await library.usages(entry.id)).toHaveLength(2);
  });

  it("still releases owned bytes when the user removes its image or deletes an assistant", async () => {
    const { library, user, workspace, db } = stores();
    await workspace.initializeWorkspace(null, []);
    const entry = await library.import("Photo", image());
    const selected = await library.select(entry.id);
    await user.save(selected);
    await workspace.execute({ type: "create-assistant", id: "a", input: input(selected) });
    await library.remove(entry.id);
    await user.remove();
    await workspace.execute({ type: "delete-assistant", id: "a", mode: "delete" });
    expect(await db.userAvatar.get("user")).toEqual({ id: "user" });
    expect(await db.assistants.get("a")).toBeUndefined();
  });

  it("normalizes stale user, edited assistant, and new assistant draft snapshots after library removal", async () => {
    const { library, user, workspace, db } = stores();
    await workspace.initializeWorkspace(null, []);
    const previous = image("private-owner-image");
    await user.save(previous);
    await workspace.execute({ type: "create-assistant", id: "a", input: input(previous, "Original") });
    const entry = await library.import("Photo", image());
    const stale = await library.select(entry.id);
    await library.remove(entry.id);
    await user.save(stale);
    await workspace.execute({ type: "edit-assistant", id: "a", input: input(stale, "Changed") });
    await workspace.execute({ type: "create-assistant", id: "b", input: input(stale) });
    await expectImage(await user.load(), standalone(stale));
    expect((await db.assistants.get("a"))?.name).toBe("Changed");
    await expectImage((await db.assistants.get("a"))?.avatar, standalone(stale));
    await expectImage((await db.assistants.get("b"))?.avatar, standalone(stale));
    expect(stale.source).toBeDefined();
  });

  it.each([
    { owner: "user", saveFirst: false }, { owner: "user", saveFirst: true },
    { owner: "assistant", saveFirst: false }, { owner: "assistant", saveFirst: true },
  ])("serializes concurrent deletion and $owner saving (save first: $saveFirst) without dangling references", async ({ owner, saveFirst }) => {
    const { library, user, workspace, db } = stores();
    await workspace.initializeWorkspace(null, []);
    await user.load();
    const entry = await library.import("Photo", image());
    const selected = await library.select(entry.id);
    const save = () => owner === "user" ? user.save(selected)
      : workspace.execute({ type: "create-assistant", id: "a", input: input(selected) });
    const results = await Promise.allSettled(saveFirst ? [save(), library.remove(entry.id)] : [library.remove(entry.id), save()]);
    expect(results.every(result => result.status === "fulfilled")).toBe(true);
    const resource = await db.avatarLibrary.get(entry.id);
    const avatar = owner === "user" ? (await db.userAvatar.get("user"))?.value : (await db.assistants.get("a"))?.avatar;
    expect(resource).toBeUndefined();
    await expectImage(avatar, standalone(selected));
  });

  it("preserves owned images while stripping missing library provenance on user load and assistant snapshot", async () => {
    const { library, user, workspace, db } = stores();
    await workspace.initializeWorkspace(null, []);
    const entry = await library.import("Photo", image());
    const selected = await library.select(entry.id);
    await user.save(selected);
    await workspace.execute({ type: "create-assistant", id: "a", input: input(selected) });
    await db.avatarLibrary.delete(entry.id);
    await expectImage(await user.load(), standalone(selected));
    const restored = await workspace.initializeWorkspace(null, []);
    await expectImage(restored.assistants.find(item => item.id === "a")?.avatar, standalone(selected));
  });

  it("keeps avatar bytes and source references outside transcripts and conversation configuration", async () => {
    const { library, workspace, db } = stores();
    await workspace.initializeWorkspace(null, []);
    const entry = await library.import("Photo", image());
    await workspace.execute({ type: "create-assistant", id: "a", input: input(await library.select(entry.id)) });
    await workspace.execute({ type: "create-conversation", id: "conversation", assistantId: "a" });
    await workspace.save({ id: "conversation", updatedAt: 123, messages: [
      { id: "message", role: "assistant", content: "Hello", status: "complete" },
    ] });
    const conversation = await db.conversations.get("conversation");
    expect(conversation?.settings).toEqual({ modelId: null, config: defaultSessionConfig() });
    const transcript = await workspace.load("conversation");
    expect(transcript).toEqual({ id: "conversation", updatedAt: 123,
      messages: [{ id: "message", role: "assistant", content: "Hello", status: "complete" }] });
    expect(JSON.stringify({ conversation, transcript })).not.toMatch(/avatar|resourceId|thumbnail|original/);
  });
});

describe("legacy avatar migration", () => {
  it("keeps library browsing and explicit library selection usable without reading a broken legacy backup", async () => {
    const { name, library, db } = stores();
    const legacyName = `${name}-legacy`;
    databaseNames.push(legacyName);
    const user = createAvatarRepository(name);
    const legacy = new Dexie(legacyName);
    legacy.version(1).stores({ avatars: "id" });
    const old = image("broken-library-legacy-backup");
    await legacy.table("avatars").put({ id: "user", ...old });
    const failedRead = vi.fn(() => Dexie.Promise.reject(new Error("legacy avatar read failed")));
    interceptLegacyReads(legacyName, failedRead);
    await expect(user.load()).rejects.toThrow("legacy avatar read failed");
    expect(failedRead).toHaveBeenCalledTimes(1);
    failedRead.mockClear();

    const entry = await library.import("Healthy library image", image("healthy"));
    expect((await library.list()).map(item => item.id)).toEqual([entry.id]);
    expect(await library.usages(entry.id)).toEqual([]);
    const selected = await library.select(entry.id);
    await library.remove(entry.id);
    expect(await library.list()).toEqual([]);
    expect(await db.userAvatar.get("user")).toBeUndefined();

    const chosen = await library.import("Chosen library image", selected);
    const avatar = await library.select(chosen.id);
    await user.save(avatar);
    await expectImage(await user.load(), avatar);
    expect(await library.usages(chosen.id)).toEqual([{ id: "user", name: "用户头像" }]);
    await library.remove(chosen.id);
    await expectImage(await user.load(), standalone(avatar));
    expect(await library.list()).toEqual([]);
    expect(failedRead).not.toHaveBeenCalled();
    await expectImage(await legacy.table("avatars").get("user"), old);
  });

  it.each(["save", "remove"])("recovers from a failed legacy read with explicit %s without touching the backup", async action => {
    const { name, legacyName, user, db } = stores();
    const old = image("unreadable-legacy-backup");
    const legacy = new Dexie(legacyName);
    legacy.version(1).stores({ avatars: "id" });
    await legacy.table("avatars").put({ id: "user", ...old });
    interceptLegacyReads(legacyName, () => Dexie.Promise.reject(new Error("legacy avatar read failed")));
    await expect(user.load()).rejects.toThrow("legacy avatar read failed");
    expect(await db.userAvatar.get("user")).toBeUndefined();
    const replacement = image("explicit-new-choice");
    if (action === "save") {
      await user.save(replacement);
      await expectImage(await createAvatarRepository(name, legacyName).load(), replacement);
    } else {
      await user.remove();
      expect(await db.userAvatar.get("user")).toEqual({ id: "user" });
      expect(await createAvatarRepository(name, legacyName).load()).toBeUndefined();
    }
    await expectImage(await legacy.table("avatars").get("user"), old);
  });

  it.each(["save", "remove"])("does not let a delayed legacy migration overwrite explicit %s", async action => {
    const { legacyName, user, db } = stores();
    const old = image("delayed-legacy");
    const legacy = new Dexie(legacyName);
    legacy.version(1).stores({ avatars: "id" });
    await legacy.table("avatars").put({ id: "user", ...old });
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const reading = new Promise<void>(resolve => { started = resolve; });
    interceptLegacyReads(legacyName, original => {
      started();
      return Dexie.Promise.resolve(gate).then(original);
    });
    const loading = user.load();
    await reading;
    const replacement = image("new-choice-during-migration");
    if (action === "save") await user.save(replacement);
    else await user.remove();
    release();
    if (action === "save") {
      await expectImage(await loading, replacement);
      await expectImage((await db.userAvatar.get("user"))?.value, replacement);
    } else {
      expect(await loading).toBeUndefined();
      expect(await db.userAvatar.get("user")).toEqual({ id: "user" });
    }
    await expectImage(await legacy.table("avatars").get("user"), old);
  });

  it("migrates exact original bytes and crop once and keeps the removal tombstone across reloads", async () => {
    const { name, legacyName, user, db } = stores();
    const old = image("legacy-exact-original");
    old.crop = { x: 0.17, y: 0.83, zoom: 2.75 };
    const legacy = new Dexie(legacyName);
    legacy.version(1).stores({ avatars: "id" });
    await legacy.table("avatars").put({ id: "user", ...old });
    await expectImage(await user.load(), old);
    await legacy.table("avatars").put({ id: "user", ...image("changed-legacy") });
    await expectImage(await createAvatarRepository(name, legacyName).load(), old);
    await user.remove();
    expect(await db.userAvatar.get("user")).toEqual({ id: "user" });
    expect(await createAvatarRepository(name, legacyName).load()).toBeUndefined();
    expect((await legacy.table("avatars").get("user")).original.size).toBe("changed-legacy".length);
  });

  it("preserves embedded legacy assistant avatars upgrading the shared database from v3 to v4", async () => {
    const { name, workspace, db } = stores();
    const old = image("legacy-assistant");
    old.crop = { x: 0.24, y: 0.76, zoom: 3.5 };
    const legacy = new Dexie(name);
    legacy.version(3).stores({ chats: "id,updatedAt", assistants: "id,sortOrder",
      conversations: "id,assistantId,updatedAt", workspace: "id", legacyConversationConfigs: "id" });
    await legacy.table("assistants").put({ id: "a", sortOrder: 1, ...input(old, "Legacy") });
    legacy.close();
    const restored = await workspace.initializeWorkspace(null, []);
    await expectImage(restored.assistants.find(item => item.id === "a")?.avatar, old);
    await expectImage((await db.assistants.get("a"))?.avatar, old);
    expect(await db.avatarLibrary.count()).toBe(0);
  });
});
