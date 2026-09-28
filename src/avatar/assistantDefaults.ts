export const assistantAvatarDefaults = [
  { id: "system", label: "系统默认" },
  { id: "blue", label: "晴蓝" },
  { id: "green", label: "青绿" },
  { id: "violet", label: "紫罗兰" },
] as const;

export type AssistantDefaultAvatar = typeof assistantAvatarDefaults[number]["id"];
const preferenceKey = "ayase-studio.assistant-default-avatar";

export function isAssistantDefaultAvatar(value: unknown): value is AssistantDefaultAvatar {
  return assistantAvatarDefaults.some((avatar) => avatar.id === value);
}

export function readAssistantDefaultAvatar(): AssistantDefaultAvatar {
  try {
    const value = localStorage.getItem(preferenceKey);
    return isAssistantDefaultAvatar(value) ? value : "system";
  } catch { return "system"; }
}

export function writeAssistantDefaultAvatar(value: string): void {
  if (!isAssistantDefaultAvatar(value)) return;
  localStorage.setItem(preferenceKey, value);
}
