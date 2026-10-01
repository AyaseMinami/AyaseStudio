import { useState } from "react";
import { createRoot } from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import { DrawingController } from "../../src/drawing/controller";
import { DexieDrawingRepository } from "../../src/drawing/repository";
import { AyaseDatabase } from "../../src/storage/database";
import { runtimeDrawingFiles } from "../../src/drawing/runtime";
import { createGeminiImageTransport } from "../../src/drawing/geminiImage";
import { createOpenAIImagesTransport } from "../../src/drawing/openaiImages";
import { captureReference, referenceDigest } from "../../src/drawing/referenceSession";
import { bytesToBase64 } from "../../src/chat/attachments";
import { DrawingReferences } from "../../src/ui/drawing/DrawingReferences";
import { initialDrawingDraft, type DrawingFiles, type DrawingImageInput, type DrawingReference,
  type DrawingReferenceSelection, type DrawingProtocol } from "../../src/drawing/types";
import "../../src/App.css";
import "../../src/ui/drawing/DrawingWorkspace.css";

// Never mount App, load ordinary settings, use its database or create a real transport.
const native = isTauri(), environment = native ? "native" : "browser";
const settings = { version: 3 as const, activeModelId: null, providers: [{ id: "p110", name: "Synthetic", connections: [
  { id: "g110", name: "Gemini", protocol: "gemini-image" as const, baseUrl: "https://synthetic.invalid", apiKey: "synthetic-only", models: [{ id: "gm110", modelId: "synthetic-gemini" }] },
  { id: "o110", name: "OpenAI", protocol: "openai-images" as const, baseUrl: "https://synthetic.invalid", apiKey: "synthetic-only", models: [{ id: "om110", modelId: "synthetic-openai" }] },
] }] };
type Bytes = Uint8Array<ArrayBuffer>;
type Arm = "reconstructed-baseline" | "optimized-controller";
interface Fixture { file: File; digest: string; width: number; height: number; alpha: number }
interface IpcCall { operation: string; phase: string; elapsedMs: number; requestBodyBytes: number; responseBodyBytes: number }
interface RequestMetric { protocol: DrawingProtocol; submitToRequestMs: number; preparationToRegisteredMs: number;
  registeredToAdapterMs: number; adapterToFetchMs: number;
  validationMs: number; originalBytes: number[]; hashes: string[]; hashesMatched: boolean; pngSignaturesMatched: boolean }
interface PreviewMetric { round: number; selectionToVisibleMs: number; selected: number; nativeImports: number; ipcBodyBytes: number }
interface RunMetric { arm: Arm; scenario: string; previews: PreviewMetric[]; requests: RequestMetric[]; ipc: IpcCall[];
  fixtures: { name: string; bytes: number; digest: string; width: number; height: number; alpha: number }[];
  importsBeforeSubmit: number; importsAfterBatchTwo: number; importsAfterBothProtocols: number;
  originalDescriptorsMatched: boolean; batchPreparationShared: boolean; totalIpcBodyBytes: number }
const runs: RunMetric[] = [], failures: string[] = [];
const limitations = [
  "Old selection is reconstructed from prechange HEAD, not measured with an old executable. Both arms dispatch with the current controller.",
  "Browser environment uses in-memory native mocks; only native environment measures Rust decode/storage and actual IPC.",
  "IPC sizes count UTF-8 command argument/result bodies or raw bytes, excluding Tauri routing headers and implementation copies.",
  "Visible preview means actual DrawingReferences img.decode plus two animation frames; compositor paint is not independently observed.",
  "Adapter-to-fetch includes synchronous request packaging; native reads are separate. Controller SHA verification and scheduling are included in submit-to-request.",
  "Preparation ends when the atomic enqueue resolves; registered-to-adapter includes queue waiting, native reads and SHA verification. Later batch requests also include prior fake-fetch validation.",
  "Fixture generation, expected-hash calculation and fake-fetch integrity validation are outside selection/request-arrival timing; no provider request is sent.",
  "One sequential run per case and arm; order/cache/GC effects remain. No peak native memory claim is made.",
];
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function waitFor(predicate: () => boolean, timeout = 180_000) {
  const start = performance.now();
  while (!predicate()) { if (performance.now() - start > timeout) throw Error("Measurement wait expired"); await delay(20); }
}
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const fromBase64 = (data: string): Bytes => Uint8Array.from(atob(data), char => char.charCodeAt(0));
const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const imageBodyBytes = (image: DrawingImageInput) => image.data.length + jsonBytes({ mime: image.mime, data: "" });
const pngSignature = (bytes: Bytes) => [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);

