import type { ChatProtocol } from "./types";
import { dataCheck, dataRecord, migrateData, type DataMigration } from "../storage/dataContract";
import { backupFields } from "../storage/dataContract";
import { dataPolicies } from "../storage/dataPolicies";
import { isGeminiThinkingSettings } from "./geminiThinking";
import { isThinkingSettings } from "./thinking";

export type NumericSetting =
  | { mode: "auto" }
  | { mode: "custom"; value: string };

export type NumericField =
  | "temperature"
  | "topP"
  | "topK"
  | "contextBudget"
  | "maxOutput";

export interface SessionConfig {
  version: 1;
  webSearch?: boolean;
  webSearchProvider?: "native" | import("../search/settings").ExternalSearchProvider;
  geminiThinking?: import("./geminiThinking").GeminiThinkingSettings;
  thinking?: Partial<Record<Exclude<ChatProtocol, "gemini-native">, import("./thinking").ThinkingSettings>>;
  systemInstruction: string;
  temperature: NumericSetting;
  topP: NumericSetting;
  topK: NumericSetting;
  contextBudget: NumericSetting;
  maxOutput: NumericSetting;
  stream: boolean;
  dualSamplingConfirmed: boolean;
  customJson: Record<ChatProtocol, string>;
  invalidStoredConfig?: string;
}

export type ConfigErrors = Partial<Record<NumericField | "systemInstruction" | "stream" | "customJson" | "dualSampling" | "stored" | "thinking", string>>;

const protocols: ChatProtocol[] = [
  "openai-chat",
  "openai-responses",
  "gemini-native",
  "anthropic-native",
];

