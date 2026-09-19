import {
  defaultSessionConfig,
  numericValue,
  validateSessionConfig,
  type ConfigErrors,
  type NumericField,
  type SessionConfig,
} from "./sessionConfig";
import type { ChatProtocol, ChatRequest } from "./types";
import { geminiThinkingBody } from "./geminiThinking";
import { getThinkingSettings, thinkingCapability, validateThinkingSelection, protocolThinkingBody } from "./thinking";
import { attachmentCapabilityFailure, safeTextAttachment, type RequestAttachment } from "./attachments";

export class RequestConfigError extends Error {
  constructor(readonly errors: ConfigErrors) {
    super(Object.values(errors)[0] ?? "会话配置无效。");
    this.name = "RequestConfigError";
  }
}

function checkedInlineBody(protocol: ChatProtocol, body: Record<string, unknown>, hasInlineMedia = false): Record<string, unknown> {
  const bytes = new TextEncoder().encode(JSON.stringify(body)).length;
  if (protocol === "gemini-native" && hasInlineMedia && bytes > 20_000_000) {
    throw new RequestConfigError({ customJson: "Gemini 内联附件使整次请求超过官方 20 MB 上限；请减少附件或历史轮次。" });
  }
  if (protocol === "anthropic-native" && bytes > 32_000_000) {
    throw new RequestConfigError({ customJson: "Anthropic 整个请求超过官方 32 MB 上限；请减少附件或历史轮次。" });
  }
  return body;
}

export type ParameterSupport = "supported" | "unsupported" | "unknown";
export interface ParameterCapability {
  support: ParameterSupport;
  reason: string;
}

function isKnownReasoningModel(model: string): boolean {
  return !!thinkingCapability("openai-chat", model) || /^(o1|o3|o4-mini)(?:$|-)/i.test(model) ||
    /^gpt-5(?:$|-(?:mini|nano|pro)(?:$|-)|\.(?:1|2)(?:$|-))/i.test(model) ||
    /^gpt-6-astra(?:$|-)/i.test(model);
}

function isNewAnthropicModel(model: string): boolean {
  return new Set([
    "claude-opus-4-7", "claude-opus-4-8", "claude-opus-5",
    "claude-sonnet-5", "claude-fable-5", "claude-mythos-5",
    "claude-mythos-preview",
  ]).has(model.toLowerCase());
}

export function parameterCapability(
  protocol: ChatProtocol,
  model: string,
  field: NumericField,
  config?: SessionConfig,
): ParameterCapability {
  if (field === "contextBudget") {
    return { support: "supported", reason: "Ayase 本地输入历史预算，不是供应商请求参数。" };
  }
  if (field === "maxOutput") return { support: "supported", reason: "由当前协议映射到输出上限。" };
  if (field === "topK" && (protocol === "openai-chat" || protocol === "openai-responses")) {
    return { support: "unsupported", reason: "OpenAI API 不提供 Top-K 请求字段。" };
  }
  if (protocol === "anthropic-native" && isNewAnthropicModel(model) &&
      (field === "temperature" || field === "topP" || field === "topK")) {
    return { support: "unsupported", reason: "Anthropic 此模型已弃用采样参数；请使用自动。" };
  }
  if ((protocol === "openai-chat" || protocol === "openai-responses") &&
      isKnownReasoningModel(model) && (field === "temperature" || field === "topP")) {
    // GPT-5.1/5.2/5.4 document sampling at explicit none; do not infer it for other models.
    if (config && ["gpt-5.1", "gpt-5.1-2025-11-13", "gpt-5.2", "gpt-5.2-2025-12-11",
      "gpt-5.4", "gpt-5.4-2026-03-05"].includes(model) &&
        getThinkingSettings(config, protocol)?.choice === "off") {
      return { support: "supported", reason: "此模型显式关闭推理时支持采样参数。" };
    }
    return { support: "unsupported", reason: "此 OpenAI 推理模型不支持自定义采样参数。" };
  }
  if (protocol === "gemini-native" && field === "topK") {
    return { support: "unknown", reason: /^gemini-3(?:$|[.-])/i.test(model)
      ? "Google 建议 Gemini 3.x 使用自动采样；Top-K 能力仍取决于模型元数据，请自行确认。"
      : "Top-K 取决于模型元数据；当前模型目录未保存该能力，发送前请自行确认。" };
  }
  if (protocol === "gemini-native" && /^gemini-3(?:$|[.-])/i.test(model) &&
      (field === "temperature" || field === "topP")) {
    return { support: "unknown", reason: "Google 建议 Gemini 3.x 使用自动采样；当前模型目录未保存具体能力。" };
  }
  if (!model.trim()) return { support: "unknown", reason: "尚未选择模型。" };
  return { support: "unknown", reason: "当前模型目录只有身份信息；具体模型能力未知。" };
}

