import type { ChatProtocol } from "./types";

export type ServiceProtocol = ChatProtocol | "gemini-image" | "openai-images";

export function isDrawingProtocol(protocol: unknown): protocol is "gemini-image" | "openai-images" {
  return protocol === "gemini-image" || protocol === "openai-images";
}

export interface ProtocolOption {
  value: ServiceProtocol;
  label: string;
  hint: string;
}

export const protocolOptions: readonly ProtocolOption[] = [
  {
    value: "openai-images",
    label: "OpenAI 绘图",
    hint: "Images 文生图协议，仅支持 HTTPS；Base URL 通常以 /v1 结尾",
  },
  {
    value: "openai-chat",
    label: "OpenAI Chat",
    hint: "Base URL 通常以 /v1 结尾",
  },
  {
    value: "openai-responses",
    label: "OpenAI Responses",
    hint: "Base URL 通常以 /v1 结尾",
  },
  {
    value: "gemini-native",
    label: "Gemini 聊天",
    hint: "Gemini 聊天协议；填写路由根地址，不包含 /v1beta/models/...",
  },
  {
    value: "gemini-image",
    label: "Gemini 绘图",
    hint: "独立绘图协议，仅支持 HTTPS；填写路由根地址，不包含 /v1beta/models/...",
  },
  {
    value: "anthropic-native",
    label: "Anthropic Native",
    hint: "填写路由根地址，不包含 /v1/messages",
  },
];

export function getProtocolOption(protocol: ServiceProtocol): ProtocolOption {
  return protocolOptions.find((option) => option.value === protocol)!;
}
