import type { ChatProtocol } from "./types";

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
  geminiThinking?: import("./geminiThinking").GeminiThinkingSettings;
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

export function restoreSessionConfig(raw: unknown): SessionConfig {
  if (raw === undefined) return defaultSessionConfig();
  if (!isRecord(raw) || raw.version !== 1) {
    return {
      ...defaultSessionConfig(),
      invalidStoredConfig: "会话配置版本或结构无效；请恢复默认配置。",
    };
  }
  const required = [
    "systemInstruction", "temperature", "topP", "topK",
    "contextBudget", "maxOutput", "stream", "dualSamplingConfirmed", "customJson",
  ];
  if (required.some((key) => !(key in raw)) || !isRecord(raw.customJson)) {
    return {
      ...defaultSessionConfig(),
      invalidStoredConfig: "已保存的会话配置缺少字段；请恢复默认配置。",
    };
  }
  return raw as unknown as SessionConfig;
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
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    if (field === "topK") return "请输入非负安全整数；模型允许范围取决于供应商能力。";
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
  if (
    config.temperature?.mode === "custom" &&
    config.topP?.mode === "custom" &&
    config.dualSamplingConfirmed !== true
  ) {
    errors.dualSampling = "Temperature 与 Top-P 通常二选一；请明确选择继续。";
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
