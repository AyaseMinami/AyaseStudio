import { defaultGeminiThinking, geminiThinkingChoices, isGeminiThinkingSettings,
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
export interface ThinkingOptions {
  choices: ThinkingChoice[];
  summary: boolean;
  summaryHint?: string;
  efforts?: ThinkingEffort[];
}

// These describe wire formats, not a list of permitted model IDs.
export function thinkingOptions(protocol: ChatProtocol): ThinkingOptions {
  if (protocol === "gemini-native") return { choices: geminiThinkingChoices, summary: true };
  if (protocol === "anthropic-native") return {
    choices: ["default", "off", "adaptive", "budget"], summary: true,
    efforts: ["default", "low", "medium", "high", "xhigh", "max"],
  };
  return {
    choices: ["default", "off", "minimal", "low", "medium", "high", "xhigh", "max"],
    summary: true,
    ...(protocol === "openai-chat" ? { summaryHint: "显示兼容服务返回的思考内容；OpenAI 官方 Chat Completions 不保证返回此内容。" } : {}),
    ...(protocol === "openai-responses" ? { summaryHint: "显示服务返回的思考摘要或思考文本；OpenAI 官方模型通常仅提供摘要。" } : {}),
  };
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

// Preserve protocol-local values only while their controls remain available across the switch.
export function switchThinkingProtocol(config: SessionConfig, from: ChatProtocol | undefined, to: ChatProtocol): SessionConfig {
  if (from === to) return config;
  const source = from ? thinkingOptions(from) : undefined;
  const target = thinkingOptions(to);
  let next = config;
  for (const protocol of from ? [from, to] : [to]) {
    const saved = getThinkingSettings(next, protocol);
    if (!saved) continue;
    const choiceAvailable = source?.choices.includes(saved.choice) && target.choices.includes(saved.choice);
    next = withThinkingSettings(next, protocol, {
      ...saved,
      choice: choiceAvailable ? saved.choice : "default",
      budget: source?.choices.includes("budget") && target.choices.includes("budget") ? saved.budget : "",
      includeSummary: !!source?.summary && target.summary && saved.includeSummary,
      ...(protocol === "anthropic-native" ? { effort: source?.efforts && target.efforts ? saved.effort : "default" } : {}),
    });
  }
  return next;
}
export function isThinkingSettings(raw: unknown): raw is ThinkingSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const value = raw as Partial<ThinkingSettings>;
  return typeof value.choice === "string" && Object.prototype.hasOwnProperty.call(thinkingLabels, value.choice) &&
    typeof value.budget === "string" && typeof value.includeSummary === "boolean" &&
    (value.effort === undefined || ["default", "low", "medium", "high", "xhigh", "max"].includes(value.effort));
}
export function validateThinkingSelection(protocol: ChatProtocol, raw: unknown): string | undefined {
  if (protocol === "gemini-native") return validateGeminiThinking(raw);
  if (raw === undefined) return;
  if (!isThinkingSettings(raw)) return "思考配置无效，请重新选择。";
  const options = thinkingOptions(protocol);
  if (!options.choices.includes(raw.choice) ||
      (raw.effort && raw.effort !== "default" && !options.efforts?.includes(raw.effort))) {
    return "思考选项无法映射到当前协议，请重新选择。";
  }
  if (raw.choice === "budget" && (!raw.budget.trim() || !Number.isSafeInteger(Number(raw.budget)))) {
    return "思考预算必须是可精确表示的整数。";
  }
}

export function includeThinkingSummary(config: SessionConfig | undefined, protocol: ChatProtocol): boolean {
  return config !== undefined && getThinkingSettings(config, protocol)?.includeSummary === true;
}

// Called only after final request validation. Summary visibility never enables Anthropic thinking.
export function protocolThinkingBody(protocol: ChatProtocol, config: SessionConfig): Record<string, unknown> {
  if (protocol === "gemini-native") return {};
  const settings = getThinkingSettings(config, protocol) ?? defaultThinking;
  if (protocol === "openai-chat") return settings.choice === "default" ? {} : {
    reasoning_effort: settings.choice === "off" ? "none" : settings.choice,
  };
  if (protocol === "openai-responses") {
    const reasoning = {
      ...(settings.choice !== "default" ? { effort: settings.choice === "off" ? "none" : settings.choice } : {}),
      ...(settings.includeSummary ? { summary: "auto" } : {}),
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
