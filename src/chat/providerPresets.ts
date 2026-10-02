import type { BrandId } from "../avatar/brandIds";
import type { ServiceProtocol } from "./protocolOptions";

export type ProviderTemplateId = BrandId | "custom";
export interface ConnectionTemplate { name: string; protocol: ServiceProtocol; baseUrl: string; catalogHint?: string; manualCatalog?: boolean }
export interface ProviderTemplate { id: ProviderTemplateId; label: string; providerName: string; connections: readonly ConnectionTemplate[] }

const connection = (name: string, protocol: ServiceProtocol, baseUrl: string): ConnectionTemplate => ({ name, protocol, baseUrl });
export const providerTemplates: readonly ProviderTemplate[] = [
  { id: "openai", label: "OpenAI", providerName: "OpenAI", connections: [connection("OpenAI Chat", "openai-chat", "https://api.openai.com/v1"), connection("OpenAI Responses", "openai-responses", "https://api.openai.com/v1"), connection("OpenAI 绘图", "openai-images", "https://api.openai.com/v1")] },
  { id: "anthropic", label: "Anthropic", providerName: "Anthropic", connections: [connection("Anthropic Native", "anthropic-native", "https://api.anthropic.com"), { ...connection("Anthropic Chat 兼容", "openai-chat", "https://api.anthropic.com/v1"), catalogHint: "官方 Chat 兼容层主要用于测试比较；模型目录鉴权与原生接口不同，获取失败时请手动添加。" }] },
  { id: "gemini", label: "Google", providerName: "Google", connections: [connection("Gemini 聊天", "gemini-native", "https://generativelanguage.googleapis.com"), connection("Gemini 绘图", "gemini-image", "https://generativelanguage.googleapis.com"), connection("Gemini Chat 兼容", "openai-chat", "https://generativelanguage.googleapis.com/v1beta/openai")] },
  { id: "xai", label: "xAI", providerName: "xAI", connections: [connection("Grok Chat", "openai-chat", "https://api.x.ai/v1"), connection("Grok Responses", "openai-responses", "https://api.x.ai/v1"), connection("Grok 绘图", "grok-images", "https://api.x.ai/v1")] },
  { id: "openrouter", label: "OpenRouter", providerName: "OpenRouter", connections: [connection("OpenRouter Chat", "openai-chat", "https://openrouter.ai/api/v1"), connection("OpenRouter Responses", "openai-responses", "https://openrouter.ai/api/v1")] },
  { id: "deepseek", label: "DeepSeek", providerName: "DeepSeek", connections: [connection("DeepSeek Chat", "openai-chat", "https://api.deepseek.com"), connection("DeepSeek Responses", "openai-responses", "https://api.deepseek.com"), { ...connection("DeepSeek Anthropic", "anthropic-native", "https://api.deepseek.com/anthropic"), catalogHint: "此兼容路径未提供明确的模型目录，获取失败时请手动添加模型 ID。" }] },
  { id: "zhipu", label: "智谱", providerName: "智谱", connections: [connection("智谱 Chat", "openai-chat", "https://open.bigmodel.cn/api/paas/v4"), connection("智谱 Responses", "openai-responses", "https://open.bigmodel.cn/api/v1"), { ...connection("智谱 Anthropic", "anthropic-native", "https://open.bigmodel.cn/api/anthropic"), catalogHint: "账户套餐可能影响此接口的开通与计费；请以官方控制台为准。模型目录获取失败时可手动添加。" }] },
  { id: "qwen", label: "阿里云", providerName: "阿里云", connections: [connection("千问 Chat", "openai-chat", "https://dashscope.aliyuncs.com/compatible-mode/v1"), connection("千问 Responses", "openai-responses", "https://dashscope.aliyuncs.com/compatible-mode/v1"), { ...connection("千问 Anthropic", "anthropic-native", "https://dashscope.aliyuncs.com/apps/anthropic"), catalogHint: "官方 Anthropic 兼容接口没有模型目录，请手动添加模型 ID。", manualCatalog: true }] },
  { id: "moonshot", label: "月之暗面", providerName: "月之暗面", connections: [connection("Kimi Chat", "openai-chat", "https://api.moonshot.cn/v1"), connection("Kimi Responses", "openai-responses", "https://api.moonshot.cn/v1"), { ...connection("Kimi Anthropic", "anthropic-native", "https://api.moonshot.cn/anthropic"), catalogHint: "此兼容路径未提供明确的模型目录，获取失败时请手动添加模型 ID。" }] },
  { id: "doubao", label: "火山引擎", providerName: "火山引擎", connections: [connection("豆包 Chat", "openai-chat", "https://ark.cn-beijing.volces.com/api/v3"), connection("豆包 Responses", "openai-responses", "https://ark.cn-beijing.volces.com/api/v3"), connection("Seedream 绘图", "seedream-images", "https://ark.cn-beijing.volces.com/api/v3"), { ...connection("豆包 Anthropic", "anthropic-native", "https://ark.cn-beijing.volces.com/api/compatible"), catalogHint: "请先在火山方舟开通模型服务；目录获取失败时，填写控制台提供的模型或推理接入点 ID。" }] },
  { id: "minimax", label: "MiniMax", providerName: "MiniMax", connections: [connection("MiniMax Chat", "openai-chat", "https://api.minimax.cn/v1"), connection("MiniMax Responses", "openai-responses", "https://api.minimax.cn/v1"), connection("MiniMax Anthropic", "anthropic-native", "https://api.minimax.cn/anthropic")] },
  { id: "custom", label: "自定义", providerName: "自定义供应商", connections: [] },
];

export function getConnectionTemplate(presetId: BrandId | undefined, protocol: ServiceProtocol | undefined) {
  return providerTemplates.find(p => p.id === presetId)?.connections.find(c => c.protocol === protocol);
}

export function presetCatalogOptions(provider: { presetId?: BrandId } | undefined, c: { protocol: ServiceProtocol; presetProtocol?: ServiceProtocol; baseUrl: string } | undefined) {
  const defaults = getConnectionTemplate(provider?.presetId, c?.presetProtocol);
  return c && defaults && defaults.protocol === c.protocol && defaults.baseUrl.replace(/\/+$/, "") === c.baseUrl.trim().replace(/\/+$/, "") ? defaults : undefined;
}
