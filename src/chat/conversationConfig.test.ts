import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { copyAssistantConfig, readConversationConfig, resolveConversationConfig, type ConversationOverrides } from "./conversationConfig";
import { defaultSessionConfig } from "./sessionConfig";
import { createChatRepository } from "./repository";
import type { AssistantPreset } from "./workspace";

const assistant = (): AssistantPreset => ({ id: "writer", name: "Writer", icon: "", sortOrder: 1, defaultModelId: "m",
  defaultConfig: { ...defaultSessionConfig(), systemInstruction: "Inherited", webSearch: true,
    temperature: { mode: "custom", value: "0.5" },
    thinking: { "openai-responses": { choice: "high", budget: "1024", includeSummary: true } } } });

describe("conversation configuration snapshots", () => {
  it("keeps incomplete stored snapshots recoverable without falling back to assistant values", () => {
    for (const raw of [null, "invalid", { modelId: "m" }, { modelId: "m", config: {} }]) {
      expect(readConversationConfig(raw).config.invalidStoredConfig).toBeTruthy();
    }
    expect(readConversationConfig(copyAssistantConfig(assistant()))).toEqual(copyAssistantConfig(assistant()));
  });
  it("freezes the formerly effective configuration once, preserving empty, false, auto and protocol fields", async () => {
    const databaseName = `Snapshot-${crypto.randomUUID()}`;
    const repo = createChatRepository(databaseName);
    await repo.initializeWorkspace("m", ["m"]);
    await repo.execute({ type: "create-assistant", id: "writer", input: assistant() });
    const raw = new Dexie(databaseName); await raw.open();
    const overrides: ConversationOverrides = { version: 1, values: {
      modelId: "missing", systemInstruction: "", webSearch: false, temperature: { mode: "auto" },
      "thinking.openai-responses.choice": "default", "thinking.openai-responses.includeSummary": false,
      "customJson.gemini-native": '{"seed":7}',
    } };
    for (const id of ["plain", "overridden"]) {
      await raw.table("conversations").put({ id, assistantId: "writer", title: id, createdAt: 1, updatedAt: 2,
        ...(id === "overridden" ? { overrides } : {}),
        creationConfig: { modelId: "historical", config: defaultSessionConfig() } });
      await raw.table("chats").put({ id, updatedAt: 2, messages: [] });
    }
    const first = await repo.initializeWorkspace("m", ["m"]);
    const converted = first.conversations.find((item) => item.id === "overridden")!;
    expect(converted.settings).toEqual(resolveConversationConfig(assistant(), overrides));
    expect(converted).not.toHaveProperty("overrides");
    expect(converted.updatedAt).toBe(2);
    expect(first.conversations.find((item) => item.id === "plain")?.settings).toEqual(copyAssistantConfig(assistant()));
    await repo.execute({ type: "edit-assistant", id: "writer", input: { ...assistant(), defaultModelId: null, defaultConfig: defaultSessionConfig() } });
    const second = await createChatRepository(databaseName).initializeWorkspace(null, []);
    expect(second.conversations.find((item) => item.id === "overridden")?.settings).toEqual(converted.settings);
    expect(second.conversations.find((item) => item.id === "plain")?.settings).toEqual(copyAssistantConfig(assistant()));
    raw.close();
  });

  it("copies defaults only at creation; clear, fork and reassignment retain independent snapshots", async () => {
    const repo = createChatRepository(`Snapshot-${crypto.randomUUID()}`);
    await repo.initializeWorkspace(null, ["m"]);
    await repo.execute({ type: "create-assistant", id: "writer", input: assistant() });
    await repo.execute({ type: "create-conversation", id: "a", assistantId: "writer" });
    await repo.execute({ type: "edit-assistant", id: "writer", input: { ...assistant(), defaultConfig: { ...defaultSessionConfig(), systemInstruction: "Updated" } } });
    const created = await repo.execute({ type: "create-conversation", id: "b", assistantId: "writer" });
    expect(created.conversations.find((item) => item.id === "a")?.settings?.config.systemInstruction).toBe("Inherited");
    expect(created.conversations.find((item) => item.id === "b")?.settings?.config.systemInstruction).toBe("Updated");
    await repo.save({ id: "a", updatedAt: 1, messages: [{ id: "u", role: "user", content: "hello", status: "complete" }] });
    await repo.execute({ type: "fork-conversation", id: "fork", conversationId: "a", messageId: "u",
      creationConfig: { modelId: "historical", config: defaultSessionConfig() } });
    const custom = copyAssistantConfig(assistant()); custom.config.systemInstruction = "Fork";
    await repo.execute({ type: "configure-conversation", id: "fork", settings: custom });
    await repo.save({ id: "a", updatedAt: 2, messages: [] });
    const moved = await repo.execute({ type: "delete-assistant", id: "writer", mode: "move" });
    expect(moved.conversations.find((item) => item.id === "a")).toMatchObject({ assistantId: "default", settings: copyAssistantConfig(assistant()) });
    expect(moved.conversations.find((item) => item.id === "fork")?.settings).toEqual(custom);
    const deleted = await repo.execute({ type: "delete-conversation", id: "a" });
    expect(deleted.conversations.some((item) => item.id === "a")).toBe(false);
  });

  it("preserves invalid legacy configuration as a blocking error instead of activating unknown versions", () => {
    for (const value of [null, false, { version: 2, values: { systemInstruction: "Unknown" } }]) {
      expect(resolveConversationConfig(assistant(), value as unknown as ConversationOverrides).config.invalidStoredConfig).toBeTruthy();
    }
  });
});
