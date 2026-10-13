import type { RequestAttachment, SentAttachment } from "./attachments";
import type { AttachmentStore } from "./attachmentResources";

/** Serializes native writes and ref-based cleanup without exposing app paths or Dexie to UI. */
export class AttachmentLifecycle {
  private reserved = new Set<string>();
  private readonly leases = new Map<symbol, Set<string>>();
  private readonly discardRetries = new Set<string>();
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

  /** Old files must be native retained, including staging/quarantined files. */
  acquireReferences(references: readonly string[]): Promise<{ release(): Promise<void> }> {
    return this.serialize(async () => {
      const identity = Symbol("attachment-lease");
      this.leases.set(identity, new Set(references));
      return { release: () => this.serialize(async () => { this.leases.delete(identity); }) };
    });
  }

  private leasedReferences(): string[] { return [...this.leases.values()].flatMap(refs => [...refs]); }

  commit(items: SentAttachment[]): Promise<void> {
    if (!items.length) return Promise.resolve();
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
      const references = items.map((item) => item.reference);
      try { await this.store.discardUncommitted(references); }
      catch (error) { references.forEach(ref => this.discardRetries.add(ref)); throw error; }
      references.forEach(ref => this.discardRetries.delete(ref));
      this.release(items);
    });
  }

  cleanup(): Promise<void> {
    return this.serialize(async () => {
      // Only definitely uncommitted copies enter this set. Keep their reservation on failure.
      if (this.discardRetries.size) {
        const retries = [...this.discardRetries];
        await this.store.discardUncommitted(retries);
        retries.forEach(ref => { this.discardRetries.delete(ref); this.reserved.delete(ref); });
      }
      const pendingBeforeRead = [...this.reserved];
      const leasedBeforeRead = this.leasedReferences();
      const persisted = await this.retained();
      await this.store.cleanup([...new Set([...persisted, ...leasedBeforeRead, ...this.leasedReferences()])],
        [...new Set([...pendingBeforeRead, ...this.reserved])]);
    });
  }
}
