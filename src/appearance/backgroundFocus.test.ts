import { describe, expect, it } from "vitest";
import { normalizeBackgroundFocus, focusFromLegacyCrop } from "./backgroundFocus";

describe("background focus preferences", () => {
  it("allows positions outside the image and rejects invalid numbers", () => {
    expect(normalizeBackgroundFocus({ x: 0, y: 1 })).toEqual({ x: 0, y: 1 });
    expect(normalizeBackgroundFocus({ x: 2, y: 0.5 })).toEqual({ x: 2, y: 0.5 });
    expect(normalizeBackgroundFocus({ x: NaN, y: 0.5 })).toBeNull();
  });
  it("uses the center of an earlier crop", () => {
    expect(focusFromLegacyCrop({ x: 0.1, y: 0.2, width: 0.6, height: 0.4 })).toEqual({ x: 0.4, y: 0.4 });
  });
});