async function makeFixture(side: number, seed: number): Promise<Fixture> {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = side;
  const context = canvas.getContext("2d")!;
  const pixels = context.createImageData(side, side);
  let state = seed;
  for (let index = 0; index < pixels.data.length; index += 4) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    pixels.data[index] = state & 255; pixels.data[index + 1] = state >>> 8 & 255;
    pixels.data[index + 2] = state >>> 16 & 255; pixels.data[index + 3] = 128 + (state >>> 24 & 127);
  }
  pixels.data.set([20, 40, 90, 70], 0);
  context.putImageData(pixels, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(Error("PNG fixture failed")), "image/png"));
  canvas.width = canvas.height = 0;
  const file = new File([blob], `synthetic-${side}-${seed}.png`, { type: "image/png" });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const bitmap = await createImageBitmap(file);
  const sample = document.createElement("canvas"); sample.width = sample.height = 1;
  sample.getContext("2d")!.drawImage(bitmap, 0, 0);
  const alpha = sample.getContext("2d")!.getImageData(0, 0, 1, 1).data[3];
  bitmap.close();
  if (!pngSignature(bytes) || alpha !== 70) throw Error("Synthetic format/alpha check failed");
  return { file, digest: await referenceDigest(bytes), width: side, height: side, alpha };
}

function browserFiles(): DrawingFiles {
  const originals = new Map<string, DrawingImageInput>();
  const descriptor = async (bytes: Bytes, prefix: string) => {
    if (!pngSignature(bytes)) throw Error("Browser mock only accepts PNG fixtures");
    const id = crypto.randomUUID(), reference = `${prefix}/${id}.png`, view = new DataView(bytes.buffer);
    return { id, reference, mime: "image/png", size: bytes.length, width: view.getUint32(16), height: view.getUint32(20), digest: await referenceDigest(bytes) };
  };
  const read = async (reference: string) => {
    const image = originals.get(reference); if (!image) throw Error("Missing synthetic original"); return image;
  };
  return {
    importReference: async image => { const value = await descriptor(fromBase64(image.data), "drawing/references"); originals.set(value.reference, image); return value; },
    importReferenceBytes: async bytes => { const value = await descriptor(bytes, "drawing/references"); originals.set(value.reference, { mime: "image/png", data: bytesToBase64(bytes) }); return value; },
    listReferences: async () => [...originals.keys()].filter(reference => reference.startsWith("drawing/references/")),
    removeReferences: async references => { references.forEach(reference => originals.delete(reference)); },
    save: async (taskId, images) => Promise.all(images.map(async image => {
      const { digest: _digest, ...value } = await descriptor(fromBase64(image.data), `drawing/${taskId}`); originals.set(value.reference, image); return value;
    })),
    read,
    thumbnail: async reference => {
      const image = await read(reference), bitmap = await createImageBitmap(new Blob([fromBase64(image.data)], { type: image.mime }));
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = Math.min(256, bitmap.width);
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
      return { mime: "image/png", data: canvas.toDataURL().split(",")[1] };
    },
    recover: async () => null, discardRecovery: async taskId => {
      for (const reference of originals.keys()) if (reference.startsWith(`drawing/${taskId}/`)) originals.delete(reference);
    }, export: async () => true,
  };
}

