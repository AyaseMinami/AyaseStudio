import { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import { DrawingWorkspace } from "../../src/ui/drawing/DrawingWorkspace";
import { DrawingController } from "../../src/drawing/controller";
import { AyaseDatabase } from "../../src/storage/database";
import { DexieDrawingRepository } from "../../src/drawing/repository";
import { DexieDrawingPresetRepository } from "../../src/drawing/presets";
import { runtimeDrawingFiles, openDrawingOutputDirectory } from "../../src/drawing/runtime";
import { getDrawingModels } from "../../src/chat/settings";
import { createGeminiImageTransport } from "../../src/drawing/geminiImage";
import { createOpenAIImagesTransport } from "../../src/drawing/openaiImages";
import { initialDrawingDraft, type DrawingFiles, type DrawingImageInput, type DrawingParameters } from "../../src/drawing/types";
import { BackupRepository } from "../../src/backup/repository";
import { createBackupDocument } from "../../src/backup/snapshot";
import { createRestorePlan } from "../../src/backup/restorePlan";
import { encodeBackup, decodeBackup } from "../../src/backup/codec";
import { connectionSettingsStorageKey } from "../../src/chat/settings";
import "../../src/App.css";

// This entry never mounts the ordinary App or reads its database/settings/keys.
const native = isTauri(), environment = native ? "native" : "browser";
const database = new AyaseDatabase(`Drawing94-Synthetic-${environment}-${new URL(location.href).searchParams.get("dataset") ?? "v3"}`);
const repository = new DexieDrawingRepository(database);
const settings = { version: 3 as const, activeModelId: null, providers: [{ id: "p94", name: "合成供应商", connections: [
  { id: "g94", name: "合成 Gemini", protocol: "gemini-image" as const, baseUrl: "https://synthetic.invalid", apiKey: "synthetic-only", models: [{ id: "gm94", modelId: "synthetic-gemini" }] },
  { id: "o94", name: "合成 OpenAI", protocol: "openai-images" as const, baseUrl: "https://synthetic.invalid", apiKey: "synthetic-only", models: [{ id: "om94", modelId: "synthetic-openai" }] },
] }] };
const errors: string[] = [], calls: { protocol: string; prompt: string; referenceCount: number }[] = [];
const exports: { parameters: boolean }[] = [];
const metrics = { originals: 0, thumbnails: 0, references: 0, urlsCreated: 0, urlsRevoked: 0, peakUrls: 0 };
const liveUrls = new Set<string>();
const createUrl = URL.createObjectURL.bind(URL), revokeUrl = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = blob => { const url = createUrl(blob); liveUrls.add(url); metrics.urlsCreated++; metrics.peakUrls = Math.max(metrics.peakUrls, liveUrls.size); return url; };
URL.revokeObjectURL = url => { liveUrls.delete(url); metrics.urlsRevoked++; revokeUrl(url); };
window.addEventListener("error", event => errors.push(event.message));
window.addEventListener("unhandledrejection", event => errors.push(String(event.reason)));
const longTasks: { start: number; duration: number }[] = [];
try { new PerformanceObserver(list => list.getEntries().forEach(entry => longTasks.push({ start: entry.startTime, duration: entry.duration }))).observe({ type: "longtask", buffered: true }); } catch { /* Report unsupported observer. */ }
const heap = () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function waitFor(test: () => boolean, timeout = 60000) { const start = performance.now(); while (!test()) { if (performance.now() - start > timeout) throw Error("Acceptance wait expired"); await delay(20); } }
function picture(side: number): DrawingImageInput {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = side;
  const context = canvas.getContext("2d")!;
  for (let y = 0; y < side; y += 16) { context.fillStyle = `hsl(${y % 360} 45% 55%)`; context.fillRect(0, y, side, 16); }
  context.fillStyle = "#293344"; context.font = `${side / 18}px sans-serif`; context.fillText(`Synthetic ${side} PNG`, side / 12, side / 2);
  const data = canvas.toDataURL("image/png").split(",")[1]; canvas.width = canvas.height = 0;
  return { mime: "image/png", data };
}
let big: DrawingImageInput | undefined, small: DrawingImageInput | undefined, thumbnail: DrawingImageInput | undefined;
const bigImage = () => big ??= picture(4096), smallImage = () => small ??= picture(512), thumbImage = () => thumbnail ??= picture(256);
const saved = new Map<string, { width: number; images?: DrawingImageInput[] }>();
function dimensions(image: DrawingImageInput) { const bytes = Uint8Array.from(atob(image.data.slice(0, 40)), character => character.charCodeAt(0)); const view = new DataView(bytes.buffer); return { width: view.getUint32(16), height: view.getUint32(20) }; }
const mockFiles: DrawingFiles = {
  importReference: async image => { const id = crypto.randomUUID(), bytes = Uint8Array.from(atob(image.data), character => character.charCodeAt(0)); const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join(""); saved.set(`drawing/references/${id}.png`, { width: dimensions(image).width, images: [image] }); return { id, reference: `drawing/references/${id}.png`, mime: image.mime, size: bytes.length, ...dimensions(image), digest }; },
  removeReferences: async references => { references.forEach(reference => saved.delete(reference)); },
  save: async (taskId, images) => images.map(image => { const id = crypto.randomUUID(), reference = `drawing/${taskId}/${id}.png`, size = dimensions(image); saved.set(reference, { width: size.width }); return { id, reference, mime: image.mime, size: atob(image.data).length, ...size }; }),
  recover: async () => null, inspectRecovery: async () => ({ total: 0, durable: [] }),
  discardRecovery: async () => {},
  read: async reference => { const value = saved.get(reference); if (!value) throw Error("Missing synthetic image"); return value.images?.[0] ?? (value.width === 4096 ? bigImage() : smallImage()); },
  thumbnail: async () => thumbImage(), export: async (_reference, parameters) => { exports.push({ parameters: !!parameters }); return true; },
};
const baseFiles = native ? runtimeDrawingFiles : mockFiles;
const files: DrawingFiles = { ...baseFiles,
  read: async reference => { metrics.originals++; if (reference.startsWith("drawing/references/")) metrics.references++; return baseFiles.read(reference); },
  thumbnail: async reference => { metrics.thumbnails++; return baseFiles.thumbnail!(reference); },
};
const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
  const text = String(url), gemini = text.includes("generateContent");
  const body = init?.body instanceof FormData ? init.body : JSON.parse(String(init?.body));
  const prompt = body instanceof FormData ? String(body.get("prompt")) : gemini ? body.contents[0].parts[0].text : body.prompt;
  const referenceCount = body instanceof FormData ? body.getAll("image[]").length : gemini ? body.contents[0].parts.filter((part: any) => part.inlineData).length : 0;
  calls.push({ protocol: gemini ? "gemini-image" : "openai-images", prompt, referenceCount });
  await delay(10); const image = !native || (calls.length - 1) % 99 < 4 ? bigImage() : smallImage();
  return new Response(JSON.stringify(gemini ? { candidates: [{ finishReason: "STOP", content: { parts: [{ inlineData: { mimeType: image.mime, data: image.data } }] } }] } : { data: [{ b64_json: image.data }] }));
};
const controller = new DrawingController({ repository, presetRepository: new DexieDrawingPresetRepository(database), files,
  transport: async () => ({ generate: (parameters, key, signal, references) => (parameters.protocol === "gemini-image" ? createGeminiImageTransport(fetcher) : createOpenAIImagesTransport(fetcher)).generate(parameters, key, signal, references) }) });
