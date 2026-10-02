import { dataCheck } from "../storage/dataContract";

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

/** The existing empty selection means automatic; no new persisted enum or mode. */
export function readAssistantAvatarSelection(value: { icon?: unknown; defaultAvatar?: unknown }) {
  dataCheck(value.icon === undefined || typeof value.icon === "string", "助手头像结构不受支持；原数据已保留。");
  dataCheck(value.defaultAvatar === undefined || isAssistantDefaultAvatar(value.defaultAvatar), "助手头像选择不受支持；原数据已保留。");
  return structuredClone({ icon: value.icon ?? "", defaultAvatar: value.defaultAvatar });
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
