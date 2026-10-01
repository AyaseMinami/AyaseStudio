import { describe, expect, it, vi } from "vitest";
import { DrawingController, UnsavedDrawingImagesError } from "./controller";
import type { DrawingRepository, DrawingSnapshot } from "./repository";
import type { DrawingFiles, DrawingImageInput, DrawingTask, ImageGenerationTransport } from "./types";
import type { ConnectionSettingsState } from "../chat/settings";
import { ImageGenerationError } from "./geminiImage";
import { createOpenAIImagesTransport } from "./openaiImages";

const images: DrawingImageInput[] = [{ mime: "image/png", data: "AQID" }];
const settings: ConnectionSettingsState = { version: 3, activeModelId: "chat-model", providers: [{ id: "p", name: "test", connections: [
  { id: "image", name: "drawing", protocol: "gemini-image", baseUrl: "https://example.test", apiKey: "synthetic-secret", models: [{ id: "image-model", modelId: "test-image" }] },
  { id: "chat", name: "chat", protocol: "gemini-native", baseUrl: "https://example.test", apiKey: "synthetic-chat", models: [{ id: "chat-model", modelId: "test-chat" }] },
] }] };
const file = { id: "file-1", reference: "drawing/task/file.png", mime: "image/png", size: 3, width: 1, height: 1 };
function fixture(snapshot: DrawingSnapshot = { tasks: [], results: [] }) {
  let saved: DrawingSnapshot = structuredClone(snapshot);
  const repository: DrawingRepository = {
    load: vi.fn(async () => structuredClone(saved)),
    saveDraft: vi.fn(async draft => { saved.draft = structuredClone(draft); }),
    saveTask: vi.fn(async task => { saved.tasks = [structuredClone(task), ...saved.tasks.filter(item => item.id !== task.id)]; }),
    complete: vi.fn(async (task, results) => { saved.tasks = [structuredClone(task), ...saved.tasks.filter(item => item.id !== task.id)]; saved.results = [...structuredClone(results), ...saved.results.filter(item => item.taskId !== task.id)]; }),
  };
  let referenceSequence = 0;
  const files: DrawingFiles = { save: vi.fn(async () => [file]), recover: vi.fn(async () => null),
    importReference: vi.fn(async image => { const id = `ref-${++referenceSequence}`; return { ...file, id, reference: `drawing/references/${id}.png`, digest: image.data }; }),
    removeReferences: vi.fn(async () => undefined),
    read: vi.fn(async () => images[0]), export: vi.fn(async () => true) };
  const transport: ImageGenerationTransport = { generate: vi.fn(async () => images) };
  let sequence = 0;
  const controller = new DrawingController({ repository, files, transport: vi.fn(async () => transport),
    id: () => `task-${++sequence}`, now: () => `2026-10-01T00:00:0${sequence}.000Z` });
  return { controller, repository, files, transport, saved: () => saved };
}
async function prepare(f: ReturnType<typeof fixture>) {
  await f.controller.initialize();
  f.controller.setDraft({ ...f.controller.getSnapshot().draft, modelId: "image-model", prompt: "synthetic prompt", aspectRatio: "1:1", resolution: "2K" });
}
describe("application drawing task controller", () => {
  it("imports a batch, skips duplicate bytes, reorders and persists references across reload", async () => {
    const f = fixture(); await prepare(f);
    const first = new File(["first"], "first.png", { type: "image/png" });
    const second = new File(["second"], "second.bmp", { type: "image/bmp" });
    await f.controller.addReferences([first, second, first]);
    expect(f.controller.getSnapshot().draft.references?.map(item => item.name)).toEqual(["first.png", "second.bmp"]);
    expect(f.controller.getSnapshot().error).toContain("重复");
    const id = f.controller.getSnapshot().draft.references![1].id;
    await f.controller.moveReference(id, -1);
    const restored = fixture(f.saved()); await restored.controller.initialize();
    expect(restored.controller.getSnapshot().draft.references?.map(item => item.name)).toEqual(["second.bmp", "first.png"]);
    expect(f.transport.generate).not.toHaveBeenCalled();
    await f.controller.removeReference(id);
    expect(f.files.removeReferences).toHaveBeenCalledWith([expect.stringContaining("drawing/references/")]);
  });
  it("pins submission references while the draft is edited, and failed tasks retain their inputs", async () => {
    const f = fixture(); await prepare(f);
    await f.controller.addReferences([new File(["first"], "first.png", { type: "image/png" })]);
    const reference = f.controller.getSnapshot().draft.references![0];
    let release!: () => void;
    const reading = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(f.files.read).mockImplementation(async () => { await reading; return images[0]; });
    vi.mocked(f.transport.generate).mockRejectedValue(new ImageGenerationError("synthetic failure"));
    const running = f.controller.generate(settings);
    await vi.waitFor(() => expect(f.files.read).toHaveBeenCalled());
    await f.controller.removeReference(reference.id);
    f.controller.setDraft({ ...f.controller.getSnapshot().draft, prompt: "next prompt" });
    expect(f.files.removeReferences).not.toHaveBeenCalled();
    release(); await running;
    expect(f.transport.generate).toHaveBeenCalledWith(expect.objectContaining({ prompt: "synthetic prompt", references: [reference] }), "synthetic-secret", expect.any(AbortSignal), images);
    expect(f.saved().tasks[0]).toMatchObject({ status: "failed", parameters: { references: [reference] } });
    expect(f.saved().draft).toMatchObject({ prompt: "next prompt", references: [] });
    expect(f.files.removeReferences).not.toHaveBeenCalled();
  });
  it("cleans an uncommitted batch on import failure and blocks unreadable task inputs before dispatch", async () => {
    const f = fixture(); await prepare(f);
    vi.mocked(f.files.importReference).mockRejectedValueOnce(new Error("synthetic corrupt image"));
    await f.controller.addReferences([new File(["bad"], "bad.png")]);
    expect(f.controller.getSnapshot().error).toContain("参考图");
    expect(f.controller.getSnapshot().draft.references).toBeUndefined();
    await f.controller.addReferences([new File(["first"], "first.png")]);
    vi.mocked(f.files.importReference).mockResolvedValueOnce({ ...file, id: "orphan", reference: "drawing/references/orphan.png", digest: "another" })
      .mockRejectedValueOnce(new Error("failure"));
    await f.controller.addReferences([new File(["another"], "other.png"), new File(["bad"], "bad.png")]);
    // Existing draft is unaffected by the rejected batch.
    expect(f.controller.getSnapshot().draft.references).toHaveLength(1);
    expect(f.files.removeReferences).toHaveBeenCalledWith(["drawing/references/orphan.png"]);
    vi.mocked(f.files.read).mockRejectedValue(new Error("unavailable"));
    await f.controller.generate(settings);
    expect(f.controller.getSnapshot().error).toContain("参考图读取失败");
    expect(f.transport.generate).not.toHaveBeenCalled();
    expect(f.saved().tasks).toHaveLength(0);
  });
  it("uses a saved result as a reference without copying bytes, replacing the draft or sending", async () => {
    const f = fixture(); await prepare(f); await f.controller.generate(settings);
    f.controller.setDraft({ ...f.controller.getSnapshot().draft, prompt: "next prompt" });
    vi.mocked(f.transport.generate).mockClear();
    await f.controller.useAsReference("file-1"); await f.controller.useAsReference("file-1");
    expect(f.controller.getSnapshot().draft).toMatchObject({ prompt: "next prompt", modelId: "image-model", references: [{ reference: file.reference }] });
    expect(f.controller.getSnapshot().draft.references).toHaveLength(1);
    expect(f.files.importReference).not.toHaveBeenCalled(); expect(f.transport.generate).not.toHaveBeenCalled();
    await f.controller.removeReference("file-1");
    expect(f.files.removeReferences).not.toHaveBeenCalled();
  });
  it("freezes only OpenAI parameters, persists/results/reuses them, and preserves the Gemini draft across restart", async () => {
    const f = fixture(); await prepare(f);
    const local = structuredClone(settings);
    local.providers[0].connections[0].protocol = "openai-images";
    f.controller.setDraft({ ...f.controller.getSnapshot().draft, openai: { size: "3840x2160", quality: "max" } });
    await f.controller.generate(local);
    expect(f.transport.generate).toHaveBeenCalledWith(expect.objectContaining({ protocol: "openai-images", size: "3840x2160", quality: "max" }), "synthetic-secret", expect.any(AbortSignal));
    expect(f.saved().tasks[0].parameters).not.toHaveProperty("aspectRatio");
    expect(f.saved().tasks[0].parameters).not.toHaveProperty("resolution");
    expect(JSON.stringify(f.saved())).not.toContain("synthetic-secret");
    f.controller.setDraft({ ...f.controller.getSnapshot().draft, openai: { size: "auto", quality: "low" } });
    f.controller.reuse("file-1"); await f.controller.flush();
    expect(f.saved().draft).toMatchObject({ aspectRatio: "1:1", resolution: "2K", openai: { size: "3840x2160", quality: "max" } });
    const restored = fixture(f.saved()); await restored.controller.initialize();
    expect(restored.controller.getSnapshot().draft).toEqual(f.saved().draft);
    local.providers[0].connections[0].protocol = "gemini-image";
    await restored.controller.generate(local);
    expect(restored.transport.generate).toHaveBeenCalledWith(expect.objectContaining({ protocol: "gemini-image", aspectRatio: "1:1", resolution: "2K" }), "synthetic-secret", expect.any(AbortSignal));
    expect(restored.saved().tasks[0].parameters).not.toHaveProperty("size");
    expect(restored.saved().tasks[0].parameters).not.toHaveProperty("quality");
  });
  it("defaults old drafts to automatic OpenAI options and blocks invalid sizes before task registration", async () => {
    const f = fixture(); await prepare(f);
    const local = structuredClone(settings); local.providers[0].connections[0].protocol = "openai-images";
    await f.controller.generate(local);
    expect(f.saved().tasks[0].parameters).toMatchObject({ protocol: "openai-images", size: "auto", quality: "auto" });
    vi.mocked(f.repository.saveTask).mockClear(); vi.mocked(f.transport.generate).mockClear();
    f.controller.setDraft({ ...f.controller.getSnapshot().draft, openai: { size: "4096x4096", quality: "max" } });
    await f.controller.generate(local);
    expect(f.repository.saveTask).not.toHaveBeenCalled(); expect(f.transport.generate).not.toHaveBeenCalled();
    expect(f.controller.getSnapshot().error).toContain("尺寸");
  });
  it("routes one Base64 Images response into local saving, preview/export and restart without provider replays", async () => {
    const f = fixture(); await prepare(f);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: images[0].data }] })));
    vi.mocked(f.transport.generate).mockImplementation(createOpenAIImagesTransport(fetcher).generate);
    const local = structuredClone(settings); local.providers[0].connections[0].protocol = "openai-images";
    await f.controller.generate(local);
    expect(fetcher).toHaveBeenCalledOnce(); expect(f.files.save).toHaveBeenCalledWith("task-1", images);
    expect(f.controller.getSnapshot().selectedResultId).toBe("file-1");
    await f.controller.export("file-1"); expect(f.files.export).toHaveBeenCalledWith(file.reference);
    const restored = fixture(f.saved()); await restored.controller.initialize();
    expect(restored.controller.getSnapshot()).toMatchObject({ selectedResultId: "file-1", results: [{ parameters: { protocol: "openai-images" } }] });
    expect(restored.transport.generate).not.toHaveBeenCalled();
  });
  it("saves before success, keeps task parameters and chat selection frozen, automatically selects the latest image", async () => {
    const f = fixture(); await prepare(f);
    const local = structuredClone(settings);
    await f.controller.generate(local);
    expect(f.saved().tasks[0]).toMatchObject({ status: "completed", parameters: { prompt: "synthetic prompt", modelId: "test-image", configuredModelId: "image-model" } });
    expect(f.saved().results[0]).toMatchObject({ taskId: "task-1", id: "file-1" });
    expect(JSON.stringify(f.saved())).not.toContain("synthetic-secret");
    expect(local.activeModelId).toBe("chat-model");
    expect(f.controller.getSnapshot()).toMatchObject({ selectedResultId: "file-1", busy: false, hasData: true });
    expect(f.files.save).toHaveBeenCalledOnce();
    expect(f.transport.generate).toHaveBeenCalledOnce();
    await f.controller.export("file-1"); expect(f.files.export).toHaveBeenCalledWith(file.reference);
  });
  it("guards double-submit synchronously and changing settings/draft doesn't alter an active request", async () => {
    const f = fixture(); await prepare(f);
    let resolve!: (value: DrawingImageInput[]) => void;
    vi.mocked(f.transport.generate).mockImplementation(() => new Promise(r => { resolve = r; }));
    const local = structuredClone(settings), first = f.controller.generate(local);
    await f.controller.generate(local);
    await vi.waitFor(() => expect(f.transport.generate).toHaveBeenCalledOnce());
    local.providers[0].connections[0].apiKey = "changed-key";
    local.providers[0].connections[0].models[0].modelId = "changed-model";
    f.controller.setDraft({ ...f.controller.getSnapshot().draft, prompt: "new draft" });
    expect(f.transport.generate).toHaveBeenCalledWith(expect.objectContaining({ modelId: "test-image", prompt: "synthetic prompt" }), "synthetic-secret", expect.any(AbortSignal));
    resolve(images); await first;
    expect(f.saved().draft?.prompt).toBe("new draft");
    expect(f.saved().results[0].parameters.modelId).toBe("test-image");
  });
  it("never sends when durable task registration fails", async () => {
    const f = fixture(); await prepare(f);
    vi.mocked(f.repository.saveTask).mockRejectedValueOnce(new Error("disk"));
    await f.controller.generate(settings);
    expect(f.transport.generate).not.toHaveBeenCalled();
    expect(f.controller.getSnapshot().error).toContain("未发起");
  });
  it("retains returned pixels after local save failure and retries only local saving", async () => {
    const f = fixture(); await prepare(f);
    vi.mocked(f.files.save).mockRejectedValueOnce(new Error("disk"));
    await f.controller.generate(settings);
    expect(f.saved().tasks[0].status).toBe("save-failed");
    expect(f.saved().results).toHaveLength(0);
    expect(f.controller.getSnapshot().error).toContain("保存未完成");
    await expect(f.controller.settleForClose()).rejects.toBeInstanceOf(UnsavedDrawingImagesError);
    f.controller.cancelClose();
    await f.controller.retrySave("task-1");
    expect(f.saved().tasks[0].status).toBe("completed");
    expect(f.transport.generate).toHaveBeenCalledOnce();
    expect(f.files.save).toHaveBeenCalledTimes(2);
    await expect(f.controller.settleForClose()).resolves.toBeUndefined();
  });
  it("recovers native success after a database commit failure without writing images twice", async () => {
    const f = fixture(); await prepare(f);
    vi.mocked(f.repository.complete).mockRejectedValueOnce(new Error("db"));
    await f.controller.generate(settings);
    expect(f.saved().tasks[0].status).toBe("save-failed");
    vi.mocked(f.files.recover).mockResolvedValue([file]);
    await f.controller.retrySave("task-1");
    expect(f.saved().tasks[0].status).toBe("completed");
    expect(f.files.save).toHaveBeenCalledOnce();
    expect(f.transport.generate).toHaveBeenCalledOnce();
  });
  it("cancel before dispatch is cancelled, cancel after dispatch is unknown and never retried", async () => {
    const f = fixture(); await prepare(f);
    const before = f.controller.generate(settings); f.controller.cancel(); await before;
    expect(f.saved().tasks[0].status).toBe("cancelled");
    expect(f.transport.generate).not.toHaveBeenCalled();
    vi.mocked(f.transport.generate).mockImplementation(async (_, __, signal) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("provider exception synthetic-secret")), { once: true });
    }));
    const after = f.controller.generate(settings);
    await vi.waitFor(() => expect(f.transport.generate).toHaveBeenCalledOnce());
    f.controller.cancel(); await after;
    expect(f.saved().tasks[0].status).toBe("unknown");
    expect(JSON.stringify(f.saved())).not.toContain("synthetic-secret");
    expect(f.transport.generate).toHaveBeenCalledOnce();
  });
  it("failure/cancellation preserves the last successful preview", async () => {
    const f = fixture(); await prepare(f); await f.controller.generate(settings);
    vi.mocked(f.transport.generate).mockRejectedValueOnce(new ImageGenerationError("没有图片"));
    await f.controller.generate(settings);
    expect(f.saved().tasks[0].status).toBe("failed");
    expect(f.controller.getSnapshot().error).toBe("没有图片");
    expect(f.controller.getSnapshot().selectedResultId).toBe("file-1");
    expect(f.controller.getSnapshot().results).toHaveLength(1);
  });
  it("restart repairs saved receipts and marks dispatched tasks unknown without generating", async () => {
    const f = fixture(); await prepare(f); await f.controller.generate(settings);
    const complete = f.saved().tasks[0];
    const tasks: DrawingTask[] = [{ ...complete, status: "saving" }, { ...complete, id: "lost", status: "running" }];
    const restored = fixture({ draft: f.saved().draft, tasks, results: [] });
    vi.mocked(restored.files.recover).mockImplementation(async id => id === complete.id ? [file] : null);
    await restored.controller.initialize();
    expect(restored.saved().tasks.find(task => task.id === "lost")?.status).toBe("unknown");
    expect(restored.saved().tasks.find(task => task.id === complete.id)?.status).toBe("completed");
    expect(restored.controller.getSnapshot().selectedResultId).toBe("file-1");
    expect(restored.transport.generate).not.toHaveBeenCalled();
  });
  it("reuses local parameters without changing chat settings or generating, and a failed load blocks dispatch", async () => {
    const f = fixture(); await prepare(f); await f.controller.generate(settings);
    f.controller.setDraft({ ...f.controller.getSnapshot().draft, prompt: "another" });
    f.controller.reuse("file-1"); await f.controller.flush();
    expect(f.saved().draft?.prompt).toBe("synthetic prompt"); expect(settings.activeModelId).toBe("chat-model");
    expect(f.transport.generate).toHaveBeenCalledOnce();
    const bad = fixture(); vi.mocked(bad.repository.load).mockRejectedValue(new Error("db"));
    await bad.controller.initialize(); await bad.controller.generate(settings);
    expect(bad.controller.getSnapshot().ready).toBe(false); expect(bad.transport.generate).not.toHaveBeenCalled();
  });
  it("freezes drawing commands while closing waits for a slow draft flush, then unlocks a cancelled close", async () => {
    const f = fixture(); await prepare(f); await f.controller.flush();
    let release!: () => void;
    vi.mocked(f.repository.saveDraft).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    f.controller.setDraft({ ...f.controller.getSnapshot().draft, prompt: "slow save" });
    const close = f.controller.settleForClose();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    f.controller.setDraft({ ...f.controller.getSnapshot().draft, prompt: "must be rejected" });
    await f.controller.generate(settings); await f.controller.retrySave("task-1");
    expect(f.transport.generate).not.toHaveBeenCalled();
    expect(f.controller.getSnapshot()).toMatchObject({ closing: true, draft: { prompt: "slow save" } });
    release(); await close;
    f.controller.cancelClose(); await f.controller.generate(settings);
    expect(f.transport.generate).toHaveBeenCalledOnce();
  });
});
