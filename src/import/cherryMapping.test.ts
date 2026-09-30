import { describe, expect, it } from "vitest";
import { createCherryImportPlan } from "./cherryMapping";
import type { CherryBackup, CherryMessage, CherryTopic } from "./cherryTypes";

function message(id: string, role: CherryMessage["role"] = "user", extra: Partial<CherryMessage> = {}): CherryMessage {
  return { id, role, createdAt: 10, status: "complete", parts: [{ type: "text", text: id }], ...extra };
}
function topic(messages: CherryMessage[], extra: Partial<CherryTopic> = {}): CherryTopic {
  return { id: "topic", assistantId: "assistant", title: "title", createdAt: 1, updatedAt: 20, messages, ...extra };
}
function backup(messages: CherryMessage[], extra: Partial<CherryBackup> = {}): CherryBackup {
  return { token: "private-token", format: 5, source: "legacy-json", assistants: [{ id: "assistant", name: "name" }],
    topics: [topic(messages)], warnings: [], ...extra };
}

describe("Cherry normalized chat mapping", () => {
  it("keeps only chat fields, ordered text/thinking, files and explicit reply links", () => {
    const data = backup([message("u"), message("a", "assistant", { status: "streaming", parts: [
      { type: "text", text: "first" }, { type: "thinking", text: "think1" },
      { type: "text", text: "second" }, { type: "thinking", text: "think2" },
      { type: "file", fileKey: "file", name: "name.txt" }, { type: "unsupported", text: "PRIVATE" },
    ] })]);
    Object.assign(data, { apiKey: "PRIVATE", model: "PRIVATE" });
    Object.assign(data.assistants[0]!, { prompt: "PRIVATE" });
    data.warnings = ["PRIVATE"];
    const plan = createCherryImportPlan(data);
    expect(plan.conversations[0]!.messages[1]).toEqual({ sourceId: "a", role: "assistant", content: "first\nsecond",
      thinkingSummary: "think1\nthink2", createdAt: 10, status: "aborted", replyToSourceId: "u", files: [{ key: "file", name: "name.txt" }] });
    expect(plan.assistants).toEqual([{ id: "assistant", name: "name" }]);
    expect(JSON.stringify(plan)).not.toContain("PRIVATE");
    expect(JSON.stringify(plan)).not.toContain("private-token");
    expect(plan.warnings).toHaveLength(2);
  });

  it("retains empty topics and stable keys independent of content", () => {
    expect(createCherryImportPlan(backup([])).conversations[0]!.messages).toEqual([]);
    const data = backup([message("u")]);
    const key = createCherryImportPlan(data).conversations[0]!.sourceKey;
    data.topics[0]!.messages[0]!.parts = [{ type: "text", text: "changed" }];
    expect(createCherryImportPlan(data).conversations[0]!.sourceKey).toBe(key);
    expect(key).toBe('cherry:["topic",["u"]]');
  });

  it("preserves all Cartesian askId routes without treating sequential replies as alternatives", () => {
    const plan = createCherryImportPlan(backup([message("u"), message("a1", "assistant", { askId: "u" }),
      message("a2", "assistant", { askId: "u" }), message("next"),
      message("b1", "assistant", { askId: "next" }), message("b2", "assistant", { askId: "next" }),
      message("sequential1", "assistant"), message("sequential2", "assistant")]));
    expect(plan.conversations.map((conversation) => conversation.messages.map((item) => item.sourceId))).toEqual([
      ["u", "a1", "next", "b1", "sequential1", "sequential2"], ["u", "a1", "next", "b2", "sequential1", "sequential2"],
      ["u", "a2", "next", "b1", "sequential1", "sequential2"], ["u", "a2", "next", "b2", "sequential1", "sequential2"],
    ]);
    expect(plan.conversations.map((conversation) => conversation.title)).toEqual(["title · 分支 1", "title · 分支 2", "title · 分支 3", "title · 分支 4"]);
  });

  it("preserves every SQLite leaf and puts the active path first, omitting only empty virtual roots", () => {
    const data = backup([message("root", "root", { parts: [] }), message("u", "user", { parentId: "root" }),
      message("a1", "assistant", { parentId: "u" }), message("a2", "assistant", { parentId: "u" }),
      message("next", "user", { parentId: "a2" })], { format: 7, source: "sqlite" });
    data.topics[0]!.activeNodeId = "next";
    const plan = createCherryImportPlan(data);
    expect(plan.conversations.map((conversation) => conversation.messages.map((item) => item.sourceId))).toEqual([["u", "a2", "next"], ["u", "a1"]]);
    expect(plan.conversations[0]!.sourceKey).toBe('cherry:["topic",["root","u","a2","next"]]');
    expect(plan.conversations[0]!.messages[1]!.replyToSourceId).toBe("u");
  });

  it.each([
    () => backup([message("same"), message("same")]),
    () => backup([message("u", "user", { createdAt: NaN })]),
    () => backup([message("u", "user", { createdAt: -1 })]),
    () => backup([message("a", "assistant", { askId: "absent" })]),
    () => backup([message("a", "assistant", { askId: "u" }), message("u")]),
    () => backup([], { topics: [topic([]), topic([])] }),
    () => backup([], { assistants: [{ id: "assistant", name: "one" }, { id: "assistant", name: "two" }] }),
    () => backup([], { topics: [topic([], { assistantId: "absent" })] }),
    () => backup([message("root", "root")], { source: "sqlite" }),
    () => backup([message("a", "assistant", { parentId: "b" }), message("b", "assistant", { parentId: "a" })], { source: "sqlite" }),
    () => backup([message("a", "assistant", { parentId: "absent" })], { source: "sqlite" }),
    () => backup([], { topics: [topic([message("a", "user", { parentId: "outside" })]), topic([message("outside")], { id: "other" })], source: "sqlite" }),
    () => backup([], { topics: [topic([], { activeNodeId: "absent" })], source: "sqlite" }),
  ])("rejects invalid identities, chronology, ownership and trees generically", (input) => {
    expect(() => createCherryImportPlan(input())).toThrow("Cherry 备份聊天数据无效或超出导入限制。");
  });

  it("rejects too many branches before expanding them", () => {
    const messages: CherryMessage[] = [];
    for (let index = 0; index < 11; index++) messages.push(message(`u${index}`),
      message(`a${index}`, "assistant", { askId: `u${index}` }), message(`b${index}`, "assistant", { askId: `u${index}` }));
    expect(() => createCherryImportPlan(backup(messages))).toThrow("导入限制");
  });

  it("rejects cloned transcript growth instead of silently truncating", () => {
    const messages: CherryMessage[] = Array.from({ length: 60 }, (_, index) => message(`prefix${index}`));
    for (let index = 0; index < 10; index++) messages.push(message(`u${index}`),
      message(`a${index}`, "assistant", { askId: `u${index}` }), message(`b${index}`, "assistant", { askId: `u${index}` }));
    messages.push(...Array.from({ length: 30 }, (_, index) => message(`suffix${index}`)));
    expect(() => createCherryImportPlan(backup(messages))).toThrow("导入限制");
  });

  it("bounds per-field and aggregate source and emitted text", () => {
    const maximumText = "x".repeat(8 * 1024 * 1024);
    expect(() => createCherryImportPlan(backup([message("u", "user", { parts: [{ type: "text", text: maximumText + "x" }] })]))).toThrow("导入限制");
    expect(() => createCherryImportPlan(backup(Array.from({ length: 9 }, (_, index) =>
      message(`u${index}`, "user", { parts: [{ type: "text", text: maximumText }] }))))).toThrow("导入限制");
    const messages = [message("prefix", "user", { parts: [{ type: "text", text: maximumText }] })];
    for (let index = 0; index < 4; index++) messages.push(message(`u${index}`),
      message(`a${index}`, "assistant", { askId: `u${index}` }), message(`b${index}`, "assistant", { askId: `u${index}` }));
    expect(() => createCherryImportPlan(backup(messages))).toThrow("导入限制");
  });

  it("bounds SQLite cloned message paths", () => {
    const prefix = Array.from({ length: 60 }, (_, index) => message(`p${index}`, "user", { parentId: index ? `p${index - 1}` : null }));
    const leaves = Array.from({ length: 1700 }, (_, index) => message(`leaf${index}`, "assistant", { parentId: "p59" }));
    expect(() => createCherryImportPlan(backup([...prefix, ...leaves], { source: "sqlite" }))).toThrow("导入限制");
  });

  it("bounds empty and file part amplification through branches", () => {
    const messages = [message("prefix", "user", { parts: Array.from({ length: 201 }, () => ({ type: "unsupported" })) })];
    for (let index = 0; index < 10; index++) messages.push(message(`u${index}`),
      message(`a${index}`, "assistant", { askId: `u${index}` }), message(`b${index}`, "assistant", { askId: `u${index}` }));
    expect(() => createCherryImportPlan(backup(messages))).toThrow("导入限制");
  });

  it("marks unavailable attachments before confirmation, preserves names and aliases, and sanitizes warnings", () => {
    const data = backup([message("u", "user", { parts: [
      { type: "file", fileKey: "file", name: "first.txt", available: false },
      { type: "file", fileKey: "file", name: "alias.txt", available: false },
      { type: "file", fileKey: "file", name: "first.txt", available: false },
      { type: "file", fileKey: "present", name: "present.txt", available: true },
    ] })]);
    const plan = createCherryImportPlan(data);
    expect(plan.conversations[0]!.messages[0]!.files).toEqual([
      { key: "file", name: "first.txt" }, { key: "file", name: "alias.txt" }, { key: "file", name: "first.txt" }, { key: "present", name: "present.txt" },
    ]);
    expect(plan.conversations[0]!.messages[0]!.unavailableAttachments).toEqual(["first.txt", "alias.txt"]);
    expect(plan.warnings).toEqual(["部分附件缺失或格式不受支持，已保留消息和文件信息。"]);
    expect(plan.warnings.join()).not.toContain("first.txt");
  });
});
