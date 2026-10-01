import { expect, it, vi } from "vitest";
import type { ConnectionSettingsState } from "../chat/settings";
import { DrawingController } from "./controller";
import type { DrawingRepository, DrawingSnapshot } from "./repository";
import { initialDrawingDraft, type DrawingFiles, type DrawingImageInput, type DrawingParameters,
  type DrawingReference, type DrawingTask, type ImageGenerationTransport } from "./types";

const settings: ConnectionSettingsState = { version: 3, activeModelId: "image-model", providers: [{ id: "p", name: "synthetic", connections: [
  { id: "image", name: "drawing", protocol: "gemini-image", baseUrl: "https://example.test", apiKey: "synthetic-key",
    models: [{ id: "image-model", modelId: "synthetic-image" }] },
] }] };
const parameters: DrawingParameters = { protocol: "gemini-image", prompt: "synthetic prompt", aspectRatio: "auto", resolution: "auto",
  providerId: "p", connectionId: "image", configuredModelId: "image-model", modelId: "synthetic-image", modelName: "synthetic-image", baseUrl: "https://example.test" };
const image: DrawingImageInput = { mime: "image/png", data: "AQID" };
const time = "2026-10-02T00:00:00.000Z";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}
async function digest(bytes: Uint8Array<ArrayBuffer>) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function source(name: string, bytes: number[]) { return new File([new Uint8Array(bytes)], name, { type: "image/png" }); }
async function owned(id = "legacy", bytes = [1, 2, 3]): Promise<DrawingReference> {
  return { id, reference: `drawing/references/${id}.png`, name: `${id}.png`, mime: "image/png", size: bytes.length,
    width: 1, height: 1, digest: await digest(new Uint8Array(bytes)) };
}
function fixture(snapshot: DrawingSnapshot = { tasks: [], results: [] }) {
  const saved = structuredClone(snapshot);
  const repository: DrawingRepository = {
    load: vi.fn(async () => structuredClone(saved)),
    saveDraft: vi.fn(async draft => { saved.draft = structuredClone(draft); }),
    saveTask: vi.fn(async task => { saved.tasks = [structuredClone(task), ...saved.tasks.filter(row => row.id !== task.id)]; }),
    enqueue: vi.fn(async (tasks: DrawingTask[]) => {
      const ordered = tasks.map((task, index) => ({ ...structuredClone(task), queueOrder: index + 1 }));
      saved.tasks = [...ordered, ...saved.tasks]; return structuredClone(ordered);
    }),
    complete: vi.fn(async (task, results) => {
      saved.tasks = [structuredClone(task), ...saved.tasks.filter(row => row.id !== task.id)];
      saved.results = [...structuredClone(results), ...saved.results.filter(row => row.taskId !== task.id)];
    }),
    removeTasks: vi.fn(async ids => { saved.tasks = saved.tasks.filter(row => !ids.includes(row.id)); }),
    removeResults: vi.fn(async ids => { saved.results = saved.results.filter(row => !ids.includes(row.id)); }),
  };
  let importSequence = 0, taskSequence = 0;
  const nativeImages = new Map<string, DrawingImageInput>();
  const importBytes = async (bytes: Uint8Array<ArrayBuffer>) => {
    const id = `import-${++importSequence}`;
    const reference = `drawing/references/${id}.png`;
    nativeImages.set(reference, { mime: "image/png", data: btoa(String.fromCharCode(...bytes)) });
    return { id, reference, mime: "image/png", size: bytes.length, width: 1, height: 1, digest: await digest(bytes) };
  };
  const files: DrawingFiles = {
    importReferenceBytes: vi.fn(importBytes),
    importReference: vi.fn(async input => importBytes(Uint8Array.from(atob(input.data), char => char.charCodeAt(0)))),
    removeReferences: vi.fn(async (references: string[]) => { references.forEach(reference => nativeImages.delete(reference)); }),
    read: vi.fn(async reference => nativeImages.get(reference) ?? image),
    save: vi.fn(async taskId => [{ id: `${taskId}-output`, reference: `drawing/${taskId}/output.png`, mime: "image/png", size: 3, width: 1, height: 1 }]),
    recover: vi.fn(async () => null), export: vi.fn(async () => true), discardRecovery: vi.fn(async () => undefined),
  };
  const transport: ImageGenerationTransport = { generate: vi.fn(async () => [image]) };
  const create = () => new DrawingController({ repository, files, transport: vi.fn(async () => transport), id: () => `task-${++taskSequence}`, now: () => time });
  return { controller: create(), create, saved, repository, files, transport, nativeImages };
}
async function prepare(f: ReturnType<typeof fixture>) {
  await f.controller.initialize();
  f.controller.setDraft({ ...f.controller.getSnapshot().draft, modelId: "image-model", prompt: "synthetic prompt" });
  await f.controller.flush();
  vi.mocked(f.repository.saveDraft).mockClear();
}
function expectNoDispatch(f: ReturnType<typeof fixture>) {
  expect(f.repository.enqueue).not.toHaveBeenCalled();
  expect(f.transport.generate).not.toHaveBeenCalled();
  expect(f.saved.tasks).toEqual([]);
}

