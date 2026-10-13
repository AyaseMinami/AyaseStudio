import { materializeDraftAttachment, type SentAttachment } from "./attachments";
import type { AttachmentLifecycle } from "./attachmentLifecycle";
import type { AttachmentStore } from "./attachmentResources";
import { editedMessage, readEditTranscript, readSentAttachment, sameTranscriptValue } from "./messageData";
import type { MessageEditDraft, MessageEditResult } from "./messageEditTypes";
import type { StoredChatMessage } from "./repository";
import { retainedRoundMessages } from "./roundVersions";
import { withReplyLinks } from "./messageOperations";

export interface MessageEditAccess {
  canBegin(id: string): boolean;
  read(id: string, flush: boolean): Promise<StoredChatMessage[]>;
  replace(id: string, before: StoredChatMessage[], after: StoredChatMessage[]): Promise<void>;
  detach(id: string): void;
  reload(id: string, confirmed?: StoredChatMessage[]): Promise<void>;
  outcome(id: string, result: MessageEditResult): void;
}
export interface PreparedMessageEdit {
  messages: StoredChatMessage[];
  /** Acquire generation ownership synchronously, before relinquishing edit ownership. */
  claim?(): boolean;
  cancel?(): void;
  /** Start request only after durable references, verify and writable-store replacement. */
  committed?(): void;
}
interface Operation {
  id: string;
  before?: StoredChatMessage[];
  after?: StoredChatMessage[];
  ownedNew: SentAttachment[];
  lease?: { release(): Promise<void> };
  prepared?: PreparedMessageEdit;
  result?: MessageEditResult;
}
function detail(error: unknown): string { return error instanceof Error ? error.message : "本地消息保存失败。"; }

/** Owns accepted edits across navigation. No durable edit journal or provider retries. */
export class MessageEdits {
  private readonly operations = new Map<string, Operation>();
  private readonly pending = new Set<Promise<unknown>>();
  private accepting = true;
  constructor(private readonly access: MessageEditAccess, private readonly lifecycle: AttachmentLifecycle,
    private readonly files: AttachmentStore, private readonly changed: () => void = () => undefined) {}
  has = (id: string): boolean => this.operations.has(id);
  resultFor(id: string): MessageEditResult | undefined { return this.operations.get(id)?.result; }
  isPending = (): boolean => this.pending.size > 0;
  needsAttention = (): boolean => [...this.operations.values()].some(op => !!op.result);
  stopAccepting(): void { this.accepting = false; }
  activate(): void { this.accepting = true; }
  async settle(): Promise<void> { await Promise.allSettled([...this.pending]); }

