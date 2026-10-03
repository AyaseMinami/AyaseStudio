// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BackgroundLibraryEntry, BackgroundResource } from "../../appearance/appearance";
import { createAppearanceController } from "../../appearance/appearance";
import { BackgroundLibraryDialog, type BackgroundLibraryDialogProps } from "./BackgroundLibraryDialog";

let root: Root, host: HTMLDivElement, entries: BackgroundLibraryEntry[], props: BackgroundLibraryDialogProps;
const snow: BackgroundLibraryEntry = { id: "snow", name: "雪.webp", reference: "backgrounds/snow.webp", focus: null, fit: "cover", mask: 65, blur: 0 };
const imported: BackgroundResource = { name: "山.webp", reference: "backgrounds/mountain.webp", url: "asset://mountain.webp" };
beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", undefined);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  entries = [snow, { ...snow, id: "moon", name: "月.webp", reference: "backgrounds/moon.webp" }];
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) { this.open = false; });
  props = {
    entries, currentReference: snow.reference, busy: false,
    onPrepare: vi.fn().mockResolvedValue(imported),
    onSave: vi.fn().mockImplementation(async (resource: BackgroundResource, replaceId?: string) => {
      const saved = { ...snow, id: replaceId ?? "mountain", name: resource.name ?? "背景", reference: resource.reference };
      entries = replaceId ? entries.map((entry) => entry.id === replaceId ? saved : entry) : [...entries, saved];
      root.render(<BackgroundLibraryDialog {...props} entries={entries} />);
      return saved;
    }),
    onDiscard: vi.fn().mockResolvedValue(undefined),
    onResolve: vi.fn().mockImplementation(async (reference: string) => ({ reference, url: `asset://${reference}` })),
    onApply: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn().mockImplementation(async (ids: string[]) => { entries = entries.filter((entry) => !ids.includes(entry.id)); root.render(<BackgroundLibraryDialog {...props} entries={entries} />); }),
    onClose: vi.fn(),
  };
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount() { await act(async () => root.render(<BackgroundLibraryDialog {...props} />)); }
async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find((button) => button.textContent === label || button.getAttribute("aria-label") === label);
  expect(button, label).toBeTruthy(); await act(async () => button!.click());
}
async function escape() { await act(async () => host.querySelector("dialog")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))); }

it("reopens using the controller cache and forces a fresh read after image failure", async () => {
  const reference = "backgrounds/00000000-0000-4000-8000-000000000001.png";
  const entry = { ...snow, reference };
  const resolve = vi.fn(async () => ({ reference, url: "asset://snow.png" }));
  const controller = createAppearanceController({
    storage: { getItem: () => JSON.stringify({ backgroundLibrary: [entry] }), setItem() {} },
    target: document.documentElement,
    systemTheme: { isDark: () => false, subscribe: () => () => {} },
    backgroundResources: { resolve, selectAndImport: async () => null, cleanup: async () => {} },
  });
  try {
    await controller.ready;
    props = { ...props, entries: [entry], currentReference: reference, onResolve: controller.resolveLibraryBackground };
    await mount();
    await act(async () => root.render(null));
    await mount();
    expect(host.querySelector('[aria-label="选择 雪.webp"] img')).not.toBeNull();
    expect(resolve).toHaveBeenCalledTimes(2);
    await act(async () => host.querySelector('[aria-label="选择 雪.webp"] img')!.dispatchEvent(new Event("error")));
    await click("重试读取图片");
    expect(resolve).toHaveBeenCalledTimes(3);
  } finally { controller.destroy(); }
});

it("previews a candidate with the shared chat canvas and applies only explicitly", async () => {
  await mount(); expect(host.querySelector('[aria-label="选择 雪.webp"]')?.getAttribute("aria-pressed")).toBe("true");
  await click("选择 雪.webp");
  expect(props.onApply).not.toHaveBeenCalled();
  expect(host.querySelectorAll(".appearance-preview-sidebar")).toHaveLength(2);
  expect(host.querySelector(".appearance-preview-composer")).not.toBeNull();
  expect(host.querySelector('[aria-label="选择 雪.webp"]')?.getAttribute("title")).toBe("雪.webp · 当前背景");
  await click("应用背景"); expect(props.onApply).toHaveBeenCalledWith("snow", { reference: snow.reference, focus: null, fit: "cover", mask: 65, blur: 0 }); expect(props.onClose).toHaveBeenCalledOnce();
});

