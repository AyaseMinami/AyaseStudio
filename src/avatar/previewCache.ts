export interface AvatarPreviewLease {
  readonly url: string;
  release(): void;
}

interface Entry {
  url: string;
  ready: Promise<HTMLImageElement>;
  references: number;
  bytes: number;
  failed: boolean;
}

/** Local thumbnail content, never assistant IDs or mutable library provenance. */
export class AvatarPreviewCache {
  private readonly keys = new WeakMap<Blob, Promise<string>>();
  private readonly entries = new Map<string, Entry>();
  private disposed = false;

  constructor(private readonly maxIdleEntries = 32, private readonly maxIdleBytes = 8 * 1024 * 1024) {}

  private key(blob: Blob): Promise<string> {
    let pending = this.keys.get(blob);
    if (!pending) {
      pending = blob.arrayBuffer().then(bytes => crypto.subtle.digest("SHA-256", bytes))
        .then(hash => `${blob.type}:${Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, "0")).join("")}`);
      this.keys.set(blob, pending);
      void pending.catch(() => this.keys.delete(blob));
    }
    return pending;
  }

  async acquire(blob: Blob): Promise<AvatarPreviewLease> {
    const key = await this.key(blob);
    if (this.disposed) throw new Error("Avatar preview cache disposed");
    let entry = this.entries.get(key);
    if (!entry) {
      const url = URL.createObjectURL(blob);
      const image = new Image();
      entry = { url, references: 0, bytes: blob.size, failed: false, ready: Promise.resolve(image) };
      const created = entry;
      entry.ready = Promise.resolve().then(async () => {
        image.src = url;
        await image.decode();
        created.bytes += image.naturalWidth * image.naturalHeight * 4;
        return image;
      });
      this.entries.set(key, entry);
    }
    const held = entry;
    held.references++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      held.references--;
      if (held.references === 0) {
        if (held.failed || this.disposed) this.remove(key, held);
        else {
          // Move the most recently released idle thumbnail to the LRU tail.
          this.entries.delete(key); this.entries.set(key, held);
          this.prune();
        }
      }
    };
    try { await held.ready; }
    catch (error) { held.failed = true; release(); throw error; }
    return { url: held.url, release };
  }

  private remove(key: string, entry: Entry) {
    if (this.entries.get(key) !== entry) return;
    this.entries.delete(key);
    URL.revokeObjectURL(entry.url);
  }

  private prune() {
    const idle = [...this.entries].filter(([, entry]) => entry.references === 0);
    let bytes = idle.reduce((sum, [, entry]) => sum + entry.bytes, 0);
    let count = idle.length;
    for (const [key, entry] of idle) {
      if (count <= this.maxIdleEntries && bytes <= this.maxIdleBytes) break;
      this.remove(key, entry); bytes -= entry.bytes; count--;
    }
  }

  clearUnused() {
    for (const [key, entry] of this.entries) if (entry.references === 0) this.remove(key, entry);
  }

  dispose() { this.disposed = true; this.clearUnused(); }
}

export const avatarPreviewCache = new AvatarPreviewCache();
if (import.meta.hot) import.meta.hot.dispose(() => avatarPreviewCache.dispose());
