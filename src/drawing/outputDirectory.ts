import { invoke, isTauri } from "@tauri-apps/api/core";

export interface DrawingOutputDirectorySettings {
  directory: string;
  defaultDirectory: string;
  isDefault: boolean;
}

export function drawingOutputError(error: unknown): string {
  const code = typeof error === "string" ? error : error instanceof Error ? error.message
    : error && typeof error === "object" && "code" in error ? error.code : undefined;
  switch (code) {
    case "drawing-output-unwritable": return "无法写入此输出目录，请检查磁盘空间和权限，或选择其他文件夹。";
    case "drawing-output-config": return "输出目录设置无法读取或保存，已保留原配置。";
    case "drawing-output-unavailable": return "输出目录不可用，请检查磁盘连接或选择其他文件夹。";
    default: return "绘图输出目录操作失败，请重试。";
  }
}

function nativeCommand<T>(command: string): Promise<T> {
  if (!isTauri()) return Promise.reject(new Error("绘图输出目录仅可在桌面应用中设置。"));
  return invoke<T>(command);
}

export function getDrawingOutputDirectorySettings(): Promise<DrawingOutputDirectorySettings> {
  return nativeCommand("get_drawing_output_directory_settings");
}

export function selectDrawingOutputDirectory(): Promise<DrawingOutputDirectorySettings | null> {
  return nativeCommand("select_drawing_output_directory");
}

export function resetDrawingOutputDirectory(): Promise<DrawingOutputDirectorySettings> {
  return nativeCommand("reset_drawing_output_directory");
}

export function openDrawingOutputDirectory(): Promise<void> {
  return nativeCommand("open_drawing_output_directory");
}
