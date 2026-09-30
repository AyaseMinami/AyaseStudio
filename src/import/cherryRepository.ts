import type { SentAttachment } from "../chat/attachments";
import type { ChatSnapshot, StoredChatMessage } from "../chat/repository";
import { defaultSessionConfig } from "../chat/sessionConfig";
import { AyaseDatabase } from "../storage/database";
import type { CherryImportPlan, CherryImportRepository, CherryImportResult } from "./cherryTypes";

const INVALID_PLAN = "导入计划无效。";
const MAX_TEXT = 8 * 1024 * 1024;
const MAX_TOTAL_TEXT = 64 * 1024 * 1024;
const statuses = new Set(["complete", "incomplete", "paused", "streaming", "aborted", "failed"]);
const attachmentMimes = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf", "text/plain", "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"]);
const attachmentReference = /^attachments\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp|pdf|txt|md|docx|xlsx|pptx)$/;
const markerId = (kind: "assistant" | "conversation", sourceId: string) => JSON.stringify([kind, sourceId]);

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function requireValid(value: unknown): asserts value {
  if (!value) throw new Error(INVALID_PLAN);
}
function timestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

// Snapshot only allowlisted fields before awaiting IndexedDB; backup configuration is never copied.
function validatedPlan(raw: CherryImportPlan): CherryImportPlan {
  let totalText = 0;
  const encoder = new TextEncoder();
  const text = (value: unknown, max = MAX_TEXT): string => {
    requireValid(typeof value === "string" && value.length <= max);
    const size = encoder.encode(value).length;
    totalText += size;
    requireValid(size <= max && totalText <= MAX_TOTAL_TEXT);
    return value;
  };
  const id = (value: unknown): string => {
    const result = text(value, 512);
    requireValid(result.trim());
    return result;
  };
  const array = (value: unknown, max: number): unknown[] => {
    requireValid(Array.isArray(value) && value.length <= max);
    return value;
  };
  requireValid(record(raw) && [5, 6, 7].includes(raw.format));
  const assistantIds = new Set<string>();
  const assistants = array(raw.assistants, 5000).map((item) => {
    requireValid(record(item));
    const sourceId = id(item.id);
    requireValid(!assistantIds.has(sourceId));
    assistantIds.add(sourceId);
    return { id: sourceId, name: text(item.name, 4096) };
  });
  let messageCount = 0;
  const sourceKeys = new Set<string>();
  const conversations = array(raw.conversations, 2000).map((item) => {
    requireValid(record(item));
    const sourceKey = text(item.sourceKey);
    requireValid(sourceKey.trim() && !sourceKeys.has(sourceKey));
    sourceKeys.add(sourceKey);
    const assistantId = id(item.assistantId);
    requireValid(assistantIds.has(assistantId) && timestamp(item.createdAt) && timestamp(item.updatedAt));
    const sourceIds = new Map<string, string>();
    const messages = array(item.messages, 100000).map((message) => {
      requireValid(record(message) && ++messageCount <= 100000);
      const sourceId = id(message.sourceId);
      requireValid(!sourceIds.has(sourceId) && typeof message.role === "string" && ["user", "assistant", "system"].includes(message.role)
        && typeof message.status === "string" && statuses.has(message.status) && timestamp(message.createdAt));
      sourceIds.set(sourceId, String(message.role));
      requireValid(message.replyToSourceId === undefined || message.replyToSourceId === null || typeof message.replyToSourceId === "string");
      const files = array(message.files, 1000).map((file) => {
        requireValid(record(file));
        return { key: id(file.key), name: text(file.name, 4096) };
      });
      const attachments = message.attachments === undefined ? undefined : array(message.attachments, 1000).map((attachment) => {
        requireValid(record(attachment));
        const reference = text(attachment.reference, 512);
        const name = text(attachment.name, 4096);
        const mimeType = text(attachment.mimeType, 128);
        requireValid(attachmentReference.test(reference) && name.length > 0 && !/[\\/\p{Cc}]/u.test(name)
          && attachmentMimes.has(mimeType) && timestamp(attachment.size));
        return { reference, name, mimeType: mimeType as SentAttachment["mimeType"], size: attachment.size };
      });
      const unavailableAttachments = message.unavailableAttachments === undefined ? undefined
        : array(message.unavailableAttachments, 1000).map((value) => {
          const name = text(value, 4096);
          requireValid(name.trim() && !/[\\/\p{Cc}]/u.test(name));
          return name;
        });
      return { sourceId, role: message.role as "user" | "assistant" | "system", content: text(message.content),
        createdAt: message.createdAt, status: message.status as StoredChatMessage["status"], files,
        ...(message.thinkingSummary === undefined ? {} : { thinkingSummary: text(message.thinkingSummary) }),
        ...(message.replyToSourceId === undefined ? {} : { replyToSourceId: message.replyToSourceId === null ? null : id(message.replyToSourceId) }),
        ...(attachments === undefined ? {} : { attachments }),
        ...(unavailableAttachments === undefined ? {} : { unavailableAttachments }) };
    });
    const seen = new Set<string>();
    for (const message of messages) {
      if (message.replyToSourceId !== undefined && message.replyToSourceId !== null) {
        requireValid(message.role === "assistant" && seen.has(message.replyToSourceId)
          && sourceIds.get(message.replyToSourceId) === "user");
      }
      seen.add(message.sourceId);
    }
    return { sourceKey, topicId: id(item.topicId), assistantId, title: text(item.title),
      createdAt: item.createdAt, updatedAt: item.updatedAt, messages };
  });
  const warnings = array(raw.warnings, 100000).map((warning) => text(warning));
  return { format: raw.format, assistants, conversations, warnings };
}

