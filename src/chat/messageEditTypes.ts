import type { DraftAttachment, SentAttachment } from "./attachments";
import type { StoredChatMessage } from "./repository";

/** Runtime only. The editor's base is checked again against the durable message. */
export interface MessageEditDraft {
  base: StoredChatMessage;
  attachments?: MessageEditAttachment[];
}
export type MessageEditAttachment =
  | { kind: "retained"; attachment: SentAttachment }
  | { kind: "added"; attachment: DraftAttachment };

export type MessageEditResult = {
  status: "notSaved" | "saved" | "savedNeedsReload" | "recoveryRequired";
  error?: string;
  warning?: string;
};
