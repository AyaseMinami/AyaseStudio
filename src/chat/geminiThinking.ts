// Official GenerateContent thinking table, checked 2026-09-16:
// https://ai.google.dev/gemini-api/docs/generate-content/thinking
// Exact model aliases only: relay names and future models remain unknown.
export type ThinkingChoice = "default" | "minimal" | "low" | "medium" | "high" | "dynamic" | "off" | "budget";
export interface GeminiThinkingSettings {
  choice: ThinkingChoice;
  budget: string;
  includeSummary: boolean;
}
export const defaultGeminiThinking: GeminiThinkingSettings = { choice: "default", budget: "1024", includeSummary: true };
export const thinkingLabels: Record<ThinkingChoice, string> = {
  default: "默认（由模型决定）", minimal: "最低（不保证关闭）", low: "低", medium: "中", high: "高",
  dynamic: "动态预算", off: "关闭", budget: "自定义 Token 预算",
};
interface Capability { choices: ThinkingChoice[]; minBudget?: number; maxBudget?: number }
const levels = (...choices: ThinkingChoice[]): Capability => ({ choices: ["default", ...choices] });
const capabilities: Record<string, Capability> = {
  "gemini-3.8-flash": levels("low", "medium", "high"),
  "gemini-3.7-flash": levels("low", "medium", "high"),
  "gemini-3.6-flash": levels("minimal", "low", "medium", "high"),
  "gemini-3.5-flash": levels("minimal", "low", "medium", "high"),
  "gemini-3.1-pro": levels("low", "medium", "high"),
  "gemini-3.1-pro-preview": levels("low", "medium", "high"),
  "gemini-3-flash-preview": levels("minimal", "low", "medium", "high"),
  "gemini-3-flash": levels("minimal", "low", "medium", "high"),
  "gemini-3.5-flash-lite": levels("minimal", "low", "medium", "high"),
  "gemini-3.1-flash-lite": levels("minimal", "low", "medium", "high"),
  "gemini-3.1-flash-lite-preview": levels("minimal", "low", "medium", "high"),
  "gemini-2.5-pro": { choices: ["default", "dynamic", "budget"], minBudget: 128, maxBudget: 32768 },
  "gemini-2.5-flash": { choices: ["default", "dynamic", "off", "budget"], minBudget: 1, maxBudget: 24576 },
  "gemini-2.5-flash-lite": { choices: ["default", "dynamic", "off", "budget"], minBudget: 512, maxBudget: 24576 },
};
export function geminiThinkingCapability(model: string): Capability | undefined {
  return capabilities[model.replace(/^models\//, "")];
}
export function isGeminiThinkingSettings(value: unknown): value is GeminiThinkingSettings {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<GeminiThinkingSettings>;
  return typeof item.choice === "string" && Object.prototype.hasOwnProperty.call(thinkingLabels, item.choice) &&
    typeof item.budget === "string" && typeof item.includeSummary === "boolean";
}
export function validateGeminiThinking(model: string, raw: unknown): string | undefined {
  if (raw === undefined) return undefined; // Existing assistants use the default.
  if (!isGeminiThinkingSettings(raw)) return "思考配置无效，请重新选择。";
  const capability = geminiThinkingCapability(model);
  if (!(capability?.choices ?? ["default"]).includes(raw.choice)) return "当前模型不支持已保存的思考选项，请使用默认。";
  if (raw.choice === "budget") {
    const budget = Number(raw.budget);
    if (!raw.budget.trim() || !Number.isInteger(budget) || budget < capability!.minBudget! || budget > capability!.maxBudget!)
      return `思考预算必须为 ${capability!.minBudget}–${capability!.maxBudget} 的整数。`;
  }
}
export function geminiThinkingBody(model: string, settings = defaultGeminiThinking): Record<string, unknown> | undefined {
  // Validation at the final request boundary rejects unsupported selections.
  if (!geminiThinkingCapability(model)) return undefined;
  const result: Record<string, unknown> = {};
  if (settings.includeSummary) result.includeThoughts = true;
  if (settings.choice === "budget") result.thinkingBudget = Number(settings.budget);
  else if (settings.choice === "off") result.thinkingBudget = 0;
  else if (settings.choice === "dynamic") result.thinkingBudget = -1;
  else if (settings.choice !== "default") result.thinkingLevel = settings.choice;
  return Object.keys(result).length ? result : undefined;
}
