export interface DrawingDraft {
  id: "current";
  prompt: string;
  aspectRatio: string;
  resolution: string;
  modelId: string | null;
  /** Absent in #84 drafts; defaults to automatic without rewriting old records. */
  openai?: { size: string; quality: string };
  references?: DrawingReference[];
}

export const initialDrawingDraft: DrawingDraft = {
  id: "current", prompt: "", aspectRatio: "auto", resolution: "auto", modelId: null,
};

/** Frozen task parameters never include credentials. */
interface DrawingParameterBase {
  prompt: string;
  providerId: string;
  connectionId: string;
  configuredModelId: string;
  modelId: string;
  modelName: string;
  baseUrl: string;
  references?: DrawingReference[];
}

export type DrawingProtocol = "gemini-image" | "openai-images";
export type DrawingParameters = DrawingParameterBase & (
  | { protocol: "gemini-image"; aspectRatio: string; resolution: string }
  | { protocol: "openai-images"; size: string; quality: string }
);

export type DrawingTaskStatus = "running" | "saving" | "completed" | "failed" | "cancelled" | "unknown" | "save-failed";
export interface DrawingTask {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: DrawingTaskStatus;
  parameters: DrawingParameters;
  error?: string;
}

export interface DrawingImageInput { mime: string; data: string }
export interface DrawingFile {
  id: string;
  reference: string;
  mime: string;
  size: number;
  width: number;
  height: number;
}
export interface DrawingReference extends DrawingFile { name: string; digest?: string }
export interface DrawingResult extends DrawingFile {
  taskId: string;
  createdAt: string;
  parameters: DrawingParameters;
}

export interface DrawingFiles {
  importReference(image: DrawingImageInput): Promise<DrawingFile & { digest: string }>;
  removeReferences(references: string[]): Promise<void>;
  save(taskId: string, images: DrawingImageInput[]): Promise<DrawingFile[]>;
  recover(taskId: string): Promise<DrawingFile[] | null>;
  read(reference: string): Promise<DrawingImageInput>;
  export(reference: string): Promise<boolean>;
}

export interface ImageGenerationTransport {
  generate(parameters: DrawingParameters, apiKey: string, signal: AbortSignal, references?: DrawingImageInput[]): Promise<DrawingImageInput[]>;
}

export interface DrawingModelOption { id: string; label: string; protocol: DrawingProtocol }
