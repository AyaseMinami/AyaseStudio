import { describe, expect, it, vi } from "vitest";
import { createAppearanceController, type BackgroundResourceStore, type ThemeTarget } from "./appearance";

const refs = [1, 2, 3, 4].map((n) => `backgrounds/00000000-0000-4000-8000-00000000000${n}.png`);
function harness(initial: unknown = null) {
  let saved = initial === null ? null : JSON.stringify(initial);
  let failSave = false;
  let nextImport = 0;
  const files = new Set(refs);
  const storage = { getItem: () => saved, setItem: (_key: string, value: string) => {
    if (failSave) throw new Error("disk full"); saved = value;
  } };
  const resources: BackgroundResourceStore = {
    selectAndImport: vi.fn(async () => { const reference = refs[nextImport++]; files.add(reference); return { reference, url: `asset://${reference}`, name: `图 ${nextImport}` }; }),
    resolve: vi.fn(async (reference) => { if (!files.has(reference)) throw new Error("missing"); return { reference, url: `asset://${reference}` }; }),
    cleanup: vi.fn(async (retained) => { for (const ref of files) if (!retained.includes(ref)) files.delete(ref); }),
  };
  const target: ThemeTarget = { style: { colorScheme: "", removeProperty() {}, setProperty() {} }, removeAttribute() {}, setAttribute() {} };
  const create = () => createAppearanceController({ storage, backgroundResources: resources, target, systemTheme: { isDark: () => false, subscribe: () => () => {} } });
  const controller = create();
  return { controller, resources, files, create, storage, fail(value = true) { failSave = value; }, saved: () => saved };
}
async function add(h: ReturnType<typeof harness>, replaceId?: string) {
  const resource = await h.controller.prepareLibraryBackground();
  return h.controller.saveLibraryBackground(resource!, replaceId);
}