const safeCustomFields: Record<ChatProtocol, Record<string, "integer" | "number" | "stop" | "metadata" | "gemini-config">> = {
  "openai-chat": { seed: "integer", presence_penalty: "number", frequency_penalty: "number", stop: "stop" },
  "openai-responses": { metadata: "metadata" },
  "gemini-native": { generationConfig: "gemini-config" },
  "anthropic-native": { stop_sequences: "stop" },
};

const protectedNames = new Set([
  "model", "models", "messages", "message", "input", "contents", "content", "parts",
  "system", "systeminstruction", "instructions", "stream", "streaming", "maxoutputtokens",
  "maxcompletiontokens", "maxtokens", "store", "previousresponseid", "conversation",
  "background", "tools", "toolchoice", "functioncall", "functions", "paralleltoolcalls",
  "baseurl", "url", "headers", "apikey", "key", "generationconfigtemperature",
  "generationconfigtopp", "generationconfigtopk", "generationconfigmaxoutputtokens",
  "truncate", "truncation", "cachedcontent", "sessionresumption",
]);

function canonical(name: string): string {
  return name.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkProtected(value: unknown, path: string[] = []): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => checkProtected(item, [...path, String(index)]));
  } else if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      const next = [...path, key];
      const joined = next.map(canonical).join("");
      if (protectedNames.has(canonical(key)) || protectedNames.has(joined)) {
        throw new RequestConfigError({ customJson: `自定义 JSON 的 ${next.join(".")} 是受保护字段。` });
      }
      checkProtected(child, next);
    }
  }
}

function validStops(value: unknown): boolean {
  const items = typeof value === "string" ? [value] : value;
  return Array.isArray(items) && items.length > 0 && items.length <= 5 &&
    items.every((item) => typeof item === "string" && item.length > 0 && item.length <= 200);
}

export function parseCustomBody(protocol: ChatProtocol, json: string): Record<string, unknown> {
  let body: unknown;
  try {
    body = JSON.parse(json);
  } catch {
    throw new RequestConfigError({ customJson: "自定义 JSON 不是有效的 JSON 对象。" });
  }
  if (!isRecord(body)) throw new RequestConfigError({ customJson: "自定义 JSON 必须是对象。" });
  checkProtected(body);
  for (const [key, value] of Object.entries(body)) {
    const kind = safeCustomFields[protocol][key];
    if (!kind) throw new RequestConfigError({ customJson: `当前协议不允许自定义字段 ${key}。` });
    if (kind === "integer" && (!Number.isInteger(value) || (value as number) < 0)) {
      throw new RequestConfigError({ customJson: `${key} 必须是非负整数。` });
    }
    if (kind === "number" && (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 2)) {
      throw new RequestConfigError({ customJson: `${key} 必须是 -2 至 2 的数值。` });
    }
    if (kind === "stop" && !validStops(value)) {
      throw new RequestConfigError({ customJson: `${key} 必须是非空文本或最多五条非空文本。` });
    }
    if (kind === "metadata" && (!isRecord(value) || Object.keys(value).length > 16 ||
      Object.values(value).some((item) => typeof item !== "string"))) {
      throw new RequestConfigError({ customJson: "metadata 必须是最多 16 个文本键值。" });
    }
    if (kind === "gemini-config") {
      if (!isRecord(value) || Object.keys(value).some((item) => item !== "stopSequences" && item !== "seed")) {
        throw new RequestConfigError({ customJson: "Gemini generationConfig 只允许 stopSequences 与 seed。" });
      }
      if (value.stopSequences !== undefined && !validStops(value.stopSequences)) {
        throw new RequestConfigError({ customJson: "stopSequences 必须是最多五条非空文本。" });
      }
      if (value.seed !== undefined && (!Number.isInteger(value.seed) || (value.seed as number) < 0)) {
        throw new RequestConfigError({ customJson: "seed 必须是非负整数。" });
      }
    }
  }
  return body;
}

