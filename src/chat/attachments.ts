const officeMimeTypes = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
} as const;
export type AttachmentMime = "image/png" | "image/jpeg" | "image/webp" | "application/pdf" | "text/plain" | "text/markdown"
  | typeof officeMimeTypes[keyof typeof officeMimeTypes];
const textExtensions = "txt,csv,tsv,json,xml,yaml,yml,log,html,htm,css,js,jsx,ts,tsx,py,rs,java,c,cpp,h,hpp,cs,go,sh,sql,toml,ini,tex".split(",");
export function isOfficeAttachment(item: AttachmentMetadata): boolean {
  return Object.values(officeMimeTypes).some((mime) => mime === item.mimeType);
}
export function attachmentAccept(): string {
  return ["png", "jpg", "jpeg", "webp", "pdf", "md", "markdown", ...textExtensions,
    ...Object.keys(officeMimeTypes)].map((ext) => `.${ext}`).join(",");
}

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
  if (extension && textExtensions.includes(extension)) return "text/plain";
  if (extension === "docx" || extension === "xlsx" || extension === "pptx") return officeMimeTypes[extension];
  switch (extension) {
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    case "pdf": return "application/pdf";
    case "txt": return "text/plain";
    case "md": case "markdown": return "text/markdown";
    default: throw new AttachmentError("不支持此文件类型。可添加图片、PDF、常用文本或 DOCX/XLSX/PPTX（仅 Responses）。");
  }
}

function mimeFromHeader(name: string, bytes: Uint8Array): AttachmentMime {
  if (!name || /[\\/\p{Cc}]/u.test(name)) throw new AttachmentError("附件文件名无效。");
  const declaredMimeType = mimeFromName(name);
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  if (isOfficeAttachment({ name, mimeType: declaredMimeType, size: bytes.length }) && !starts(80, 75, 3, 4)) {
    throw new AttachmentError("Office 文件容器格式无效，请选择 DOCX/XLSX/PPTX 原文件。");
  }
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
  if (attachments.some(isOfficeAttachment)) return "Office 原文件由 Responses 服务端处理，本地不解析；文档内图片/图表不保证读取，表格可能只处理部分行。中转站兼容性尚未核实。";
  if (!attachments.some((item) => !item.mimeType.startsWith("text/"))) return undefined;
  return model.trim()
    ? "当前模型的图片/PDF 输入能力尚未核实；若上游不支持会报告错误，不会自动改用其他模型或重试。"
    : "请先选择模型；当前图片/PDF 输入能力无法确认。";
}

export function attachmentCapabilityFailure(protocol: ChatProtocol, model: string,
  attachments: AttachmentMetadata[]): string | undefined {
  if (protocol !== "openai-responses" && attachments.some(isOfficeAttachment)) {
    return "Office 附件仅支持 Responses 连接。请切换连接或移除附件；不会自动转换文件。";
  }
  if (!attachments.some((item) => item.mimeType.startsWith("image/") || item.mimeType === "application/pdf")) return undefined;
  if ((protocol === "openai-chat" || protocol === "openai-responses") &&
    (/^gpt-3\.5-turbo(?:$|-)/i.test(model) || /^gpt-4(?:$|-(?:0314|0613)(?:$|-))/i.test(model) ||
      /^gpt-4-turbo-preview(?:$|-)/i.test(model))) {
    return `${model} 的官方模型资料注明不支持图片输入，因此也不能解析 PDF 页面图片；请改用具备视觉能力的模型，附件未发送。`;
  }
  return undefined;
}
import type { ChatProtocol } from "./types";
