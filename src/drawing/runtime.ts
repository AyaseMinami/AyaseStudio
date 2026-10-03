import { invoke, isTauri } from "@tauri-apps/api/core";
import type { DrawingFiles, DrawingFile, DrawingImageInput, ImageGenerationTransport } from "./types";
import { createGeminiImageTransport } from "./geminiImage";
import { createOpenAIImagesTransport } from "./openaiImages";
import { createGrokImagesTransport } from "./grokImages";
import { createSeedreamImagesTransport } from "./seedreamImages";
import { ImageGenerationError } from "./imageResponse";

/** The host chooses the configured drawing directory; callers cannot supply paths. */
export async function openDrawingOutputDirectory(): Promise<void> {
  if (!isTauri()) throw new Error("请在桌面应用中打开输出文件夹。");
  await invoke<void>("open_drawing_output_directory");
}

export const runtimeDrawingFiles: DrawingFiles = {
  prepareOutputs: taskIds => invoke<void>("prepare_drawing_output", { taskIds }),
  importReference: image => invoke<DrawingFile & { digest: string }>("import_drawing_reference", { image }),
  importReferenceBytes: bytes => invoke<DrawingFile & { digest: string }>("import_drawing_reference_bytes", bytes),
  listReferences: () => invoke<string[]>("list_drawing_references"),
  removeReferences: references => invoke<void>("remove_drawing_references", { references }),
  save: (taskId, images) => invoke<DrawingFile[]>("save_drawing_result", { taskId, images }),
  recover: taskId => invoke<DrawingFile[] | null>("recover_drawing_result", { taskId }),
  inspectRecovery: taskId => invoke<{ total: number; durable: number[] }>("inspect_drawing_recovery", { taskId }),
  resumeRecovery: (taskId, images) => invoke<DrawingFile[]>("resume_drawing_recovery", { taskId, images }),
  discardRecovery: (taskId, completedOnly) => invoke<void>("discard_drawing_recovery", { taskId, ...(completedOnly ? { completedOnly } : {}) }),
  read: reference => invoke<DrawingImageInput>("read_drawing_result", { reference }),
  thumbnail: reference => invoke<DrawingImageInput>("read_drawing_thumbnail", { reference }),
  export: (reference, parameters) => invoke<boolean>("export_drawing_result", { reference, ...(parameters ? { parameters } : {}) }),
};

export async function createRuntimeImageTransport(): Promise<ImageGenerationTransport> {
  if (!isTauri()) throw new ImageGenerationError("请在桌面应用中生成图片。");
  const { fetch } = await import("@tauri-apps/plugin-http");
  const fetcher: Parameters<typeof createGeminiImageTransport>[0] = (input, init) => fetch(input, { ...init, maxRedirections: 0 });
  const gemini = createGeminiImageTransport(fetcher), openai = createOpenAIImagesTransport(fetcher);
  const grok = createGrokImagesTransport(fetcher), seedream = createSeedreamImagesTransport(fetcher);
  return { generate: (parameters, key, signal, references) => {
    switch (parameters.protocol) {
      case "gemini-image": return gemini.generate(parameters, key, signal, references);
      case "openai-images": return openai.generate(parameters, key, signal, references);
      case "grok-images": return grok.generate(parameters, key, signal, references);
      case "seedream-images": return seedream.generate(parameters, key, signal, references);
      default: throw new ImageGenerationError("不支持的绘图协议。");
    }
  } };
}
