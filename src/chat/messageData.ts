import { dataCheck, dataRecord } from "../storage/dataContract";
import { dataPolicies } from "../storage/dataPolicies";
import { readMessageGenerationMetrics } from "./generationMetricsData";
import type { SentAttachment } from "./attachments";
import type { StoredChatMessage } from "./repository";
import { readSessionConfigData } from "./sessionConfig";

export const attachmentReference = /^attachments\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp|pdf|txt|md|docx|xlsx|pptx)$/;
const mimes = ["image/png", "image/jpeg", "image/webp", "application/pdf", "text/plain", "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"];
function keys(raw: unknown, policy: object): asserts raw is Record<string, unknown> {
  dataRecord(raw); dataCheck(Object.keys(raw).every(key => Object.prototype.hasOwnProperty.call(policy, key)));
}
function string(raw: unknown): asserts raw is string { dataCheck(typeof raw === "string"); }
function time(raw: unknown): void { dataCheck(Number.isSafeInteger(raw) && (raw as number) >= 0); }
function strings(raw: unknown): void { dataCheck(Array.isArray(raw)); raw.forEach(string); }
function search(raw: unknown): void {
  keys(raw, dataPolicies.searchRecord);
  dataCheck(typeof raw.enabled === "boolean" && ["pending", "searching", "completed", "not-used", "failed", "cancelled"].includes(raw.status as string));
  if (raw.provider !== undefined) dataCheck(["exa-mcp", "exa-api", "tavily", "zhipu"].includes(raw.provider as string));
  for (const name of ["warning", "suggestionHtml", "error"]) if (raw[name] !== undefined) string(raw[name]);
  strings(raw.queries); dataCheck(Array.isArray(raw.sources) && Array.isArray(raw.citations));
  raw.sources.forEach(item => {
    keys(item, dataPolicies.searchSource); string(item.id); string(item.url); string(item.title);
    if (item.excerpt !== undefined) string(item.excerpt);
  });
  raw.citations.forEach(item => {
    keys(item, dataPolicies.citation); time(item.start); time(item.end);
    dataCheck((item.start as number) <= (item.end as number)); strings(item.sourceIds);
  });
}
function replay(raw: unknown): void {
  keys(raw, dataPolicies.replay); dataCheck(raw.protocol === "anthropic-native"); string(raw.scope);
  dataCheck(Array.isArray(raw.content)); raw.content.forEach(dataRecord);
  if (raw.responses !== undefined) {
    dataCheck(Array.isArray(raw.responses)); raw.responses.forEach(response => { dataCheck(Array.isArray(response)); response.forEach(dataRecord); });
  }
  // Provider replay blocks intentionally retain provider-defined keys as opaque data.
}
function historyMessage(raw: unknown): void {
  keys(raw, dataPolicies.continuationMessage);
  dataCheck(["system", "user", "assistant"].includes(raw.role as string)); string(raw.content);
  if (raw.attachments !== undefined) { dataCheck(Array.isArray(raw.attachments)); raw.attachments.forEach(readSentAttachment); }
  if (raw.search !== undefined) search(raw.search);
  if (raw.providerReplay !== undefined) replay(raw.providerReplay);
}
export function readSentAttachment(raw: unknown): SentAttachment {
  const value = structuredClone(raw);
  keys(value, dataPolicies.attachment);
  dataCheck(typeof value.reference === "string" && attachmentReference.test(value.reference));
  dataCheck(typeof value.name === "string" && !!value.name && !/[\\/\p{Cc}]/u.test(value.name));
  dataCheck(Number.isSafeInteger(value.size) && (value.size as number) >= 0 && mimes.includes(value.mimeType as string));
  return value as unknown as SentAttachment;
}