it("captures original bytes without import or persistence, even when the source backing bytes later change", async () => {
  const f = fixture(); await prepare(f);
  let backing = new Uint8Array([1, 2, 3]);
  const file = source("mutable.png", [9]);
  vi.spyOn(file, "arrayBuffer").mockImplementation(async () => backing.buffer);
  await f.controller.addReferences([file]);
  backing.fill(8); backing = new Uint8Array([7, 7]);
  const selection = f.controller.getSnapshot().references[0];
  if (!("blob" in selection)) throw new Error("Expected session reference");
  expect([...new Uint8Array(await selection.blob.arrayBuffer())]).toEqual([1, 2, 3]);
  expect(f.files.importReferenceBytes).not.toHaveBeenCalled();
  expect(f.files.importReference).not.toHaveBeenCalled();
  expect(f.files.read).not.toHaveBeenCalled();
  expect(f.repository.saveDraft).not.toHaveBeenCalled();
  expect(f.saved.draft?.references ?? []).toEqual([]);
  f.controller.setDraft({ ...f.controller.getSnapshot().draft, prompt: "later prompt" });
  await f.controller.flush();
  expect(f.saved.draft?.prompt).toBe("later prompt");
  expect(f.saved.draft?.references ?? []).toEqual([]);
  expect(JSON.stringify(f.saved)).not.toContain("mutable.png");
  await f.controller.generate(settings);
  expect([...vi.mocked(f.files.importReferenceBytes!).mock.calls[0][0]]).toEqual([1, 2, 3]);
  expect(f.transport.generate).toHaveBeenCalledOnce();
});

it("keeps the selection identity when importing so its mounted preview survives submission", async () => {
  const f = fixture(); await prepare(f);
  await f.controller.addReferences([source("one.png", [1, 2, 3])]);
  const id = f.controller.getSnapshot().references[0].id;
  await f.controller.generate(settings);
  expect(f.controller.getSnapshot().references[0]).toMatchObject({ id, reference: "drawing/references/import-1.png" });
  await f.controller.generate(settings);
  expect(f.files.importReferenceBytes).toHaveBeenCalledOnce();
  await f.controller.removeReference(id);
  expect(f.controller.getSnapshot().references).toEqual([]);
  expect(f.files.removeReferences).not.toHaveBeenCalled();
});

it("rejects an unreadable multi-file selection atomically and preserves earlier session references", async () => {
  const f = fixture(); await prepare(f);
  await f.controller.addReferences([source("existing.png", [1])]);
  const prior = f.controller.getSnapshot().references;
  const failed = source("unreadable.png", [3]);
  vi.spyOn(failed, "arrayBuffer").mockRejectedValue(new Error("synthetic read failure"));
  await f.controller.addReferences([source("readable.png", [2]), failed]);
  expect(f.controller.getSnapshot().references).toEqual(prior);
  expect(f.controller.getSnapshot().error).toContain("参考图读取或保存失败");
  expect(f.files.importReferenceBytes).not.toHaveBeenCalled();
  expect(f.repository.saveDraft).not.toHaveBeenCalled();
  expectNoDispatch(f);
});