export function validateRequestConfig(config: SessionConfig, protocol: ChatProtocol, model: string): ConfigErrors {
  const errors = validateSessionConfig(config, protocol);
  const thinking = getThinkingSettings(config, protocol);
  const thinkingError = validateThinkingSelection(protocol, model, thinking);
  if (thinkingError) errors.thinking = thinkingError;
  if (config.thinking !== undefined && (!config.thinking || typeof config.thinking !== "object" || Array.isArray(config.thinking))) {
    errors.thinking = "思考配置无效，请恢复默认配置。";
  }
  if (protocol === "anthropic-native" && !thinkingError && thinking &&
      (thinking.choice === "budget" || thinking.choice === "adaptive")) {
    if (thinking.choice === "budget" && Number(thinking.budget) >= (numericValue(config.maxOutput) ?? 4096)) {
      errors.thinking = "思考预算必须小于最大输出（自动模式为 4096），请调整预算或最大输出。";
    }
    if (config.temperature?.mode === "custom" && numericValue(config.temperature) !== 1) {
      errors.temperature = "Anthropic 开启思考时 Temperature 只能省略或为 1，请调整配置。";
    }
    if (config.topK?.mode === "custom") errors.topK = "Anthropic 开启思考时不能设置 Top-K。";
    if (config.topP?.mode === "custom" && numericValue(config.topP)! < 0.95) {
      errors.topP = "Anthropic 开启思考时 Top-P 必须为 0.95–1。";
    }
  }
  if (protocol === "anthropic-native" && config.temperature?.mode === "custom" &&
      !errors.temperature && numericValue(config.temperature)! > 1) {
    errors.temperature = "Anthropic Temperature 范围为 0–1。";
  }
  for (const field of ["temperature", "topP", "topK"] as NumericField[]) {
    if (config[field]?.mode === "custom" && parameterCapability(protocol, model, field, config).support === "unsupported") {
      errors[field] = parameterCapability(protocol, model, field, config).reason;
    }
  }
  if (!errors.customJson && typeof config.customJson?.[protocol] === "string") {
    try {
      const custom = parseCustomBody(protocol, config.customJson[protocol]);
      if (isKnownReasoningModel(model) &&
          (protocol === "openai-chat" || protocol === "openai-responses") &&
          Object.keys(custom).some((key) => key !== "metadata")) {
        errors.customJson = "当前 OpenAI 推理模型的补充采样字段能力未知；请移除这些自定义字段。";
      }
    }
    catch (error) {
      if (error instanceof RequestConfigError) errors.customJson = error.message;
      else throw error;
    }
  }
  return errors;
}

