import { bytesToBase64, type RequestAttachment, type SentAttachment } from "../../src/chat/attachments";
import type { AttachmentStore } from "../../src/chat/attachmentResources";
export const assets = new Map<string, RequestAttachment>(JSON.parse(sessionStorage.getItem("edit128-synthetic-assets") ?? "[]"));
export function rememberAssets() { sessionStorage.setItem("edit128-synthetic-assets", JSON.stringify([...assets])); }
export const fixture = { failSave: false, failReload: false, requests: 0, failProvider: false };
export function seed(name: string, data: string, mimeType: SentAttachment["mimeType"] = "text/plain"): SentAttachment {
  const reference = `attachments/${crypto.randomUUID()}.${mimeType === "image/png" ? "png" : "txt"}`;
  const size = atob(data).length;
  assets.set(reference, { name, data, size, mimeType }); rememberAssets(); return { reference, name, size, mimeType };
}
export const textFile = (name: string, text: string) => seed(name, bytesToBase64(new TextEncoder().encode(text)));
export function createTauriAttachmentStore(): AttachmentStore {
  return {
    async save(draft) {
      if (fixture.failSave) throw Error("合成文件保存失败，原消息保持。");
      return seed(draft.name, draft.data, draft.mimeType);
    },
    async read(item) { const found = assets.get(item.reference); if (!found) throw Error("合成附件已不可读取。"); return found; },
    async verify(items) { if (items.some(item => !assets.has(item.reference))) throw Error("合成附件校验失败。"); },
    async discardUncommitted(refs) { refs.forEach(ref => assets.delete(ref)); rememberAssets(); },
    async cleanup(retained, pending) { for (const ref of assets.keys()) if (!retained.includes(ref) && !pending.includes(ref)) assets.delete(ref); rememberAssets(); },
  };
}