it("imports only the submitted final order once for two tasks while later selection edits stay independent", async () => {
  const f = fixture(); await prepare(f); f.controller.pause();
  await f.controller.addReferences([source("one.png", [1]), source("discarded.png", [2]), source("three.png", [3])]);
  const [one, discarded, three] = f.controller.getSnapshot().references;
  await f.controller.removeReference(discarded.id); await f.controller.moveReference(three.id, -1);
  f.controller.setDraft({ ...f.controller.getSnapshot().draft, count: 2 });
  const gate = deferred<void>();
  const originalImport = vi.mocked(f.files.importReferenceBytes!).getMockImplementation()!;
  vi.mocked(f.files.importReferenceBytes!).mockImplementationOnce(async bytes => { await gate.promise; return originalImport(bytes); });
  const submission = f.controller.generate(settings);
  await vi.waitFor(() => expect(f.files.importReferenceBytes).toHaveBeenCalledOnce());
  await f.controller.removeReference(three.id);
  await f.controller.addReferences([source("later.png", [4])]);
  const later = f.controller.getSnapshot().references[1];
  await f.controller.moveReference(later.id, -1);
  f.controller.setDraft({ ...f.controller.getSnapshot().draft, prompt: "later prompt" });
  gate.resolve(); await submission;
  expect(vi.mocked(f.files.importReferenceBytes!).mock.calls.map(([bytes]) => [...bytes])).toEqual([[3], [1]]);
  expect(f.repository.enqueue).toHaveBeenCalledOnce(); expect(f.saved.tasks).toHaveLength(2);
  for (const task of f.saved.tasks) {
    expect(task.parameters.prompt).toBe("synthetic prompt");
    expect(task.parameters.references?.map(ref => ref.name)).toEqual(["three.png", "one.png"]);
  }
  expect(f.controller.getSnapshot().references.map(ref => ref.name)).toEqual(["later.png", "one.png"]);
  expect(f.controller.getSnapshot().references[0]).toHaveProperty("blob");
  expect(f.controller.getSnapshot().references[1]).not.toHaveProperty("blob");
  expect(f.controller.getSnapshot().references[1].id).toBe(one.id);
  expect(f.files.removeReferences).not.toHaveBeenCalled();
  expect(f.saved.draft?.references ?? []).toEqual([]);
  expect(f.transport.generate).not.toHaveBeenCalled();
  f.controller.resume();
  await vi.waitFor(() => expect(f.controller.getSnapshot().tasks.every(task => task.status === "completed")).toBe(true));
  expect(f.transport.generate).toHaveBeenCalledTimes(2);
  for (const call of vi.mocked(f.transport.generate).mock.calls)
    expect(call[3]?.map(input => input.data)).toEqual(["Aw==", "AQ=="]);
  expect(f.files.importReferenceBytes).toHaveBeenCalledTimes(2);
});

it("cancels before native import with zero enqueue and zero transport requests", async () => {
  const f = fixture(); await prepare(f); await f.controller.addReferences([source("one.png", [1])]);
  const submission = f.controller.generate(settings); f.controller.cancel(); await submission;
  expectNoDispatch(f); expect(f.files.importReferenceBytes).not.toHaveBeenCalled();
  expect(f.files.removeReferences).not.toHaveBeenCalled();
  expect(f.controller.getSnapshot().preparation).toBeUndefined();
});

