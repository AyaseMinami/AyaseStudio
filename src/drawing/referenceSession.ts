import { bytesToBase64 } from "../chat/attachments";
import type { DrawingFiles, DrawingImageInput, DrawingReference, DrawingReferenceSelection } from "./types";

export const managedReferences = (items: readonly DrawingReferenceSelection[]): DrawingReference[] =>
  items.filter((item): item is DrawingReference => !("blob" in item));

/** Materialize bytes, not a File-backed Blob slice: later disk edits cannot change the preview or submission. */
export async function captureReference(file: File): Promise<DrawingReferenceSelection> {
  const bytes = await file.arrayBuffer();
  return { id: crypto.randomUUID(), name: file.name, blob: new Blob([bytes], { type: file.type }) };
}

export async function referenceDigest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function readVerifiedReference(files: DrawingFiles, reference: DrawingReference): Promise<DrawingImageInput> {
  const image = await files.read(reference.reference);
  if (reference.digest) {
    const bytes = Uint8Array.from(atob(image.data), character => character.charCodeAt(0));
    if (await referenceDigest(bytes) !== reference.digest) throw new Error("Reference bytes changed");
  }
  return image;
}

/** One preparation per selected input, shared by every task in a submitted batch. */
export async function prepareReferences(
  snapshot: readonly DrawingReferenceSelection[], files: DrawingFiles,
  hooks: { cancelled(): boolean; imported(reference: DrawingReference): void; progress(completed: number): void },
): Promise<{ references: DrawingReference[]; resolved: Map<string, DrawingReference>; duplicates: boolean }> {
  const check = () => { if (hooks.cancelled()) throw new Error("Reference preparation cancelled"); };
  const available = new Map<string, DrawingReference>();
  const managed = new Map<string, DrawingReference>();
  // Reuse a matching managed original even when it appears after a new local selection.
  for (const item of managedReferences(snapshot)) {
    check();
    const image = await readVerifiedReference(files, item);
    const digest = item.digest ?? await referenceDigest(Uint8Array.from(atob(image.data), char => char.charCodeAt(0)));
    const reference = { ...item, digest };
    managed.set(item.id, reference);
    if (!available.has(digest)) available.set(digest, reference);
  }
  const references: DrawingReference[] = [], resolved = new Map<string, DrawingReference>();
  const seen = new Set<string>();
  for (const [index, item] of snapshot.entries()) {
    check();
    let reference: DrawingReference;
    if ("blob" in item) {
      const bytes = new Uint8Array(await item.blob.arrayBuffer());
      const digest = await referenceDigest(bytes);
      check();
      const existing = available.get(digest);
      if (existing) reference = { ...existing, name: item.name };
      else {
        const descriptor = files.importReferenceBytes
          ? await files.importReferenceBytes(bytes)
          : await files.importReference({ mime: item.blob.type || "application/octet-stream", data: bytesToBase64(bytes) });
        reference = { ...descriptor, name: item.name };
        hooks.imported(reference); // Pin even if cancellation raced with publication.
        if (descriptor.digest !== digest) throw new Error("Imported reference digest mismatch");
        available.set(digest, reference);
      }
    } else reference = { ...available.get(managed.get(item.id)!.digest!)!, name: item.name };
    check();
    resolved.set(item.id, reference);
    if (!seen.has(reference.digest!)) { seen.add(reference.digest!); references.push(reference); }
    hooks.progress(index + 1);
  }
  return { references, resolved, duplicates: references.length !== snapshot.length };
}
