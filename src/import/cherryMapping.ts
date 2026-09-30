import type { CherryBackup, CherryImportConversation, CherryImportMessage, CherryImportPlan, CherryMessage, CherryTopic } from "./cherryTypes";

const MAX_PATHS = 2_000;
const MAX_CLONED_MESSAGES = 100_000;
const INVALID = "Cherry 备份聊天数据无效或超出导入限制。";
function invalid(): never { throw new Error(INVALID); }
function string(value: unknown, limit = 4096, empty = false): asserts value is string {
  if (typeof value !== "string" || (!empty && !value.trim()) || value.length > limit) invalid();
}
function timestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000) invalid();
}
function unique(value: string, seen: Set<string>): void {
  string(value); if (seen.has(value)) invalid(); seen.add(value);
}

function treePaths(topic: CherryTopic): CherryMessage[][] {
  const byId = new Map(topic.messages.map((message) => [message.id, message]));
  const parents = new Set<string>();
  const checked = new Set<string>();
  for (const message of topic.messages) {
    if (message.role === "root" && (message.parentId || message.parts.length)) invalid();
    const visiting = new Set<string>();
    let current: CherryMessage | undefined = message;
    while (current && !checked.has(current.id)) {
      if (visiting.has(current.id)) invalid();
      visiting.add(current.id);
      if (current.parentId) {
        const parent = byId.get(current.parentId);
        if (!parent) invalid();
        parents.add(parent.id);
        current = parent;
      } else current = undefined;
    }
    for (const id of visiting) checked.add(id);
  }
  if (topic.activeNodeId && !byId.has(topic.activeNodeId)) invalid();
  const leaves = topic.messages.filter((message) => !parents.has(message.id));
  if (leaves.length > MAX_PATHS) invalid();
  let cloned = 0;
  const paths = leaves.map((leaf) => {
    const path: CherryMessage[] = [];
    let current: CherryMessage | undefined = leaf;
    while (current) {
      if (++cloned > MAX_CLONED_MESSAGES) invalid();
      path.push(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return path.reverse();
  });
  const activeIndex = paths.findIndex((path) => path.some((message) => message.id === topic.activeNodeId));
  if (activeIndex > 0) paths.unshift(...paths.splice(activeIndex, 1));
  return paths.length ? paths : [[]];
}

function orderedPaths(topic: CherryTopic): CherryMessage[][] {
  const groups = new Map<string, string[]>();
  const precedingUsers = new Set<string>();
  for (const message of topic.messages) {
    if (message.role === "root" || message.parentId) invalid();
    if (message.askId) {
      if (message.role !== "assistant" || !precedingUsers.has(message.askId)) invalid();
      const group = groups.get(message.askId) ?? [];
      group.push(message.id); groups.set(message.askId, group);
    }
    if (message.role === "user") precedingUsers.add(message.id);
  }
  const alternatives = [...groups.values()].filter((group) => group.length > 1);
  let selections: Set<string>[] = [new Set()];
  for (const group of alternatives) {
    if (selections.length * group.length > MAX_PATHS) invalid();
    selections = selections.flatMap((selection) => group.map((id) => new Set([...selection, id])));
  }
  const alternativeIds = new Set(alternatives.flat());
  if (selections.length * (topic.messages.length - alternativeIds.size + alternatives.length) > MAX_CLONED_MESSAGES) invalid();
  return selections.map((selection) => topic.messages.filter((message) => !alternativeIds.has(message.id) || selection.has(message.id)));
}

/** Only normalized chat fields enter the plan. Virtual roots remain in stable source keys, not transcripts. */
function buildPlan(backup: CherryBackup): CherryImportPlan {
  if (![5, 6, 7].includes(backup.format) || !["legacy-json", "legacy-chromium", "sqlite"].includes(backup.source)
    || !Array.isArray(backup.assistants) || !Array.isArray(backup.topics)
    || backup.assistants.length > 5_000 || backup.topics.length > 10_000) invalid();
  const assistants = new Set<string>();
  for (const assistant of backup.assistants) { unique(assistant.id, assistants); string(assistant.name, 4096, true); }
  const topics = new Set<string>();
  const messages = new Set<string>();
  let parts = 0;
  let textSize = 0;
  let cloned = 0;
  let clonedParts = 0;
  let clonedTextSize = 0;
  const warnings = new Set<string>();
  // Native warnings are deliberately reduced to a generic notice, never echoed from source data.
  if (backup.warnings?.length) warnings.add("备份中有未支持或未恢复的内容，请检查导入结果。");
  const conversations: CherryImportConversation[] = [];
  for (const topic of backup.topics) {
    unique(topic.id, topics); string(topic.assistantId); string(topic.title, 4096, true);
    if (!assistants.has(topic.assistantId) || !Array.isArray(topic.messages)) invalid();
    timestamp(topic.createdAt); timestamp(topic.updatedAt);
    if (topic.updatedAt < topic.createdAt) invalid();
    for (const message of topic.messages) {
      unique(message.id, messages);
      if (messages.size > 100_000 || !["user", "assistant", "system", "root"].includes(message.role)
        || !["complete", "incomplete", "paused", "streaming", "aborted", "failed"].includes(message.status) || !Array.isArray(message.parts)) invalid();
      timestamp(message.createdAt);
      if (message.parentId != null) string(message.parentId);
      if (message.askId != null) string(message.askId);
      for (const part of message.parts) {
        if (++parts > 200_000) invalid();
        if (part.type === "text" || part.type === "thinking") {
          string(part.text, 8 * 1024 * 1024, true);
          textSize += part.text.length;
          if (textSize > 64 * 1024 * 1024) invalid();
        } else if (part.type === "file") {
          string(part.fileKey); string(part.name, 4096);
          if (part.available !== undefined && typeof part.available !== "boolean") invalid();
          if (part.available === false) warnings.add("部分附件缺失或格式不受支持，已保留消息和文件信息。");
        } else if (part.type === "unsupported") {
          warnings.add("未支持的消息内容已省略；工具、搜索等内容不会作为操作重放。");
        } else invalid();
      }
    }
    const paths = backup.source === "sqlite" ? treePaths(topic) : orderedPaths(topic);
    for (const [index, path] of paths.entries()) {
      if (conversations.length >= MAX_PATHS) invalid();
      let lastUser: string | undefined;
      const precedingUsers = new Set<string>();
      const mapped: CherryImportMessage[] = [];
      for (const message of path) {
        if (message.role === "root") continue;
        if (++cloned > MAX_CLONED_MESSAGES) invalid();
        clonedParts += message.parts.length;
        if (clonedParts > 200_000) invalid();
        if (message.askId && (message.role !== "assistant" || !precedingUsers.has(message.askId))) invalid();
        const content = message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
        const thinking = message.parts.filter((part) => part.type === "thinking").map((part) => part.text).join("\n");
        clonedTextSize += content.length + thinking.length;
        if (clonedTextSize > 64 * 1024 * 1024) invalid();
        const replyToSourceId = message.role === "assistant" ? message.askId ?? lastUser ?? null : undefined;
        const unavailableAttachments = [...new Set(message.parts.filter((part) => part.type === "file" && part.available === false).map((part) => part.name!))];
        mapped.push({ sourceId: message.id, role: message.role, content, createdAt: message.createdAt,
          status: message.status === "streaming" ? "aborted" : message.status,
          ...(thinking ? { thinkingSummary: thinking } : {}),
          ...(replyToSourceId !== undefined ? { replyToSourceId } : {}),
          ...(unavailableAttachments.length ? { unavailableAttachments } : {}),
          files: message.parts.filter((part) => part.type === "file").map((part) => ({ key: part.fileKey!, name: part.name! })) });
        if (message.role === "user") { lastUser = message.id; precedingUsers.add(message.id); }
      }
      conversations.push({ sourceKey: `cherry:${JSON.stringify([topic.id, path.map((message) => message.id)])}`,
        topicId: topic.id, assistantId: topic.assistantId,
        title: paths.length > 1 ? `${topic.title} · 分支 ${index + 1}` : topic.title,
        createdAt: topic.createdAt, updatedAt: topic.updatedAt, messages: mapped });
    }
  }
  return { format: backup.format, assistants: backup.assistants.map(({ id, name }) => ({ id, name })),
    conversations, warnings: [...warnings] };
}

export function createCherryImportPlan(backup: CherryBackup): CherryImportPlan {
  try { return buildPlan(backup); } catch { return invalid(); }
}
