export const brandIds = ["openai", "anthropic", "gemini", "xai", "openrouter", "deepseek", "zhipu", "qwen", "moonshot", "doubao", "minimax"] as const;
export type BrandId = typeof brandIds[number];
export function isBrandId(value: unknown): value is BrandId {
  return typeof value === "string" && (brandIds as readonly string[]).includes(value);
}

export type ProviderAvatarSelection = { kind: "builtin"; id: BrandId } | { kind: "image"; id: string };
