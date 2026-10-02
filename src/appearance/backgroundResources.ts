import { convertFileSrc, invoke } from "@tauri-apps/api/core";

import {
  BackgroundResourceError,
  type BackgroundResource,
  type BackgroundResourceStore,
} from "./appearance";

interface NativeBackgroundResource {
  reference: string;
  absolutePath: string;
  name?: string;
}

const nativeErrorMessages: Record<string, string> = {
  "background-too-large": "背景图片不能超过 20 MB，现有背景未发生变化。",
  "background-unsupported-type":
    "仅支持 PNG、JPEG 或 WebP 图片，现有背景未发生变化。",
  "background-corrupt": "图片已损坏或无法解码，现有背景未发生变化。",
  "background-invalid-reference": "背景资源引用无效，已回退到基础主题。",
  "background-unavailable": "无法读取所选图片，现有背景未发生变化。",
  "background-storage-failed": "无法写入 Ayase Studio 私有目录。",
};

function toResource(resource: NativeBackgroundResource): BackgroundResource {
  return {
    reference: resource.reference,
    url: convertFileSrc(resource.absolutePath),
    name: resource.name,
  };
}

function toBackgroundError(error: unknown): BackgroundResourceError {
  const code =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "";
  return new BackgroundResourceError(
    nativeErrorMessages[code] ?? "背景图片操作失败，现有外观保持不变。",
  );
}

export function createTauriBackgroundResourceStore(): BackgroundResourceStore {
  return {
    async selectAndImport() {
      try {
        const resource = await invoke<NativeBackgroundResource | null>(
          "select_background_image",
        );
        return resource ? toResource(resource) : null;
      } catch (error) {
        throw toBackgroundError(error);
      }
    },
    async resolve(reference, options) {
      try {
        return toResource(
          await invoke<NativeBackgroundResource>("resolve_background_image", {
            reference,
            thumbnail: options?.thumbnail ?? false,
            refresh: options?.refresh ?? false,
          }),
        );
      } catch (error) {
        throw toBackgroundError(error);
      }
    },
    async cleanup(retainedReferences) {
      try {
        await invoke("cleanup_background_images", {
          retainedReferences: [...retainedReferences],
        });
      } catch (error) {
        throw toBackgroundError(error);
      }
    },
  };
}
