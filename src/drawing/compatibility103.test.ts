import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AyaseDatabase } from "../storage/database";
import { getActiveTarget, selectModel, getDrawingModels, getDrawingTarget, readConnectionSettingsData, type ConnectionSettingsState } from "../chat/settings";
import { DrawingController } from "./controller";
import { DexieDrawingRepository } from "./repository";
import { createGrokImagesTransport, initialGrokDrawingOptions } from "./grokImages";
import { createSeedreamImagesTransport, initialSeedreamDrawingOptions } from "./seedreamImages";
import { drawingExportParameters } from "./exportParameters";
import type { DrawingFiles, DrawingImageInput, DrawingProtocol, DrawingTask } from "./types";

const png: DrawingImageInput = { mime: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==" };
const databases: AyaseDatabase[] = [];
afterEach(async () => { for (const database of databases.splice(0)) await database.delete(); });
const protocols = ["grok-images", "seedream-images"] as const;
function fixture(protocol: typeof protocols[number]) {
  const db = new AyaseDatabase(`drawing103-${crypto.randomUUID()}`); databases.push(db);
  const repository = new DexieDrawingRepository(db);
  const settings: ConnectionSettingsState = { version: 3, activeModelId: null, providers: [{ id: "p", name: "Synthetic", connections: [{
    id: "c", name: "Synthetic images", protocol, baseUrl: "https://synthetic.invalid", apiKey: "synthetic-only",
    models: [{ id: "m", modelId: "relay-alias" }],
  }] }] };
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: png.data }] })));
  const transport = protocol === "grok-images" ? createGrokImagesTransport(fetcher) : createSeedreamImagesTransport(fetcher);
  let saveFails = false;
  const files: DrawingFiles = {
    save: vi.fn(async (taskId: string, images: DrawingImageInput[]) => {
      if (saveFails) throw Error("Synthetic disk failure");
      return images.map((image, index) => ({ id: `${taskId}-${index}`, reference: `drawing/${taskId}/${index}.png`, mime: image.mime, size: 70, width: 1, height: 1 }));
    }), recover: vi.fn(async () => null), discardRecovery: vi.fn(async () => undefined),
    read: vi.fn(async () => png), export: vi.fn(async () => true), importReference: vi.fn(async () => { throw Error("unused"); }),
    removeReferences: vi.fn(async () => undefined),
  };
  const create = () => new DrawingController({ repository, files, transport: async () => transport });
  return { db, repository, settings, fetcher, files, create, failSave: (value: boolean) => { saveFails = value; } };
}
async function prepare(f: ReturnType<typeof fixture>) {
  const controller = f.create(); await controller.initialize(); controller.pause();
  controller.setDraft({ ...controller.getSnapshot().draft, modelId: "m", prompt: "original", count: 2,
    grok: { ...initialGrokDrawingOptions, modelVersion: "2.0", quality: "medium", resolution: "2k" },
    seedream: { ...initialSeedreamDrawingOptions, modelVersion: "5.0-lite", size: "3K", outputFormat: "png", watermark: "off" } });
  return controller;
}
const wait = (check: () => void) => vi.waitFor(check, { timeout: 5000, interval: 5 });

describe("Grok/Seedream integration #103", () => {
  it.each(protocols)("preserves %s connections and excludes their models from chat", protocol => {
    const f = fixture(protocol), read = readConnectionSettingsData(f.settings);
    expect(read).toEqual(f.settings); expect(selectModel(read, "m").activeModelId).toBeNull(); expect(getActiveTarget({ ...read, activeModelId: "m" })).toBeUndefined();
    expect(getDrawingModels(read)).toMatchObject([{ id: "m", protocol }]);
    expect(getDrawingTarget(read, "m")?.connection.protocol).toBe(protocol);
  });
  it.each(protocols)("freezes %s batch across draft changes/restart and reuses saved parameters", async protocol => {
    const f = fixture(protocol), original = await prepare(f);
    await original.generate(f.settings);
    const frozen = structuredClone(original.getSnapshot().tasks[0].parameters);
    original.setDraft({ ...original.getSnapshot().draft, prompt: "later", grok: initialGrokDrawingOptions, seedream: initialSeedreamDrawingOptions });
    await original.settleForClose(); expect(f.fetcher).not.toHaveBeenCalled();
    const reopened = f.create(); await reopened.initialize(); reopened.updateSettings(f.settings);
    expect(reopened.getSnapshot().paused).toBe(true); reopened.resume();
    await wait(() => expect(reopened.getSnapshot().results).toHaveLength(2));
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(reopened.getSnapshot().tasks.every(task => task.status === "completed" && task.parameters.prompt === "original")).toBe(true);
    const result = reopened.getSnapshot().results[0]; expect(result.parameters).toEqual(frozen);
    await reopened.exportResults([result.id], true);
    expect(f.files.export).toHaveBeenCalledWith(result.reference, drawingExportParameters(frozen));
    expect(drawingExportParameters(frozen)).not.toHaveProperty("api_type");
    await reopened.reuse(result.id); expect(reopened.getSnapshot().draft.prompt).toBe("original");
    expect(reopened.getSnapshot().draft[protocol === "grok-images" ? "grok" : "seedream"]).toMatchObject({ modelVersion: protocol === "grok-images" ? "2.0" : "5.0-lite" });
    expect(JSON.stringify(await f.repository.load())).not.toContain("synthetic-only");
    await reopened.deleteTasks(reopened.getSnapshot().tasks.map(task => task.id));
    expect(reopened.getSnapshot().results).toHaveLength(2);
    await reopened.useAsReference(result.id); expect(reopened.getSnapshot().references[0]).toMatchObject({ reference: result.reference });
    await reopened.deleteResults([result.id]);
    expect(f.files.discardRecovery).not.toHaveBeenCalledWith(result.taskId, expect.anything());
  });
  it.each(protocols)("retries %s local save without another provider request", async protocol => {
    const f = fixture(protocol), controller = await prepare(f); f.failSave(true);
    controller.setDraft({ ...controller.getSnapshot().draft, count: 1 }); await controller.generate(f.settings); controller.resume();
    await wait(() => expect(controller.getSnapshot().tasks[0]?.status).toBe("save-failed"));
    f.failSave(false); await controller.retrySave(controller.getSnapshot().tasks[0].id);
    expect(controller.getSnapshot().tasks[0].status).toBe("completed"); expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(protocols)("retains %s possible-send markers as unknown on restart without dispatch", async protocol => {
    const f = fixture(protocol), controller = await prepare(f); await controller.generate(f.settings);
    const task: DrawingTask = { ...controller.getSnapshot().tasks[0], status: "running" };
    await f.repository.saveTask(task);
    const reopened = f.create(); await reopened.initialize(); reopened.updateSettings(f.settings);
    expect(reopened.getSnapshot().tasks.find(item => item.id === task.id)?.status).toBe("unknown");
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("protects unsupported protocol history before file recovery or writes", async () => {
    const f = fixture("grok-images"), controller = await prepare(f); await controller.generate(f.settings);
    const task = controller.getSnapshot().tasks[0];
    await f.db.drawingTasks.put({ ...task, status: "running", parameters: { ...task.parameters, protocol: "future-images" as DrawingProtocol } } as DrawingTask);
    const before = await f.repository.load(); const reopened = f.create(); await reopened.initialize();
    expect(reopened.getSnapshot().ready).toBe(false); expect(f.files.recover).not.toHaveBeenCalled();
    expect(await f.repository.load()).toEqual(before);
  });
});
