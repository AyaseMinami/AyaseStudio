import { invoke, isTauri } from "@tauri-apps/api/core";
import type { DrawingFiles, DrawingFile, DrawingImageInput, ImageGenerationTransport } from "./types";
import { createGeminiImageTransport } from "./geminiImage";
import { createOpenAIImagesTransport } from "./openaiImages";
import { ImageGenerationError } from "./imageResponse";

export const runtimeDrawingFiles: DrawingFiles = {
  importReference: image => invoke<DrawingFile & { digest: string }>("import_drawing_reference", { image }),
  removeReferences: references => invoke<void>("remove_drawing_references", { references }),
  save: (taskId, images) => invoke<DrawingFile[]>("save_drawing_result", { taskId, images }),
  recover: taskId => invoke<DrawingFile[] | null>("recover_drawing_result", { taskId }),
  read: reference => invoke<DrawingImageInput>("read_drawing_result", { reference }),
  export: reference => invoke<boolean>("export_drawing_result", { reference }),
};

export async function createRuntimeImageTransport(): Promise<ImageGenerationTransport> {
  if (!isTauri()) throw new ImageGenerationError("请在桌面应用中生成图片。");
  const { fetch } = await import("@tauri-apps/plugin-http");
  const fetcher: Parameters<typeof createGeminiImageTransport>[0] = (input, init) => fetch(input, { ...init, maxRedirections: 0 });
  const gemini = createGeminiImageTransport(fetcher), openai = createOpenAIImagesTransport(fetcher);
  return { generate: (parameters, key, signal, references) => {
    switch (parameters.protocol) {
      case "gemini-image": return gemini.generate(parameters, key, signal, references);
      case "openai-images": return openai.generate(parameters, key, signal, references);
      default: throw new ImageGenerationError("不支持的绘图协议。");
    }
  } };
}