it("cleans an import that finishes after cancellation without registering any task", async () => {
  const f = fixture(); await prepare(f); await f.controller.addReferences([source("one.png", [1]), source("two.png", [2])]);
  const gate = deferred<void>(); const originalImport = vi.mocked(f.files.importReferenceBytes!).getMockImplementation()!;
  vi.mocked(f.files.importReferenceBytes!).mockImplementationOnce(async bytes => { await gate.promise; return originalImport(bytes); });
  const submission = f.controller.generate(settings);
  await vi.waitFor(() => expect(f.files.importReferenceBytes).toHaveBeenCalledOnce());
  f.controller.cancel(); gate.resolve(); await submission;
  expectNoDispatch(f); expect(f.files.importReferenceBytes).toHaveBeenCalledOnce();
  expect(f.files.removeReferences).toHaveBeenCalledExactlyOnceWith(["drawing/references/import-1.png"]);
  expect(f.nativeImages.size).toBe(0);
  expect(f.controller.getSnapshot().references.every(ref => "blob" in ref)).toBe(true);
});

it.each(["native", "registration"])("cleans all published imports after %s failure with an empty submitted batch", async failure => {
  const f = fixture(); await prepare(f); await f.controller.addReferences([source("one.png", [1]), source("two.png", [2])]);
  f.controller.setDraft({ ...f.controller.getSnapshot().draft, count: 2 });
  if (failure === "native") {
    const originalImport = vi.mocked(f.files.importReferenceBytes!).getMockImplementation()!;
    vi.mocked(f.files.importReferenceBytes!).mockImplementationOnce(originalImport).mockRejectedValueOnce(new Error("synthetic native failure"));
  } else vi.mocked(f.repository.enqueue).mockRejectedValueOnce(new Error("atomic registration failure"));
  await f.controller.generate(settings);
  expect(f.saved.tasks).toEqual([]); expect(f.transport.generate).not.toHaveBeenCalled();
  expect(f.repository.enqueue).toHaveBeenCalledTimes(failure === "native" ? 0 : 1);
  expect(f.files.removeReferences).toHaveBeenCalledExactlyOnceWith(failure === "native"
    ? ["drawing/references/import-1.png"] : ["drawing/references/import-1.png", "drawing/references/import-2.png"]);
  expect(f.nativeImages.size).toBe(0);
  expect(f.controller.getSnapshot().references.every(ref => "blob" in ref)).toBe(true);
});

it("retains successful task and result inputs after clearing the session and reopening the controller", async () => {
  const f = fixture(); await prepare(f); await f.controller.addReferences([source("one.png", [1])]);
  await f.controller.generate(settings); await f.controller.clearReferences();
  const references = structuredClone(f.saved.tasks[0].parameters.references);
  expect(f.saved.tasks[0].status).toBe("completed"); expect(references).toHaveLength(1);
  expect(f.saved.results[0].parameters.references).toEqual(references);
  expect(f.saved.draft?.references ?? []).toEqual([]); expect(f.files.removeReferences).not.toHaveBeenCalled();
  f.files.listReferences = vi.fn(async () => [...f.nativeImages.keys()]);
  const restarted = f.create(); await restarted.initialize();
  expect(restarted.getSnapshot().references).toEqual([]);
  expect(restarted.getSnapshot().tasks[0].parameters.references).toEqual(references);
  expect(restarted.getSnapshot().results[0].parameters.references).toEqual(references);
  expect(f.files.removeReferences).not.toHaveBeenCalled(); expect(f.transport.generate).toHaveBeenCalledOnce();
});

it("keeps legacy durable bindings through prompt writes and explicit removal respects task owners", async () => {
  const reference = await owned();
  const task: DrawingTask = { id: "legacy-task", status: "failed", createdAt: time, updatedAt: time, parameters: { ...parameters, references: [reference] } };
  const f = fixture({ draft: { ...initialDrawingDraft, references: [reference] }, tasks: [task], results: [] }); await prepare(f);
  await f.controller.addReferences([source("new.png", [4])]);
  f.controller.setDraft({ ...f.controller.getSnapshot().draft, prompt: "edited" }); await f.controller.flush();
  expect(f.saved.draft?.references).toEqual([reference]);
  await f.controller.removeReference(reference.id);
  expect(f.saved.draft?.references).toEqual([]); expect(f.saved.tasks[0].parameters.references).toEqual([reference]);
  expect(f.files.removeReferences).not.toHaveBeenCalled();
  await f.controller.deleteTasks([task.id]);
  expect(f.files.removeReferences).toHaveBeenCalledExactlyOnceWith([reference.reference]);
});

