import { describe, expect, it, vi } from "vitest";
import { addModel, applyModelGroupCommand, connectionSettingsStorageKey, loadConnectionSettings, readConnectionSettingsData,
  saveConnectionSettings, updateModel, type ConnectionSettingsState } from "./settings";
import { groupConfiguredModels } from "./modelGrouping";

export function groupFixture(): ConnectionSettingsState {
  return { version: 3, activeModelId: "m1", providers: [{ id: "p", name: "Synthetic", connections: [
    { id: "c", name: "Main", protocol: "openai-chat", baseUrl: "https://example.invalid", apiKey: "", models: [
      { id: "m1", modelId: "gpt-5.3-chat" }, { id: "m2", modelId: "gpt-5.3-thinking" }, { id: "m3", modelId: "unknown" },
    ] },
    { id: "other", name: "Other", protocol: "gemini-native", baseUrl: "https://example.invalid", apiKey: "", models: [{ id: "m4", modelId: "gemini-3-pro" }] },
  ] }] };
}
function main(state: ConnectionSettingsState) { return state.providers[0].connections[0]; }
function customized() {
  const created = applyModelGroupCommand(groupFixture(), "c", { kind: "create", id: "g", name: "常用" });
  return applyModelGroupCommand(created, "c", { kind: "assign", modelIds: ["m1", "m3"], groupId: "g" });
}

describe("connection-scoped model groups", () => {
  it("keeps old automatic groups and reads legacy data without writes or inferred membership", () => {
    const old = groupFixture(), storage = { getItem: () => JSON.stringify(old), setItem: vi.fn() };
    expect(loadConnectionSettings(storage)).toEqual(old);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(groupConfiguredModels(main(old).models).map(group => [group.label, group.models.length])).toEqual([["gpt-5.3", 2], ["其他", 1]]);
    const v2 = { version: 2, activeConnectionId: "legacy-c", providers: [{ id: "legacy-p", name: "Legacy", connections: [
      { id: "legacy-c", protocol: "openai-chat", baseUrl: "https://example.invalid", apiKey: "", model: "gpt-5.3-chat" },
    ] }] };
    const converted = readConnectionSettingsData(v2);
    expect(converted.version).toBe(3);
    expect(converted.providers[0].connections[0].modelGroups).toBeUndefined();
    expect(readConnectionSettingsData(converted)).toEqual(converted);
    expect(v2.version).toBe(2);
  });
  it("creates, assigns, renames and restores automatic grouping without changing targets", () => {
    const old = groupFixture(), state = customized();
    expect(state.activeModelId).toBe(old.activeModelId);
    expect(state.providers[0].connections[1]).toEqual(old.providers[0].connections[1]);
    expect(groupConfiguredModels(main(state).models, main(state).modelGroups).map(group => [group.label, group.models.map(model => model.id)]))
      .toEqual([["常用", ["m1", "m3"]], ["gpt-5.3", ["m2"]]]);
    const renamed = applyModelGroupCommand(state, "c", { kind: "rename", id: "g", name: " 编程 " });
    expect(main(renamed).modelGroups).toEqual([{ id: "g", name: "编程" }]);
    expect(main(renamed).models).toEqual(main(state).models);
    const reset = applyModelGroupCommand(renamed, "c", { kind: "assign", modelIds: ["m1"], groupId: null });
    expect(main(reset).models[0].groupId).toBeUndefined();
    const deleted = applyModelGroupCommand(reset, "c", { kind: "delete", id: "g" });
    expect(main(deleted).models).toEqual(main(old).models);
    expect(deleted.activeModelId).toBe("m1");
    expect(main(state).modelGroups?.[0].name).toBe("常用");
  });
  it("persists empty groups and membership, and preserves them when models change or new models are added", () => {
    const state = applyModelGroupCommand(customized(), "c", { kind: "create", id: "empty", name: "空组" });
    const values = new Map<string, string>(), storage = { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); } };
    saveConnectionSettings(state, storage);
    expect(loadConnectionSettings(storage)).toEqual(state);
    const added = addModel(state, "c", { id: "new", modelId: "gpt-5.3-new" });
    expect(main(added).models[main(added).models.length - 1].groupId).toBeUndefined();
    const edited = updateModel(added, "m1", "modelId", "renamed-api-id");
    expect(main(edited).models[0].groupId).toBe("g");
    expect(groupConfiguredModels(main(edited).models, main(edited).modelGroups).find(group => group.groupId === "empty")?.models).toEqual([]);
  });
  it("rejects empty/duplicate names and invalid batch targets without mutating the input", () => {
    const state = customized(), original = structuredClone(state);
    for (const command of [
      { kind: "create", id: "other-g", name: " 常用 " }, { kind: "create", id: "g", name: "Second" },
      { kind: "rename", id: "g", name: " " }, { kind: "delete", id: "missing" },
      { kind: "assign", modelIds: [], groupId: "g" }, { kind: "assign", modelIds: ["m1", "m4"], groupId: "g" },
      { kind: "assign", modelIds: ["m1", "m1"], groupId: "g" }, { kind: "assign", modelIds: ["m1"], groupId: "missing" },
    ] as const) expect(() => applyModelGroupCommand(state, "c", command)).toThrow();
    expect(state).toEqual(original);
    const latin = applyModelGroupCommand(state, "c", { kind: "create", id: "latin", name: "Code" });
    expect(() => applyModelGroupCommand(latin, "c", { kind: "create", id: "duplicate", name: " code " })).toThrow();
  });
  it.each(["unknown-group-field", "duplicate-group-id", "duplicate-name", "dangling-ref", "foreign-ref", "invalid-ref", "invalid-groups"])(
    "rejects %s before saving and preserves the original stored text", variant => {
      const raw: any = customized(), connection = main(raw);
      if (variant === "unknown-group-field") connection.modelGroups![0] = { ...connection.modelGroups![0], credential: "synthetic" } as any;
      if (variant === "duplicate-group-id") connection.modelGroups!.push({ id: "g", name: "Second" });
      if (variant === "duplicate-name") connection.modelGroups!.push({ id: "g2", name: " 常用 " });
      if (variant === "dangling-ref") connection.modelGroups = [];
      if (variant === "foreign-ref") { raw.providers[0].connections[1].modelGroups = [{ id: "foreign", name: "Other" }]; connection.models[0].groupId = "foreign"; }
      if (variant === "invalid-ref") connection.models[0].groupId = 4 as any;
      if (variant === "invalid-groups") connection.modelGroups = {} as any;
      const encoded = JSON.stringify(raw), storage = { getItem: (key: string) => key === connectionSettingsStorageKey ? encoded : null, setItem: vi.fn() };
      expect(() => saveConnectionSettings(groupFixture(), storage)).toThrow();
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.getItem(connectionSettingsStorageKey)).toBe(encoded);
      expect(() => readConnectionSettingsData(raw)).toThrow();
    });
});
