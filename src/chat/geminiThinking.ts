// Protocol options, independent of model IDs. The provider validates compatibility.
export type ThinkingChoice = "default" | "minimal" | "low" | "medium" | "high" | "dynamic" | "off" | "budget";
export interface GeminiThinkingSettings {
  choice: ThinkingChoice;
  budget: string;
  includeSummary: boolean;
}
export const defaultGeminiThinking: GeminiThinkingSettings = { choice: "default", budget: "1024", includeSummary: false };
export const thinkingLabels: Record<ThinkingChoice, string> = {
  default: "默认（由供应商决定）", minimal: "最低（不保证关闭）", low: "低", medium: "中", high: "高",
  dynamic: "动态预算", off: "关闭", budget: "自定义 Token 预算",
};
export const geminiThinkingChoices: ThinkingChoice[] = ["default", "off", "minimal", "low", "medium", "high", "dynamic", "budget"];
export function isGeminiThinkingSettings(value: unknown): value is GeminiThinkingSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<GeminiThinkingSettings>;
  return typeof item.choice === "string" && Object.prototype.hasOwnProperty.call(thinkingLabels, item.choice) &&
    typeof item.budget === "string" && typeof item.includeSummary === "boolean";
}
export function validateGeminiThinking(raw: unknown): string | undefined {
  if (raw === undefined) return;
  if (!isGeminiThinkingSettings(raw)) return "思考配置无效，请重新选择。";
  if (raw.choice === "budget" && (!raw.budget.trim() || !Number.isSafeInteger(Number(raw.budget)))) {
    return "思考预算必须是可精确表示的整数。";
  }
}
export function geminiThinkingBody(settings = defaultGeminiThinking): Record<string, unknown> | undefined {
  const result: Record<string, unknown> = {};
  if (settings.includeSummary) result.includeThoughts = true;
  if (settings.choice === "budget") result.thinkingBudget = Number(settings.budget);
  else if (settings.choice === "off") result.thinkingBudget = 0;
  else if (settings.choice === "dynamic") result.thinkingBudget = -1;
  else if (settings.choice !== "default") result.thinkingLevel = settings.choice;
  return Object.keys(result).length ? result : undefined;
}