it("uses only thumbnails for tiles and resolves originals only for the selected candidate", async () => {
  props.currentReference = null;
  vi.mocked(props.onResolve).mockImplementation(async (reference, options) => ({ reference, url: `asset://${options?.thumbnail ? "thumb" : "full"}/${reference}` }));
  await mount();
  expect(vi.mocked(props.onResolve).mock.calls.every(([, options]) => options?.thumbnail)).toBe(true);
  expect([...host.querySelectorAll(".background-library-choice img")].every((img) => img.getAttribute("src")?.includes("/thumb/"))).toBe(true);
  await click("选择 月.webp");
  expect(vi.mocked(props.onResolve).mock.calls.filter(([, options]) => !options?.thumbnail).map(([reference]) => reference)).toEqual([entries[1].reference]);
});

it("can retry an original preview failure while its independent thumbnail remains visible", async () => {
  const images: { onload: (() => void) | null; onerror: (() => void) | null }[] = [];
  vi.stubGlobal("Image", class {
    onload = null; onerror = null; naturalWidth = 1920; naturalHeight = 1080; src = "";
    constructor() { images.push(this); }
  });
  await mount();
  await act(async () => images[images.length - 1].onerror?.());
  expect(host.textContent).toContain("背景原图无法显示");
  expect(host.querySelector('[aria-label="选择 雪.webp"] img')).not.toBeNull();
  expect([...host.querySelectorAll("button")].find((button) => button.textContent === "应用背景")?.disabled).toBe(true);
  await click("重试读取图片");
  expect(props.onResolve).toHaveBeenCalledWith(snow.reference, { refresh: true });
  await act(async () => images[images.length - 1].onload?.());
  expect(host.querySelector(".background-library-preview svg.background-image")).not.toBeNull();
});

it("defers offscreen thumbnail reads and unmounts their pixels when scrolled out", async () => {
  const observed: { element: Element; notify(visible: boolean): void }[] = [];
  vi.stubGlobal("IntersectionObserver", class {
    constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
    observe(element: Element) { observed.push({ element, notify: (visible) => this.callback([{ isIntersecting: visible }]) }); }
    disconnect() {}
  });
  props.currentReference = null;
  await mount(); expect(props.onResolve).not.toHaveBeenCalled();
  await act(async () => observed[0].notify(true));
  expect(props.onResolve).toHaveBeenCalledTimes(1);
  expect(props.onResolve).toHaveBeenCalledWith(snow.reference, { thumbnail: true, refresh: false });
  expect(host.querySelectorAll(".background-library-choice img")).toHaveLength(1);
  await act(async () => observed[0].notify(false));
  expect(host.querySelectorAll(".background-library-choice img")).toHaveLength(0);
});

async function changeInput(label: string, value: string) {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

it("keeps per-image parameter drafts isolated and only submits the applied candidate", async () => {
  await mount();
  await changeInput("背景遮罩强度", "48"); await changeInput("背景模糊程度", "7");
  await click("图片适配方式");
  const fitOption = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === "适应")!;
  expect(fitOption).toBeTruthy();
  await act(async () => fitOption.click());
  expect(host.querySelector<HTMLElement>(".appearance-background-preview")!.style.getPropertyValue("--appearance-background-mask")).toBe("0.48");
  expect(props.onApply).not.toHaveBeenCalled(); expect(props.onSave).not.toHaveBeenCalled();
  expect(entries[0]).toEqual(snow);
  await click("选择 月.webp"); expect(host.querySelector<HTMLInputElement>('[aria-label="背景遮罩强度"]')!.value).toBe("65");
  await changeInput("背景遮罩强度", "55"); await click("选择 雪.webp");
  expect(host.querySelector<HTMLInputElement>('[aria-label="背景遮罩强度"]')!.value).toBe("48");
  await click("应用背景");
  expect(props.onApply).toHaveBeenCalledWith("snow", { reference: snow.reference, fit: "contain", mask: 48, blur: 7, focus: null });
  expect(entries[1].mask).toBe(65);
});

it("resets only draft values and discards all parameter edits on cancel", async () => {
  await mount(); await changeInput("背景遮罩强度", "40"); await changeInput("背景模糊程度", "10");
  await click("恢复背景遮罩强度默认值");
  expect(host.querySelector<HTMLInputElement>('[aria-label="背景遮罩强度"]')!.value).toBe("50");
  expect(host.querySelector<HTMLInputElement>('[aria-label="背景模糊程度"]')!.value).toBe("10");
  await click("取消"); expect(props.onApply).not.toHaveBeenCalled(); expect(props.onSave).not.toHaveBeenCalled();
  await act(async () => root.render(null)); await mount();
  expect(host.querySelector<HTMLInputElement>('[aria-label="背景模糊程度"]')!.value).toBe("0");
});

