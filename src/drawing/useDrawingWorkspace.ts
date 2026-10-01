import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import { DrawingController, UnsavedDrawingImagesError } from "./controller";
import { DexieDrawingRepository } from "./repository";
import { createRuntimeImageTransport, runtimeDrawingFiles } from "./runtime";

export function useDrawingWorkspace() {
  const [controller] = useState(() => new DrawingController({ repository: new DexieDrawingRepository(),
    files: runtimeDrawingFiles, transport: createRuntimeImageTransport }));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const sound = useRef<AudioContext | null>(null);
  const heard = useRef(0);
  useEffect(() => {
    const unlock = () => {
      if (controller.getSnapshot().draft.completionSound === false || typeof AudioContext === "undefined") return;
      sound.current ??= new AudioContext();
      void sound.current.resume().catch(() => undefined);
    };
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("keydown", unlock);
    return () => {
      document.removeEventListener("pointerdown", unlock); document.removeEventListener("keydown", unlock);
      void sound.current?.close().catch(() => undefined); sound.current = null;
    };
  }, [controller]);
  useEffect(() => {
    if (state.completion.sequence === heard.current) return;
    heard.current = state.completion.sequence;
    const context = sound.current;
    if (state.draft.completionSound === false || !context || context.state !== "running") return;
    const tone = context.createOscillator(), gain = context.createGain();
    tone.frequency.value = state.completion.allSucceeded ? 660 : 330;
    gain.gain.setValueAtTime(0.08, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.3);
    tone.connect(gain); gain.connect(context.destination);
    tone.onended = () => { tone.disconnect(); gain.disconnect(); };
    tone.start(); tone.stop(context.currentTime + 0.3);
  }, [state.completion, state.draft.completionSound]);
  const [preview, setPreview] = useState<{ id: string; url: string | null; error: string | null } | null>(null);
  useEffect(() => { void controller.initialize(); }, [controller]);
  const result = state.results.find(item => item.id === state.selectedResultId);
  useEffect(() => {
    if (!result) return;
    let alive = true, url: string | undefined;
    void runtimeDrawingFiles.read(result.reference).then(image => {
      if (!alive) return;
      const bytes = Uint8Array.from(atob(image.data), char => char.charCodeAt(0));
      url = URL.createObjectURL(new Blob([bytes], { type: image.mime }));
      setPreview({ id: result.id, url, error: null });
    }).catch(() => { if (alive) setPreview({ id: result.id, url: null, error: "图片读取失败；本地成果记录已保留。" }); });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [result]);
  useEffect(() => {
    if (!isTauri()) return;
    let alive = true, release: (() => void) | undefined, approved = false, closing = false;
    void getCurrentWindow().onCloseRequested(event => {
      if (approved) return;
      event.preventDefault();
      if (closing) return;
      if ((controller.getSnapshot().busy || controller.getSnapshot().submitting || controller.getSnapshot().tasks.some(task => task.status === "queued")) && !window.confirm("绘图队列尚未结束。退出将保留等待项并停止本地请求；可能已发出的请求结果未知，服务端仍可能生成或计费。重启后需手动继续等待项。确定退出？")) return;
      closing = true;
      void (async () => {
        try {
          try { await controller.settleForClose(); }
          catch (error) {
            if (!(error instanceof UnsavedDrawingImagesError)) throw error;
            if (!window.confirm("有已生成但尚未保存的图片。退出可能丢失这些图片，建议先重试本地保存。仍然退出？")) { closing = false; controller.cancelClose(); return; }
            await controller.discardUnsavedForClose();
          }
          approved = true; await getCurrentWindow().close();
        } catch { approved = false; closing = false; controller.cancelClose(); window.alert("绘图数据尚未完成保存，请检查本地存储后再退出。"); }
      })();
    }).then(unlisten => { if (alive) release = unlisten; else unlisten(); }).catch(() => { /* Startup smoke does not claim native close-event acceptance. */ });
    return () => { alive = false; release?.(); };
  }, [controller]);
  return { ...state, controller, previewUrl: preview?.id === result?.id ? preview?.url ?? null : null,
    previewError: preview?.id === result?.id ? preview?.error ?? null : null };
}