function measuredFiles(base: DrawingFiles, metric: RunMetric, phase: () => string): DrawingFiles {
  async function call<T>(operation: string, requestBodyBytes: number, execute: () => Promise<T>, size: (value: T) => number = jsonBytes): Promise<T> {
    const begin = performance.now(), at = phase();
    const value = await execute();
    const elapsedMs = performance.now() - begin;
    metric.ipc.push({ operation, phase: at, elapsedMs, requestBodyBytes, responseBodyBytes: size(value) });
    return value;
  }
  return {
    ...base,
    importReference: image => call("importReference", imageBodyBytes(image) + 10, () => base.importReference(image)),
    importReferenceBytes: base.importReferenceBytes
      ? bytes => call("importReferenceBytes", bytes.length, () => base.importReferenceBytes!(bytes)) : undefined,
    listReferences: base.listReferences ? () => call("listReferences", 2, () => base.listReferences!()) : undefined,
    removeReferences: references => call("removeReferences", jsonBytes({ references }), () => base.removeReferences(references), () => 4),
    read: reference => call("read", jsonBytes({ reference }), () => base.read(reference), imageBodyBytes),
    thumbnail: reference => call("thumbnail", jsonBytes({ reference }), () => base.thumbnail!(reference), imageBodyBytes),
    save: (taskId, images) => call("save", jsonBytes({ taskId, images }), () => base.save(taskId, images)),
    recover: taskId => call("recover", jsonBytes({ taskId }), () => base.recover(taskId)),
    discardRecovery: (taskId, completedOnly) => call("discardRecovery", jsonBytes({ taskId, ...(completedOnly ? { completedOnly } : {}) }), () => base.discardRecovery!(taskId, completedOnly), () => 4),
  };
}

let displayReferences: (references: DrawingReferenceSelection[]) => void;
let displayStatus: (message: string) => void;
let displayReader: (files: DrawingFiles) => void;
let activeController: DrawingController | undefined;
async function waitPreview(expected: number) {
  await waitFor(() => {
    const images = [...document.querySelectorAll<HTMLImageElement>("#references .drawing-reference-list img")];
    return images.length === expected && images.every(image => image.complete && image.naturalWidth > 0);
  });
  await Promise.all([...document.querySelectorAll<HTMLImageElement>("#references .drawing-reference-list img")].map(image => image.decode()));
  await frame(); await frame();
}
const importCount = (metric: RunMetric) => metric.ipc.filter(call => call.operation.startsWith("importReference")).length;
const ipcBytes = (calls: IpcCall[]) => calls.reduce((sum, call) => sum + call.requestBodyBytes + call.responseBodyBytes, 0);

