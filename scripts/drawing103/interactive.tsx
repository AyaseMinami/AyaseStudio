import { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { getDrawingModels, type ConnectionSettingsState } from "../../src/chat/settings";
import { createGrokImagesTransport } from "../../src/drawing/grokImages";
import { createSeedreamImagesTransport } from "../../src/drawing/seedreamImages";
import { DrawingController } from "../../src/drawing/controller";
import type { DrawingRepository, DrawingSnapshot } from "../../src/drawing/repository";
import type { DrawingPresetRepository, DrawingPromptPreset } from "../../src/drawing/presets";
import { referenceDigest } from "../../src/drawing/referenceSession";
import { initialDrawingDraft, type DrawingFiles, type DrawingImageInput, type ImageGenerationTransport } from "../../src/drawing/types";
import { DrawingWorkspace } from "../../src/ui/drawing/DrawingWorkspace";
import "../../src/App.css";

// Browser-only acceptance data: no App, persistent database, settings reads, native invocation or provider fetches.
const settings: ConnectionSettingsState = { version: 3, activeModelId: null, providers: [{ id: "p103", name: "隔离合成供应商", connections: [
  { id: "g103", name: "合成 Gemini", protocol: "gemini-image", baseUrl: "https://synthetic.invalid", apiKey: "synthetic-only",
    models: [{ id: "gm103", modelId: "synthetic-gemini", displayName: "合成 Gemini 绘图" }] },
  { id: "o103", name: "合成 OpenAI", protocol: "openai-images", baseUrl: "https://synthetic.invalid", apiKey: "synthetic-only",
    models: [{ id: "om103", modelId: "synthetic-openai", displayName: "合成 OpenAI 绘图" }] },
  { id: "x103", name: "合成 Grok", protocol: "grok-images", baseUrl: "https://synthetic.invalid/v1", apiKey: "synthetic-only", models: [{ id: "xm103", modelId: "synthetic-grok", displayName: "合成 Grok 绘图" }] },
  { id: "s103", name: "合成 Seedream", protocol: "seedream-images", baseUrl: "https://synthetic.invalid/api/v3", apiKey: "synthetic-only", models: [{ id: "sm103", modelId: "synthetic-seedream", displayName: "合成 Seedream 绘图" }] },
] }] };
const saved: DrawingSnapshot = { draft: { ...initialDrawingDraft, modelId: "xm103", prompt: "合成渐变图片与透明背景", completionSound: false }, tasks: [], results: [] };
const repository: DrawingRepository = {
  load: async () => structuredClone(saved),
  saveDraft: async draft => { saved.draft = structuredClone(draft); },
  saveTask: async task => { saved.tasks = [structuredClone(task), ...saved.tasks.filter(row => row.id !== task.id)]; },
  enqueue: async tasks => {
    const last = Math.max(0, ...saved.tasks.map(task => task.queueOrder ?? 0));
    const registered = tasks.map((task, index) => ({ ...structuredClone(task), queueOrder: last + index + 1 }));
    saved.tasks = [...registered, ...saved.tasks]; return structuredClone(registered);
  },
  complete: async (task, results) => {
    saved.tasks = [structuredClone(task), ...saved.tasks.filter(row => row.id !== task.id)];
    saved.results = [...structuredClone(results), ...saved.results.filter(row => row.taskId !== task.id)];
  },
  removeTasks: async ids => { saved.tasks = saved.tasks.filter(row => !ids.includes(row.id)); },
  removeResults: async ids => { saved.results = saved.results.filter(row => !ids.includes(row.id)); },
};
let presets: DrawingPromptPreset[] = [];
const presetRepository: DrawingPresetRepository = {
  load: async () => structuredClone(presets),
  create: async input => {
    const now = new Date().toISOString(), preset = { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
    presets.push(preset); return structuredClone(preset);
  },
  update: async (id, input) => {
    const previous = presets.find(preset => preset.id === id);
    if (!previous) throw Error("Synthetic preset missing");
    const next = { ...previous, ...input, updatedAt: new Date().toISOString() };
    presets = presets.map(preset => preset.id === id ? next : preset); return structuredClone(next);
  },
  remove: async id => { presets = presets.filter(preset => preset.id !== id); },
};
const originals = new Map<string, DrawingImageInput>();
const counters = { importCalls: 0, requestCalls: 0, originalReads: 0, thumbnailReads: 0,
  allRequestBytesVerified: null as boolean | null, lastSubmittedNames: [] as string[] };
let metricVersion = 0, holdPreparation = false, syntheticSequence = 0;
const metricListeners = new Set<() => void>(), waitingImports: Array<() => void> = [];
const notify = () => { metricVersion++; metricListeners.forEach(listener => listener()); };
const subscribeMetrics = (listener: () => void) => { metricListeners.add(listener); return () => { metricListeners.delete(listener); }; };
const bytesOf = (image: DrawingImageInput) => Uint8Array.from(atob(image.data), character => character.charCodeAt(0));
const imageOf = (bytes: Uint8Array<ArrayBuffer>): DrawingImageInput => {
  let text = ""; for (const byte of bytes) text += String.fromCharCode(byte);
  return { mime: "image/png", data: btoa(text) };
};
function picture(width: number, height: number, sequence: number): DrawingImageInput {
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d")!;
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, `hsla(${sequence * 47 % 360}, 80%, 60%, .35)`);
  gradient.addColorStop(1, `hsla(${(sequence * 47 + 103) % 360}, 80%, 50%, .9)`);
  context.fillStyle = gradient; context.fillRect(width / 16, height / 16, width * 7 / 8, height * 7 / 8);
  context.fillStyle = "#17344d"; context.font = `${Math.max(12, width / 18)}px sans-serif`;
  context.fillText(`PNG ${sequence}`, width / 8, height / 2);
  const data = canvas.toDataURL("image/png").split(",")[1]; canvas.width = canvas.height = 0;
  return { mime: "image/png", data };
}
const output = picture(64, 32, 0);
function dimensions(image: DrawingImageInput) {
  const bytes = bytesOf(image), view = new DataView(bytes.buffer);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
async function importBytes(bytes: Uint8Array<ArrayBuffer>) {
  counters.importCalls++; notify();
  if (holdPreparation) await new Promise<void>(resolve => { waitingImports.push(resolve); notify(); });
  const image = imageOf(bytes), id = crypto.randomUUID(), reference = `drawing/references/${id}.png`;
  const digest = await referenceDigest(bytes);
  originals.set(reference, image); notify();
  return { id, reference, mime: image.mime, size: bytes.length, ...dimensions(image), digest };
}
const files: DrawingFiles = {
  importReferenceBytes: importBytes,
  importReference: async image => importBytes(bytesOf(image)),
  listReferences: async () => [...originals.keys()].filter(reference => reference.startsWith("drawing/references/")),
  removeReferences: async references => { references.forEach(reference => originals.delete(reference)); notify(); },
  read: async reference => {
    counters.originalReads++; notify();
    const image = originals.get(reference); if (!image) throw Error("Synthetic original missing");
    return { ...image };
  },
  thumbnail: async reference => {
    counters.thumbnailReads++; notify();
    const original = originals.get(reference); if (!original) throw Error("Synthetic original missing");
    const bitmap = await createImageBitmap(new Blob([bytesOf(original)], { type: original.mime }));
    const canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 32;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, 64, 32); bitmap.close();
    return { mime: "image/png", data: canvas.toDataURL("image/png").split(",")[1] };
  },
  save: async (taskId, images) => images.map(image => {
    const id = crypto.randomUUID(), reference = `drawing/${taskId}/${id}.png`;
    originals.set(reference, { ...image });
    return { id, reference, mime: image.mime, size: bytesOf(image).length, ...dimensions(image) };
  }),
  recover: async () => null,
  inspectRecovery: async () => ({ total: 0, durable: [] }),
  discardRecovery: async taskId => { for (const reference of originals.keys()) if (reference.startsWith(`drawing/${taskId}/`)) originals.delete(reference); notify(); },
  export: async () => true,
};
const transport: ImageGenerationTransport = { generate: async (parameters, _key, _signal, references = []) => {
  counters.requestCalls++; counters.lastSubmittedNames = parameters.references?.map(reference => reference.name) ?? [];
  const digests = await Promise.all(references.map(image => referenceDigest(bytesOf(image))));
  const verified = references.length === (parameters.references?.length ?? 0)
    && digests.every((digest, index) => digest === parameters.references?.[index].digest);
  counters.allRequestBytesVerified = (counters.allRequestBytesVerified ?? true) && verified; notify();
  if (!verified) throw Error("Synthetic dispatch original bytes/order mismatch");
  const fakeFetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const inputs = parameters.protocol === "grok-images" ? (body.images ?? (body.image ? [body.image] : [])).map((image: {url:string}) => image.url) : (Array.isArray(body.image) ? body.image : body.image ? [body.image] : []);
    if (JSON.stringify(inputs) !== JSON.stringify(references.map(image => `data:${image.mime};base64,${image.data}`))) throw Error("Adapter input integrity failed");
    return new Response(JSON.stringify({ data: [{ b64_json: output.data }] }), { headers: { "Content-Type": "application/json" } });
  };
  if (parameters.protocol === "grok-images") return createGrokImagesTransport(fakeFetch).generate(parameters, _key, _signal, references);
  if (parameters.protocol === "seedream-images") return createSeedreamImagesTransport(fakeFetch).generate(parameters, _key, _signal, references);
  return [{ ...output }];
} };
const controller = new DrawingController({ repository, presetRepository, files, transport: async () => transport });