/** Shared clone-based structural read. Backup also verifies asset bytes and portable-only states. */
export function readMessageData(raw: unknown, pair = false): StoredChatMessage {
  const value = readMessageGenerationMetrics(raw);
  keys(value, dataPolicies.messages);
  dataCheck(!pair || value.roundVersions === undefined);
  dataCheck(typeof value.id === "string" && !!value.id.trim());
  dataCheck(["system", "user", "assistant"].includes(value.role as string) && typeof value.content === "string");
  dataCheck(["complete", "incomplete", "paused", "streaming", "aborted", "failed"].includes(value.status as string));
  if (value.attachments !== undefined) {
    dataCheck(Array.isArray(value.attachments)); value.attachments = value.attachments.map(readSentAttachment);
  }
  if (value.replyToId !== undefined && value.replyToId !== null) string(value.replyToId);
  if (value.editedAt !== undefined) time(value.editedAt);
  if (value.thinkingSummary !== undefined) string(value.thinkingSummary);
  if (value.source !== undefined) {
    keys(value.source, dataPolicies.messageSource); dataCheck(value.source.source === "cherry"); string(value.source.id); time(value.source.createdAt);
    if (value.source.unavailableAttachments !== undefined) {
      strings(value.source.unavailableAttachments);
      dataCheck((value.source.unavailableAttachments as string[]).every(name => !/[\\/\p{Cc}]/u.test(name)));
    }
  }
  if (value.search !== undefined) search(value.search);
  if (value.providerReplay !== undefined) replay(value.providerReplay);
  if (value.continuation !== undefined) {
    keys(value.continuation, dataPolicies.continuation);
    readSessionConfigData(value.continuation.config);
    string(value.continuation.model); string(value.continuation.baseUrl); string(value.continuation.scope);
    dataCheck(Array.isArray(value.continuation.messages)); value.continuation.messages.forEach(historyMessage);
  }
  if (value.roundVersions !== undefined) {
    keys(value.roundVersions, dataPolicies.roundVersions);
    const versions = value.roundVersions;
    dataCheck(Array.isArray(versions.pairs) && Number.isInteger(versions.selected)
      && (versions.selected as number) >= 0 && (versions.selected as number) < versions.pairs.length);
    versions.pairs = versions.pairs.map(pair => {
      dataCheck(Array.isArray(pair) && pair.length === 2);
      const messages = pair.map(item => readMessageData(item, true));
      dataCheck(messages[0].role === "user" && messages[1].role === "assistant"
        && messages[1].replyToId === messages[0].id);
      return messages;
    });
  }
  return value as unknown as StoredChatMessage;
}

export function readEditTranscript(raw: StoredChatMessage[]): StoredChatMessage[] {
  const messages = raw.map(message => readMessageData(message));
  dataCheck(new Set(messages.map(message => message.id)).size === messages.length);
  const present = new Set(messages.map(message => message.id)), seen = new Set<string>();
  for (const message of messages) {
    dataCheck(!message.replyToId || !present.has(message.replyToId) || seen.has(message.replyToId));
    seen.add(message.id);
  }
  return messages;
}

/** IndexedDB omits undefined fields in some paths; property order carries no meaning. */
export function sameTranscriptValue(left: unknown, right: unknown): boolean {
  function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
    return JSON.stringify(value);
  }
  return canonical(left) === canonical(right);
}

export function editedMessage(base: StoredChatMessage, content: string, attachments: SentAttachment[] | undefined,
  editedAt = Date.now()): StoredChatMessage {
  if (base.role !== "user" && base.role !== "assistant") throw new Error("此消息不支持编辑。");
  const final = attachments === undefined ? base.attachments : attachments;
  if (base.role !== "user" && attachments !== undefined && !sameTranscriptValue(final ?? [], base.attachments ?? []))
    throw new Error("仅用户消息支持附件编辑。");
  if (!content.trim() && !final?.length) throw new Error("消息正文和附件不能同时为空。");
  const value = { ...base, content, editedAt, search: undefined, providerReplay: undefined, continuation: undefined,
    status: base.status === "paused" ? "incomplete" as const : base.status };
  if (final?.length) value.attachments = final.map(readSentAttachment); else delete value.attachments;
  return value;
}
