/// <reference lib="es2022.intl" />

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const palettes = [
  { background: "#e2ecf8", color: "#234e8c" },
  { background: "#e0f0e8", color: "#1f5b43" },
  { background: "#ece5f7", color: "#583a84" },
  { background: "#f7e4ea", color: "#8a2d4c" },
  { background: "#f5ebd8", color: "#784912" },
  { background: "#dff0f3", color: "#195866" },
] as const;

/** Derived display only: renaming changes the initial, never the identity color. */
export function automaticAvatar(assistantName = "", assistantId = "") {
  const first = segmenter.segment(assistantName.trim())[Symbol.iterator]().next().value?.segment ?? "";
  const initial = first.replace(/^[a-z]/, (letter) => letter.toUpperCase());
  let hash = 2166136261;
  for (const character of assistantId) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619) >>> 0;
  const palette = palettes[hash % palettes.length];
  return { initial, background: palette.background, color: palette.color };
}
