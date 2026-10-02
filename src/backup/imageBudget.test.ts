import { describe, expect, it } from "vitest";
import { checkImageBudget } from "./imageBudget";
import { decode64 } from "./codec";

function png(w: number, h: number) {
  const bytes = new Uint8Array(33), v = new DataView(bytes.buffer);
  v.setUint32(0, 0x89504e47); v.setUint32(4, 0x0d0a1a0a); v.setUint32(8, 13); v.setUint32(12, 0x49484452); v.setUint32(16, w); v.setUint32(20, h);
  return bytes;
}
describe("predecode image resource budget", () => {
  it("rejects compressed oversized PNG dimensions before a browser decoder can allocate pixels", () => {
    expect(() => checkImageBudget(png(16384, 16384), "image/png")).toThrow("4000 万");
    expect(checkImageBudget(png(256, 256), "image/png")).toEqual({ width: 256, height: 256 });
  });
  it("rejects truncated and zero dimensions", () => {
    expect(() => checkImageBudget(png(0, 1), "image/png")).toThrow();
    expect(() => checkImageBudget(png(1, 1).slice(0, 20), "image/png")).toThrow();
  });
  it("checks JPEG SOF dimensions and segment boundaries", () => {
    const bytes = new Uint8Array([255, 216, 255, 224, 0, 2, 255, 192, 0, 8, 8, 0, 16, 0, 32, 1]);
    expect(checkImageBudget(bytes, "image/jpeg")).toEqual({ width: 32, height: 16 });
    bytes[11] = 63; bytes[13] = 63;
    expect(() => checkImageBudget(bytes, "image/jpeg")).toThrow();
  });
  it("checks WebP VP8X canvas and rejects oversized frame allocation", () => {
    const bytes = new Uint8Array(30), v = new DataView(bytes.buffer);
    v.setUint32(0, 0x52494646); v.setUint32(4, 22, true); v.setUint32(8, 0x57454250); v.setUint32(12, 0x56503858); v.setUint32(16, 10, true);
    expect(checkImageBudget(bytes, "image/webp")).toEqual({ width: 1, height: 1 });
    bytes[24] = 255; bytes[25] = 63; bytes[27] = 255; bytes[28] = 63;
    expect(() => checkImageBudget(bytes, "image/webp")).toThrow();
  });
  it("validates a 12 MiB decoded resource without recursive-regex stack overflow", () => {
    const encoded = "A".repeat(16 * 1024 * 1024);
    expect(decode64(encoded, 48 * 1024 * 1024).length).toBe(12 * 1024 * 1024);
  });
});