  submit(id: string, messageId: string, content: string, draft: MessageEditDraft | undefined,
    prepare?: (before: StoredChatMessage[], edited: StoredChatMessage) => Promise<PreparedMessageEdit>): Promise<MessageEditResult> {
    if (!this.accepting || this.has(id) || !this.access.canBegin(id)) return Promise.resolve({ status: "notSaved", error: "请等待该对话的操作完成后重试。" });
    // Freeze synchronously, including File references, before any awaited work.
    const input = draft && { base: structuredClone(draft.base), attachments: draft.attachments?.map(item => item.kind === "retained"
      ? { kind: "retained" as const, attachment: structuredClone(item.attachment) }
      : { kind: "added" as const, attachment: { ...item.attachment } }) };
    const op: Operation = { id, ownedNew: [] };
    this.operations.set(id, op);
    this.changed();
    return this.track(this.run(op, messageId, content, input, prepare));
  }
  private track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise); this.changed();
    void promise.finally(() => { this.pending.delete(promise); this.changed(); }).catch(() => undefined);
    return promise;
  }
  private finish(op: Operation, result: MessageEditResult): MessageEditResult {
    op.result = result;
    if (result.status !== "savedNeedsReload" && result.status !== "recoveryRequired") this.operations.delete(op.id);
    this.access.outcome(op.id, result); this.changed(); return result;
  }
  private async readState(op: Operation): Promise<"before" | "after" | "unknown"> {
    try {
      const actual = await this.access.read(op.id, false);
      if (op.after && sameTranscriptValue(actual, op.after)) return "after";
      if (op.before && sameTranscriptValue(actual, op.before)) return "before";
    } catch { /* Unknown state keeps new reservations and old resource lease. */ }
    return "unknown";
  }
  private recovery(op: Operation, error: string): MessageEditResult {
    op.prepared?.cancel?.(); this.access.detach(op.id);
    return this.finish(op, { status: "recoveryRequired", error: `${error} 保存状态需核对，请重新加载并核对；不会自动发送。` });
  }
  private async abandon(op: Operation, error: string): Promise<MessageEditResult> {
    op.prepared?.cancel?.();
    let warning: string | undefined;
    try { await this.lifecycle.discard(op.ownedNew); }
    catch { warning = "未保存附件副本整理失败，已保留保护，将在下次整理时重试。"; }
    await op.lease?.release();
    return this.finish(op, { status: "notSaved", error, warning });
  }
  private async accept(op: Operation, forGeneration: boolean): Promise<MessageEditResult> {
    // Verification and DB ownership have both been confirmed; old files can now be released.
    await op.lease?.release(); op.lease = undefined;
    this.access.detach(op.id);
    try { await this.access.reload(op.id, forGeneration ? op.after : undefined); }
    catch {
      op.prepared?.cancel?.();
      return this.finish(op, { status: "savedNeedsReload", error: "消息已保存，但读取对话失败。请重新加载，无需重复保存。" });
    }
    let warning: string | undefined;
    try { await this.lifecycle.cleanup(); }
    catch { warning = "消息已保存，附件整理待重试。"; }
    const result = this.finish(op, { status: "saved", warning });
    try { if (forGeneration) op.prepared?.committed?.(); }
    catch { this.access.outcome(op.id, { status: "saved", error: "消息已保存，启动请求失败；不会自动重发。" }); }
    return result;
  }
  private async run(op: Operation, messageId: string, content: string, draft: MessageEditDraft | undefined,
    prepare?: (before: StoredChatMessage[], edited: StoredChatMessage) => Promise<PreparedMessageEdit>): Promise<MessageEditResult> {
    try {
      op.before = readEditTranscript(await this.access.read(op.id, true));
      const base = withReplyLinks(op.before).find(message => message.id === messageId);
      if (!base || (draft && !sameTranscriptValue(base, draft.base))) return this.abandon(op, "消息已变化，请重新打开编辑。");
      if (draft?.attachments !== undefined && base.role !== "user") throw new Error("仅用户消息支持附件编辑。");
      const items = draft?.attachments;
      // Validate old ownership and emptiness before file writes or provider preparation.
      const available = [...(base.attachments ?? [])];
      for (const item of items ?? []) if (item.kind === "retained") {
        const retained = readSentAttachment(item.attachment);
        const match = available.findIndex(original => sameTranscriptValue(original, retained));
        if (match < 0) throw new Error("附件不属于这条消息。");
        available.splice(match, 1);
      }
      if (!content.trim() && !(items?.length ?? base.attachments?.length ?? 0)) throw new Error("消息正文和附件不能同时为空。");
      if (base.role !== "user" && base.role !== "assistant") throw new Error("此消息不支持编辑。");
      op.lease = await this.lifecycle.acquireReferences(op.before.flatMap(retainedRoundMessages)
        .flatMap(message => message.attachments?.map(item => item.reference) ?? []));
      let final: SentAttachment[] | undefined;
      if (items !== undefined) {
        final = [];
        for (const item of items) {
          if (item.kind === "retained") final.push(readSentAttachment(item.attachment));
          else {
            const saved = await this.lifecycle.save(await materializeDraftAttachment(item.attachment));
            // Track successful saves before metadata validation can reject them.
            op.ownedNew.push(saved); final.push(readSentAttachment(saved));
          }
        }
      }
      if (op.ownedNew.length) await this.files.verify(op.ownedNew);
      const edited = editedMessage(base, content, final);
      op.prepared = prepare ? await prepare(structuredClone(op.before), edited) : undefined;
      op.after = readEditTranscript(op.prepared?.messages ?? op.before.map(message => message.id === messageId ? edited : message));
      if (op.prepared?.claim && !op.prepared.claim()) return this.abandon(op, "无法取得该对话生成权限；消息尚未保存。");
      try { await this.access.replace(op.id, op.before, op.after); }
      catch (error) {
        const state = await this.readState(op);
        if (state === "before") return this.abandon(op, detail(error));
        if (state === "unknown") return this.recovery(op, "无法确认消息写入结果。");
      }
      try { await this.lifecycle.commit(op.ownedNew); }
      catch {
        try { await this.access.replace(op.id, op.after, op.before); }
        catch { /* A lost acknowledgement can still be resolved by a durable read. */ }
        if (await this.readState(op) !== "before") return this.recovery(op, "附件校验失败，消息回滚尚未确认。");
        this.access.detach(op.id);
        try { await this.access.reload(op.id); }
        catch { return this.recovery(op, "消息已回滚，但重新读取失败。"); }
        return this.abandon(op, "附件校验失败；原消息已恢复，请重试。");
      }
      return this.accept(op, !!op.prepared);
    } catch (error) {
      if (op.after && await this.readState(op) !== "before") return this.recovery(op, detail(error));
      return this.abandon(op, detail(error));
    }
  }

  /** Explicit reconciliation, including navigation back to the original conversation. Never resends. */
  recover(id: string): Promise<MessageEditResult | undefined> {
    const op = this.operations.get(id);
    if (!op?.result || this.isPending()) return Promise.resolve(undefined);
    op.result = undefined; this.changed();
    return this.track((async () => {
      if (!op.lease) { // Confirmed durable save; only loading remains.
        try { this.access.detach(id); await this.access.reload(id); return this.finish(op, { status: "saved" }); }
        catch { return this.finish(op, { status: "savedNeedsReload", error: "消息已保存，重新加载仍失败。请重试加载。" }); }
      }
      const state = await this.readState(op);
      if (state === "unknown") return this.recovery(op, "消息状态仍无法确认。");
      if (state === "before") {
        try { this.access.detach(id); await this.access.reload(id); }
        catch { return this.recovery(op, "原消息已确认，重新读取失败。"); }
        return this.abandon(op, "原消息未被替换，请重新打开编辑。");
      }
      try { await this.lifecycle.commit(op.ownedNew); }
      catch { return this.recovery(op, "已保存的附件仍无法读取。"); }
      // A recovered streaming placeholder is hydrated as aborted, never automatically requested.
      return this.accept(op, false);
    })());
  }
}
