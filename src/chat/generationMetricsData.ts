import { backupFields, dataCheck, dataRecord, migrateData } from "../storage/dataContract";
import { dataPolicies } from "../storage/dataPolicies";
import type { GenerationMetrics } from "./generationMetrics";
import type { StoredChatMessage } from "./repository";

/** Statistics have no semantic migrations; old messages retain their absent field. */
export function readGenerationMetricsData(raw: unknown): GenerationMetrics {
  const value = migrateData(raw, { version: 1, oldestVersion: 1, migrations: {} });
  dataCheck(Object.keys(value).every(key => backupFields(dataPolicies.generationMetrics).includes(key)));
  dataCheck(["openai-chat", "openai-responses", "gemini-native", "anthropic-native"].includes(value.protocol as string));
  dataCheck(typeof value.streaming === "boolean" && typeof value.usageComplete === "boolean");
  dataCheck(["complete", "incomplete", "paused", "streaming", "aborted", "failed"].includes(value.status as string));
  dataCheck(typeof value.elapsedMs === "number" && Number.isFinite(value.elapsedMs) && value.elapsedMs >= 0);
  for (const key of ["firstTextMs", "firstThinkingMs"]) if (key in value) {
    dataCheck(value.streaming && typeof value[key] === "number" && Number.isFinite(value[key])
      && (value[key] as number) >= 0 && (value[key] as number) <= value.elapsedMs);
  }
  if ("usage" in value) {
    dataRecord(value.usage);
    const usage = value.usage;
    dataCheck(Object.keys(usage).every(key => backupFields(dataPolicies.tokenUsage).includes(key)));
    for (const count of Object.values(usage)) dataCheck(Number.isSafeInteger(count) && (count as number) >= 0);
    const knownSum = (keys: string[]) => {
      const sum = keys.reduce((total, key) => total + (typeof usage[key] === "number" ? usage[key] : 0), 0);
      dataCheck(Number.isSafeInteger(sum));
      return sum;
    };
    const prompt = knownSum(["uncachedInputTokens", "cacheReadTokens", "cacheWriteTokens"]);
    if (usage.inputTokens !== undefined) dataCheck(prompt <= (usage.inputTokens as number));
    if (usage.reasoningTokens !== undefined && usage.outputTokens !== undefined)
      dataCheck((usage.reasoningTokens as number) <= (usage.outputTokens as number));
    const total = knownSum(["inputTokens", "outputTokens"]);
    if (usage.totalTokens !== undefined) dataCheck(total <= (usage.totalTokens as number));
  }
  if (value.usageComplete) {
    dataRecord(value.usage);
    dataCheck(value.usage.outputTokens !== undefined
      && ["complete", "incomplete", "paused"].includes(value.status as string));
  }
  return value as unknown as GenerationMetrics;
}

/** Validate generation metadata, preserving unrelated local message fields. */
export function readMessageGenerationMetrics<T>(raw: T): T {
  const value = structuredClone(raw);
  function visit(message: unknown): void {
    if (message === null || typeof message !== "object" || Array.isArray(message)) return;
    const record = message as Record<string, unknown>;
    if (record.generationModel !== undefined) {
      dataCheck(record.role === "assistant" && typeof record.generationModel === "string"
        && record.generationModel.trim().length > 0);
    }
    if ("generationMetrics" in record && record.generationMetrics !== undefined) {
      dataCheck(Array.isArray(record.generationMetrics));
      record.generationMetrics = record.generationMetrics.map(readGenerationMetricsData);
    }
    const versions = record.roundVersions;
    if (versions && typeof versions === "object" && "pairs" in versions && Array.isArray(versions.pairs))
      for (const pair of versions.pairs) if (Array.isArray(pair)) pair.forEach(visit);
  }
  visit(value);
  return value;
}

export function readMessagesGenerationMetrics(raw: StoredChatMessage[]): StoredChatMessage[] {
  return raw.map(readMessageGenerationMetrics);
}