it("refuses destructive maintenance reload while an unsent session reference remains", async () => {
  const f = fixture(); await prepare(f); await f.controller.addReferences([source("unsent.png", [1])]);
  await expect(f.controller.prepareMaintenance()).rejects.toThrow("仅在本次打开期间保留");
  expect(f.controller.getSnapshot()).toMatchObject({ closing: false, paused: false });
  expect(f.controller.getSnapshot().references).toHaveLength(1);
  expect(f.repository.saveDraft).not.toHaveBeenCalled(); expectNoDispatch(f);
  await f.controller.clearReferences(); await f.controller.prepareMaintenance();
  expect(f.controller.getSnapshot()).toMatchObject({ closing: true, paused: true });
  f.controller.cancelMaintenance();
});

it("rechecks unsent references after an already accepted file capture finishes during maintenance", async () => {
  const f = fixture(); await prepare(f);
  const gate = deferred<ArrayBuffer>(); const file = source("pending.png", [1]);
  const read = vi.spyOn(file, "arrayBuffer").mockReturnValue(gate.promise);
  const selection = f.controller.addReferences([file]);
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
  const maintenance = f.controller.prepareMaintenance();
  expect(f.controller.getSnapshot()).toMatchObject({ closing: true, paused: true });
  const rejected = expect(maintenance).rejects.toThrow("仅在本次打开期间保留");
  gate.resolve(new Uint8Array([1]).buffer); await selection; await rejected;
  expect(f.controller.getSnapshot()).toMatchObject({ closing: false, paused: false });
  expect(f.controller.getSnapshot().references).toHaveLength(1);
  expect(f.controller.getSnapshot().references[0]).toHaveProperty("blob");
  expect(f.files.importReferenceBytes).not.toHaveBeenCalled(); expect(f.repository.saveDraft).not.toHaveBeenCalled();
  expectNoDispatch(f);
});

it("deduplicates equal original content with different names at first appearance", async () => {
  const f = fixture(); await prepare(f);
  await f.controller.addReferences([source("first.png", [1, 2]), source("middle.png", [3]), source("duplicate.png", [1, 2])]);
  await f.controller.generate(settings);
  expect(f.files.importReferenceBytes).toHaveBeenCalledTimes(2);
  expect(f.saved.tasks[0].parameters.references?.map(ref => ref.name)).toEqual(["first.png", "middle.png"]);
  expect(f.controller.getSnapshot().references.map(ref => ref.name)).toEqual(["first.png", "middle.png"]);
  expect(f.controller.getSnapshot().notice).toContain("重复参考图");
});

it("cancels only the new preparation while an earlier paid request remains active", async () => {
  const f = fixture(); await prepare(f);
  const request = deferred<DrawingImageInput[]>();
  vi.mocked(f.transport.generate).mockReturnValueOnce(request.promise);
  const first = f.controller.generate(settings);
  await vi.waitFor(() => expect(f.transport.generate).toHaveBeenCalledOnce());
  await f.controller.addReferences([source("next.png", [5])]);
  const gate = deferred<void>(), original = vi.mocked(f.files.importReferenceBytes!).getMockImplementation()!;
  vi.mocked(f.files.importReferenceBytes!).mockImplementationOnce(async bytes => { await gate.promise; return original(bytes); });
  const second = f.controller.generate(settings);
  await vi.waitFor(() => expect(f.files.importReferenceBytes).toHaveBeenCalledOnce());
  f.controller.cancelPreparation(); gate.resolve();
  await vi.waitFor(() => expect(f.controller.getSnapshot().submitting).toBe(false));
  expect(vi.mocked(f.transport.generate).mock.calls[0][2].aborted).toBe(false);
  expect(f.saved.tasks).toHaveLength(1);
  expect(f.repository.enqueue).toHaveBeenCalledOnce();
  request.resolve([image]); await Promise.all([first, second]);
  expect(f.saved.tasks[0].status).toBe("completed");
});