describe("background library lifecycle", () => {
  it("keeps thumbnail and original caches separate and cleans both after deletion", async () => {
    const h = harness(); await h.controller.ready; const a = await add(h);
    vi.mocked(h.resources.resolve).mockImplementation(async (reference, options) => {
      if (!h.files.has(reference)) throw new Error("missing");
      return { reference, url: options?.thumbnail ? "asset://thumbnail.png" : "asset://original.png" };
    });
    expect((await h.controller.resolveLibraryBackground(a.reference, { thumbnail: true })).url).toBe("asset://thumbnail.png");
    expect((await h.controller.resolveLibraryBackground(a.reference)).url).toBe("asset://original.png");
    await h.controller.resolveLibraryBackground(a.reference, { thumbnail: true });
    expect(h.resources.resolve).toHaveBeenCalledTimes(2);
    await h.controller.applyLibraryBackground(a.id);
    expect(h.controller.getSnapshot().backgroundUrl).toBe("asset://original.png");
    const b = await add(h); await h.controller.applyLibraryBackground(b.id);
    await h.controller.removeLibraryBackgrounds([a.id]);
    await expect(h.controller.resolveLibraryBackground(a.reference, { thumbnail: true })).rejects.toThrow("missing");
    await expect(h.controller.resolveLibraryBackground(a.reference)).rejects.toThrow("missing");
  });

  it("does not cache failures and lets retry bypass a previously successful preview", async () => {
    const h = harness(); await h.controller.ready; const a = await add(h);
    await h.controller.resolveLibraryBackground(a.reference);
    h.files.delete(a.reference);
    await expect(h.controller.resolveLibraryBackground(a.reference, { refresh: true })).rejects.toThrow("missing");
    h.files.add(a.reference);
    await h.controller.resolveLibraryBackground(a.reference);
    expect(h.resources.resolve).toHaveBeenCalledTimes(3);
  });

  it("still validates application and clears stale preview results on failure", async () => {
    const h = harness(); await h.controller.ready; const a = await add(h);
    await h.controller.resolveLibraryBackground(a.reference); h.files.delete(a.reference);
    await expect(h.controller.applyLibraryBackground(a.id)).rejects.toThrow("missing");
    await expect(h.controller.resolveLibraryBackground(a.reference)).rejects.toThrow("missing");
    expect(h.controller.getSnapshot().backgroundReference).toBeNull();
  });

  it("evicts deleted images and starts a new cache after controller recreation", async () => {
    const h = harness(); await h.controller.ready; const a = await add(h);
    await h.controller.resolveLibraryBackground(a.reference);
    const restarted = h.create(); await restarted.ready;
    await restarted.resolveLibraryBackground(a.reference);
    expect(h.resources.resolve).toHaveBeenCalledTimes(2);
    restarted.destroy();
    await h.controller.removeLibraryBackgrounds([a.id]);
    await expect(h.controller.resolveLibraryBackground(a.reference)).rejects.toThrow("missing");
  });

  it("does not let an older failed read evict a newer refresh", async () => {
    const h = harness(); await h.controller.ready; const a = await add(h);
    let rejectOld!: (error: Error) => void;
    vi.mocked(h.resources.resolve).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }));
    const old = h.controller.resolveLibraryBackground(a.reference);
    const failed = expect(old).rejects.toThrow("old read");
    await h.controller.resolveLibraryBackground(a.reference, { refresh: true });
    rejectOld(new Error("old read")); await failed;
    await h.controller.resolveLibraryBackground(a.reference);
    expect(h.resources.resolve).toHaveBeenCalledTimes(2);
  });

  it("reuses successful preview reads across openings and shares concurrent reads", async () => {
    const h = harness(); await h.controller.ready; const a = await add(h);
    await Promise.all([h.controller.resolveLibraryBackground(a.reference), h.controller.resolveLibraryBackground(a.reference)]);
    await h.controller.resolveLibraryBackground(a.reference);
    expect(h.resources.resolve).toHaveBeenCalledTimes(1);
  });

  it("atomically saves candidate parameters and applies them without touching other pictures or globals", async () => {
    const h = harness(); await h.controller.ready; const a = await add(h); const b = await add(h);
    h.controller.setAccentColor("#abcdef"); h.controller.setSidebarTransparency(21);
    const save = vi.spyOn(h.storage, "setItem");
    await h.controller.applyLibraryBackground(a.id, { reference: a.reference, focus: { x: .2, y: 1.1, zoom: 2 }, fit: "contain", mask: 48, blur: 7 });
    expect(save).toHaveBeenCalledOnce();
    expect(h.controller.getSnapshot()).toMatchObject({ backgroundReference: a.reference, backgroundFit: "contain", backgroundMask: 48, backgroundBlur: 7, backgroundFocus: { x: .2, y: 1.1, zoom: 2 }, accentColor: "#abcdef", sidebarTransparency: 21 });
    expect(h.controller.getSnapshot().backgroundLibrary.find((entry) => entry.id === b.id)).toEqual(b);
    const restarted = h.create(); await restarted.ready;
    await restarted.applyLibraryBackground(b.id); await restarted.applyLibraryBackground(a.id);
    expect(restarted.getSnapshot()).toMatchObject({ backgroundFit: "contain", backgroundMask: 48, backgroundBlur: 7, backgroundFocus: { x: .2, y: 1.1, zoom: 2 } });
  });

  it("preserves a zero mask through apply, restart and image switching", async () => {
    const h = harness(); await h.controller.ready; const a = await add(h); const b = await add(h);
    expect(a.mask).toBe(50);
    await h.controller.applyLibraryBackground(a.id, { ...a, mask: 0 });
    const restarted = h.create(); await restarted.ready;
    expect(restarted.getSnapshot().backgroundMask).toBe(0);
    await restarted.applyLibraryBackground(b.id); await restarted.applyLibraryBackground(a.id);
    expect(restarted.getSnapshot().backgroundMask).toBe(0);
  });

  it("leaves library and applied parameters unchanged when saving candidate edits fails", async () => {
    const h = harness(); await h.controller.ready; const a = await add(h); const b = await add(h);
    await h.controller.applyLibraryBackground(a.id); const before = h.saved(); h.fail();
    await expect(h.controller.applyLibraryBackground(b.id, { reference: b.reference, focus: null, fit: "contain", mask: 40, blur: 8 })).rejects.toThrow("无法保存");
    expect(h.saved()).toBe(before);
    expect(h.controller.getSnapshot()).toMatchObject({ backgroundReference: a.reference, backgroundMask: 50, backgroundBlur: 0 });
    expect(h.controller.getSnapshot().backgroundLibrary.find((entry) => entry.id === b.id)).toEqual(b);
  });

  it("rejects stale image-version edits and invalid parameters without applying or saving", async () => {
    const h = harness(); await h.controller.ready; const a = await add(h); await h.controller.applyLibraryBackground(a.id);
    const replacement = await add(h, a.id); const before = h.saved();
    await expect(h.controller.applyLibraryBackground(a.id, { ...a, mask: 45 })).rejects.toThrow("已被替换");
    await expect(h.controller.applyLibraryBackground(a.id, { ...replacement, blur: NaN })).rejects.toThrow("参数无效");
    expect(h.saved()).toBe(before); expect(h.controller.getSnapshot().backgroundReference).toBe(a.reference);
  });

  it("imports independently, preserves unused entries on restart, and applies only explicitly", async () => {
    const h = harness(); await h.controller.ready;
    const a = await add(h); const b = await add(h);
    expect(h.controller.getSnapshot().backgroundReference).toBeNull();
    const restarted = h.create(); await restarted.ready;
    expect(restarted.getSnapshot().backgroundLibrary.map((entry) => entry.id)).toEqual([a.id, b.id]);
    expect(h.files).toEqual(new Set([a.reference, b.reference]));
    await restarted.applyLibraryBackground(b.id);
    expect(restarted.getSnapshot().backgroundReference).toBe(b.reference);
  });

  it("restores per-image parameters without changing global theme or transparency", async () => {
    const h = harness(); await h.controller.ready;
    const a = await add(h); const b = await add(h);
    await h.controller.applyLibraryBackground(a.id);
    h.controller.setBackgroundFit("contain"); h.controller.setBackgroundMask(40); h.controller.setBackgroundBlur(8);
    h.controller.editBackgroundFocus(); await h.controller.confirmBackgroundFocus({ x: -.2, y: 1.4, zoom: .75 });
    h.controller.setUnifiedThemeColor("#abcdef"); h.controller.setSidebarTransparency(23);
    await h.controller.applyLibraryBackground(b.id);
    expect(h.controller.getSnapshot()).toMatchObject({ backgroundFit: "cover", backgroundMask: 50, backgroundBlur: 0, backgroundFocus: null });
    await h.controller.applyLibraryBackground(a.id);
    expect(h.controller.getSnapshot()).toMatchObject({ backgroundFit: "contain", backgroundMask: 40, backgroundBlur: 8,
      backgroundFocus: { x: -.2, y: 1.4, zoom: .75 }, accentColor: "#abcdef", sidebarTransparency: 23 });
  });

  it("replaces only the library image, retains applied version and crop, then frees it after explicit application", async () => {
    const h = harness(); await h.controller.ready; const a = await add(h);
    await h.controller.applyLibraryBackground(a.id);
    h.controller.setBackgroundMask(45); h.controller.editBackgroundFocus();
    await h.controller.confirmBackgroundFocus({ x: .2, y: .6, zoom: 2 });
    const replacement = await add(h, a.id);
    expect(replacement).toMatchObject({ id: a.id, reference: refs[1], mask: 45, focus: null });
    expect(h.controller.getSnapshot()).toMatchObject({ backgroundReference: a.reference, backgroundFocus: { x: .2, y: .6, zoom: 2 } });
    h.controller.setBackgroundMask(70);
    expect(h.controller.getSnapshot().backgroundLibrary[0].mask).toBe(45);
    expect(h.files.has(a.reference)).toBe(true);
    await h.controller.applyLibraryBackground(a.id);
    expect(h.controller.getSnapshot()).toMatchObject({ backgroundReference: replacement.reference, backgroundFocus: null, backgroundMask: 45 });
    expect(h.files.has(a.reference)).toBe(false);
  });

  it("batch deletion preserves the current image and allows recropping, disable, restart and restore", async () => {
    const h = harness(); await h.controller.ready; const a = await add(h); const b = await add(h);
    await h.controller.applyLibraryBackground(a.id);
    await h.controller.removeLibraryBackgrounds([a.id, b.id, a.id]);
    expect(h.controller.getSnapshot().backgroundLibrary).toEqual([]);
    expect(h.files).toEqual(new Set([a.reference]));
    h.controller.editBackgroundFocus(); await h.controller.confirmBackgroundFocus({ x: .3, y: .8, zoom: 1.3 });
    await h.controller.removeBackground();
    const restarted = h.create(); await restarted.ready;
    expect(restarted.getSnapshot()).toMatchObject({ backgroundEnabled: false, backgroundReference: a.reference, backgroundUrl: null });
    await restarted.restoreBackground();
    expect(restarted.getSnapshot()).toMatchObject({ backgroundStatus: "ready", backgroundFocus: { x: .3, y: .8, zoom: 1.3 } });
  });

  it("resets colors and disables background while retaining library and current parameters", async () => {
    const h = harness(); await h.controller.ready; const a = await add(h);
    await h.controller.applyLibraryBackground(a.id); h.controller.setBackgroundBlur(12); h.controller.setAccentColor("#abcdef");
    await h.controller.resetCustomAppearance();
    expect(h.controller.getSnapshot()).toMatchObject({ accentColor: null, backgroundEnabled: false, backgroundBlur: 12 });
    expect(h.controller.getSnapshot().backgroundLibrary[0].blur).toBe(12);
    await h.controller.restoreBackground(); expect(h.controller.getSnapshot().backgroundBlur).toBe(12);
  });

  it("preserves complete legacy background parameters without making a second file copy", async () => {
    const h = harness({ backgroundReference: refs[0], backgroundFocus: { x: .1, y: .9, zoom: 3 }, backgroundFit: "contain", backgroundMask: 37, backgroundBlur: 9 });
    await h.controller.ready;
    expect(h.controller.getSnapshot().backgroundLibrary).toEqual([{ id: refs[0], reference: refs[0], name: "原有背景", focus: { x: .1, y: .9, zoom: 3 }, fit: "contain", mask: 37, blur: 9 }]);
    expect(h.resources.selectAndImport).not.toHaveBeenCalled();
    await h.controller.removeBackground(); const restarted = h.create(); await restarted.ready;
    expect(restarted.getSnapshot().backgroundLibrary).toHaveLength(1);
  });

  it("rolls back whole batch on metadata failure and validates all IDs before deletion", async () => {
    const h = harness(); await h.controller.ready; const a = await add(h); const b = await add(h);
    const before = h.saved();
    await expect(h.controller.removeLibraryBackgrounds([a.id, "missing"])).rejects.toThrow();
    h.fail(); await expect(h.controller.removeLibraryBackgrounds([a.id, b.id])).rejects.toThrow("无法保存");
    expect(h.saved()).toBe(before); expect(h.controller.getSnapshot().backgroundLibrary).toHaveLength(2);
    expect(h.files).toEqual(new Set([a.reference, b.reference]));
    h.fail(false); await h.controller.removeLibraryBackgrounds([a.id, b.id]); expect(h.files.size).toBe(0);
  });

  it("retains a failed replacement draft for retry and never applies it", async () => {
    const h = harness(); await h.controller.ready; const a = await add(h); await h.controller.applyLibraryBackground(a.id);
    const pending = (await h.controller.prepareLibraryBackground())!;
    h.fail(); await expect(h.controller.saveLibraryBackground(pending, a.id)).rejects.toThrow();
    expect(h.controller.getSnapshot().backgroundLibrary[0].reference).toBe(a.reference);
    expect(h.controller.getSnapshot().backgroundReference).toBe(a.reference);
    expect(h.files.has(pending.reference)).toBe(true);
    h.fail(false); await h.controller.saveLibraryBackground(pending, a.id);
    expect(h.controller.getSnapshot().backgroundLibrary[0].reference).toBe(pending.reference);
  });

  it("does not change the applied background or parameters after failed apply, disable or parameter save", async () => {
    const h = harness(); await h.controller.ready; const a = await add(h); const b = await add(h);
    await h.controller.applyLibraryBackground(a.id); h.fail();
    await expect(h.controller.applyLibraryBackground(b.id)).rejects.toThrow();
    await h.controller.removeBackground(); h.controller.setBackgroundBlur(15);
    expect(h.controller.getSnapshot()).toMatchObject({ backgroundReference: a.reference, backgroundEnabled: true, backgroundBlur: 0, backgroundStatus: "ready" });
  });

  it("protects pending imports from cleanup and discards only the cancelled draft", async () => {
    const h = harness(); await h.controller.ready; const a = await add(h);
    const pending = (await h.controller.prepareLibraryBackground())!;
    await h.controller.removeLibraryBackgrounds([a.id]);
    expect(h.files).toEqual(new Set([pending.reference]));
    await h.controller.discardLibraryBackground(pending.reference); expect(h.files.size).toBe(0);
  });

  it("reports cleanup failure as saved, retains files and retries at next startup", async () => {
    const h = harness(); await h.controller.ready; const a = await add(h);
    vi.mocked(h.resources.cleanup).mockRejectedValueOnce(new Error("locked file"));
    await h.controller.removeLibraryBackgrounds([a.id]);
    expect(h.controller.getSnapshot().backgroundLibrary).toEqual([]);
    expect(h.controller.getSnapshot().backgroundError).toContain("更改已保存");
    expect(h.files.has(a.reference)).toBe(true);
    const restarted = h.create(); await restarted.ready; expect(h.files.size).toBe(0);
  });

  it("missing resources do not block startup or wipe library/current metadata", async () => {
    const h = harness(); await h.controller.ready; const a = await add(h); await h.controller.applyLibraryBackground(a.id);
    h.files.delete(a.reference); const before = h.saved(); const restarted = h.create(); await restarted.ready;
    expect(restarted.getSnapshot()).toMatchObject({ backgroundStatus: "error", backgroundUrl: null, backgroundReference: a.reference });
    expect(restarted.getSnapshot().backgroundLibrary).toHaveLength(1); expect(h.saved()).toBe(before);
    await expect(restarted.applyLibraryBackground(a.id)).rejects.toThrow("missing");
  });

  it("does not clean files when persisted metadata is corrupt", async () => {
    const h = harness({ backgroundLibrary: [{ id: "bad", reference: "not-a-reference" }] }); await h.controller.ready;
    expect(h.resources.cleanup).not.toHaveBeenCalled(); expect(h.files.size).toBe(4);
  });

  it("blocks mutations during native import so cleanup cannot race the new copy", async () => {
    const h = harness(); await h.controller.ready;
    let finish!: (value: null) => void;
    vi.mocked(h.resources.selectAndImport).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const importing = h.controller.prepareLibraryBackground();
    await expect(h.controller.removeLibraryBackgrounds([])).rejects.toThrow("正在处理");
    finish(null); await importing; expect(h.controller.getSnapshot().backgroundBusy).toBe(false);
  });
});