export function buildProtocolBody(protocol: ChatProtocol, request: ChatRequest): Record<string, unknown> {
  if (request.maxOutputTokens !== undefined &&
      (!Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens < 1 || request.maxOutputTokens > 1_000_000)) {
    throw new RequestConfigError({ maxOutput: "内部输出上限必须是 1–1000000 的整数。" });
  }
  const config = request.config ?? defaultSessionConfig();
  const errors = validateRequestConfig(config, protocol, request.model);
  if (Object.keys(errors).length) throw new RequestConfigError(errors);
  const stream = config.stream;
  const temperature = numericValue(config.temperature);
  const topP = numericValue(config.topP);
  const topK = numericValue(config.topK);
  const maxOutput = request.maxOutputTokens ?? numericValue(config.maxOutput);
  const thinking = getThinkingSettings(config, protocol);
  if (protocol === "anthropic-native" && thinking?.choice === "budget" && Number(thinking.budget) >= (maxOutput ?? 4096)) {
    throw new RequestConfigError({ thinking: "思考预算必须小于本次请求的最大输出。" });
  }
  const thinkingBody = protocolThinkingBody(protocol, request.model, config);
  const custom = parseCustomBody(protocol, config.customJson[protocol]);
  const system = [
    ...request.messages.filter((message) => message.role === "system").map((message) => message.content),
    config.systemInstruction.trim(),
  ].filter(Boolean).join("\n\n");
  const messages = request.messages.filter((message) => message.role !== "system");
  function readyAttachments(message: (typeof messages)[number]): RequestAttachment[] {
    return (message.attachments ?? []).map((attachment) => {
      if (!("data" in attachment)) {
        throw new RequestConfigError({ customJson: "附件内容尚未加载，未发送请求。" });
      }
      return attachment;
    });
  }
  function documentText(attachment: RequestAttachment): string {
    return `附件 ${JSON.stringify(attachment.name)}（${attachment.mimeType}）的 UTF-8 内容：\n${safeTextAttachment(attachment.data)}`;
  }
  const mapped = messages.map((message) => ({ message, attachments: readyAttachments(message) }));
  const inlineAttachments = mapped.flatMap(({ attachments }) => attachments);
  if (protocol === "openai-chat" || protocol === "openai-responses") {
    const files = inlineAttachments.filter((item) => item.mimeType === "application/pdf");
    if (files.some((item) => item.size >= 50_000_000) ||
      files.reduce((sum, item) => sum + item.size, 0) > 50_000_000) {
      throw new RequestConfigError({ customJson: "OpenAI 文件输入要求单个 PDF 小于 50 MB、请求内所有文件合计不超过 50 MB。" });
    }
  }
  const hasInlineMedia = mapped.some(({ attachments }) => attachments.some((item) => !item.mimeType.startsWith("text/")));
  if (protocol === "anthropic-native" && mapped.some(({ attachments }) =>
    attachments.some((item) => item.mimeType.startsWith("image/") && item.data.length > 10_000_000))) {
    throw new RequestConfigError({ customJson: "Anthropic 内联图片的 Base64 数据不能超过官方 10 MB 上限；请减少图片大小。" });
  }
  const capabilityError = attachmentCapabilityFailure(protocol, request.model,
    inlineAttachments);
  if (capabilityError) throw new RequestConfigError({ customJson: capabilityError });
  if (protocol === "openai-chat") {
    return checkedInlineBody(protocol, {
      ...custom,
      ...thinkingBody,
      model: request.model,
      messages: system ? [{ role: "system", content: system }, ...mapped.map(({ message, attachments }) => ({
        role: message.role,
        content: !attachments.length ? message.content : [
          { type: "text", text: message.content },
          ...attachments.map((item) => item.mimeType.startsWith("text/")
            ? { type: "text", text: documentText(item) }
            : item.mimeType === "application/pdf"
              ? { type: "file", file: { filename: item.name, file_data: `data:application/pdf;base64,${item.data}` } }
              : { type: "image_url", image_url: { url: `data:${item.mimeType};base64,${item.data}` } }),
        ],
      }))] : mapped.map(({ message, attachments }) => ({
        role: message.role,
        content: !attachments.length ? message.content : [
          { type: "text", text: message.content },
          ...attachments.map((item) => item.mimeType.startsWith("text/")
            ? { type: "text", text: documentText(item) }
            : item.mimeType === "application/pdf"
              ? { type: "file", file: { filename: item.name, file_data: `data:application/pdf;base64,${item.data}` } }
              : { type: "image_url", image_url: { url: `data:${item.mimeType};base64,${item.data}` } }),
        ],
      })),
      stream,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(topP !== undefined ? { top_p: topP } : {}),
      ...(maxOutput !== undefined ? { max_completion_tokens: maxOutput } : {}),
    });
  }
  if (protocol === "openai-responses") {
    return checkedInlineBody(protocol, {
      ...custom,
      ...thinkingBody,
      model: request.model,
      input: mapped.map(({ message, attachments }) => ({ role: message.role,
        content: !attachments.length ? message.content : [
          { type: "input_text", text: message.content },
          ...attachments.map((item) => item.mimeType.startsWith("text/")
            ? { type: "input_text", text: documentText(item) }
            : item.mimeType === "application/pdf"
              ? { type: "input_file", filename: item.name, file_data: `data:application/pdf;base64,${item.data}` }
              : { type: "input_image", image_url: `data:${item.mimeType};base64,${item.data}` }),
        ] })),
      ...(system ? { instructions: system } : {}),
      store: false,
      stream,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(topP !== undefined ? { top_p: topP } : {}),
      ...(maxOutput !== undefined ? { max_output_tokens: maxOutput } : {}),
    });
  }
  if (protocol === "gemini-native") {
    const customGeneration = isRecord(custom.generationConfig) ? custom.generationConfig : {};
    const thinkingConfig = geminiThinkingBody(request.model, config.geminiThinking);
    const generationConfig = {
      ...customGeneration,
      ...(thinkingConfig ? { thinkingConfig } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(topP !== undefined ? { topP } : {}),
      ...(topK !== undefined ? { topK } : {}),
      ...(maxOutput !== undefined ? { maxOutputTokens: maxOutput } : {}),
    };
    return checkedInlineBody(protocol, {
      contents: mapped.map(({ message, attachments }) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }, ...attachments.map((item) => item.mimeType.startsWith("text/")
          ? { text: documentText(item) } : { inlineData: { mimeType: item.mimeType, data: item.data } })],
      })),
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
    }, hasInlineMedia);
  }
  const body = {
    ...custom,
    ...thinkingBody,
    model: request.model,
    max_tokens: maxOutput ?? 4096,
    stream,
    ...(system ? { system } : {}),
    messages: mapped.map(({ message, attachments }) => ({ role: message.role,
      content: !attachments.length ? message.content : [
        { type: "text", text: message.content },
        ...attachments.map((item) => item.mimeType.startsWith("text/")
          ? { type: "text", text: documentText(item) }
          : { type: item.mimeType === "application/pdf" ? "document" : "image",
            source: { type: "base64", media_type: item.mimeType, data: item.data } }),
      ] })),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(topP !== undefined ? { top_p: topP } : {}),
    ...(topK !== undefined ? { top_k: topK } : {}),
  };
  return checkedInlineBody(protocol, body);
}