it("edits focus in the same modal, cancels that subview independently and saves focus only on final Apply", async () => {
  vi.stubGlobal("Image", class {
    naturalWidth = 1600; naturalHeight = 900; onload: (() => void) | null = null; onerror = null;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  });
  await mount(); await changeInput("背景遮罩强度", "50"); await changeInput("背景模糊程度", "10"); await click("调整取景中心");
  expect(host.querySelectorAll("dialog")).toHaveLength(1);
  expect(host.querySelector("dialog")!.style.getPropertyValue("--appearance-background-mask")).toBe("0.5");
  expect(host.querySelector("dialog")!.style.getPropertyValue("--appearance-background-blur")).toBe("10px");
  await changeInput("横向位置", "25"); await escape();
  expect(host.textContent).toContain("应用背景"); expect(props.onClose).not.toHaveBeenCalled();
  expect(document.activeElement?.textContent).toBe("调整取景中心");
  await click("调整取景中心"); expect(host.querySelector<HTMLInputElement>('[aria-label="横向位置"]')!.value).toBe("50");
  await changeInput("横向位置", "30"); await changeInput("图片缩放", "125"); await click("确认取景");
  expect(props.onApply).not.toHaveBeenCalled(); expect(props.onSave).not.toHaveBeenCalled();
  await click("应用背景");
  expect(props.onApply).toHaveBeenCalledWith("snow", expect.objectContaining({ mask: 50, focus: { x: .3, y: .5, zoom: 1.25 } }));
});

