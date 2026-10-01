import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { DrawingController } from "../../src/drawing/controller";
import { DexieDrawingRepository } from "../../src/drawing/repository";
import { AyaseDatabase } from "../../src/storage/database";
import { DrawingWorkspace } from "../../src/ui/drawing/DrawingWorkspace";
import { createGeminiImageTransport } from "../../src/drawing/geminiImage";
import type { DrawingFile, DrawingFiles, DrawingImageInput } from "../../src/drawing/types";
import "../../src/App.css";

const db = new AyaseDatabase(`Drawing94-Memory-only-${crypto.randomUUID()}`);
const settings = { version: 3 as const, activeModelId: null, providers: [{ id: "p", name: "Synthetic", connections: [{ id: "c", name: "Synthetic", protocol: "gemini-image" as const, baseUrl: "https://synthetic.invalid", apiKey: "synthetic-only", models: [{ id: "m", modelId: "synthetic-image" }] }] }] };
const heap = () => (performance as any).memory?.usedJSHeapSize ?? null;
let writable = false, dispatches = 0, image: DrawingImageInput, report: Record<string, unknown> = {};
const durable = new Map<string, DrawingFile[]>();
const files: DrawingFiles = { importReference: async () => { throw Error("unused fixture boundary"); }, removeReferences: async () => {}, export: async () => true, read: async () => image,
  recover: async taskId => durable.get(taskId) ?? null, inspectRecovery: async taskId => ({ total: durable.has(taskId) ? 1 : 0, durable: durable.has(taskId) ? [0] : [] }), discardRecovery: async taskId => { durable.delete(taskId); },
  save: async (taskId, images) => { if (!writable) throw Error("Synthetic disk and staging are unavailable"); const id = crypto.randomUUID(), rows = [{ id, reference: `drawing/${taskId}/${id}.png`, mime: "image/png", size: atob(images[0].data).length, width: 2048, height: 2048 }]; durable.set(taskId, rows); return rows; },
};
const controller = new DrawingController({ repository: new DexieDrawingRepository(db), files, transport: async () => createGeminiImageTransport(async () => {
  dispatches++; return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ inlineData: { mimeType: image.mime, data: image.data } }] } }] }));
}) });
function noise() {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 2048; const context = canvas.getContext("2d")!, pixels = context.createImageData(2048, 2048); let state = 94;
  for (let offset = 0; offset < pixels.data.length; offset += 4) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; pixels.data[offset] = state & 255; pixels.data[offset + 1] = (state >>> 8) & 255; pixels.data[offset + 2] = (state >>> 16) & 255; pixels.data[offset + 3] = 255; }
  context.putImageData(pixels, 0, 0); image = { mime: "image/png", data: canvas.toDataURL().split(",")[1] }; canvas.width = canvas.height = 0;
}
async function start() {
  noise(); await controller.initialize(); controller.setDraft({ ...controller.getSnapshot().draft, modelId: "m", prompt: "Synthetic continuous save failures", count: 12, concurrency: 4, completionSound: false });
  let sampledPeak = heap() ?? 0; const sampler = setInterval(() => { sampledPeak = Math.max(sampledPeak, heap() ?? 0); }, 20);
  try {
  const before = heap(), began = performance.now(); await controller.generate(settings); clearInterval(sampler);
  const tasks = controller.getSnapshot().tasks;
  if (tasks.length !== 12 || tasks.some(task => task.status !== "save-failed" || task.recovery?.memory.length !== 1) || dispatches !== 12 || !controller.hasUnsavedImages()) throw Error("Failure injection did not retain all images and continue queue");
  report = { beforeHeap: before, sampledPeakHeap: Math.max(sampledPeak, heap() ?? 0), retainedHeap: heap(), requests: dispatches, failedTasks: tasks.length, originalImageBytes: atob(image.data).length, retainedImageBytes: tasks.length * atob(image.data).length, elapsedMs: performance.now() - began, paused: controller.getSnapshot().paused, warning: document.querySelector('[aria-label="未保存图片内存风险"]')?.textContent };
  } finally { clearInterval(sampler); }
}
async function release() {
  writable = true; const tasks = controller.getSnapshot().tasks, count = dispatches;
  await controller.retrySave(tasks[0].id); await controller.deleteTasks(tasks.slice(1).map(task => task.id));
  if (controller.hasUnsavedImages() || controller.getSnapshot().results.length !== 1 || dispatches !== count) throw Error("Release/retry changed request count or retained pixels");
  await new Promise(resolve => setTimeout(resolve, 30000));
  Object.assign(report, { afterReleaseHeap: heap(), requestsAfterRetryDelete: dispatches, keptResults: controller.getSnapshot().results.length, retainedMemoryOnlyImages: controller.hasUnsavedImages() ? 1 : 0, warningCleared: !document.querySelector('[aria-label="未保存图片内存风险"]') });
  await fetch("/drawing94-report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ environment: "browser", scenario: "continuous-memory-only-save-failure", report }) });
}
function App() {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot), [output, setOutput] = useState(""), [busy, setBusy] = useState(false);
  async function execute(operation: () => Promise<void>) { if (busy) return; setBusy(true); try { await operation(); setOutput(JSON.stringify(report, null, 2)); } catch (error) { setOutput(String(error)); } finally { setBusy(false); } }
  return <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}><div><button disabled={busy} onClick={() => void execute(start)}>注入十二次持续写盘失败</button><button disabled={busy || !state.tasks.length} onClick={() => void execute(release)}>本地重试一项并释放其余图片</button></div><pre id="failure-report" style={{ maxHeight: 160, overflow: "auto" }}>{output}</pre>
    <DrawingWorkspace {...state} models={[{ id: "m", label: "Synthetic", protocol: "gemini-image" }]} previewUrl={null} previewError={null} onDraftChange={controller.setDraft} onConfigure={() => {}} onGenerate={() => void controller.generate(settings)} onCancel={controller.cancel}
      onSelectResult={controller.selectResult} onExport={() => {}} onRetrySave={id => void controller.retrySave(id)} onReuse={() => {}} onAddReferences={() => {}} onRemoveReference={() => {}} onMoveReference={() => {}} onUseAsReference={() => {}} readReference={controller.readReference} onPause={controller.pause} onResume={controller.resume} />
  </div>;
}
document.documentElement.dataset.theme = "light";
createRoot(document.getElementById("root")!).render(<App />);
