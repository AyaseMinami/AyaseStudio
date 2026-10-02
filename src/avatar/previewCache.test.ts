// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AvatarPreviewCache } from "./previewCache";

const caches: AvatarPreviewCache[] = [];
function cache(count = 32, bytes = 8 * 1024 * 1024) {
  const value = new AvatarPreviewCache(count, bytes); caches.push(value); return value;
}
const image = (content: string, type = "image/png") => new Blob([content], { type });
beforeEach(() => {
  let serial = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:cache-${++serial}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLImageElement.prototype, "decode").mockResolvedValue();
});
afterEach(() => { for (const value of caches.splice(0)) value.dispose(); vi.restoreAllMocks(); });

it("deduplicates cloned bytes and concurrent owners, including separate Blob instances", async () => {
  const value = cache();
  const blob = image("first");
  const [first, second] = await Promise.all([value.acquire(blob), value.acquire(blob.slice(0, blob.size, blob.type))]);
  expect(first.url).toBe(second.url);
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  expect(HTMLImageElement.prototype.decode).toHaveBeenCalledTimes(1);
  first.release(); first.release(); value.clearUnused();
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  second.release();
  const remounted = await value.acquire(image("first"));
  expect(remounted.url).toBe(first.url);
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  remounted.release(); value.clearUnused();
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(first.url);
});

it("distinguishes changed bytes even with equal size/type, and distinguishes MIME", async () => {
  const value = cache();
  const first = await value.acquire(image("aaaa"));
  const changed = await value.acquire(image("bbbb"));
  const otherType = await value.acquire(image("aaaa", "image/jpeg"));
  expect(new Set([first.url, changed.url, otherType.url]).size).toBe(3);
  first.release(); changed.release(); otherType.release();
});

it("waits for actual decoding before handing a URL to callers", async () => {
  let finish!: () => void;
  vi.mocked(HTMLImageElement.prototype.decode).mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const value = cache();
  let published = false;
  const pending = value.acquire(image("pending")).then(lease => { published = true; return lease; });
  await vi.waitFor(() => expect(finish).toBeDefined());
  expect(published).toBe(false);
  finish(); const lease = await pending;
  expect(published).toBe(true); lease.release();
});

it("revokes failed decodes without caching the failure and allows a later retry", async () => {
  const value = cache();
  vi.mocked(HTMLImageElement.prototype.decode).mockRejectedValueOnce(new Error("corrupt"));
  await expect(value.acquire(image("retry"))).rejects.toThrow("corrupt");
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:cache-1");
  const retried = await value.acquire(image("retry"));
  expect(retried.url).toBe("blob:cache-2"); retried.release();
});

it("handles object URL creation failure without poisoning the key", async () => {
  const value = cache();
  vi.mocked(URL.createObjectURL).mockImplementationOnce(() => { throw new Error("URL"); });
  const blob = image("retry");
  await expect(value.acquire(blob)).rejects.toThrow("URL");
  const retried = await value.acquire(blob);
  expect(retried.url).toBe("blob:cache-1"); retried.release();
});

it("evicts least recently used idle entries while preserving active leases", async () => {
  const value = cache(1);
  const active = await value.acquire(image("active"));
  const first = await value.acquire(image("first")); first.release();
  const second = await value.acquire(image("second")); second.release();
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(first.url);
  value.clearUnused();
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(active.url);
  active.release();
});

it("counts decoded pixels toward the idle byte budget", async () => {
  vi.mocked(HTMLImageElement.prototype.decode).mockImplementation(function (this: HTMLImageElement) {
    Object.defineProperty(this, "naturalWidth", { value: 100 });
    Object.defineProperty(this, "naturalHeight", { value: 100 });
    return Promise.resolve();
  });
  const value = cache(32, 1000);
  const large = await value.acquire(image("tiny compressed image"));
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  large.release();
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(large.url);
});

it("disposal clears idle URLs and defers active/pending revocation until release", async () => {
  const value = cache();
  const idle = await value.acquire(image("idle")); idle.release();
  const active = await value.acquire(image("active"));
  let finish!: () => void;
  vi.mocked(HTMLImageElement.prototype.decode).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const pending = value.acquire(image("pending"));
  await vi.waitFor(() => expect(finish).toBeDefined());
  value.dispose();
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(idle.url);
  active.release(); finish(); const late = await pending; late.release();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
  await expect(value.acquire(image("new"))).rejects.toThrow("disposed");
});
