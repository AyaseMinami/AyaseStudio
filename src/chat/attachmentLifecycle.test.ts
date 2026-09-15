import { describe, expect, it, vi } from "vitest";
import { AttachmentLifecycle } from "./attachmentLifecycle";
import type { AttachmentStore } from "./attachmentResources";

const prepared = { name: "file.txt", mimeType: "text/plain" as const, size: 2, data: "SGk=" };
const sent = { reference: "attachments/123e4567-e89b-42d3-a456-426614174000.txt",
  name: "file.txt", mimeType: "text/plain" as const, size: 2 };

describe("private attachment lifecycle", () => {
  it("never cleans an in-flight saved copy before its owning message commits", async () => {
    let resolveSave!: (value: typeof sent) => void;
    let started!: () => void;
    const saveStarted = new Promise<void>((resolve) => { started = resolve; });
    const save = vi.fn().mockImplementation(() => new Promise<typeof sent>((resolve) => { resolveSave = resolve; started(); }));
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const store = { save, cleanup, verify: vi.fn().mockResolvedValue(undefined) } as unknown as AttachmentStore;
    const lifecycle = new AttachmentLifecycle(store, async () => []);
    const saving = lifecycle.save(prepared);
    const cleaning = lifecycle.cleanup();
    await saveStarted;
    resolveSave(sent);
    expect(await saving).toEqual(sent);
    await cleaning;
    expect(cleanup).toHaveBeenCalledWith([], [sent.reference]);
    await lifecycle.commit([sent]);
    await lifecycle.cleanup();
    expect(cleanup).toHaveBeenLastCalledWith([], []);
  });

  it("retains a reference when a cleanup DB read started before message commit", async () => {
    let releaseRead!: (value: string[]) => void;
    let started!: () => void;
    const readStarted = new Promise<void>((resolve) => { started = resolve; });
    const read = vi.fn().mockImplementation(() => new Promise<string[]>((resolve) => { releaseRead = resolve; started(); }));
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const store = { save: vi.fn().mockResolvedValue(sent), cleanup,
      verify: vi.fn().mockResolvedValue(undefined) } as unknown as AttachmentStore;
    const lifecycle = new AttachmentLifecycle(store, read);
    await lifecycle.save(prepared);
    const cleaning = lifecycle.cleanup();
    await readStarted;
    const committing = lifecycle.commit([sent]);
    releaseRead([]); // stale DB read completes after the real commit
    await cleaning;
    await committing;
    expect(cleanup).toHaveBeenCalledWith([], [sent.reference]);
  });

  it("discards a copied but uncommitted file without sending it to quarantine", async () => {
    const discardUncommitted = vi.fn().mockResolvedValue(undefined);
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const store = { save: vi.fn().mockResolvedValue(sent), discardUncommitted, cleanup } as unknown as AttachmentStore;
    const lifecycle = new AttachmentLifecycle(store, async () => []);
    await lifecycle.save(prepared);
    await lifecycle.discard([sent]);
    expect(discardUncommitted).toHaveBeenCalledWith([sent.reference]);
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("checks that a staged copy is present only after its history message commits", async () => {
    const verify = vi.fn().mockResolvedValue(undefined);
    const store = { save: vi.fn().mockResolvedValue(sent), verify } as unknown as AttachmentStore;
    const lifecycle = new AttachmentLifecycle(store, async () => [sent.reference]);
    await lifecycle.save(prepared);
    expect(verify).not.toHaveBeenCalled();
    await lifecycle.commit([sent]);
    expect(verify).toHaveBeenCalledWith([sent]);
  });

  it("releases a committed staging reservation only while its private copy is present", async () => {
    const verify = vi.fn().mockResolvedValue(undefined);
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const store = { save: vi.fn().mockResolvedValue(sent), verify, cleanup } as unknown as AttachmentStore;
    const lifecycle = new AttachmentLifecycle(store, async () => [sent.reference]);
    await lifecycle.save(prepared);
    await expect(lifecycle.commit([sent])).resolves.toBeUndefined();
    expect(verify).toHaveBeenCalledWith([sent]);
    await lifecycle.cleanup();
    expect(cleanup).toHaveBeenCalledWith([sent.reference], []);
  });

  it("rejects a committed but missing copy instead of silently sending a provider request", async () => {
    const store = { save: vi.fn().mockResolvedValue(sent),
      verify: vi.fn().mockRejectedValue(new Error("missing")),
      cleanup: vi.fn().mockResolvedValue(undefined) } as unknown as AttachmentStore;
    const lifecycle = new AttachmentLifecycle(store, async () => [sent.reference]);
    await lifecycle.save(prepared);
    await expect(lifecycle.commit([sent])).rejects.toThrow("missing");
    await lifecycle.cleanup();
    expect(store.cleanup).toHaveBeenCalledWith([sent.reference], [sent.reference]);
  });

  it("verifies all committed copies in one lightweight operation without reloading images", async () => {
    const second = { ...sent, reference: "attachments/123e4567-e89b-42d3-a456-426614174001.txt" };
    const verify = vi.fn().mockResolvedValue(undefined);
    const read = vi.fn().mockResolvedValue(prepared);
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const store = { save: vi.fn().mockResolvedValueOnce(sent).mockResolvedValueOnce(second),
      verify, read, cleanup } as unknown as AttachmentStore;
    const lifecycle = new AttachmentLifecycle(store, async () => [sent.reference, second.reference]);
    await lifecycle.save(prepared);
    await lifecycle.save(prepared);
    await lifecycle.commit([sent, second]);
    expect(verify).toHaveBeenCalledWith([sent, second]);
    expect(read).not.toHaveBeenCalled();
    await lifecycle.cleanup();
    expect(cleanup).toHaveBeenCalledWith([sent.reference, second.reference], []);
  });
});