function App() {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useSyncExternalStore(subscribeMetrics, () => metricVersion);
  const [hold, setHold] = useState(false), [theme, setTheme] = useState("light"), [message, setMessage] = useState("");
  const [previewActive, setPreviewActive] = useState(true);
  const [preview, setPreview] = useState<{ id: string; url: string } | null>(null), [previewError, setPreviewError] = useState<string | null>(null);
  const result = state.results.find(item => item.id === state.selectedResultId);
  useEffect(() => {
    let alive = true, url: string | undefined; setPreview(null); setPreviewError(null);
    if (previewActive && result) void files.read(result.reference).then(image => {
      if (!alive) return;
      url = URL.createObjectURL(new Blob([bytesOf(image)], { type: image.mime })); setPreview({ id: result.id, url });
    }).catch(() => { if (alive) setPreviewError("合成成果预览失败"); });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [previewActive, result]);
  async function addSynthetic() {
    const sequence = ++syntheticSequence, image = picture(512, 256, sequence);
    await controller.addReferences([new File([bytesOf(image)], `synthetic-${sequence}.png`, { type: image.mime })]);
  }
  const localReferences = state.references.filter(reference => "blob" in reference).length;
  const importedFiles = [...originals.keys()].filter(reference => reference.startsWith("drawing/references/")).length;
  const savedDraftIsSessionFree = !(saved.draft?.references?.length);
  return <div style={{ display: "flex", flexDirection: "column", height: "100%", minWidth: 0 }}>
    <div style={{ padding: 8, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 12 }}>
      <strong>隔离 #103 浏览器验收</strong>
      <button className="drawing-button" disabled={!state.ready || state.referencesBusy || state.closing} onClick={() => void addSynthetic()}>添加合成 PNG 参考图</button>
      <button className="drawing-button" onClick={() => {
        const next = theme === "light" ? "dark" : "light"; setTheme(next); document.documentElement.dataset.theme = next;
      }}>切换主题（当前{theme === "light" ? "浅色" : "深色"}）</button>
      <label style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
        <input type="checkbox" checked={hold} onChange={event => { holdPreparation = event.target.checked; setHold(holdPreparation); }} />暂停模拟导入
      </label>
      <button className="drawing-button" disabled={!waitingImports.length} onClick={() => {
        waitingImports.splice(0).forEach(resolve => resolve()); notify();
      }}>释放当前模拟导入</button>
    </div>
    <div aria-label="隔离验收状态" style={{ padding: "0 8px 8px", fontSize: 12, overflowWrap: "anywhere", lineHeight: 1.6 }}>
      <p style={{ margin: 0 }}>importCalls={counters.importCalls} · requestCalls={counters.requestCalls} · 原图读取={counters.originalReads} · 缩略图读取={counters.thumbnailReads}
        · tasks={state.tasks.length} · results={state.results.length} · 会话 Blob={localReferences} · 已导入文件={importedFiles} · 等待导入={waitingImports.length}</p>
      <p style={{ margin: 0 }}>原字节与发送顺序校验：{counters.allRequestBytesVerified === null ? "待提交" : counters.allRequestBytesVerified ? "通过" : "失败"}
        · 草稿排除会话输入：{savedDraftIsSessionFree ? "通过" : "失败"} · 参考图顺序：{state.references.map(reference => reference.name).join(" → ") || "空"}
        · 最近提交顺序：{counters.lastSubmittedNames.join(" → ") || "空"}</p>
      <p style={{ margin: 0 }}>暂停导入时，点击释放继续准备；取消准备后仍需释放当前模拟导入以验证清理。刷新页面会重置全部隔离数据。</p>
      {message && <p role="status" style={{ margin: 0 }}>{message}</p>}
    </div>
    <DrawingWorkspace {...state} references={state.references} preparation={state.preparation} models={getDrawingModels(settings)}
      previewUrl={preview?.id === result?.id ? preview?.url ?? null : null} previewError={previewError} onPreviewActive={setPreviewActive}
      onDraftChange={controller.setDraft} onConfigure={() => setMessage("本入口仅使用合成 Gemini、OpenAI、Grok 与 Seedream 配置。")}
      onGenerate={() => void controller.generate(settings)} onCancel={controller.cancel} onCancelPreparation={controller.cancelPreparation} onCancelBatch={controller.cancelBatch}
      onPause={controller.pause} onResume={controller.resume} onSelectResult={controller.selectResult}
      onExport={id => void controller.export(id)} onRetrySave={id => void controller.retrySave(id)} onReuse={id => void controller.reuse(id)}
      onReuseTask={id => void controller.reuseTask(id)} onDeleteTasks={ids => void controller.deleteTasks(ids)}
      onDeleteResults={ids => void controller.deleteResults(ids)} onExportResults={(ids, parameters) => void controller.exportResults(ids, parameters)}
      onCopyPrompt={() => setMessage("模拟复制成果提示词。")} onCopyTaskPrompt={() => setMessage("模拟复制任务提示词。")}
      onOpenOutputDirectory={async () => { setMessage("模拟打开输出文件夹。全部文件仅在隔离内存中。 "); }}
      onApplyPreset={controller.applyPreset} onCreatePreset={controller.createPreset} onUpdatePreset={controller.updatePreset} onDeletePreset={controller.deletePreset}
      onAddReferences={images => void controller.addReferences(images)} onRemoveReference={id => void controller.removeReference(id)}
      onMoveReference={(id, direction) => void controller.moveReference(id, direction)} onUseAsReference={id => void controller.useAsReference(id)}
      onClearReferences={() => void controller.clearReferences()} readReference={controller.readReference} readThumbnail={controller.readThumbnail} />
  </div>;
}
document.documentElement.dataset.theme = "light";
await controller.initialize(); controller.updateSettings(settings);
createRoot(document.getElementById("root")!).render(<App />);