async function measure(arm: Arm, scenario: string, rounds: Fixture[][], output: DrawingImageInput) {
  const metric: RunMetric = { arm, scenario, previews: [], requests: [], ipc: [],
    fixtures: rounds.flat().map(fixture => ({ name: fixture.file.name, bytes: fixture.file.size,
      digest: fixture.digest, width: fixture.width, height: fixture.height, alpha: fixture.alpha })), importsBeforeSubmit: 0,
    importsAfterBatchTwo: 0, importsAfterBothProtocols: 0, originalDescriptorsMatched: false, batchPreparationShared: false, totalIpcBodyBytes: 0 };
  runs.push(metric);
  const database = new AyaseDatabase(`Drawing110-${environment}-${crypto.randomUUID()}`);
  const repository = new DexieDrawingRepository(database);
  let phase = "initialize", submitStarted = 0, registeredAt = 0, adapterStarted = 0;
  const enqueue = repository.enqueue.bind(repository);
  repository.enqueue = async tasks => { const registered = await enqueue(tasks); registeredAt = performance.now(); return registered; };
  const files = measuredFiles(native ? runtimeDrawingFiles : browserFiles(), metric, () => phase);
  displayReader(files); displayReferences([]);
  const expected = rounds[rounds.length - 1];
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    const arrived = performance.now(), gemini = String(url).includes("generateContent");
    const validationStarted = performance.now();
    const body = init?.body;
    let inputs: Bytes[];
    if (body instanceof FormData) {
      inputs = await Promise.all(body.getAll("image[]").map(async value => {
        if (!(value instanceof Blob) || value.type !== "image/png") throw Error("Multipart reference MIME mismatch");
        return new Uint8Array(await value.arrayBuffer());
      }));
    } else {
      const parsed = JSON.parse(String(body)) as { contents: { parts: { inlineData?: DrawingImageInput & { mimeType: string } }[] }[] };
      inputs = parsed.contents[0].parts.flatMap(part => {
        if (!part.inlineData) return [];
        if (part.inlineData.mimeType !== "image/png") throw Error("Gemini reference MIME mismatch");
        return [fromBase64(part.inlineData.data)];
      });
    }
    const hashes = await Promise.all(inputs.map(referenceDigest));
    const hashesMatched = JSON.stringify(hashes) === JSON.stringify(expected.map(fixture => fixture.digest));
    const pngSignaturesMatched = inputs.every(pngSignature);
    metric.requests.push({ protocol: gemini ? "gemini-image" : "openai-images", submitToRequestMs: arrived - submitStarted,
      preparationToRegisteredMs: registeredAt - submitStarted, registeredToAdapterMs: adapterStarted - registeredAt,
      adapterToFetchMs: arrived - adapterStarted, validationMs: performance.now() - validationStarted,
      originalBytes: inputs.map(bytes => bytes.length), hashes, hashesMatched, pngSignaturesMatched });
    if (!hashesMatched || !pngSignaturesMatched) throw Error("Protocol reference bytes/order changed");
    return new Response(JSON.stringify(gemini
      ? { candidates: [{ finishReason: "STOP", content: { parts: [{ inlineData: { mimeType: output.mime, data: output.data } }] } }] }
      : { data: [{ b64_json: output.data }] }));
  };
  const controller = new DrawingController({ repository, files, transport: async () => ({
    generate: (parameters, key, signal, references) => {
      if (key !== "synthetic-only") throw Error("Unexpected credential");
      adapterStarted = performance.now();
      return (parameters.protocol === "gemini-image" ? createGeminiImageTransport(fetcher) : createOpenAIImagesTransport(fetcher))
        .generate(parameters, key, signal, references);
    },
  }) });
  let unsubscribe = () => {};
  activeController = controller;
  const draft = { ...initialDrawingDraft, prompt: "Synthetic #110 measurement", modelId: "gm110", count: 2, concurrency: 1, completionSound: false };
  if (arm === "optimized-controller") {
    await controller.initialize(); controller.updateSettings(settings); controller.setDraft(draft); await controller.flush();
    unsubscribe = controller.subscribe(() => displayReferences(controller.getSnapshot().references));
  }
  let legacy: DrawingReference[] = [];
  try {
    for (const [index, fixtures] of rounds.entries()) {
      phase = "selection";
      displayStatus(`${scenario} · ${arm} · 选择 ${index + 1}/${rounds.length}`);
      if (index) {
        if (arm === "optimized-controller") await controller.clearReferences();
        else {
          await repository.saveDraft({ ...draft, references: [] });
          await files.removeReferences(legacy.map(reference => reference.reference));
          legacy = []; displayReferences([]);
        }
        await frame();
      }
      const beforeCalls = metric.ipc.length, beforeImports = importCount(metric), selectedAt = performance.now();
      if (arm === "optimized-controller") await controller.addReferences(fixtures.map(fixture => fixture.file));
      else {
        // Reconstructed HEAD addReferences: arrayBuffer -> Base64 -> native import,
        // digest dedup -> durable private draft -> ownership reread -> thumbnail UI.
        const imported: DrawingReference[] = [];
        for (const fixture of fixtures) {
          const bytes = new Uint8Array(await fixture.file.arrayBuffer());
          const descriptor = await files.importReference({ mime: fixture.file.type || "image/png", data: bytesToBase64(bytes) });
          imported.push({ ...descriptor, name: fixture.file.name });
        }
        for (const reference of imported) if (!legacy.some(item => item.digest === reference.digest || item.reference === reference.reference)) legacy.push(reference);
        await repository.saveDraft({ ...draft, references: legacy });
        await repository.load();
        const unused = imported.filter(reference => !legacy.some(item => item.reference === reference.reference));
        if (unused.length) await files.removeReferences(unused.map(reference => reference.reference));
        displayReferences(legacy);
      }
      await waitPreview(fixtures.length);
      metric.previews.push({ round: index + 1, selectionToVisibleMs: performance.now() - selectedAt, selected: fixtures.length,
        nativeImports: importCount(metric) - beforeImports, ipcBodyBytes: ipcBytes(metric.ipc.slice(beforeCalls)) });
    }
    metric.importsBeforeSubmit = importCount(metric);
    if (arm === "reconstructed-baseline") {
      phase = "baseline-controller-initialize";
      await controller.initialize(); controller.updateSettings(settings);
      unsubscribe = controller.subscribe(() => displayReferences(controller.getSnapshot().references));
    }
    phase = "submit-gemini-batch2"; submitStarted = performance.now();
    await controller.generate(settings);
    metric.importsAfterBatchTwo = importCount(metric);
    const references = controller.getSnapshot().references;
    metric.originalDescriptorsMatched = references.length === expected.length && references.every((reference, index) =>
      "reference" in reference && reference.digest === expected[index].digest && reference.mime === "image/png" &&
      reference.size === expected[index].file.size && reference.width === expected[index].width && reference.height === expected[index].height);
    metric.batchPreparationShared = metric.importsAfterBatchTwo - metric.importsBeforeSubmit === (arm === "optimized-controller" ? expected.length : 0);
    controller.setDraft({ ...controller.getSnapshot().draft, modelId: "om110", count: 1 }); await controller.flush();
    phase = "submit-openai-batch1"; submitStarted = performance.now();
    await controller.generate(settings);
    metric.importsAfterBothProtocols = importCount(metric);
    if (metric.requests.length !== 3 || controller.getSnapshot().tasks.some(task => task.status !== "completed") ||
      !metric.originalDescriptorsMatched || !metric.batchPreparationShared || metric.importsAfterBothProtocols !== metric.importsAfterBatchTwo)
      throw Error(`Generation/descriptor/shared-import validation failed: ${controller.getSnapshot().error ?? "unexpected count"}`);
    phase = "output-readback";
    for (const result of controller.getSnapshot().results) {
      const image = await files.read(result.reference);
      if (image.mime !== output.mime || image.data !== output.data) throw Error("Saved tiny output bytes changed");
    }
    metric.totalIpcBodyBytes = ipcBytes(metric.ipc);
  } finally {
    phase = "cleanup"; unsubscribe();
    // Cleanup is outside measurement totals and targets only this synthetic run.
    await controller.clearReferences();
    await controller.deleteTasks(controller.getSnapshot().tasks.map(task => task.id));
    await controller.deleteResults(controller.getSnapshot().results.map(result => result.id));
    await controller.flush();
    database.close(); await database.delete(); activeController = undefined;
  }
}

