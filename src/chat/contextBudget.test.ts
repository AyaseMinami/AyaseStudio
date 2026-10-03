import { describe, expect, it } from "vitest";
import { ContextBudgetError, estimateInlineRequestBytes, planContextBudget, selectTokenCounter, tokenCountLabel } from "./contextBudget";
import { defaultSessionConfig } from "./sessionConfig";
import type { StoredChatMessage } from "./repository";

const history: StoredChatMessage[] = [
  { id: "u1", role: "user", content: "old question", status: "complete" },
  { id: "a1", role: "assistant", content: "old answer", status: "complete" },
  { id: "u2", role: "user", content: "newer question", status: "complete" },
  { id: "a2", role: "assistant", content: "newer answer", status: "complete" },
  { id: "u3", role: "user", content: "failed question", status: "complete" },
  { id: "a3", role: "assistant", content: "partial", status: "aborted" },
  { id: "u4", role: "user", content: "cut-off question", status: "complete" },
  { id: "a4", role: "assistant", content: "cut-off answer", status: "incomplete" },
];

describe("local context budget", () => {
  const count = (text: string) => text.length;
  it("keeps mandatory content and the latest complete round, never edits history", async () => {
    const original = structuredClone(history);
    const config = { ...defaultSessionConfig(), systemInstruction: "system",
      contextBudget: { mode: "custom" as const, value: "70" } };
    const plan = await planContextBudget(history, "latest", config, "openai-chat", "unknown", count);
    expect(plan.messages).toEqual([
      { role: "user", content: "newer question" },
      { role: "assistant", content: "newer answer" },
      { role: "user", content: "latest" },
    ]);
    expect(plan.trimmedTurns).toBe(1);
    expect(plan.excludedIncompleteTurns).toBe(2);
    expect(history).toEqual(original);
  });

  it("blocks when system plus latest user exceed a boundary budget", async () => {
    const config = { ...defaultSessionConfig(), systemInstruction: "system",
      contextBudget: { mode: "custom" as const, value: "28" } };
    await expect(planContextBudget(history, "latest", config, "openai-chat", "unknown", count)).resolves.toBeDefined();
    config.contextBudget.value = "27";
    await expect(planContextBudget(history, "latest", config, "openai-chat", "unknown", count)).rejects.toThrow(ContextBudgetError);
  });

  it("labels known OpenAI encoding and unknown-model conservative counts as estimates", async () => {
    expect(tokenCountLabel("openai-chat", "gpt-4o")).toContain("o200k_base");
    expect((await selectTokenCounter("gemini-native", "gemini-any")).label).toContain("保守估算");
    expect((await planContextBudget([], "Hi", defaultSessionConfig(), "anthropic-native", "x")).estimated).toBe(true);
  });

  it("shares one tokenizer across simultaneous cold requests for the same encoding", async () => {
    const counters = await Promise.all(Array.from({ length: 4 }, () => selectTokenCounter("openai-chat", "gpt-4o")));
    expect(counters.every(counter => counter.count === counters[0].count)).toBe(true);
    const warm = await selectTokenCounter("openai-responses", "gpt-4.1");
    expect(warm.count).toBe(counters[0].count);
    const other = await selectTokenCounter("openai-chat", "gpt-3.5-turbo");
    expect(other.count).not.toBe(warm.count);
    expect(other.count("Hello")).toBe(1);
  }, 60_000);

  it("counts a known OpenAI model with its local encoding", async () => {
    const selected = await selectTokenCounter("openai-chat", "gpt-4o");
    expect(selected.count("Hello")).toBe(1);
    expect(selected.label).toContain("o200k_base");
  }, 60_000);

  it("keeps attachments with their owning turn and the latest attachment-only message", async () => {
    const attachment = { name: "a.txt", mimeType: "text/plain" as const, size: 12, reference: "attachments/id.txt" };
    const latest = { name: "b.png", mimeType: "image/png" as const, size: 3, data: "AQID" };
    const plan = await planContextBudget([
      { id: "u", role: "user", content: "", attachments: [attachment], status: "complete" },
      { id: "a", role: "assistant", content: "seen", status: "complete" },
    ], "", defaultSessionConfig(), "openai-chat", "unknown", (value) => value.length, [latest]);
    expect(plan.messages).toMatchObject([
      { role: "user", attachments: [attachment] }, { role: "assistant", content: "seen" },
      { role: "user", attachments: [latest] },
    ]);
  });

  it("preflights many historical attachments before loading their bytes", () => {
    const messages = Array.from({ length: 3 }, (_, index) => ({ role: "user" as const, content: `turn ${index}`,
      attachments: [{ reference: `attachments/${index}.pdf`, name: `${index}.pdf`, mimeType: "application/pdf" as const, size: 10_000_000 }] }));
    expect(estimateInlineRequestBytes(messages)).toBeGreaterThan(32_000_000);
  });
});