export function defaultSessionConfig(): SessionConfig {
  return {
    version: 1,
    systemInstruction: "",
    temperature: { mode: "auto" },
    topP: { mode: "auto" },
    topK: { mode: "auto" },
    contextBudget: { mode: "auto" },
    maxOutput: { mode: "auto" },
    stream: true,
    dualSamplingConfirmed: false,
    customJson: {
      "openai-chat": "{}",
      "openai-responses": "{}",
      "gemini-native": "{}",
      "anthropic-native": "{}",
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const sessionDataMigration: DataMigration = { version: 1, oldestVersion: 1, migrations: {} };

/** Strict read used before durable writes and by backup; editable invalid numeric text is preserved. */
export function readSessionConfigData(raw: unknown): SessionConfig {
  if (raw === undefined) return defaultSessionConfig();
  const value = migrateData(raw, sessionDataMigration);
  const required = [
    "systemInstruction", "temperature", "topP", "topK",
    "contextBudget", "maxOutput", "stream", "dualSamplingConfirmed", "customJson",
  ];
  dataCheck(required.every(key => key in value), "已保存的会话配置缺少字段；原数据未被修改。");
  dataRecord(value.customJson);
  dataCheck(Object.keys(value).every(key => backupFields(dataPolicies.session).includes(key)));
  dataCheck(typeof value.systemInstruction === "string" && typeof value.stream === "boolean"
    && typeof value.dualSamplingConfirmed === "boolean");
  dataCheck(Object.keys(value.customJson).every(key => protocols.includes(key as ChatProtocol))
    && protocols.every(key => typeof (value.customJson as Record<string, unknown>)[key] === "string"));
  for (const key of ["temperature", "topP", "topK", "contextBudget", "maxOutput"]) {
    dataRecord(value[key]);
    dataCheck(Object.keys(value[key]).every(field => backupFields(dataPolicies.numeric).includes(field)));
    dataCheck(["auto", "custom"].includes(value[key].mode as string));
    dataCheck(value[key].mode !== "custom" || typeof value[key].value === "string");
  }
  dataCheck(value.webSearch === undefined || typeof value.webSearch === "boolean");
  dataCheck(value.webSearchProvider === undefined || ["native", "exa-mcp", "exa-api", "tavily", "zhipu"].includes(value.webSearchProvider as string));
  dataCheck(value.invalidStoredConfig === undefined || typeof value.invalidStoredConfig === "string");
  if (value.geminiThinking !== undefined) {
    dataRecord(value.geminiThinking);
    dataCheck(Object.keys(value.geminiThinking).every(key => backupFields(dataPolicies.geminiThinking).includes(key))
      && isGeminiThinkingSettings(value.geminiThinking));
  }
  if (value.thinking !== undefined) {
    dataRecord(value.thinking);
    dataCheck(Object.keys(value.thinking).every(key => ["openai-chat", "openai-responses", "anthropic-native"].includes(key)));
    for (const settings of Object.values(value.thinking)) {
      dataRecord(settings);
      dataCheck(Object.keys(settings).every(key => backupFields(dataPolicies.thinking).includes(key)) && isThinkingSettings(settings));
    }
  }
  return value as unknown as SessionConfig;
}

export function restoreSessionConfig(raw: unknown): SessionConfig {
  try { return readSessionConfigData(raw); }
  catch { return { ...defaultSessionConfig(), invalidStoredConfig: "会话配置版本或结构无效；请恢复默认配置。" }; }
}

const ranges: Record<NumericField, { min: number; max: number; integer: boolean }> = {
  temperature: { min: 0, max: 2, integer: false },
  topP: { min: 0, max: 1, integer: false },
  topK: { min: 0, max: Number.MAX_SAFE_INTEGER, integer: true },
  contextBudget: { min: 1, max: 1_000_000, integer: true },
  maxOutput: { min: 1, max: 1_000_000, integer: true },
};

export function numericValue(setting: NumericSetting): number | undefined {
  return setting.mode === "custom" ? Number(setting.value) : undefined;
}

export function validateNumericSetting(field: NumericField, setting: unknown): string | undefined {
  if (!isRecord(setting) || (setting.mode !== "auto" && setting.mode !== "custom")) {
    return "请选择自动或自定义。";
  }
  if (setting.mode === "auto") return undefined;
  if (typeof setting.value !== "string" || !setting.value.trim()) {
    return "请输入数值。";
  }
  const value = Number(setting.value);
  const { min, max, integer } = ranges[field];
  if (!Number.isFinite(value) || (field === "contextBudget" && (value < min || value > max)) || (integer && !Number.isSafeInteger(value))) {
    if (field !== "contextBudget") return integer ? "请输入可精确表示的整数。" : "请输入有限数值。";
    return `请输入 ${min}–${max} ${integer ? "之间的整数" : "之间的数值"}。`;
  }
  return undefined;
}

export function validateSessionConfig(config: SessionConfig, protocol?: ChatProtocol): ConfigErrors {
  const errors: ConfigErrors = {};
  if (config.invalidStoredConfig) errors.stored = config.invalidStoredConfig;
  if (typeof config.systemInstruction !== "string") errors.systemInstruction = "系统指令必须是文本。";
  if (typeof config.stream !== "boolean") errors.stream = "流式开关必须是布尔值。";
  for (const field of Object.keys(ranges) as NumericField[]) {
    const error = validateNumericSetting(field, config[field]);
    if (error) errors[field] = error;
  }
  if (!isRecord(config.customJson) || protocols.some((item) => typeof config.customJson[item] !== "string")) {
    errors.customJson = "四种协议的自定义 JSON 必须分别保存为文本。";
  } else if (protocol) {
    try {
      const parsed: unknown = JSON.parse(config.customJson[protocol]);
      if (!isRecord(parsed)) errors.customJson = "自定义 JSON 必须是对象。";
    } catch {
      errors.customJson = "自定义 JSON 不是有效的 JSON 对象。";
    }
  }
  return errors;
}

export function changeNumericSetting(
  config: SessionConfig,
  field: NumericField,
  setting: NumericSetting,
): SessionConfig {
  return {
    ...config,
    [field]: setting,
    dualSamplingConfirmed:
      field === "temperature" || field === "topP" ? false : config.dualSamplingConfirmed,
  };
}
