import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { AyaseDatabase } from "../storage/database";
import { readGenerationMetricsData, readMessageGenerationMetrics } from "./generationMetricsData";
import type { GenerationMetrics } from "./generationMetrics";
import { createChatRepository, type StoredChatMessage } from "./repository";
import { SessionStore } from "./sessionStore";
import { defaultSessionConfig } from "./sessionConfig";

const metric = (): GenerationMetrics => ({ version: 1, protocol: "openai-responses", streaming: true,
  status: "complete", elapsedMs: 120, firstTextMs: 12, firstThinkingMs: 4, usageComplete: true,
  usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30, cacheReadTokens: 4, reasoningTokens: 3 } });
const answer = (): StoredChatMessage => ({ id: "a", role: "assistant", replyToId: "u", content: "answer", status: "complete", generationMetrics: [metric()] });
const user = (): StoredChatMessage => ({ id: "u", role: "user", content: "question", status: "complete" });
const invalid = [
  { version: 2 }, { future: true }, { protocol: "future" }, { status: "future" },
  { elapsedMs: -1 }, { elapsedMs: NaN }, { elapsedMs: Infinity }, { firstTextMs: 121 },
  { firstThinkingMs: -1 }, { streaming: false }, { usage: { future: 1 } },
  { usage: { inputTokens: -1 } }, { usage: { outputTokens: 1.5 } },
  { usage: { totalTokens: Number.MAX_SAFE_INTEGER + 1 } }, { usage: { inputTokens: 2, cacheReadTokens: 3 } },
  { usage: { inputTokens: 3, cacheReadTokens: 2, cacheWriteTokens: 2 } },
  { usage: { inputTokens: 4, uncachedInputTokens: 3, cacheReadTokens: 2 } },
  { usage: { outputTokens: 1, reasoningTokens: 2 } },
  { usage: { inputTokens: 2, outputTokens: 2, totalTokens: 3 } },
  { usage: { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1 } },
  { usage: {} }, { usage: undefined }, { usage: { inputTokens: 20 } }, { usageComplete: true, status: "streaming" },
];

