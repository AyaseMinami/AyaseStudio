export interface DrawingDraft {
  id: "current";
  prompt: string;
  aspectRatio: string;
  resolution: string;
  modelId: string | null;
  /** Absent in #84 drafts; defaults to automatic without rewriting old records. */
  openai?: { size: string; quality: string };
  /** Missing old fields preserve service defaults and TEXT+IMAGE output. */
  gemini?: GeminiDrawingOptions;
  grok?: GrokDrawingOptions;
  seedream?: SeedreamDrawingOptions;
  /** Legacy durable bindings only. New selections live in DrawingState.references, never here. */
  references?: DrawingReference[];
  count?: number;
  concurrency?: number;
  completionSound?: boolean;
  /** Preserve reused protocol controls when the original target is unavailable. */
  reusedProtocol?: DrawingProtocol;
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

export type DrawingProtocol = "gemini-image" | "openai-images" | "grok-images" | "seedream-images";
export interface GrokDrawingOptions { modelVersion: "legacy" | "2.0"; aspectRatio: string; resolution: string; quality: string }
export interface SeedreamDrawingOptions { modelVersion: "4.0" | "4.5" | "5.0-lite" | "5.0-pro" | "5.0-flash"; size: string; outputFormat: "auto" | "png" | "jpeg"; watermark: "auto" | "on" | "off" }
export type GeminiSafetyThreshold = "BLOCK_NONE" | "BLOCK_ONLY_HIGH" | "BLOCK_MEDIUM_AND_ABOVE" | "BLOCK_LOW_AND_ABOVE" | "OFF";
export interface GeminiDrawingOptions {
  temperature?: number;
  safetyThreshold?: GeminiSafetyThreshold;
  outputMode?: "text-image" | "image";
}
export type DrawingParameters = DrawingParameterBase & (
  | { protocol: "gemini-image"; aspectRatio: string; resolution: string; gemini?: GeminiDrawingOptions }
  | { protocol: "openai-images"; size: string; quality: string }
  | ({ protocol: "grok-images" } & GrokDrawingOptions)
  | ({ protocol: "seedream-images" } & SeedreamDrawingOptions)
);

export type DrawingTaskStatus = "queued" | "preparing" | "dispatching" | "running" | "saving" | "completed" | "failed" | "cancelled" | "unknown" | "save-failed";
export interface DrawingRecovery {
  total: number;
  durable: number[];
  memory: number[];
  lost: number[];
  unverified?: boolean;
}
export interface DrawingDiagnostic {
  category: "rejected" | "rate-limited" | "network-unknown" | "invalid-response" | "local-file" | "local-state" | "configuration" | "cancelled";
  httpStatus?: number;
}
export interface DrawingTask {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: DrawingTaskStatus;
  parameters: DrawingParameters;
  error?: string;
  batchId?: string;
  queueOrder?: number;
  startedAt?: string;
  finishedAt?: string;
  sourceTaskId?: string;
  diagnostic?: DrawingDiagnostic;
  recovery?: DrawingRecovery;
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
/** Session only: byte-backed Blobs are never serialized or placed in task records. */
export type DrawingReferenceSelection = DrawingReference | { id: string; name: string; blob: Blob };
export interface DrawingResult extends DrawingFile {
  taskId: string;
  createdAt: string;
  parameters: DrawingParameters;
}

/** Export-only allowlist. Never spread stored provider configuration here. */
export interface DrawingExportParameters {
  prompt: string;
  model: string;
  protocol: DrawingProtocol;
  api_type?: "gemini" | "gpt";
  model_version?: string;
  output_format?: string;
  watermark?: boolean;
  aspect_ratio?: string;
  resolution?: string;
  size?: string;
  quality?: string;
  temperature?: number;
  safety_threshold?: GeminiSafetyThreshold;
  response_modalities?: ("TEXT" | "IMAGE")[];
}

export interface DrawingFiles {
  importReference(image: DrawingImageInput): Promise<DrawingFile & { digest: string }>;
  importReferenceBytes?(bytes: Uint8Array<ArrayBuffer>): Promise<DrawingFile & { digest: string }>;
  listReferences?(): Promise<string[]>;
  removeReferences(references: string[]): Promise<void>;
  save(taskId: string, images: DrawingImageInput[]): Promise<DrawingFile[]>;
  recover(taskId: string): Promise<DrawingFile[] | null>;
  inspectRecovery?(taskId: string): Promise<{ total: number; durable: number[] }>;
  resumeRecovery?(taskId: string, images: { index: number; image: DrawingImageInput }[]): Promise<DrawingFile[]>;
  discardRecovery?(taskId: string, completedOnly?: boolean): Promise<void>;
  read(reference: string): Promise<DrawingImageInput>;
  thumbnail?(reference: string): Promise<DrawingImageInput>;
  export(reference: string, parameters?: DrawingExportParameters): Promise<boolean>;
}

export interface ImageGenerationTransport {
  generate(parameters: DrawingParameters, apiKey: string, signal: AbortSignal, references?: DrawingImageInput[]): Promise<DrawingImageInput[]>;
}

export interface DrawingModelOption { id: string; label: string; protocol: DrawingProtocol }
