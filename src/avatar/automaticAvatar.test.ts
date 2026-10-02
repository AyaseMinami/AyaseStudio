import { expect, it } from "vitest";
import { automaticAvatar } from "./automaticAvatar";

it.each([
  ["  晴天  ", "晴"], ["alice", "A"], ["Bob", "B"], ["7days", "7"],
  ["éclair", "é"], ["e\u0301clair", "E\u0301"], ["👩🏽‍💻助手", "👩🏽‍💻"],
  ["🇨🇳助手", "🇨🇳"], ["𠮷野", "𠮷"], ["   ", ""],
])("uses the complete first grapheme of %s", (name, initial) => {
  expect(automaticAvatar(name, "same-assistant").initial).toBe(initial);
});

it("keeps colors stable through renames and derives colors from identity", () => {
  expect(automaticAvatar("Alice", "assistant-a").background).toBe(automaticAvatar("晴", "assistant-a").background);
  expect(automaticAvatar("Alice", "assistant-a")).toEqual(automaticAvatar("Alice", "assistant-a"));
  expect(new Set(Array.from({ length: 20 }, (_, index) => automaticAvatar("same", `id-${index}`).background)).size).toBeGreaterThan(1);
  expect(automaticAvatar().initial).toBe("");
});

it("maintains readable foreground contrast for every identity palette color", () => {
  const colors = new Set(Array.from({ length: 100 }, (_, index) => automaticAvatar("A", `id-${index}`).background));
  expect(colors.size).toBe(6);
  for (const background of colors) {
    const channels = [1, 3, 5].map((start) => parseInt(background.slice(start, start + 2), 16) / 255)
      .map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    expect(1.05 / (luminance + .05)).toBeGreaterThanOrEqual(4.5);
  }
});
