export type AttachmentMime = "image/png" | "image/jpeg" | "image/webp" | "application/pdf" | "text/plain" | "text/markdown";

export interface AttachmentMetadata {
  name: string;
  mimeType: AttachmentMime;
  size: number;
}

export interface DraftAttachment extends AttachmentMetadata {
  id: string;
  file: File;
}

export interface SentAttachment extends AttachmentMetadata {
  reference: string;
}

export interface RequestAttachment extends AttachmentMetadata {
  data: string;
}

export class AttachmentError extends Error {}

function mimeFromName(name: string): AttachmentMime {
  const extension = name.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    case "pdf": return "application/pdf";
    case "txt": return "text/plain";
    case "md": case "markdown": return "text/markdown";
    default: throw new AttachmentError("仅支持 PNG/JPEG/WebP/PDF/TXT/Markdown 文件。");
  }
}

function mimeFromHeader(name: string, bytes: Uint8Array): AttachmentMime {
  if (!name || /[\\/\p{Cc}]/u.test(name)) throw new AttachmentError("附件文件名无效。");
  const declaredMimeType = mimeFromName(name);
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  if (declaredMimeType.startsWith("image/")) {
    const actualMimeType: AttachmentMime | undefined = starts(137, 80, 78, 71, 13, 10, 26, 10)
      ? "image/png" : starts(255, 216, 255)
        ? "image/jpeg" : starts(82, 73, 70, 70) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
          ? "image/webp" : undefined;
    return actualMimeType ?? declaredMimeType;
  }
  return declaredMimeType;
}

export function validateAttachmentBytes(name: string, bytes: Uint8Array): AttachmentMime {
  const mimeType = mimeFromHeader(name, bytes);
  if (mimeType.startsWith("text/")) {
    try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new AttachmentError("文本附件必须是 UTF-8 编码。"); }
  }
  return mimeType;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  return btoa(binary);
}

export function base64ToBytes(data: string): Uint8Array {
  const binary = atob(data);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function prepareDraftAttachment(file: File): Promise<DraftAttachment> {
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const mimeType = mimeFromHeader(file.name, header);
  return { id: crypto.randomUUID(), name: file.name, mimeType, size: file.size, file };
}

export async function materializeDraftAttachment(draft: DraftAttachment): Promise<RequestAttachment> {
  const bytes = new Uint8Array(await draft.file.arrayBuffer());
  return { name: draft.name, mimeType: validateAttachmentBytes(draft.name, bytes),
    size: bytes.length, data: bytesToBase64(bytes) };
}

export function addDraftAttachments(existing: DraftAttachment[], added: DraftAttachment[]): DraftAttachment[] {
  return [...existing, ...added];
}

export function safeTextAttachment(data: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(base64ToBytes(data));
}

export function attachmentCapabilityNotice(model: string, attachments: AttachmentMetadata[]): string | undefined {
  if (!attachments.some((item) => !item.mimeType.startsWith("text/"))) return undefined;
  return model.trim()
    ? "当前模型的图片/PDF 输入能力尚未核实；若上游不支持会报告错误，不会自动改用其他模型或重试。"
    : "请先选择模型；当前图片/PDF 输入能力无法确认。";
}

export function attachmentCapabilityFailure(protocol: ChatProtocol, model: string,
  attachments: AttachmentMetadata[]): string | undefined {
  if (!attachments.some((item) => item.mimeType.startsWith("image/") || item.mimeType === "application/pdf")) return undefined;
  if ((protocol === "openai-chat" || protocol === "openai-responses") &&
    (/^gpt-3\.5-turbo(?:$|-)/i.test(model) || /^gpt-4(?:$|-(?:0314|0613)(?:$|-))/i.test(model) ||
      /^gpt-4-turbo-preview(?:$|-)/i.test(model))) {
    return `${model} 的官方模型资料注明不支持图片输入，因此也不能解析 PDF 页面图片；请改用具备视觉能力的模型，附件未发送。`;
  }
  return undefined;
}
import type { ChatProtocol } from "./types";
