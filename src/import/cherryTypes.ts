import type { SentAttachment } from "../chat/attachments";
import type { StoredMessageStatus } from "../chat/repository";

/** Native readers return only these chat fields; configuration never crosses IPC. */
export interface CherryPart {
  type: "text" | "thinking" | "file" | "unsupported";
  text?: string;
  fileKey?: string;
  name?: string;
  available?: boolean;
}
export interface CherryMessage {
  id: string;
  role: "user" | "assistant" | "system" | "root";
  createdAt: number;
  status: StoredMessageStatus;
  parentId?: string | null;
  askId?: string;
  parts: CherryPart[];
}
export interface CherryTopic {
  id: string;
  assistantId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  activeNodeId?: string | null;
  messages: CherryMessage[];
}
export interface CherryBackup {
  token: string;
  format: 5 | 6 | 7;
  appVersion?: string;
  source: "legacy-json" | "legacy-chromium" | "sqlite";
  assistants: { id: string; name: string }[];
  topics: CherryTopic[];
  warnings: string[];
}
export interface CherryImportMessage {
  sourceId: string;
  role: "user" | "assistant" | "system";
  content: string;
  thinkingSummary?: string;
  createdAt: number;
  status: StoredMessageStatus;
  replyToSourceId?: string | null;
  files: { key: string; name: string }[];
  attachments?: SentAttachment[];
  unavailableAttachments?: string[];
}
export interface CherryImportConversation {
  /** Stable source identity including the ordered source path, independent of content. */
  sourceKey: string;
  topicId: string;
  assistantId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: CherryImportMessage[];
}
export interface CherryImportPlan {
  format: 5 | 6 | 7;
  assistants: { id: string; name: string }[];
  conversations: CherryImportConversation[];
  warnings: string[];
}
export interface CherryImportResult {
  imported: number;
  skipped: number;
}
export interface CherryImportRepository {
  existingSourceKeys(keys: string[]): Promise<string[]>;
  commit(plan: CherryImportPlan, mode: "skip" | "copy"): Promise<CherryImportResult>;
}
