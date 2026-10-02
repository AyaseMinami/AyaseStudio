import { describe, expect, it, vi } from "vitest";
import { ImageGenerationError, normalizeImageResponseData } from "./imageResponse";

const maxBytes = 32 * 1024 * 1024;
const maxEncoded = Math.ceil(maxBytes / 3) * 4;

describe("bounded image response normalization", () => {
  it.each(["image/png", "image/jpeg", "image/webp"])("normalizes matching %s wrappers and CR/LF without decoding", mime => {
    expect(normalizeImageResponseData(`data:${mime};base64,\rAQ\nID\r\n`, mime)).toEqual({ data: "AQID", bytes: 3 });
    expect(normalizeImageResponseData("AQ\r\nI=", mime)).toEqual({ data: "AQI=", bytes: 2 });
    expect(normalizeImageResponseData("AQ==", mime)).toEqual({ data: "AQ==", bytes: 1 });
  });
  it.each(["data:image/gif;base64,AQID", "data:text/plain;base64,AQID", "data:image/png,AQID",
    "data:image/png;charset=utf-8;base64,AQID", "data:image/png;BASE64,AQID", "data:image/png;base64,AQID,",
    "data:image/jpeg;base64,AQID", "AQ ID", "AQ\tID", "AQID\v", "AQ-ID", "AQ_ID", "AQID=", "A===", "AA=A",
    "A", "AA", "AAA", "AB==", "AAF=", "////=", "", "\r\n"])("rejects malformed/noncanonical data: %j", raw => {
    expect(() => normalizeImageResponseData(raw, "image/png")).toThrow(ImageGenerationError);
  });
  it.each([null, 5, undefined, "image/gif", "IMAGE/PNG"])("rejects invalid declared MIME %j", mime => {
    expect(() => normalizeImageResponseData("AQID", mime)).toThrow(ImageGenerationError);
  });
  it("rejects excessive raw input before allocating a normalized replacement", () => {
    const replace = vi.spyOn(String.prototype, "replace");
    try {
      expect(() => normalizeImageResponseData("\n".repeat(maxEncoded * 2 + 24), "image/png")).toThrow(ImageGenerationError);
      expect(replace).not.toHaveBeenCalled();
    } finally { replace.mockRestore(); }
  });
  it("allows bounded CR/LF overhead but still enforces normalized encoded and decoded limits", () => {
    const maximum = "A".repeat(maxEncoded - 1) + "=";
    expect(normalizeImageResponseData(`data:image/jpeg;base64,${maximum}\r\n`, "image/jpeg")).toEqual({ data: maximum, bytes: maxBytes });
    expect(normalizeImageResponseData("AQID" + "\n".repeat(maxEncoded), "image/png")).toEqual({ data: "AQID", bytes: 3 });
    expect(() => normalizeImageResponseData("A".repeat(maxEncoded), "image/png")).toThrow(ImageGenerationError);
    expect(() => normalizeImageResponseData("A".repeat(maxEncoded + 4), "image/png")).toThrow(ImageGenerationError);
  });
});
