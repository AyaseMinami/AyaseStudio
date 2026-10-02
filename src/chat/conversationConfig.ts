import { defaultSessionConfig, restoreSessionConfig, readSessionConfigData, type SessionConfig } from "./sessionConfig";
import { defaultThinking, getThinkingSettings, type ThinkingSettings } from "./thinking";
import type { ChatProtocol } from "./types";
import type { AssistantPreset } from "./workspace";
import { dataCheck, dataRecord, backupFields } from "../storage/dataContract";
import { dataPolicies } from "../storage/dataPolicies";

export type ConfigField = "systemInstruction" | "temperature" | "topP" | "topK" | "contextBudget" | "maxOutput" | "stream" | "webSearch";
type ThinkingFields = { [K in keyof Required<ThinkingSettings> as `thinking.${ChatProtocol}.${K}`]: Required<ThinkingSettings>[K] };
export type OverrideValues = Pick<SessionConfig, ConfigField> & { modelId: string | null }
  & { [K in `customJson.${ChatProtocol}`]: string } & ThinkingFields;
export type OverrideField = keyof OverrideValues;
export interface ConversationOverrides { version: 1; values: Partial<OverrideValues> }
export const configFields: ConfigField[] = ["systemInstruction", "temperature", "topP", "topK", "contextBudget", "maxOutput", "stream", "webSearch"];
export const thinkingFields = ["choice", "budget", "includeSummary", "effort"] as const;
export const configProtocols: ChatProtocol[] = ["openai-chat", "openai-responses", "gemini-native", "anthropic-native"];

export function validOverrides(overrides: unknown): boolean {
  return overrides === undefined || (!!overrides && typeof overrides === "object" && "version" in overrides && overrides.version === 1
    && "values" in overrides && !!overrides.values && typeof overrides.values === "object" && !Array.isArray(overrides.values));
}

export function assertLegacyOverrides(overrides: unknown): void {
  if (overrides === undefined) return;
  dataRecord(overrides);
  dataCheck(overrides.version === 1 && Object.keys(overrides).every(key => ["version", "values"].includes(key)),
    "旧对话配置版本或结构不受支持；原数据未被修改，请升级应用。");
  dataRecord(overrides.values);
  dataCheck(overrides.values.modelId === undefined || overrides.values.modelId === null || typeof overrides.values.modelId === "string",
    "旧对话模型引用结构不受支持；原数据未被修改。");
  const allowed = ["modelId", ...configFields, ...configProtocols.map(protocol => `customJson.${protocol}`),
    ...configProtocols.flatMap(protocol => thinkingFields.map(field => `thinking.${protocol}.${field}`))];
  dataCheck(Object.keys(overrides.values).every(key => allowed.includes(key)), "旧对话配置包含不支持的参数；原数据未被修改。");
}

export function readConversationConfigData(raw: unknown): ConversationConfig {
  dataRecord(raw);
  dataCheck(Object.keys(raw).every(key => backupFields(dataPolicies.conversationConfig).includes(key))
    && "config" in raw && (raw.modelId === null || typeof raw.modelId === "string"),
    "对话配置结构或模型引用不受支持；原数据未被修改。");
  dataCheck(raw.config !== undefined);
  return { modelId: raw.modelId, config: readSessionConfigData(raw.config) };
}

export function hasOverride(overrides: ConversationOverrides | undefined, field: OverrideField): boolean {
  return !!overrides?.values && Object.prototype.hasOwnProperty.call(overrides.values, field);
}

// Legacy sparse configuration is resolved only during one-time conversion.
export function resolveConversationConfig(assistant: AssistantPreset | undefined, overrides?: ConversationOverrides) {
  const config = structuredClone(assistant?.defaultConfig ?? defaultSessionConfig());
  let modelId = assistant?.defaultModelId ?? null;
  if (overrides === undefined) return { config, modelId };
  if (!validOverrides(overrides)) {
    config.invalidStoredConfig = "会话覆盖配置无效，请恢复助手默认值。";
    return { config, modelId: null };
  }
  const values = overrides.values;
  if (hasOverride(overrides, "modelId")) {
    modelId = values.modelId ?? null;
    if (modelId !== null && typeof modelId !== "string") {
      config.invalidStoredConfig = "会话模型引用无效，请重新选择或恢复助手默认值。";
      modelId = null;
    }
  }
  for (const field of configFields) if (hasOverride(overrides, field)) Object.assign(config, { [field]: structuredClone(values[field]) });
  for (const protocol of configProtocols) {
    const jsonField = `customJson.${protocol}` as const;
    if (hasOverride(overrides, jsonField)) config.customJson = { ...config.customJson, [protocol]: values[jsonField] };
    const saved = thinkingFields.filter((field) => hasOverride(overrides, `thinking.${protocol}.${field}`));
    if (!saved.length) continue;
    const thinking = { ...defaultThinking, ...getThinkingSettings(config, protocol) };
    for (const field of saved) Object.assign(thinking, { [field]: values[`thinking.${protocol}.${field}`] });
    if (protocol === "gemini-native") config.geminiThinking = { choice: thinking.choice as NonNullable<SessionConfig["geminiThinking"]>["choice"], budget: thinking.budget, includeSummary: thinking.includeSummary };
    else config.thinking = { ...config.thinking, [protocol]: thinking };
  }
  return { config, modelId };
}


export interface ConversationConfig {
  modelId: string | null;
  config: SessionConfig;
}

export function copyAssistantConfig(assistant?: AssistantPreset): ConversationConfig {
  return { modelId: assistant?.defaultModelId ?? null, config: structuredClone(assistant?.defaultConfig ?? defaultSessionConfig()) };
}

// Live requests never consult the assistant. Missing data is not a fallback route.
export function readConversationConfig(settings: unknown): ConversationConfig {
  if (!settings || typeof settings !== "object" || !("modelId" in settings) || !("config" in settings)
    || (settings.modelId !== null && typeof settings.modelId !== "string") || settings.config === undefined) {
    return { modelId: null, config: { ...defaultSessionConfig(), invalidStoredConfig: "对话设置无效，请恢复助手默认值。" } };
  }
  return { modelId: settings.modelId, config: structuredClone(restoreSessionConfig(settings.config)) };
}
