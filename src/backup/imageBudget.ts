import { check } from "./codec";

// Parse dimensions before Image.decode, so compressed images cannot force a
// large pixel allocation before the resource budget rejects them.
export function checkImageBudget(bytes: Uint8Array<ArrayBuffer>, mime: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0;
  if (mime === "image/png") {
    check(bytes.length >= 33 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a
      && view.getUint32(8) === 13 && view.getUint32(12) === 0x49484452, "备份 PNG 图片头损坏。");
    width = view.getUint32(16); height = view.getUint32(20);
  } else if (mime === "image/jpeg") {
    check(bytes.length >= 4 && view.getUint16(0) === 0xffd8);
    let offset = 2;
    while (offset + 3 < bytes.length) {
      check(bytes[offset++] === 255);
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++]!;
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd8) continue;
      check(offset + 2 <= bytes.length); const length = view.getUint16(offset);
      check(length >= 2 && offset + length <= bytes.length);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        check(length >= 8); height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break;
      }
      offset += length;
    }
  } else if (mime === "image/webp") {
    check(bytes.length >= 20 && view.getUint32(0) === 0x52494646 && view.getUint32(8) === 0x57454250 && view.getUint32(4, true) + 8 === bytes.length);
    const u24 = (offset: number) => bytes[offset]! + bytes[offset + 1]! * 256 + bytes[offset + 2]! * 65536;
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const chunk = view.getUint32(offset), size = view.getUint32(offset + 4, true); offset += 8;
      check(size <= bytes.length - offset);
      if (chunk === 0x56503858) { check(size === 10); width = u24(offset + 4) + 1; height = u24(offset + 7) + 1; break; }
      if (chunk === 0x5650384c) { check(size >= 5 && bytes[offset] === 0x2f); width = 1 + bytes[offset + 1]! + ((bytes[offset + 2]! & 63) << 8);
        height = 1 + (bytes[offset + 2]! >> 6) + (bytes[offset + 3]! << 2) + ((bytes[offset + 4]! & 15) << 10); break; }
      if (chunk === 0x56503820) { check(size >= 10 && bytes[offset + 3] === 0x9d && bytes[offset + 4] === 1 && bytes[offset + 5] === 0x2a);
        width = view.getUint16(offset + 6, true) & 16383; height = view.getUint16(offset + 8, true) & 16383; break; }
      offset += size + (size & 1);
    }
  }
  check(width > 0 && height > 0 && width <= 16384 && height <= 16384 && width * height <= 40_000_000, "备份图片尺寸无效或超过 4000 万像素预算。");
  return { width, height };
}
