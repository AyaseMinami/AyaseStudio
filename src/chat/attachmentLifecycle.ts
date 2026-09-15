import type { RequestAttachment, SentAttachment } from "./attachments";
import type { AttachmentStore } from "./attachmentResources";

/** Serializes native writes and ref-based cleanup without exposing app paths or Dexie to UI. */
export class AttachmentLifecycle {
  private reserved = new Set<string>();
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly store: AttachmentStore, private readonly retained: () => Promise<string[]>) {}

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const running = this.queue.catch(() => undefined).then(operation);
    this.queue = running.then(() => undefined, () => undefined);
    return running;
  }

  save(draft: RequestAttachment): Promise<SentAttachment> {
    return this.serialize(async () => {
      const saved = await this.store.save(draft);
      this.reserved.add(saved.reference);
      return saved;
    });
  }

  private release(items: SentAttachment[]): void {
    for (const item of items) this.reserved.delete(item.reference);
  }

  commit(items: SentAttachment[]): Promise<void> {
    return this.serialize(async () => {
      // The DB commit is authoritative. Check every private copy with a cheap
      // native existence/size probe even on Stop, before releasing reservations.
      if (items.length) await this.store.verify(items);
      this.release(items);
    });
  }

  async discard(items: SentAttachment[]): Promise<void> {
    if (!items.length) return;
    await this.serialize(async () => {
      await this.store.discardUncommitted(items.map((item) => item.reference));
      this.release(items);
    });
  }

  cleanup(): Promise<void> {
    return this.serialize(async () => {
      const pendingBeforeRead = [...this.reserved];
      const persisted = await this.retained();
      await this.store.cleanup([...new Set(persisted)],
        [...new Set([...pendingBeforeRead, ...this.reserved])]);
    });
  }
}
