/// <reference lib="es2022.intl" />

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const backgrounds = ["#275dad", "#287052", "#7951a8", "#a34462", "#976021", "#236e80"] as const;

/** Derived display only: renaming changes the initial, never the identity color. */
export function automaticAvatar(assistantName = "", assistantId = "") {
  const first = segmenter.segment(assistantName.trim())[Symbol.iterator]().next().value?.segment ?? "";
  const initial = first.replace(/^[a-z]/, (letter) => letter.toUpperCase());
  let hash = 2166136261;
  for (const character of assistantId) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619) >>> 0;
  return { initial, background: backgrounds[hash % backgrounds.length], color: "#ffffff" };
}
