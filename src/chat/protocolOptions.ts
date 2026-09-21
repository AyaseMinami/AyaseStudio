import type { ChatProtocol } from "./types";

export interface ProtocolOption {
  value: ChatProtocol;
  label: string;
  hint: string;
}

export const protocolOptions: readonly ProtocolOption[] = [
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
    label: "Gemini Native",
    hint: "填写路由根地址，不包含 /v1beta/models/...",
  },
  {
    value: "anthropic-native",
    label: "Anthropic Native",
    hint: "填写路由根地址，不包含 /v1/messages",
  },
];

export function getProtocolOption(protocol: ChatProtocol): ProtocolOption {
  return protocolOptions.find((option) => option.value === protocol)!;
}
