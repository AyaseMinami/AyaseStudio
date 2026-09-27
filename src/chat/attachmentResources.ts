import { invoke } from "@tauri-apps/api/core";
import { AttachmentError, base64ToBytes,
  type RequestAttachment, type SentAttachment } from "./attachments";

const errors: Record<string, string> = {
  "attachment-unsupported": "不支持此附件类型。请选择图片、PDF、常用文本或 DOCX/XLSX/PPTX。",
  "attachment-corrupt": "附件内容无法读取或编码无效。",
  "attachment-invalid-reference": "附件引用无效。",
  "attachment-unavailable": "附件已不可读取。",
  "attachment-storage": "无法保存附件到应用私有目录。",
};

function nativeError(error: unknown): AttachmentError {
  const code = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  return new AttachmentError(errors[code] ?? "本地附件操作失败，请重试。");
}

export interface AttachmentStore {
  save(draft: RequestAttachment): Promise<SentAttachment>;
  read(sent: SentAttachment): Promise<RequestAttachment>;
  verify(items: SentAttachment[]): Promise<void>;
  discardUncommitted(references: string[]): Promise<void>;
  cleanup(retainedReferences: string[], pendingReferences: string[]): Promise<void>;
}

export function createTauriAttachmentStore(): AttachmentStore {
  return {
    async save(draft) {
      try {
        const item = await invoke<SentAttachment>("persist_attachment", { name: draft.name, data: draft.data });
        if (item.name !== draft.name || item.size !== draft.size || item.mimeType !== draft.mimeType) {
          try { await invoke("discard_uncommitted_attachments", { references: [item.reference] }); }
          catch { throw new AttachmentError("保存的附件元数据不一致，暂存副本清理失败；下次启动将重试。"); }
          throw new AttachmentError("保存的附件元数据不一致。");
        }
        return item;
      } catch (error) { throw error instanceof AttachmentError ? error : nativeError(error); }
    },
    async read(sent) {
      try {
        const data = await invoke<string>("read_sent_attachment", { reference: sent.reference });
        const bytes = base64ToBytes(data);
        if (bytes.length !== sent.size) {
          throw new AttachmentError("已发送附件与记录不一致。");
        }
        return { name: sent.name, mimeType: sent.mimeType, size: sent.size, data };
      } catch (error) { throw error instanceof AttachmentError ? error : nativeError(error); }
    },
    async verify(items) {
      try { await invoke("verify_sent_attachments", { items: items.map(({ reference, size }) => ({ reference, size })) }); }
      catch (error) { throw nativeError(error); }
    },
    async discardUncommitted(references) {
      try { await invoke("discard_uncommitted_attachments", { references }); }
      catch (error) { throw nativeError(error); }
    },
    async cleanup(retainedReferences, pendingReferences) {
      try { await invoke("cleanup_sent_attachments", { retainedReferences, pendingReferences }); }
      catch (error) { throw nativeError(error); }
    },
  };
}