const seedReport: Record<string, unknown> = {}, rounds: any[] = [], extra: Record<string, unknown> = {};
const parameters: DrawingParameters = { providerId: "p94", connectionId: "g94", configuredModelId: "gm94", modelId: "synthetic-gemini", modelName: "合成 Gemini", baseUrl: "https://synthetic.invalid", protocol: "gemini-image", prompt: "#94 合成图库压力样例", aspectRatio: "auto", resolution: "auto" };
async function seed() {
  const existing = await database.drawingResults.count();
  if (existing >= 1000) { for (const result of await database.drawingResults.toArray()) saved.set(result.reference, { width: result.width }); seedReport.reusedSyntheticDataset = true; seedReport.existingResults = existing; await controller.initialize(); controller.updateSettings(settings); return; }
  const start = performance.now(); const large = bigImage(), regular = smallImage(); let bytes = 0;
  for (let index = 0; index < 1000; index++) {
    const taskId = crypto.randomUUID(), image = index < 12 ? large : regular;
    const outputs = await files.save(taskId, [image]); bytes += outputs[0].size;
    const output = outputs[0];
    await database.drawingResults.put({ ...output, id: output.id, taskId, parameters, createdAt: new Date(Date.now() - index * 1000).toISOString() });
    if (index % 50 === 0) { document.querySelector("#progress")!.textContent = `初始化合成成果 ${index}/1000`; await delay(1); }
  }
  await repository.saveDraft({ ...initialDrawingDraft, modelId: "gm94", prompt: "#94 合成批量压力", count: 99, concurrency: 4, completionSound: false });
  await controller.initialize(); controller.updateSettings(settings);
  Object.assign(seedReport, { results: 1000, largeOriginals: 12, largeDimensions: "4096×4096", regularDimensions: "512×512", compressedOriginalBytes: bytes, elapsedMs: performance.now() - start });
  big = small = thumbnail = undefined;
}
async function persist() { await fetch("/drawing94-report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report()) }); }
function report() { return { environment, userAgent: navigator.userAgent, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, seedReport, rounds, extra, metrics, exports, liveUrls: liveUrls.size, tasks: controller.getSnapshot().tasks.length, results: controller.getSnapshot().results.length, calls: calls.length, protocols: [...new Set(calls.map(call => call.protocol))], errors, heapBytes: heap() }; }
let setMountedExternal: (value: boolean) => void, setStatusExternal: (text: string) => void;
async function round() {
  const number = rounds.length + 1, before = heap(), start = performance.now(), longStart = longTasks.length, readStart = metrics.originals, callsStart = calls.length;
  let sampledPeak = before ?? 0; const sampler = setInterval(() => { sampledPeak = Math.max(sampledPeak, heap() ?? 0); }, 50);
  try {
  setMountedExternal(true); await delay(250);
  controller.setDraft({ ...controller.getSnapshot().draft, count: 99, concurrency: 4, completionSound: false, references: [] });
  controller.resume();
  const existingIds = new Set(controller.getSnapshot().tasks.map(task => task.id));
  const batch = controller.generate(settings); await batch;
  await waitFor(() => {
    const state = controller.getSnapshot(), submitted = state.tasks.filter(task => !existingIds.has(task.id));
    return !state.busy && !state.submitting && submitted.length === 99 && submitted.every(task => !["queued", "preparing", "dispatching", "running", "saving"].includes(task.status));
  });
  await waitFor(() => { const image = document.querySelector<HTMLImageElement>('.drawing-preview-stage img'); return !!image?.complete && image.naturalWidth > 0 && document.querySelector('[data-preview-result-id]')?.getAttribute('data-preview-result-id') === controller.getSnapshot().selectedResultId; });
  const newTasks = controller.getSnapshot().tasks.filter(task => !existingIds.has(task.id));
  if (newTasks.length !== 99 || newTasks.some(task => task.status !== "completed") || calls.length - callsStart !== 99)
    throw Error(`Pressure outcome mismatch: ${newTasks.length} new tasks, ${calls.length - callsStart} dispatches, ${JSON.stringify(newTasks.reduce((counts: any, task) => { counts[task.status] = (counts[task.status] ?? 0) + 1; return counts; }, {}))}`);
  const elapsed = performance.now() - start, after = heap(); await delay(1000); const mountedIdleHeap = heap(); clearInterval(sampler);
  setMountedExternal(false); big = small = thumbnail = undefined;
  const urlCount = liveUrls.size; await delay(30000);
  const tasks = longTasks.slice(longStart); rounds.push({ round: number, startUtc: new Date(Date.now() - elapsed - 31000).toISOString(), endUtc: new Date().toISOString(), imageMix: native ? "4×4096 PNG +95×512 PNG" : "99×4096 PNG", completed: newTasks.length, elapsedMs: elapsed, sampledPeakHeap: sampledPeak, heapBefore: before, heapAfter: after, mountedIdleHeap, heapIdle: heap(), originalReads: metrics.originals - readStart, dispatches: calls.length - callsStart, urlsBeforeIdle: urlCount, urlsAfterIdle: liveUrls.size, longTasks: tasks.length, maxLongTaskMs: Math.max(0, ...tasks.map(task => task.duration)) });
  setStatusExternal(JSON.stringify(report(), null, 2)); await persist();
  } finally { clearInterval(sampler); }
}
async function references() {
  const originals = Array.from({ length: 9 }, (_, index) => { const canvas = document.createElement("canvas"); canvas.width = canvas.height = 4096; const context = canvas.getContext("2d")!; context.fillStyle = `hsl(${index * 37} 50% 60%)`; context.fillRect(0, 0, 4096, 4096); context.fillStyle = "#293344"; context.font = "128px sans-serif"; context.fillText(`Distinct original ${index}`, 100, 1000); const data = canvas.toDataURL("image/png").split(",")[1]; canvas.width = canvas.height = 0; return Uint8Array.from(atob(data), character => character.charCodeAt(0)); });
  await controller.addReferences(originals.map((bytes, index) => new File([bytes], `synthetic-${index}.png`, { type: "image/png" })));
  const count = controller.getSnapshot().draft.references?.length ?? 0;
  extra.referenceFixture = { requested: 9, imported: count, originalBytes: originals.reduce((total, bytes) => total + bytes.length, 0), explanation: "nine distinct original 4096 PNGs; no resizing" };
  await persist();
}
async function backup() {
  if (controller.getSnapshot().busy) throw Error("Wait for pressure queue");
  const storage = new Map<string, string>([[connectionSettingsStorageKey, JSON.stringify(settings)]]);
  const backupRepository = new BackupRepository(database, { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); }, removeItem: key => { storage.delete(key); } });
  const guardFiles = { assertAvailable: async () => {}, read: async () => { throw Error("Drawing file read forbidden in backup"); }, write: async () => { throw Error("Drawing file write forbidden in backup"); }, remove: async (references: string[]) => { if (references.length) throw Error("Drawing file deletion forbidden in backup"); } };
  const before = await backupRepository.snapshot(), capacity: any[] = [];
  for (let index = 0; index < 5; index++) {
    const source = structuredClone(before); source.drawing!.presets = Array.from({ length: 10000 }, (_, i) => ({ id: `preset-${i}`, name: `合成预设 ${i}`, content: "explicit synthetic prompt ".repeat(17), createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" }));
    const start = performance.now(); let peak = heap() ?? 0; const sampler = setInterval(() => { peak = Math.max(peak, heap() ?? 0); }, 20);
    try {
    const document = await createBackupDocument(source, { connections: true, credentials: true }, guardFiles);
    const encoded = await encodeBackup(document); peak = Math.max(peak, heap() ?? 0); const decoded = await decodeBackup(encoded); peak = Math.max(peak, heap() ?? 0); clearInterval(sampler);
    if (decoded.document.drawing?.presets?.length !== 10000 || JSON.stringify(decoded.document.drawing).includes("drawing/")) throw Error("Preset backup truncated or leaked drawing references");
    capacity.push({ round: index + 1, bytes: new TextEncoder().encode(encoded).length, elapsedMs: performance.now() - start, sampledPeakHeap: peak });
    } finally { clearInterval(sampler); }
  }
  const document = await createBackupDocument(before, { connections: true, credentials: true }, guardFiles);
  document.drawing!.presets = [{ id: "restored94", name: "显式合成预设", content: "explicitly saved", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" }];
  const preservation: any[] = [], originalDraft = await database.drawingDrafts.get("current"), resultIds = (await database.drawingResults.toArray()).map(result => result.id), taskIds = (await database.drawingTasks.toArray()).map(task => task.id), requests = calls.length;
  for (const strategy of ["merge", "copy", "replace"] as const) {
    const snapshot = await backupRepository.snapshot(), plan = createRestorePlan(document, snapshot, strategy);
    await backupRepository.restore(plan, snapshot, guardFiles);
    const promptPreserved = (await database.drawingDrafts.get("current"))?.prompt === originalDraft?.prompt;
    const resultsPreserved = JSON.stringify((await database.drawingResults.toArray()).map(result => result.id)) === JSON.stringify(resultIds);
    const tasksPreserved = JSON.stringify((await database.drawingTasks.toArray()).map(task => task.id)) === JSON.stringify(taskIds);
    if (!promptPreserved || !resultsPreserved || !tasksPreserved || calls.length !== requests) throw Error("Restore changed local excluded drawing data or dispatched requests");
    preservation.push({ strategy, promptPreserved, resultsPreserved, tasksPreserved, providerRequests: calls.length - requests });
  }
  extra.backup = { capacity, preservation, preservedResultCount: resultIds.length, preservedTaskCount: taskIds.length, originalPrompt: originalDraft?.prompt }; await persist();
}
function App() {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [mounted, setMounted] = useState(true), [active, setActive] = useState(true), [status, setStatus] = useState(""), [executing, setExecuting] = useState(false);
  const [preview, setPreview] = useState<{ id: string; url: string } | null>(null), [previewError, setPreviewError] = useState<string | null>(null);
  setMountedExternal = setMounted; setStatusExternal = setStatus;
  const result = state.results.find(item => item.id === state.selectedResultId);
  useEffect(() => { let alive = true, url: string | undefined; setPreview(null); setPreviewError(null);
    if (mounted && active && result) void files.read(result.reference).then(image => { if (!alive) return; url = URL.createObjectURL(new Blob([Uint8Array.from(atob(image.data), character => character.charCodeAt(0))], { type: image.mime })); setPreview({ id: result.id, url }); }).catch(error => { if (alive) setPreviewError(String(error)); });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [mounted, active, result]);
  async function execute(operation: () => Promise<void>) { if (executing) return; setExecuting(true); try { setStatus("正在执行合成验收…"); await operation(); setStatus(JSON.stringify(report(), null, 2)); } catch (error) { errors.push(String(error)); setStatus(String(error)); await persist(); } finally { setExecuting(false); } }
  return <div style={{ display: "flex", height: "100vh", flexDirection: "column" }}>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: 6, fontSize: 12 }}><span id="progress">隔离 #94 {environment}</span>
      <button disabled={executing} onClick={() => void execute(seed)}>准备 1000 成果</button><button disabled={executing} onClick={() => void execute(round)}>执行一轮 99 任务压力</button>
      <button disabled={executing} onClick={() => void execute(async () => { for (let index = 0; index < 5; index++) await round(); })}>执行五轮压力</button>
      <button disabled={executing} onClick={() => void execute(backup)}>五轮备份与三策略恢复</button>
      <button onClick={() => setMounted(value => !value)}>切换聊天／绘图挂载</button>
      <button onClick={() => { document.documentElement.dataset.theme = "light"; }}>浅色</button><button onClick={() => { document.documentElement.dataset.theme = "dark"; }}>深色</button>
      <button onClick={() => { document.documentElement.dataset.theme = "dark"; document.documentElement.style.setProperty("--color-accent", "160 100 200"); }}>自定义色</button>
      <button onClick={() => void execute(references)}>添加合成参考图</button><button onClick={() => void execute(async () => { await controller.clearReferences(); })}>清空合成参考图</button>
      <button onClick={() => void execute(async () => { await persist(); })}>保存验收报告</button><button onClick={() => setStatus(JSON.stringify(report(), null, 2))}>刷新计数</button>
    </div><details style={{ maxHeight: 220, overflow: "auto" }}><summary>验收测量报告</summary><pre id="report">{status}</pre></details>
    <span data-preview-result-id={preview?.id === result?.id ? preview?.id : undefined} hidden />
    {mounted ? <DrawingWorkspace {...state} models={getDrawingModels(settings)} previewUrl={preview?.id === result?.id ? preview?.url ?? null : null} previewError={previewError} onPreviewActive={setActive}
      onOpenOutputDirectory={async () => { if (native) await openDrawingOutputDirectory(); extra.outputDirectoryOpens = Number(extra.outputDirectoryOpens ?? 0) + 1; await persist(); }}
      onDraftChange={controller.setDraft} onConfigure={() => {}} onGenerate={() => void controller.generate(settings)} onCancel={controller.cancel} onCancelBatch={controller.cancelBatch}
      onPause={controller.pause} onResume={controller.resume} onSelectResult={controller.selectResult} onExport={id => void controller.export(id)} onRetrySave={id => void controller.retrySave(id)}
      onReuse={id => void controller.reuse(id)} onReuseTask={id => void controller.reuseTask(id)} onCopyPrompt={id => void controller.copyPrompt(id)} onCopyTaskPrompt={id => void controller.copyTaskPrompt(id)}
      onDeleteTasks={ids => void controller.deleteTasks(ids)} onDeleteResults={ids => void controller.deleteResults(ids)} onExportResults={(ids, withParameters) => void controller.exportResults(ids, withParameters)}
      onApplyPreset={controller.applyPreset} onCreatePreset={controller.createPreset} onUpdatePreset={controller.updatePreset} onDeletePreset={controller.deletePreset}
      onAddReferences={images => void controller.addReferences(images)} onRemoveReference={id => void controller.removeReference(id)} onMoveReference={(id, direction) => void controller.moveReference(id, direction)}
      onUseAsReference={id => void controller.useAsReference(id)} onClearReferences={() => void controller.clearReferences()} readReference={controller.readReference} readThumbnail={controller.readThumbnail} />
      : <div style={{ padding: 20 }}>绘图页面已卸载；应用所有的队列保持运行。</div>}
    <pre id="machine-report" hidden>{JSON.stringify(report())}</pre>
  </div>;
}
document.documentElement.dataset.theme = "light";
createRoot(document.getElementById("root")!).render(<App />);
if (native && new URL(location.href).searchParams.get("autorun") === "1") {
  try {
    await waitFor(() => !!setMountedExternal);
    await seed(); await persist();
    for (let index = 0; index < 5; index++) await round();
    extra.nativeAutomaticCompleted = true; await persist();
  } catch (error) { errors.push(String(error)); await persist(); }
}
