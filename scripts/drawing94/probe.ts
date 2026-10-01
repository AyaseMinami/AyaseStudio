import { isTauri } from "@tauri-apps/api/core";
import { DrawingController } from "../../src/drawing/controller";
import { DexieDrawingRepository } from "../../src/drawing/repository";
import { AyaseDatabase } from "../../src/storage/database";
import { runtimeDrawingFiles } from "../../src/drawing/runtime";
import { createGeminiImageTransport } from "../../src/drawing/geminiImage";
import { createOpenAIImagesTransport } from "../../src/drawing/openaiImages";
import { bytesToBase64 } from "../../src/chat/attachments";
import type { DrawingImageInput } from "../../src/drawing/types";

const native = isTauri(), environment = native ? "native" : "browser";
const db = new AyaseDatabase(`Drawing94-Native-Originals-${crypto.randomUUID()}`);
const originals = new Map<string, DrawingImageInput>();
const digest = async (bytes: Uint8Array<ArrayBuffer>) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
const settings = { version: 3 as const, activeModelId: null, providers: [{ id: "p", name: "Synthetic", connections: [
  { id: "g", name: "Gemini", protocol: "gemini-image" as const, baseUrl: "https://synthetic.invalid", apiKey: "synthetic-only", models: [{ id: "gm", modelId: "synthetic-gemini" }] },
  { id: "o", name: "OpenAI", protocol: "openai-images" as const, baseUrl: "https://synthetic.invalid", apiKey: "synthetic-only", models: [{ id: "om", modelId: "synthetic-openai" }] },
] }] };
function png(side: number, seed: number, noisy: boolean) {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = side; const context = canvas.getContext("2d")!;
  if (noisy) { const pixels = context.createImageData(side, side); let state = seed;
    for (let offset = 0; offset < pixels.data.length; offset += 4) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; pixels.data[offset] = state & 255; pixels.data[offset + 1] = (state >>> 8) & 255; pixels.data[offset + 2] = (state >>> 16) & 255; pixels.data[offset + 3] = 255; }
    context.putImageData(pixels, 0, 0);
  } else { context.fillStyle = `hsl(${seed * 37} 60% 60%)`; context.fillRect(0, 0, side, side); }
  const bytes = Uint8Array.from(atob(canvas.toDataURL().split(",")[1]), character => character.charCodeAt(0)); canvas.width = canvas.height = 0; return bytes;
}
const output = { mime: "image/png", data: bytesToBase64(png(64, 7, false)) };
const requests: any[] = []; let expectedHashes: string[] = [];
const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
  const gemini = String(url).includes("generateContent");
  const inputs = init?.body instanceof FormData ? await Promise.all(init.body.getAll("image[]").map(async image => new Uint8Array(await (image as Blob).arrayBuffer())))
    : JSON.parse(String(init?.body)).contents[0].parts.filter((part: any) => part.inlineData).map((part: any) => Uint8Array.from(atob(part.inlineData.data), character => character.charCodeAt(0)));
  const hashes = await Promise.all(inputs.map((bytes: Uint8Array<ArrayBuffer>) => digest(bytes)));
  if (JSON.stringify(hashes) !== JSON.stringify(expectedHashes)) throw Error("Protocol changed reference bytes/order");
  requests.push({ protocol: gemini ? "gemini-image" : "openai-images", inputCount: inputs.length, bytes: inputs.map((bytes: Uint8Array) => bytes.length), hashesMatched: true });
  return new Response(JSON.stringify(gemini ? { candidates: [{ finishReason: "STOP", content: { parts: [{ inlineData: { mimeType: output.mime, data: output.data } }] } }] } : { data: [{ b64_json: output.data }] }));
};
const files = native ? runtimeDrawingFiles : {
  importReference: async (image: DrawingImageInput) => { const id = crypto.randomUUID(), reference = `drawing/references/${id}.png`; originals.set(reference, image); const bytes = Uint8Array.from(atob(image.data), character => character.charCodeAt(0)), view = new DataView(bytes.buffer); return { id, reference, mime: image.mime, size: bytes.length, width: view.getUint32(16), height: view.getUint32(20), digest: await digest(bytes) }; },
  removeReferences: async (references: string[]) => { references.forEach(reference => originals.delete(reference)); }, read: async (reference: string) => originals.get(reference)!,
  save: async (taskId: string, images: DrawingImageInput[]) => images.map(image => { const id = crypto.randomUUID(), reference = `drawing/${taskId}/${id}.png`; originals.set(reference, image); return { id, reference, mime: image.mime, size: atob(image.data).length, width: 64, height: 64 }; }),
  recover: async () => null, discardRecovery: async () => {}, export: async () => true,
};
const controller = new DrawingController({ repository: new DexieDrawingRepository(db), files,
  transport: async () => ({ generate: (parameters, key, signal, references) => (parameters.protocol === "gemini-image" ? createGeminiImageTransport(fetcher) : createOpenAIImagesTransport(fetcher)).generate(parameters, key, signal, references) }) });
async function run() {
  const input = [png(4096, 94, true), ...Array.from({ length: 8 }, (_, index) => png(512, index + 1, false))];
  expectedHashes = await Promise.all(input.map(bytes => digest(bytes)));
  if (input[0].length <= 32 * 1024 * 1024) throw Error("Large reference fixture must exceed the 32 MiB output budget");
  await controller.initialize(); controller.updateSettings(settings); controller.setDraft({ ...controller.getSnapshot().draft, modelId: "gm", prompt: "Synthetic original-byte acceptance", count: 1, concurrency: 1, completionSound: false });
  await controller.addReferences(input.map((bytes, index) => new File([bytes], `distinct-${index}.png`, { type: "image/png" })));
  const references = controller.getSnapshot().draft.references!;
  if (references.length !== 9) throw Error("Reference fixture unexpectedly capped or deduplicated");
  await controller.generate(settings); controller.setDraft({ ...controller.getSnapshot().draft, modelId: "om" }); await controller.generate(settings);
  if (requests.length !== 2 || controller.getSnapshot().tasks.some(task => task.status !== "completed")) throw Error("Reference generation failed");
  const result = controller.getSnapshot().results[0], read = await files.read(result.reference);
  if (read.data !== output.data) throw Error("Native saved output changed original bytes");
  const thumbnail = native ? await runtimeDrawingFiles.thumbnail!(result.reference) : null;
  await controller.clearReferences(); await controller.deleteTasks(controller.getSnapshot().tasks.map(task => task.id));
  if (controller.getSnapshot().results.length !== 2 || (await files.read(result.reference)).data !== output.data) throw Error("Task cleanup deleted independent results");
  const report = { environment, scenario: "nine-original-references", largestOriginalBytes: input[0].length, references: references.length, requests, originalOutputReadback: true, thumbnailReadback: !!thumbnail, resultsSurvivedTaskDeletion: true, providerNetworkRequests: 0 };
  document.querySelector("#report")!.textContent = JSON.stringify(report, null, 2);
  await fetch("/drawing94-report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report) });
}
document.querySelector<HTMLButtonElement>("#start")!.onclick = () => { document.querySelector<HTMLButtonElement>("#start")!.disabled = true; void run().catch(error => { document.querySelector("#report")!.textContent = String(error); }); };
if (new URL(location.href).searchParams.get("autorun") === "1") document.querySelector<HTMLButtonElement>("#start")!.click();
