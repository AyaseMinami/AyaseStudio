import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AyaseDatabase } from "../storage/database";
import type { ConnectionSettingsState } from "../chat/settings";
import { DrawingController } from "./controller";
import { DexieDrawingRepository } from "./repository";
import { DexieDrawingPresetRepository } from "./presets";
import { initialDrawingDraft, type DrawingDraft, type DrawingFiles, type DrawingParameters, type DrawingTask } from "./types";

const databases: AyaseDatabase[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await Promise.all(databases.splice(0).map(db => db.delete())); });
const settings: ConnectionSettingsState = { version: 3, activeModelId: null, providers: [{ id: "p", name: "synthetic", connections: [
  { id: "g", name: "Gemini", protocol: "gemini-image", baseUrl: "https://example.test", apiKey: "synthetic", models: [{ id: "gm", modelId: "gemini-image" }] },
  { id: "o", name: "OpenAI", protocol: "openai-images", baseUrl: "https://example.test", apiKey: "synthetic", models: [{ id: "om", modelId: "openai-image" }] },
] }] };
const references = [1, 2].map(index => ({ id: `ref${index}`, name: `ref${index}.png`, reference: `drawing/references/ref${index}.png`, mime: "image/png", size: 3, width: 1, height: 1 }));
const parameters: DrawingParameters = { protocol: "gemini-image", prompt: "historical Gemini", providerId: "p", connectionId: "g", configuredModelId: "gm",
  modelId: "gemini-image", modelName: "Gemini", baseUrl: "https://example.test", aspectRatio: "16:9", resolution: "2K", references };
const openai: DrawingParameters = { protocol: "openai-images", prompt: "historical OpenAI", providerId: "p", connectionId: "o", configuredModelId: "om",
  modelId: "openai-image", modelName: "OpenAI", baseUrl: "https://example.test", size: "1536x1024", quality: "high", references: [...references].reverse() };