function report() { return { environment, generatedAt: new Date().toISOString(), userAgent: navigator.userAgent,
  viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, runs, failures, limitations, providerNetworkRequests: 0 }; }
async function persist() {
  const response = await fetch("/drawing110-report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report()) });
  if (!response.ok) throw Error("Local report persistence failed");
}
async function run() {
  runs.length = 0; failures.length = 0;
  const outputFixture = await makeFixture(2, 7);
  const output = { mime: "image/png", data: bytesToBase64(new Uint8Array(await outputFixture.file.arrayBuffer())) };
  const scenarios = ["single-4096", "multi-3x2048", "replace-3x2048-final-one"];
  try {
    for (const scenario of scenarios) {
      displayStatus(`生成合成图片：${scenario}（不计入选择耗时）`);
      const fixtures = scenario === "single-4096" ? [await makeFixture(4096, 110)]
        : await Promise.all([111, 112, 113].map(seed => makeFixture(2048, seed)));
      if (scenario === "single-4096" && fixtures[0].file.size <= 32 * 1024 * 1024) throw Error("Large noisy fixture must exceed 32 MiB");
      const rounds = scenario.startsWith("replace") ? fixtures.map(fixture => [fixture]) : [fixtures];
      for (const arm of ["reconstructed-baseline", "optimized-controller"] as const) {
        await measure(arm, scenario, rounds, output); await persist();
      }
    }
    displayReader(browserFiles()); displayReferences([await captureReference(outputFixture.file)]);
    displayStatus(`完成 ${runs.length} 组 · ${environment} · 原字节和两协议请求验证通过`);
  } catch (error) { failures.push(String(error)); displayStatus(`失败：${String(error)}`); }
  await persist();
  return report();
}

function Harness() {
  const [status, setStatus] = useState("就绪：仅使用隔离数据库和合成图片"), [busy, setBusy] = useState(false);
  const [references, setReferences] = useState<DrawingReferenceSelection[]>([]);
  const [files, setFiles] = useState<DrawingFiles>(() => browserFiles());
  const [result, setResult] = useState<ReturnType<typeof report> | null>(null);
  displayReferences = setReferences; displayStatus = setStatus; displayReader = value => setFiles(value);
  async function start() {
    setBusy(true); setResult(null);
    try { setResult(await run()); } catch (error) { setStatus(String(error)); } finally { setBusy(false); }
  }
  return <main style={{ maxWidth: 1120, margin: "24px auto", padding: 24 }}>
    <h1>#110 参考图选择与提交测量</h1>
    <p>环境：{environment}。旧选择流程为重建基线；提交均经过当前控制器和真实协议适配器，fetch 为本地桩。</p>
    <button id="start" className="drawing-button" disabled={busy} onClick={() => void start()}>运行隔离测量</button>
    <p id="status" role="status">{status}</p>
    <section id="references"><DrawingReferences references={references} disabled={busy || !activeController} busy={false}
      read={files.read} readThumbnail={files.thumbnail}
      onAdd={added => { void activeController?.addReferences(added); }}
      onRemove={id => { void activeController?.removeReference(id); }}
      onMove={(id, direction) => { void activeController?.moveReference(id, direction); }} /></section>
    {result && <><p>选择 → 可见预览（毫秒），提交 → 首个本地桩请求（毫秒）：</p>
      <table><thead><tr><th>场景</th><th>流程</th><th>预览</th><th>Gemini 首请求</th><th>OpenAI 首请求</th><th>导入数</th></tr></thead>
        <tbody>{result.runs.map(run => <tr key={`${run.arm}-${run.scenario}`}><td>{run.scenario}</td><td>{run.arm}</td>
          <td>{run.previews.map(preview => preview.selectionToVisibleMs.toFixed(1)).join(" / ")}</td>
          <td>{run.requests.find(request => request.protocol === "gemini-image")?.submitToRequestMs.toFixed(1)}</td>
          <td>{run.requests.find(request => request.protocol === "openai-images")?.submitToRequestMs.toFixed(1)}</td>
          <td>{run.importsAfterBothProtocols}</td></tr>)}</tbody></table>
      <pre id="report" style={{ maxHeight: 360, overflow: "auto", whiteSpace: "pre-wrap" }}>{JSON.stringify(result, null, 2)}</pre></>}
  </main>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
if (new URL(location.href).searchParams.get("autorun") === "1") {
  void waitFor(() => !!document.querySelector("#start")).then(() => document.querySelector<HTMLButtonElement>("#start")!.click());
}
