export interface ColorPresetPalette {
  accent: string;
  canvas: string;
  userBubble: string;
  assistantBubble: string;
}

// Stable IDs also preserve the existing default/reading preferences.
export const colorPresets = [
  { id: "default", label: "晴蓝", description: "清爽蓝色与中性画布",
    light: { accent: "#2563eb", canvas: "#fafafa", userBubble: "#d2e3f7", assistantBubble: "#f2f2f2" },
    dark: { accent: "#93c5fd", canvas: "#0c0a09", userBubble: "#93c5fd", assistantBubble: "#292524" } },
  { id: "reading", label: "纸页", description: "柔和纸色与低饱和蓝灰",
    light: { accent: "#2563eb", canvas: "#f7f7f5", userBubble: "#eef2f6", assistantBubble: "#f0f0ed" },
    dark: { accent: "#c4b99e", canvas: "#181714", userBubble: "#d5cdbb", assistantBubble: "#2a2823" } },
  { id: "sage", label: "青竹", description: "宁静青绿与浅雾绿底色",
    light: { accent: "#287052", canvas: "#f5f8f5", userBubble: "#d6e9da", assistantBubble: "#eaf0e9" },
    dark: { accent: "#97c9ab", canvas: "#101914", userBubble: "#acd5b9", assistantBubble: "#23332a" } },
  { id: "ocean", label: "海盐", description: "清透青蓝与冷调灰白",
    light: { accent: "#126d87", canvas: "#f3f8fa", userBubble: "#d1e9f0", assistantBubble: "#e7f0f3" },
    dark: { accent: "#83cddd", canvas: "#10191e", userBubble: "#a2d7e2", assistantBubble: "#20313a" } },
  { id: "violet", label: "鸢尾", description: "淡雅紫色与柔雾灰底色",
    light: { accent: "#7050a0", canvas: "#f8f6fb", userBubble: "#e5dcf3", assistantBubble: "#eeebf4" },
    dark: { accent: "#c0a7e6", canvas: "#19151f", userBubble: "#cebae9", assistantBubble: "#30273b" } },
  { id: "rose", label: "蔷薇", description: "柔和玫瑰色与暖白画布",
    light: { accent: "#a34465", canvas: "#fcf6f7", userBubble: "#f2dce4", assistantBubble: "#f4e9ed" },
    dark: { accent: "#e3a0b8", canvas: "#201519", userBubble: "#ebbbcb", assistantBubble: "#3b272f" } },
  { id: "amber", label: "琥珀", description: "温暖茶金与奶油底色",
    light: { accent: "#875514", canvas: "#fbf8f1", userBubble: "#f2e3c3", assistantBubble: "#f2eddf" },
    dark: { accent: "#e1bd79", canvas: "#1d1810", userBubble: "#e8cd98", assistantBubble: "#352c1e" } },
] as const satisfies readonly { id: string; label: string; description: string; light: ColorPresetPalette; dark: ColorPresetPalette }[];

export type ColorPreset = (typeof colorPresets)[number]["id"];

export function isColorPreset(value: unknown): value is ColorPreset {
  return colorPresets.some(preset => preset.id === value);
}

export function getColorPresetPalette(id: ColorPreset, theme: "light" | "dark"): ColorPresetPalette {
  return (colorPresets.find(preset => preset.id === id) ?? colorPresets[0])[theme];
}
