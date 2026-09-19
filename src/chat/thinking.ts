import { defaultGeminiThinking, geminiThinkingCapability, isGeminiThinkingSettings,
  thinkingLabels as geminiLabels, validateGeminiThinking, type ThinkingChoice as GeminiChoice } from "./geminiThinking";
import type { SessionConfig } from "./sessionConfig";
import type { ChatProtocol } from "./types";

export type ThinkingChoice = GeminiChoice | "adaptive" | "xhigh" | "max";
export type ThinkingEffort = "default" | "low" | "medium" | "high" | "xhigh" | "max";
export interface ThinkingSettings {
  choice: ThinkingChoice;
  budget: string;
  includeSummary: boolean;
  effort?: ThinkingEffort;
}
export const defaultThinking: ThinkingSettings = { ...defaultGeminiThinking };
export const thinkingLabels: Record<ThinkingChoice, string> = {
  ...geminiLabels, adaptive: "自动（Adaptive）", xhigh: "超高", max: "最高（Max）",
};
export interface ThinkingCapability {
  choices: ThinkingChoice[];
  minBudget?: number;
  maxBudget?: number;
  summary: boolean;
  summaryHint?: string;
  efforts?: ThinkingEffort[];
}

// Exact official aliases/snapshots only. Sources and checked date: docs/PROTOCOLS.md, Issue #16.
// A protocol-compatible relay name does not establish model capabilities.
const openAI = new Map<string, { choices: ThinkingChoice[]; summary: boolean }>();
function openAIModels(ids: string[], choices: ThinkingChoice[], summary = true) {
  for (const id of ids) openAI.set(id, { choices: ["default", ...choices], summary });
}
openAIModels(["o1", "o1-2024-12-17", "o3-mini", "o3-mini-2025-01-31"], ["low", "medium", "high"], false);
openAIModels(["o3", "o3-2025-04-16", "o4-mini", "o4-mini-2025-04-16"], ["low", "medium", "high"]);
openAIModels(["gpt-5", "gpt-5-2025-08-07", "gpt-5-mini", "gpt-5-mini-2025-08-07",
  "gpt-5-nano", "gpt-5-nano-2025-08-07"], ["minimal", "low", "medium", "high"]);
openAIModels(["gpt-5.1", "gpt-5.1-2025-11-13"], ["off", "low", "medium", "high"]);
openAIModels(["gpt-5.2", "gpt-5.2-2025-12-11", "gpt-5.4", "gpt-5.4-2026-03-05",
  "gpt-5.5", "gpt-5.5-2026-04-23"], ["off", "low", "medium", "high", "xhigh"]);
openAIModels(["gpt-6-astra"], ["low", "medium", "high", "xhigh", "max"]);

const anthropic = new Map<string, ThinkingCapability>();
function claudeModels(ids: string[], choices: ThinkingChoice[], efforts?: ThinkingEffort[]) {
  for (const id of ids) anthropic.set(id, { choices: ["default", ...choices], summary: true,
    ...(choices.includes("budget") ? { minBudget: 1024, maxBudget: 999999 } : {}),
    ...(efforts ? { efforts: ["default", ...efforts] } : {}),
  });
}
claudeModels(["claude-3-7-sonnet-latest", "claude-3-7-sonnet-20250219", "claude-sonnet-4-0",
  "claude-sonnet-4-20250514", "claude-opus-4-0", "claude-opus-4-20250514",
  "claude-opus-4-1", "claude-opus-4-1-20250805", "claude-sonnet-4-5", "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5", "claude-haiku-4-5-20251001"], ["off", "budget"]);
claudeModels(["claude-opus-4-5", "claude-opus-4-5-20251101"], ["off", "budget"], ["low", "medium", "high"]);
claudeModels(["claude-opus-4-6", "claude-sonnet-4-6"], ["off", "adaptive", "budget"], ["low", "medium", "high", "max"]);
claudeModels(["claude-opus-4-7", "claude-opus-4-8"], ["off", "adaptive"], ["low", "medium", "high", "xhigh", "max"]);

