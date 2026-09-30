import { bytesToBase64 } from "../chat/attachments";
import type { BackupDocument, BackupPreview } from "./types";
import { validateDocument } from "./validation";

export const MAX_BACKUP_FILE = 128 * 1024 * 1024;
export const MAX_PAYLOAD = 80 * 1024 * 1024;
export const KDF_ITERATIONS = 600_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const AAD = encoder.encode("ayase-studio-backup|1|PBKDF2-SHA256|600000|AES-256-GCM|128");
export function check(value: unknown, message = "备份格式、数据或资源引用无效。"): asserts value {
  if (!value) throw new Error(message);
}
export function decode64(value: unknown, maximum: number): Uint8Array<ArrayBuffer> {
  check(typeof value === "string" && value.length <= Math.ceil(maximum / 3) * 4 && value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value));
  const binary = atob(value), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  check(bytes.length <= maximum && bytesToBase64(bytes) === value);
  return bytes;
}
export async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return bytesToBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}
async function key(password: string, salt: Uint8Array<ArrayBuffer>) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: KDF_ITERATIONS }, material,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function encodeBackup(document: BackupDocument, encrypted = false, password = "", confirmation = ""): Promise<string> {
  await validateDocument(document);
  check(typeof encrypted === "boolean");
  if (encrypted) check(password === confirmation, "两次输入的密码不一致。");
  const bytes = encoder.encode(JSON.stringify(document));
  check(bytes.length <= MAX_PAYLOAD, "备份超过单个文件的资源预算。");
  const payload = JSON.stringify({ sha256: await sha256(bytes), document: decoder.decode(bytes) });
  let envelope: unknown;
  if (encrypted) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD, tagLength: 128 }, await key(password, salt), encoder.encode(payload));
    envelope = { format: "ayase-studio-envelope", version: 1, encrypted: true, kdf: "PBKDF2-SHA256", iterations: KDF_ITERATIONS,
      cipher: "AES-256-GCM", salt: bytesToBase64(salt), iv: bytesToBase64(iv), payload: bytesToBase64(new Uint8Array(encrypted)) };
  } else envelope = { format: "ayase-studio-envelope", version: 1, encrypted: false, payload };
  const result = JSON.stringify(envelope);
  check(encoder.encode(result).length <= MAX_BACKUP_FILE, "备份超过单个文件的资源预算。");
  return result;
}
export function encryptedBackup(serialized: string): boolean {
  check(serialized.length <= MAX_BACKUP_FILE && encoder.encode(serialized).length <= MAX_BACKUP_FILE, "备份文件过大。");
  let raw;
  try { raw = JSON.parse(serialized); } catch { throw new Error("无法识别此备份文件。"); }
  check(raw && raw.format === "ayase-studio-envelope" && raw.version === 1 && typeof raw.encrypted === "boolean", "不支持此备份格式或版本。");
  return raw.encrypted;
}
export async function decodeBackup(serialized: string, password = ""): Promise<BackupPreview> {
  const encrypted = encryptedBackup(serialized);
  const raw = JSON.parse(serialized);
  let payload: string;
  if (encrypted) {
    check(Object.keys(raw).sort().join() === "cipher,encrypted,format,iterations,iv,kdf,payload,salt,version"
      && raw.kdf === "PBKDF2-SHA256" && raw.iterations === KDF_ITERATIONS && raw.cipher === "AES-256-GCM", "不支持此加密参数。");
    const salt = decode64(raw.salt, 16), iv = decode64(raw.iv, 12);
    check(salt.length === 16 && iv.length === 12);
    const bytes = decode64(raw.payload, MAX_BACKUP_FILE);
    try {
      payload = decoder.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: AAD, tagLength: 128 }, await key(password, salt), bytes));
    } catch { throw new Error("密码错误，或加密备份已损坏／被篡改。"); }
  } else {
    check(Object.keys(raw).sort().join() === "encrypted,format,payload,version" && typeof raw.payload === "string");
    payload = raw.payload;
  }
  // JSON escaping can expand the document string in this container. The outer
  // file is already bounded; apply the document limit after extracting it.
  check(encoder.encode(payload).length <= MAX_BACKUP_FILE, "备份载荷过大。");
  let container;
  try { container = JSON.parse(payload); } catch { throw new Error("备份载荷损坏。"); }
  check(container && Object.keys(container).sort().join() === "document,sha256" && typeof container.document === "string");
  const bytes = encoder.encode(container.document);
  check(bytes.length <= MAX_PAYLOAD && await sha256(bytes) === container.sha256, "备份完整性校验失败。");
  let document;
  try { document = JSON.parse(container.document); } catch { throw new Error("备份内容损坏。"); }
  await validateDocument(document);
  const counts = { assistants: document.rows.assistants.length, conversations: document.rows.conversations.length,
    messages: document.rows.chats.reduce((n: number, c: { messages: { roundVersions?: { pairs: unknown[] } }[] }) => n + c.messages.reduce((count, m) => count + 1 + (m.roundVersions ? (m.roundVersions.pairs.length - 1) * 2 : 0), 0), 0),
    avatars: document.rows.avatarLibrary.length, files: document.assets.length,
    connections: document.connections?.providers.reduce((n: number, p: { connections: unknown[] }) => n + p.connections.length, 0) ?? 0 };
  return { document, encrypted, counts };
}
