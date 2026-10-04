import type { DiscoveredModel } from "./modelCatalog";
import type { ConfiguredModel, ConfiguredModelGroup } from "./settings";

/** Manual membership wins; remaining models use the existing automatic family rules. */
export function groupConfiguredModels(models: readonly ConfiguredModel[], groups: readonly ConfiguredModelGroup[] = []): {
  key: string; label: string; groupId: string | null; models: ConfiguredModel[];
}[] {
  const automatic = models.filter(model => model.groupId === undefined);
  const byActualId = new Map(automatic.map(model => [model.modelId, model]));
  return [
    ...groups.map(group => ({ key: `custom:${group.id}`, label: group.name, groupId: group.id,
      models: models.filter(model => model.groupId === group.id) })),
    ...groupDiscoveredModels(automatic.map(model => ({ id: model.modelId }))).map(group => ({
      key: `auto:${group.label}`, label: group.label, groupId: null,
      models: group.models.map(model => byActualId.get(model.id)!),
    })),
  ];
}

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