export function thinkingCapability(protocol: ChatProtocol, model: string): ThinkingCapability | undefined {
  if (protocol === "gemini-native") {
    const capability = geminiThinkingCapability(model);
    return capability ? { ...capability, summary: true } : undefined;
  }
  if (protocol === "anthropic-native") return anthropic.get(model);
  const capability = openAI.get(model);
  return capability ? { ...capability, summary: protocol === "openai-responses" && capability.summary,
    ...(protocol === "openai-chat" ? { summaryHint: "官方 Chat Completions 不提供可读思考摘要；兼容线路扩展尚未确认。" }
      : !capability.summary ? { summaryHint: "此型号尚未确认支持思考摘要。" } : {}),
  } : undefined;
}

export function getThinkingSettings(config: SessionConfig, protocol: ChatProtocol): ThinkingSettings | undefined {
  return protocol === "gemini-native" ? config.geminiThinking : config.thinking?.[protocol];
}
export function withThinkingSettings(config: SessionConfig, protocol: ChatProtocol, value: ThinkingSettings): SessionConfig {
  if (protocol === "gemini-native") {
    if (!isGeminiThinkingSettings(value)) throw new Error("Gemini 思考配置无效。");
    return { ...config, geminiThinking: { choice: value.choice, budget: value.budget, includeSummary: value.includeSummary } };
  }
  return { ...config, thinking: { ...config.thinking, [protocol]: { ...value } } };
}
export function isThinkingSettings(raw: unknown): raw is ThinkingSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const value = raw as Partial<ThinkingSettings>;
  return typeof value.choice === "string" && Object.prototype.hasOwnProperty.call(thinkingLabels, value.choice) &&
    typeof value.budget === "string" && typeof value.includeSummary === "boolean" &&
    (value.effort === undefined || ["default", "low", "medium", "high", "xhigh", "max"].includes(value.effort));
}
export function validateThinkingSelection(protocol: ChatProtocol, model: string, raw: unknown): string | undefined {
  if (protocol === "gemini-native") return validateGeminiThinking(model, raw);
  if (raw === undefined) return;
  if (!isThinkingSettings(raw)) return "思考配置无效，请重新选择。";
  const capability = thinkingCapability(protocol, model);
  if (!(capability?.choices ?? ["default"]).includes(raw.choice) ||
      (raw.effort && raw.effort !== "default" && !capability?.efforts?.includes(raw.effort))) {
    return "当前模型不支持已保存的思考选项，请使用默认。";
  }
  if (raw.choice === "budget" && (!raw.budget.trim() || !Number.isSafeInteger(Number(raw.budget)) ||
      Number(raw.budget) < capability!.minBudget! || Number(raw.budget) > capability!.maxBudget!)) {
    return `思考预算必须为 ${capability!.minBudget}–${capability!.maxBudget} 的整数，并小于最大输出。`;
  }
}

export function includeThinkingSummary(config: SessionConfig | undefined, protocol: ChatProtocol): boolean {
  return !config || getThinkingSettings(config, protocol)?.includeSummary !== false;
}

// Called only after final request validation. Summary visibility never enables Anthropic thinking.
export function protocolThinkingBody(protocol: ChatProtocol, model: string, config: SessionConfig): Record<string, unknown> {
  const capability = thinkingCapability(protocol, model);
  if (!capability || protocol === "gemini-native") return {};
  const settings = getThinkingSettings(config, protocol) ?? defaultThinking;
  if (protocol === "openai-chat") return settings.choice === "default" ? {} : {
    reasoning_effort: settings.choice === "off" ? "none" : settings.choice,
  };
  if (protocol === "openai-responses") {
    const reasoning = {
      ...(settings.choice !== "default" ? { effort: settings.choice === "off" ? "none" : settings.choice } : {}),
      ...(settings.includeSummary && capability.summary ? { summary: "auto" } : {}),
    };
    return Object.keys(reasoning).length ? { reasoning } : {};
  }
  return {
    ...(settings.choice === "off" ? { thinking: { type: "disabled" } }
      : settings.choice === "adaptive" ? { thinking: { type: "adaptive", display: settings.includeSummary ? "summarized" : "omitted" } }
      : settings.choice === "budget" ? { thinking: { type: "enabled", budget_tokens: Number(settings.budget),
        display: settings.includeSummary ? "summarized" : "omitted" } } : {}),
    ...(settings.effort && settings.effort !== "default" ? { output_config: { effort: settings.effort } } : {}),
  };
}