class DexieCherryImportRepository implements CherryImportRepository {
  constructor(private readonly database: AyaseDatabase) {}

  async existingSourceKeys(keys: string[]): Promise<string[]> {
    const db = this.database;
    return db.transaction("r", [db.cherryImports, db.conversations], async () => {
      const existing: string[] = [];
      for (const key of new Set(keys)) {
        const marker = await db.cherryImports.get(markerId("conversation", key));
        if (marker && "conversationIds" in marker && (await db.conversations.bulkGet(marker.conversationIds)).some(Boolean)) existing.push(key);
      }
      return existing;
    });
  }

  async commit(input: CherryImportPlan, mode: "skip" | "copy"): Promise<CherryImportResult> {
    requireValid(mode === "skip" || mode === "copy");
    const plan = validatedPlan(input);
    const db = this.database;
    return db.transaction("rw", [db.assistants, db.conversations, db.chats, db.cherryImports, db.workspace], async () => {
      let imported = 0;
      let skipped = 0;
      let nextOrder = (await db.assistants.toArray()).reduce((max, assistant) => Math.max(max, assistant.sortOrder), -1) + 1;
      const assistantIds = new Map<string, string>();
      const names = new Map(plan.assistants.map((assistant) => [assistant.id, assistant.name]));
      for (const conversation of plan.conversations) {
        const key = markerId("conversation", conversation.sourceKey);
        const previous = await db.cherryImports.get(key);
        const liveIds = previous && "conversationIds" in previous
          ? (await db.conversations.bulkGet(previous.conversationIds)).flatMap((item) => item ? [item.id] : []) : [];
        if (mode === "skip" && liveIds.length) {
          await db.cherryImports.put({ id: key, conversationIds: liveIds });
          skipped++;
          continue;
        }
        let assistantId = assistantIds.get(conversation.assistantId);
        if (!assistantId) {
          const assistantKey = markerId("assistant", conversation.assistantId);
          const previousAssistant = await db.cherryImports.get(assistantKey);
          if (previousAssistant && "assistantId" in previousAssistant && await db.assistants.get(previousAssistant.assistantId)) {
            assistantId = previousAssistant.assistantId;
          } else {
            assistantId = crypto.randomUUID();
            await db.assistants.add({ id: assistantId, name: names.get(conversation.assistantId)?.trim() || "导入助手",
              icon: "", sortOrder: nextOrder++, defaultModelId: null, defaultConfig: defaultSessionConfig() });
            await db.cherryImports.put({ id: assistantKey, assistantId });
          }
          assistantIds.set(conversation.assistantId, assistantId);
        }
        const conversationId = crypto.randomUUID();
        const messageIds = new Map(conversation.messages.map((message) => [message.sourceId, crypto.randomUUID()]));
        const messages: StoredChatMessage[] = conversation.messages.map((message) => ({
          id: messageIds.get(message.sourceId)!, role: message.role, content: message.content, status: message.status,
          source: { source: "cherry", id: message.sourceId, createdAt: message.createdAt,
            ...(message.unavailableAttachments === undefined ? {} : { unavailableAttachments: message.unavailableAttachments }) },
          ...(message.replyToSourceId === undefined ? {} : { replyToId: message.replyToSourceId === null ? null : messageIds.get(message.replyToSourceId)! }),
          ...(message.thinkingSummary === undefined ? {} : { thinkingSummary: message.thinkingSummary }),
          ...(message.attachments === undefined ? {} : { attachments: message.attachments }),
        }));
        await db.conversations.add({ id: conversationId, assistantId, title: conversation.title.trim() || "新对话",
          titleNaming: "manual", createdAt: conversation.createdAt, updatedAt: conversation.updatedAt,
          settings: { modelId: null, config: defaultSessionConfig() } });
        const chat: ChatSnapshot = { id: conversationId, updatedAt: conversation.updatedAt, messages };
        await db.chats.add(chat);
        await db.cherryImports.put({ id: key, conversationIds: [...liveIds, conversationId] });
        imported++;
      }
      return { imported, skipped };
    });
  }
}

export function createCherryImportRepository(databaseName = "AyaseStudio", database?: AyaseDatabase): CherryImportRepository {
  return new DexieCherryImportRepository(database ?? new AyaseDatabase(databaseName));
}