describe("generation statistics data boundary", () => {
  it("clones idempotently, retains independent invocations, and leaves old messages absent", () => {
    const input = metric(), read = readGenerationMetricsData(input);
    expect(read).toEqual(input); expect(read).not.toBe(input); expect(read.usage).not.toBe(input.usage);
    expect(readGenerationMetricsData(read)).toEqual(input);
    const old = user(); expect(readMessageGenerationMetrics(old)).toEqual(old);
    expect(readMessageGenerationMetrics(old)).not.toHaveProperty("generationMetrics");
    const partial = { ...metric(), usageComplete: false, usage: { cacheReadTokens: 0 } };
    expect(readGenerationMetricsData(partial).usage).toEqual({ cacheReadTokens: 0 });
    const message = { ...answer(), generationMetrics: [metric(), partial], unrelated: { kept: true } };
    expect(readMessageGenerationMetrics(message)).toEqual(message);
  });
  it.each(invalid)("rejects unsupported metric %# without mutating its original", patch => {
    const input = { ...metric(), ...patch }, before = structuredClone(input);
    expect(() => readGenerationMetricsData(input)).toThrow(); expect(input).toEqual(before);
  });
  it("saves and reopens independent invocations and round histories", async () => {
    const name = `metrics-${crypto.randomUUID()}`, repo = createChatRepository(name);
    const u = { ...user(), roundVersions: { selected: 0, pairs: [[user(), answer()]] as [StoredChatMessage, StoredChatMessage][] } };
    await repo.save({ id: "c", updatedAt: 1, messages: [u, answer()] });
    expect((await createChatRepository(name).load("c"))?.messages).toEqual([u, answer()]);
    const loaded = (await repo.load("c"))!; loaded.messages[1].generationMetrics![0].elapsedMs = 500;
    expect((await repo.load("c"))?.messages[1].generationMetrics![0].elapsedMs).toBe(120);
  });
  it.each(invalid)("invalid update %# never overwrites persisted data or publishes state", async patch => {
    const repo = createChatRepository(`metrics-${crypto.randomUUID()}`);
    await repo.save({ id: "c", updatedAt: 1, messages: [answer()] });
    const original = await repo.load("c"), store = new SessionStore(repo, "c"); await store.hydrate();
    const bad = { ...answer(), generationMetrics: [{ ...metric(), ...patch } as GenerationMetrics] };
    await expect(repo.save({ id: "c", updatedAt: 2, messages: [bad] })).rejects.toThrow();
    await expect(store.updateMessages([bad])).rejects.toThrow();
    expect(await repo.load("c")).toEqual(original); expect(store.current.messages[0]).toEqual(answer());
  });
  it("preflights all saved round statistics before workspace repair writes", async () => {
    const name = `metrics-${crypto.randomUUID()}`, db = new AyaseDatabase(name);
    const bad = { ...answer(), generationMetrics: [{ ...metric(), version: 2 }] };
    const raw = { id: "c", updatedAt: 1, messages: [{ ...user(), roundVersions: { selected: 0, pairs: [[user(), bad]] } }] };
    await db.chats.put(raw as unknown as Parameters<typeof db.chats.put>[0]);
    const before = await db.chats.toArray();
    const repo = createChatRepository(name);
    await expect(repo.load("c")).rejects.toThrow();
    await expect(repo.initializeWorkspace(null, [])).rejects.toThrow();
    expect(await db.chats.toArray()).toEqual(before); expect(await db.assistants.count()).toBe(0);
    expect(await db.conversations.count()).toBe(0); expect(await db.workspace.count()).toBe(0);
  });
  it("branch copies keep metrics and refuse newly corrupted statistics before branch writes", async () => {
    const name = `metrics-${crypto.randomUUID()}`, repo = createChatRepository(name);
    await repo.initializeWorkspace(null, []);
    await repo.save({ id: "current", updatedAt: 1, messages: [user(), answer()] });
    await repo.execute({ type: "fork-conversation", id: "branch", conversationId: "current", messageId: "a",
      creationConfig: { modelId: null, config: defaultSessionConfig() } });
    expect((await repo.load("branch"))?.messages[1].generationMetrics).toEqual([metric()]);
    const db = new AyaseDatabase(name), current = (await db.chats.get("current"))!;
    Object.assign(current.messages[1].generationMetrics![0], { future: true }); await db.chats.put(current);
    const original = await db.chats.toArray();
    await expect(repo.execute({ type: "fork-conversation", id: "bad-branch", conversationId: "current", messageId: "a",
      creationConfig: { modelId: null, config: defaultSessionConfig() } })).rejects.toThrow();
    expect(await db.chats.toArray()).toEqual(original); expect(await db.conversations.get("bad-branch")).toBeUndefined();
  });
  it("recovers streaming invocations recursively without adding downtime", async () => {
    const repo = createChatRepository(`metrics-${crypto.randomUUID()}`);
    const unfinished = { ...answer(), status: "streaming" as const,
      generationMetrics: [metric(), { ...metric(), status: "streaming" as const, usageComplete: false }] };
    const u = { ...user(), roundVersions: { selected: 0, pairs: [[user(), unfinished]] as [StoredChatMessage, StoredChatMessage][] } };
    await repo.save({ id: "c", updatedAt: 1, messages: [u, unfinished] });
    const save = vi.spyOn(repo, "save"), state = await new SessionStore(repo, "c").hydrate();
    for (const message of [state.messages[1], state.messages[0].roundVersions!.pairs[0][1]]) {
      expect(message.status).toBe("aborted"); expect(message.generationMetrics![0]).toEqual(metric());
      expect(message.generationMetrics![1]).toEqual({ ...metric(), status: "aborted", usageComplete: false });
    }
    expect(save).toHaveBeenCalledOnce(); expect((await repo.load("c"))?.messages).toEqual(state.messages);
  });
});