it("reuses a managed result without imports or original reads during selection", async () => {
  const f = fixture({ tasks: [], results: [{ id: "result", taskId: "source", reference: "drawing/source/result.png", mime: "image/png",
    size: 3, width: 1, height: 1, createdAt: time, parameters }] }); await prepare(f);
  await f.controller.useAsReference("result");
  expect(f.files.read).not.toHaveBeenCalled(); expect(f.files.importReferenceBytes).not.toHaveBeenCalled();
  expect(f.repository.saveDraft).not.toHaveBeenCalled(); expect(f.saved.draft?.references ?? []).toEqual([]);
  await f.controller.generate(settings);
  expect(f.files.importReferenceBytes).not.toHaveBeenCalled(); expect(f.files.importReference).not.toHaveBeenCalled();
  expect(f.saved.tasks[0].parameters.references?.[0].reference).toBe("drawing/source/result.png");
  expect(f.saved.tasks[0].parameters.references?.[0].digest).toBe(await digest(new Uint8Array([1, 2, 3])));
});

it("deduplicates equal managed results in both task inputs and the visible session", async () => {
  const result = { id: "a", taskId: "owner", reference: "drawing/owner/a.png", mime: "image/png", size: 3, width: 1, height: 1, createdAt: time, parameters };
  const f = fixture({ tasks: [], results: [result, { ...result, id: "b", reference: "drawing/owner/b.png" }] }); await prepare(f);
  await f.controller.useAsReference("a"); await f.controller.useAsReference("b");
  const firstName = f.controller.getSnapshot().references[0].name;
  expect(f.controller.getSnapshot().references).toHaveLength(2);
  await f.controller.generate(settings);
  expect(f.saved.tasks[0].parameters.references).toHaveLength(1);
  expect(f.controller.getSnapshot().references).toEqual([expect.objectContaining({ reference: result.reference, name: firstName })]);
  expect(f.files.importReferenceBytes).not.toHaveBeenCalled();
  expect(f.controller.getSnapshot().notice).toContain("重复参考图");
});

it("blocks dispatch when bytes change after registration and preserves the task reference owner", async () => {
  const f = fixture(); await prepare(f); f.controller.pause();
  await f.controller.addReferences([source("one.png", [1])]); await f.controller.generate(settings);
  const reference = f.saved.tasks[0].parameters.references![0];
  f.nativeImages.set(reference.reference, { mime: "image/png", data: "Ag==" });
  f.controller.resume();
  await vi.waitFor(() => expect(f.controller.getSnapshot().tasks[0].status).toBe("failed"));
  await vi.waitFor(() => expect(f.controller.getSnapshot().busy).toBe(false));
  expect(f.transport.generate).not.toHaveBeenCalled(); expect(f.files.save).not.toHaveBeenCalled();
  expect(f.files.removeReferences).not.toHaveBeenCalled();
  expect(f.saved.tasks[0].parameters.references).toEqual([reference]);
});

it("rejects a native import digest mismatch before registration and cleans the newly published resource", async () => {
  const f = fixture(); await prepare(f); await f.controller.addReferences([source("one.png", [1])]);
  const originalImport = vi.mocked(f.files.importReferenceBytes!).getMockImplementation()!;
  vi.mocked(f.files.importReferenceBytes!).mockImplementationOnce(async bytes => ({ ...await originalImport(bytes), digest: "0".repeat(64) }));
  await f.controller.generate(settings);
  expectNoDispatch(f);
  expect(f.files.removeReferences).toHaveBeenCalledExactlyOnceWith(["drawing/references/import-1.png"]);
  expect(f.nativeImages.size).toBe(0);
});

it("rejects a mismatched durable reference digest before enqueue or native import", async () => {
  const reference = await owned("changed", [9]);
  const f = fixture({ draft: { ...initialDrawingDraft, references: [reference] }, tasks: [], results: [] }); await prepare(f);
  await f.controller.generate(settings);
  expectNoDispatch(f);
  expect(f.files.importReferenceBytes).not.toHaveBeenCalled(); expect(f.files.importReference).not.toHaveBeenCalled();
  expect(f.files.removeReferences).not.toHaveBeenCalled();
  expect(f.saved.draft?.references).toEqual([reference]);
});