it("retains edited parameters after apply failure for retry", async () => {
  vi.mocked(props.onApply).mockRejectedValueOnce(new Error("保存失败"));
  await mount(); await changeInput("背景模糊程度", "9"); await click("应用背景");
  expect(props.onClose).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')?.textContent).toBe("保存失败");
  expect(host.querySelector<HTMLInputElement>('[aria-label="背景模糊程度"]')!.value).toBe("9");
  await click("应用背景"); expect(props.onApply).toHaveBeenLastCalledWith("snow", expect.objectContaining({ blur: 9 }));
});
it("saves imports immediately as a candidate and keeps them on modal cancel", async () => {
  await mount(); await click("导入图片");
  expect(props.onSave).toHaveBeenCalledWith(imported);
  expect(host.querySelector('[aria-label="选择 山.webp"]')?.getAttribute("aria-pressed")).toBe("true");
  expect(props.onApply).not.toHaveBeenCalled(); await click("取消");
  expect(props.onDiscard).not.toHaveBeenCalled(); expect(entries).toHaveLength(3);
});
it("manages independent selections, confirms batch deletion and retains the undeleted candidate", async () => {
  await mount(); await click("选择 雪.webp"); await click("管理");
  expect(host.textContent).not.toContain("应用背景");
  expect(host.querySelector('[aria-label="勾选 雪.webp"]')?.getAttribute("aria-checked")).toBe("false");
  await click("全选"); await click("取消全选"); expect(host.querySelectorAll('[aria-checked="true"]')).toHaveLength(0);
  await click("勾选 月.webp"); await click("删除所选（1）");
  expect(host.textContent).toContain("当前已应用的背景不受影响"); expect(props.onRemove).not.toHaveBeenCalled();
  await click("取消"); expect(host.querySelector('[aria-label="勾选 月.webp"]')?.getAttribute("aria-checked")).toBe("true");
  await click("删除所选（1）"); await click("确认删除"); expect(props.onRemove).toHaveBeenCalledWith(["moon"]);
  await click("完成管理"); expect(host.querySelector('[aria-label="选择 雪.webp"]')?.getAttribute("aria-pressed")).toBe("true");
  expect(props.onApply).not.toHaveBeenCalled();
});
it("keeps failed deletion and apply operations reviewable and retryable", async () => {
  vi.mocked(props.onRemove).mockRejectedValueOnce(new Error("删除失败"));
  vi.mocked(props.onApply).mockRejectedValueOnce(new Error("应用失败"));
  await mount(); await click("选择 雪.webp"); await click("管理"); await click("全选");
  await click("删除所选（2）"); await click("确认删除");
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("删除失败"); expect(entries).toHaveLength(2);
  await escape(); expect(host.querySelectorAll('[aria-checked="true"]')).toHaveLength(2); await escape();
  expect(props.onClose).not.toHaveBeenCalled(); await click("应用背景");
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("应用失败"); expect(props.onClose).not.toHaveBeenCalled();
  await click("应用背景"); expect(props.onClose).toHaveBeenCalledOnce();
});
it("previews replacement, saves explicitly, and retains old entry on failure", async () => {
  vi.mocked(props.onSave).mockRejectedValueOnce(new Error("保存失败"));
  await mount(); await click("选择 雪.webp"); await click("管理"); await click("勾选 雪.webp"); await click("替换图片");
  expect(props.onSave).not.toHaveBeenCalled(); expect(host.querySelector<HTMLImageElement>('[alt="替换图片预览"]')?.src).toBe(imported.url);
  await click("保存替换"); expect(entries[0].reference).toBe(snow.reference);
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("保存失败"); expect(host.textContent).toContain("保存替换");
  await click("保存替换"); expect(props.onSave).toHaveBeenLastCalledWith(imported, "snow");
  expect(props.onApply).not.toHaveBeenCalled(); await click("完成管理");
  expect(host.querySelector('[aria-label="选择 山.webp"]')?.getAttribute("aria-pressed")).toBe("true");
});
it("Escape cancels pending replacement then exits management while keeping the candidate and restores focus on close", async () => {
  const trigger = document.createElement("button"); document.body.append(trigger); trigger.focus();
  await mount(); await click("选择 雪.webp"); await click("管理"); await click("勾选 月.webp"); await click("替换图片");
  await escape(); expect(props.onDiscard).toHaveBeenCalledWith(imported.reference); expect(props.onSave).not.toHaveBeenCalled();
  expect(document.activeElement?.textContent).toBe("替换图片");
  await escape(); expect(host.querySelector('[aria-label="选择 雪.webp"]')?.getAttribute("aria-pressed")).toBe("true");
  expect(props.onClose).not.toHaveBeenCalled(); await escape(); expect(props.onClose).toHaveBeenCalledOnce();
  await act(async () => root.render(null)); expect(document.activeElement).toBe(trigger); trigger.remove();
});
it("retains a failed imported copy for retry without changing the applied background", async () => {
  vi.mocked(props.onSave).mockRejectedValueOnce(new Error("导入失败"));
  await mount(); await click("选择 雪.webp"); await click("导入图片");
  expect(props.onDiscard).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLImageElement>('[alt="导入图片预览"]')?.src).toBe(imported.url);
  await click("保存到背景库"); expect(props.onPrepare).toHaveBeenCalledOnce();
  expect(host.querySelector('[aria-label="选择 山.webp"]')?.getAttribute("aria-pressed")).toBe("true");
  expect(props.onApply).not.toHaveBeenCalled();
});
it("discards an unsaved replacement when its settings surface unmounts", async () => {
  await mount(); await click("管理"); await click("勾选 雪.webp"); await click("替换图片");
  await act(async () => root.render(null)); expect(props.onDiscard).toHaveBeenCalledWith(imported.reference);
});
it("retries unavailable images and does not reread on callback identity changes", async () => {
  vi.mocked(props.onResolve).mockRejectedValueOnce(new Error("图片丢失"));
  await mount(); expect(host.textContent).toContain("图片不可用");
  const nextResolve = vi.fn().mockImplementation(async (reference: string) => ({ reference, url: `asset://${reference}` }));
  await act(async () => root.render(<BackgroundLibraryDialog {...props} onResolve={nextResolve} />));
  expect(nextResolve).not.toHaveBeenCalled();
  await click("重试读取图片"); expect(nextResolve).toHaveBeenCalledWith(snow.reference, { thumbnail: true, refresh: true });
  expect(host.textContent).not.toContain("图片不可用"); expect(host.textContent).not.toContain("重试读取图片");
});
it("returns focus to management after the deletion action becomes disabled", async () => {
  await mount(); await click("管理"); await click("勾选 月.webp"); await click("删除所选（1）"); await click("确认删除");
  expect(document.activeElement?.textContent).toBe("完成管理");
});
it("shows an unavailable placeholder for image decoding failure and supports retry", async () => {
  await mount();
  await act(async () => host.querySelector('[aria-label="选择 雪.webp"] img')!.dispatchEvent(new Event("error")));
  expect(host.querySelector('[aria-label="选择 雪.webp"]')?.textContent).toBe("图片不可用");
  expect([...host.querySelectorAll("button")].find((button) => button.textContent === "应用背景")?.disabled).toBe(false);
  await click("重试读取图片"); expect(host.querySelector('[aria-label="选择 雪.webp"] img')).not.toBeNull();
});

it("does not keep a stale thumbnail retry after deleting the failed entry", async () => {
  await mount();
  await act(async () => host.querySelector('[aria-label="选择 雪.webp"] img')!.dispatchEvent(new Event("error")));
  await click("管理"); await click("勾选 雪.webp"); await click("删除所选（1）"); await click("确认删除");
  expect(host.textContent).not.toContain("重试读取图片");
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
