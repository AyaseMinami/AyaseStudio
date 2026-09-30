import type { AttachmentLifecycle } from "../chat/attachmentLifecycle";
import type { RequestAttachment, SentAttachment } from "../chat/attachments";
import type { CherryImportPlan, CherryImportRepository, CherryImportResult } from "./cherryTypes";

export interface CherryImportResources {
  readFile(key: string, name: string): Promise<RequestAttachment | null>;
  verify(items: SentAttachment[]): Promise<void>;
  lifecycle: Pick<AttachmentLifecycle, "save" | "commit" | "discard" | "cleanup">;
}

/** Native verification precedes the authoritative DB transaction; subsequent housekeeping cannot roll it back. */
export async function commitCherryImport(plan: CherryImportPlan, mode: "skip" | "copy",
  repository: CherryImportRepository, resources: CherryImportResources): Promise<CherryImportResult & { warnings: string[] }> {
  const warnings = new Set(plan.warnings);
  const staged: SentAttachment[] = [];
  let result: CherryImportResult;
  let skipped = 0;
  try {
    const existing = mode === "skip"
      ? new Set(await repository.existingSourceKeys(plan.conversations.map((conversation) => conversation.sourceKey)))
      : new Set<string>();
    const selected = plan.conversations.filter((conversation) => !existing.has(conversation.sourceKey));
    skipped = plan.conversations.length - selected.length;
    if (!selected.length) return { imported: 0, skipped, warnings: [...warnings] };
    const files = new Map<string, SentAttachment | null>();
    const conversations: CherryImportPlan["conversations"] = [];
    for (const conversation of selected) {
      const messages: typeof conversation.messages = [];
      for (const message of conversation.messages) {
        const attachments: SentAttachment[] = [];
        const unavailableAttachments = new Set<string>();
        for (const file of message.files) {
          if (!files.has(file.key)) {
            const draft = await resources.readFile(file.key, file.name);
            const saved = draft ? await resources.lifecycle.save(draft) : null;
            if (saved) staged.push(saved);
            else warnings.add("部分附件缺失或格式不受支持，已保留消息和文件信息。");
            files.set(file.key, saved);
          }
          const saved = files.get(file.key);
          if (saved) attachments.push({ ...saved, name: file.name });
          else unavailableAttachments.add(file.name);
        }
        messages.push({ ...message, files: message.files.map((file) => ({ ...file })),
          attachments: attachments.length ? attachments : undefined,
          unavailableAttachments: unavailableAttachments.size ? [...unavailableAttachments] : undefined });
      }
      conversations.push({ ...conversation, messages });
    }
    if (staged.length) await resources.verify(staged);
    result = await repository.commit({ ...plan, conversations }, mode);
  } catch {
    try { await resources.lifecycle.discard(staged); } catch { /* Preserve generic error; never echo private native paths. */ }
    throw new Error("Cherry 聊天导入失败，未提交聊天记录。请检查备份后重试。");
  }
  try {
    await resources.lifecycle.commit(staged);
    await resources.lifecycle.cleanup();
  } catch {
    warnings.add("聊天记录已导入，但附件整理未完成，请稍后重试整理。");
  }
  return { imported: result.imported, skipped: result.skipped + skipped, warnings: [...warnings] };
}