it("falls back to the original base64 import interface when byte import is unavailable", async () => {
  const f = fixture(); delete f.files.importReferenceBytes; await prepare(f);
  await f.controller.addReferences([source("legacy-host.png", [1, 2, 3])]); await f.controller.generate(settings);
  expect(f.files.importReference).toHaveBeenCalledExactlyOnceWith(image);
  expect(f.saved.tasks[0].status).toBe("completed"); expect(f.transport.generate).toHaveBeenCalledOnce();
});

it("removes inventory orphans only after durable draft, task and result ownership validation", async () => {
  const draftRef = await owned("draft"), taskRef = await owned("task"), resultRef = await owned("result");
  const task: DrawingTask = { id: "owner", status: "failed", createdAt: time, updatedAt: time, parameters: { ...parameters, references: [taskRef] } };
  const f = fixture({ draft: { ...initialDrawingDraft, references: [draftRef] }, tasks: [task], results: [{ id: "output", taskId: "owner",
    reference: "drawing/owner/output.png", mime: "image/png", size: 3, width: 1, height: 1, createdAt: time, parameters: { ...parameters, references: [resultRef] } }] });
  f.files.listReferences = vi.fn(async () => [draftRef.reference, taskRef.reference, resultRef.reference, "drawing/references/orphan.png"]);
  await f.controller.initialize();
  expect(f.repository.load).toHaveBeenCalledTimes(2);
  expect(f.files.removeReferences).toHaveBeenCalledExactlyOnceWith(["drawing/references/orphan.png"]);
  expect(f.controller.getSnapshot().ready).toBe(true);
});

it.each(["initial", "reread"])("preserves inventory files when %s ownership metadata is corrupt", async when => {
  const reference = await owned();
  const f = fixture({ draft: { ...initialDrawingDraft, references: [reference] }, tasks: [], results: [] });
  const corrupt = { ...structuredClone(f.saved), draft: { ...initialDrawingDraft, references: [{ ...reference, width: 0 }] } };
  if (when === "initial") vi.mocked(f.repository.load).mockResolvedValue(corrupt);
  else vi.mocked(f.repository.load).mockResolvedValueOnce(structuredClone(f.saved)).mockResolvedValueOnce(corrupt);
  f.files.listReferences = vi.fn(async () => ["drawing/references/orphan.png"]);
  await f.controller.initialize();
  expect(f.files.listReferences).not.toHaveBeenCalled(); expect(f.files.removeReferences).not.toHaveBeenCalled();
  expect(f.repository.saveDraft).not.toHaveBeenCalled(); expect(f.repository.saveTask).not.toHaveBeenCalled();
  expect(f.controller.getSnapshot().ready).toBe(when === "reread");
  expect(f.saved.draft?.references).toEqual([reference]);
});

it.each(["task", "parameters", "diagnostic", "recovery"])("refuses unknown %s ownership fields before recovery or cleanup", async area => {
  const task: DrawingTask = { id: "future", status: "preparing", createdAt: time, updatedAt: time, parameters };
  const hidden = { futureReference: "drawing/references/retained.png" };
  const corrupt = area === "task" ? { ...task, ...hidden } : { ...task, [area]: { ...(area === "parameters" ? parameters : {}), ...hidden } };
  const f = fixture({ tasks: [corrupt as DrawingTask], results: [] });
  f.files.listReferences = vi.fn(async () => [hidden.futureReference]);
  await f.controller.initialize();
  expect(f.controller.getSnapshot().ready).toBe(false);
  expect(f.files.listReferences).not.toHaveBeenCalled(); expect(f.files.removeReferences).not.toHaveBeenCalled();
  expect(f.repository.saveTask).not.toHaveBeenCalled(); expect(f.files.recover).not.toHaveBeenCalled();
  expect(f.saved.tasks).toEqual([corrupt]);
});