const task = (id: string, value: DrawingParameters): DrawingTask => ({ id, status: "failed", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", parameters: value });
function fixture() {
  const db = new AyaseDatabase(`presets-controller-${crypto.randomUUID()}`); databases.push(db);
  const repository = new DexieDrawingRepository(db), presetRepository = new DexieDrawingPresetRepository(db);
  const files: DrawingFiles = { read: vi.fn(async () => ({ mime: "image/png", data: "AQID" })), save: vi.fn(async () => []), recover: vi.fn(async () => null),
    importReference: vi.fn(), removeReferences: vi.fn(async () => undefined), export: vi.fn(async () => true) };
  const transport = vi.fn(async () => ({ generate: vi.fn() }));
  const controller = new DrawingController({ repository, presetRepository, files, transport });
  return { db, repository, presetRepository, files, transport, controller };
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }

describe("pure-text presets and history reuse #90", () => {
  it("releases the preset-only maintenance gate when the last preset is deleted without touching a draft", async () => {
    const f = fixture(); await f.controller.initialize();
    expect(f.controller.getSnapshot().hasData).toBe(false);
    await f.controller.createPreset({ name: "temporary", content: "temporary" });
    expect(f.controller.getSnapshot().hasData).toBe(true);
    await f.controller.deletePreset(f.controller.getSnapshot().presets[0].id);
    expect(f.controller.getSnapshot().hasData).toBe(false);
    expect((await f.repository.load()).draft).toBeUndefined(); expect(f.transport).not.toHaveBeenCalled();
  });
  it("persists separate CRUD records and applies only their exact text without any provider or file request", async () => {
    const f = fixture(); await f.controller.initialize();
    const draft: DrawingDraft = { ...initialDrawingDraft, prompt: "existing draft", modelId: "gm", aspectRatio: "1:1", resolution: "4K",
      openai: { size: "1024x1024", quality: "low" }, references, count: 6, concurrency: 2, completionSound: false };
    f.controller.setDraft(draft); await f.controller.flush();
    const previous = f.controller.getSnapshot().draft;
    expect(await f.controller.createPreset({ name: "same name", content: "  first\ntext  " })).toBe(true);
    expect(await f.controller.createPreset({ name: "same name", content: "second" })).toBe(true);
    const first = f.controller.getSnapshot().presets.find(item => item.content === "  first\ntext  ")!;
    const second = f.controller.getSnapshot().presets.find(item => item.content === "second")!;
    expect(first.id).not.toBe(second.id);
    f.controller.applyPreset(first.id); await f.controller.flush();
    expect((await f.repository.load()).draft).toEqual({ ...previous, prompt: "  first\ntext  " });
    f.controller.setDraft({ ...f.controller.getSnapshot().draft, prompt: "unsaved preset edit" }); await f.controller.flush();
    expect((await f.presetRepository.load()).find(item => item.id === first.id)?.content).toBe("  first\ntext  ");
    expect(await f.controller.updatePreset(first.id, { name: "renamed", content: "updated" })).toBe(true);
    expect(await f.controller.deletePreset(second.id)).toBe(true);
    expect(f.controller.getSnapshot().draft.prompt).toBe("unsaved preset edit");
    const restored = new DrawingController({ repository: f.repository, presetRepository: f.presetRepository, files: f.files, transport: f.transport });
    await restored.initialize();
    expect(restored.getSnapshot().presets).toEqual([expect.objectContaining({ id: first.id, name: "renamed", content: "updated", createdAt: first.createdAt })]);
    expect(restored.getSnapshot().hasData).toBe(true);
    expect(f.transport).not.toHaveBeenCalled(); expect(f.files.read).not.toHaveBeenCalled(); expect(f.files.save).not.toHaveBeenCalled();
  });
  it("retains saved records on write failures and allows a later explicit retry", async () => {
    const f = fixture(); await f.controller.initialize();
    const create = vi.spyOn(f.presetRepository, "create").mockRejectedValueOnce(new Error("disk"));
    expect(await f.controller.createPreset({ name: "preset", content: "original" })).toBe(false);
    expect(f.controller.getSnapshot().presets).toEqual([]); expect(f.controller.getSnapshot().presetsBusy).toBe(false);
    expect(await f.controller.createPreset({ name: "preset", content: "original" })).toBe(true);
    const original = f.controller.getSnapshot().presets[0];
    vi.spyOn(f.presetRepository, "update").mockRejectedValueOnce(new Error("disk"));
    expect(await f.controller.updatePreset(original.id, { name: "changed", content: "changed" })).toBe(false);
    vi.spyOn(f.presetRepository, "remove").mockRejectedValueOnce(new Error("disk"));
    expect(await f.controller.deletePreset(original.id)).toBe(false);
    expect(f.controller.getSnapshot().presets).toEqual([original]); expect(await f.presetRepository.load()).toEqual([original]);
    expect(await f.controller.updatePreset(original.id, { name: "changed", content: "changed" })).toBe(true);
    expect(create).toHaveBeenCalledTimes(2); expect(f.transport).not.toHaveBeenCalled();
  });
  it("freezes queued preset input and waits for its durable write before close", async () => {
    const f = fixture(); await f.controller.initialize();
    const gate = deferred(), started = deferred();
    const originalCreate = f.presetRepository.create.bind(f.presetRepository);
    vi.spyOn(f.presetRepository, "create").mockImplementation(async input => { started.resolve(); await gate.promise; return originalCreate(input); });
    const input = { name: "frozen name", content: "frozen content" };
    const save = f.controller.createPreset(input); input.name = "later name"; input.content = "later content";
    await started.promise; expect(f.controller.getSnapshot().presetsBusy).toBe(true);
    let closed = false; const close = f.controller.settleForClose().then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false); expect(f.controller.getSnapshot().closing).toBe(true);
    expect(await f.controller.createPreset({ name: "after close", content: "blocked" })).toBe(false);
    gate.resolve(); expect(await save).toBe(true); await close;
    expect(await f.presetRepository.load()).toEqual([expect.objectContaining({ name: "frozen name", content: "frozen content" })]);
    expect(f.controller.getSnapshot().presetsBusy).toBe(false); expect(f.transport).not.toHaveBeenCalled();
  });
  it("blocks initialization when presets cannot be read rather than treating damaged storage as empty", async () => {
    const f = fixture(); vi.spyOn(f.presetRepository, "load").mockRejectedValue(new Error("unreadable"));
    await f.controller.initialize();
    expect(f.controller.getSnapshot().ready).toBe(false); expect(f.controller.getSnapshot().error).toContain("读取或恢复失败");
    expect(await f.controller.createPreset({ name: "blocked", content: "blocked" })).toBe(false); expect(f.transport).not.toHaveBeenCalled();
  });
  it("reuses task and result snapshots across protocols, preserves ordered inputs and history, and makes no network calls", async () => {
    const f = fixture();
    await f.repository.enqueue([task("gemini", parameters), task("openai", openai)]);
    const result = { id: "r", taskId: "gemini", reference: "drawing/gemini/r.png", mime: "image/png", size: 3, width: 1, height: 1, createdAt: "2026-10-01T00:00:00.000Z", parameters };
    await f.db.drawingResults.add(result);
    await f.controller.initialize(); f.controller.updateSettings(settings);
    f.controller.setDraft({ ...initialDrawingDraft, prompt: "discarded draft", modelId: "gm", aspectRatio: "auto", resolution: "auto", openai: { size: "auto", quality: "low" } });
    const before = await f.repository.load();
    await f.controller.reuseTask("openai");
    expect(f.controller.getSnapshot().draft).toMatchObject({ prompt: openai.prompt, modelId: "om", aspectRatio: "auto", resolution: "auto", openai: { size: "1536x1024", quality: "high" }, references: [...references].reverse() });
    await f.controller.reuse("r");
    expect(f.controller.getSnapshot().draft).toMatchObject({ prompt: parameters.prompt, modelId: "gm", aspectRatio: "16:9", resolution: "2K", openai: { size: "1536x1024", quality: "high" }, references });
    await f.controller.reuseTask("openai");
    expect(f.controller.getSnapshot().draft).toMatchObject({ modelId: "om", aspectRatio: "16:9", resolution: "2K", references: [...references].reverse() });
    const after = await f.repository.load(); expect(after.tasks).toEqual(before.tasks); expect(after.results).toEqual(before.results);
    expect(f.transport).not.toHaveBeenCalled(); expect(f.files.save).not.toHaveBeenCalled();
  });
  it("retains invalid historical protocol controls and reports each unavailable reference", async () => {
    const f = fixture(); await f.repository.enqueue([task("openai", openai)]); await f.controller.initialize();
    f.controller.updateSettings({ version: 3, activeModelId: null, providers: [] });
    vi.mocked(f.files.read).mockRejectedValue(new Error("missing"));
    await f.controller.reuseTask("openai");
    expect(f.controller.getSnapshot().draft).toMatchObject({ prompt: openai.prompt, modelId: null, reusedProtocol: "openai-images", openai: { size: "1536x1024", quality: "high" }, references: [...references].reverse() });
    expect(f.controller.getSnapshot().error).toContain("模型已失效"); expect(f.controller.getSnapshot().error).toContain("参考图 1、2");
    expect(f.transport).not.toHaveBeenCalled(); expect((await f.repository.load()).tasks[0].parameters).toEqual(openai);
  });
  it("copies task and result text without loading it or generating; clipboard failure preserves the draft", async () => {
    const f = fixture(); await f.repository.enqueue([task("gemini", parameters)]);
    await f.db.drawingResults.add({ id: "r", taskId: "gemini", reference: "drawing/gemini/r.png", mime: "image/png", size: 3, width: 1, height: 1, createdAt: "2026-10-01T00:00:00.000Z", parameters: openai });
    await f.controller.initialize();
    const before = f.controller.getSnapshot().draft, writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await f.controller.copyTaskPrompt("gemini"); await f.controller.copyPrompt("r");
    expect(writeText.mock.calls).toEqual([[parameters.prompt], [openai.prompt]]);
    writeText.mockRejectedValueOnce(new Error("denied")); await f.controller.copyTaskPrompt("gemini");
    expect(f.controller.getSnapshot().error).toContain("复制失败"); expect(f.controller.getSnapshot().draft).toEqual(before);
    expect(f.transport).not.toHaveBeenCalled(); expect(f.files.read).not.toHaveBeenCalled();
  });
});
