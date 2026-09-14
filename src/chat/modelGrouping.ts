import type { DiscoveredModel } from "./modelCatalog";

export interface DiscoveredModelGroup {
  label: string;
  models: DiscoveredModel[];
}

function inferFamily(modelId: string): string | undefined {
  const patterns = [
    /^(gpt-\d+(?:\.\d+)?)/i,
    /^(gemini-\d+(?:\.\d+)?)/i,
    /^(grok-\d+(?:\.\d+)?)/i,
    /^(glm-\d+(?:\.\d+)?)/i,
    /^(llama-\d+(?:\.\d+)?)/i,
    /^(claude-(?:\d+(?:[.-]\d+)*|sonnet|opus|haiku))/i,
    /^(deepseek-(?:v\d+|r\d+))/i,
  ];
  for (const pattern of patterns) {
    const match = modelId.match(pattern);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return undefined;
}

export function groupDiscoveredModels(
  models: readonly DiscoveredModel[],
): DiscoveredModelGroup[] {
  const groups = new Map<string, DiscoveredModel[]>();
  for (const model of models) {
    const label = model.family?.trim() || inferFamily(model.id) || "其他";
    const group = groups.get(label) ?? [];
    group.push(model);
    groups.set(label, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => {
      if (left === "其他") return 1;
      if (right === "其他") return -1;
      return left.localeCompare(right, undefined, { sensitivity: "base" });
    })
    .map(([label, groupModels]) => ({
      label,
      models: [...groupModels].sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
    }));
}
