import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { base64ToBytes, isOfficeAttachment, safeTextAttachment, type RequestAttachment, type SentAttachment } from "../../chat/attachments";
import { SafeMarkdown } from "../../chat/SafeMarkdown";

function PdfPreview({ data }: { data: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    let close: (() => void) | undefined;
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const task = pdfjs.getDocument({ data: base64ToBytes(data), useSystemFonts: false });
        close = () => void task.destroy();
        const document = await task.promise;
        if (cancelled) return;
        setTotal(document.numPages);
        const pdfPage = await document.getPage(page);
        if (cancelled) return;
        const base = pdfPage.getViewport({ scale: 1 });
        if (!Number.isFinite(base.width) || !Number.isFinite(base.height) ||
          !Number.isFinite(base.width * base.height) || base.width <= 0 || base.height <= 0) {
          throw new Error("Invalid PDF page dimensions");
        }
        const viewport = pdfPage.getViewport({ scale: Math.min(1.4, 1800 / base.width, 1800 / base.height,
          Math.sqrt(4_000_000 / (base.width * base.height))) });
        const element = canvas.current;
        const context = element?.getContext("2d");
        if (!element || !context) return;
        element.width = Math.floor(viewport.width);
        element.height = Math.floor(viewport.height);
        await pdfPage.render({ canvas: element, canvasContext: context, viewport }).promise;
      } catch { if (!cancelled) setError("无法在当前窗口预览该 PDF。附件记录仍保持不变。"); }
    })();
    return () => { cancelled = true; close?.(); };
  }, [data, page]);
  return <div className="pdf-preview">
    {error && <p role="alert">{error}</p>}
    <canvas ref={canvas} aria-label={`PDF 第 ${page} 页`} />
    {total > 0 && <div className="pdf-preview-controls">
      <button type="button" disabled={page <= 1} onClick={() => setPage((old) => old - 1)}>上一页</button>
      <span>{page} / {total}</span>
      <button type="button" disabled={page >= total} onClick={() => setPage((old) => old + 1)}>下一页</button>
    </div>}
  </div>;
}

export function SentAttachmentPreview({ item, read, images = [], onNavigate, returnFocus, onClose }: {
  item: SentAttachment;
  read(item: SentAttachment): Promise<RequestAttachment>;
  images?: SentAttachment[];
  onNavigate?: (item: SentAttachment) => void;
  returnFocus: HTMLElement;
  onClose(): void;
}) {
  const [loaded, setLoaded] = useState<RequestAttachment>();
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  const infoOnly = isOfficeAttachment(item);
  const imageIndex = images.findIndex((image) => image.reference === item.reference);
  useEffect(() => {
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { if (returnFocus.isConnected) returnFocus.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    let alive = true;
    setLoaded(undefined);
    setError("");
    if (!infoOnly) void read(item).then((value) => { if (alive) setLoaded(value); })
      .catch((caught) => { if (alive) setError(caught instanceof Error ? caught.message : "附件读取失败。"); });
    return () => { alive = false; };
  }, [item, read, infoOnly]);
  return <div className="attachment-preview-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <div ref={dialog} className="attachment-preview-dialog" role="dialog" aria-modal="true"
      aria-label={`预览 ${item.name}`} onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); return; }
        if (imageIndex >= 0 && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
          const next = images[imageIndex + (event.key === "ArrowLeft" ? -1 : 1)];
          if (next) { event.preventDefault(); onNavigate?.(next); }
        }
        if (event.key !== "Tab") return;
        const fields = [...(dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        const index = fields.indexOf(document.activeElement as HTMLButtonElement);
        if (event.shiftKey && index <= 0) { event.preventDefault(); fields[fields.length - 1]?.focus(); }
        else if (!event.shiftKey && index === fields.length - 1) { event.preventDefault(); fields[0]?.focus(); }
      }}>
      <div className="attachment-preview-heading"><h2>{item.name}</h2>
        <button type="button" aria-label="关闭预览" onClick={onClose}><X size={18} /></button></div>
      {imageIndex >= 0 && images.length > 1 && <div className="attachment-preview-navigation">
        <button type="button" aria-disabled={imageIndex === 0} onClick={() => {
          if (imageIndex > 0) onNavigate?.(images[imageIndex - 1]);
        }}>上一张</button>
        <span>{imageIndex + 1} / {images.length}</span>
        <button type="button" aria-disabled={imageIndex === images.length - 1} onClick={() => {
          if (imageIndex < images.length - 1) onNavigate?.(images[imageIndex + 1]);
        }}>下一张</button>
      </div>}
      {error && <p role="alert">{error}</p>}
      {infoOnly && <div className="attachment-preview-text"><p>{item.name} · {(item.size / 1_000_000).toFixed(2)} MB</p>
        <p>{item.mimeType}</p><p>原文件已保存在本地。本应用不解析或预览 Office 正文，发送时由 Responses 服务端处理。</p></div>}
      {!infoOnly && !loaded && !error && <p role="status">正在读取附件…</p>}
      {!error && loaded?.mimeType.startsWith("image/") &&
        <img className="attachment-preview-image" alt={loaded.name}
          onError={() => setError("图片加载失败，无法预览。附件记录仍保持不变。")}
          src={`data:${loaded.mimeType};base64,${loaded.data}`} />}
      {loaded?.mimeType === "application/pdf" && <PdfPreview data={loaded.data} />}
      {loaded?.mimeType === "text/plain" && <pre className="attachment-preview-text">{safeTextAttachment(loaded.data)}</pre>}
      {loaded?.mimeType === "text/markdown" && <div className="attachment-preview-text markdown">
        <SafeMarkdown>{safeTextAttachment(loaded.data)}</SafeMarkdown>
      </div>}
    </div>
  </div>;
}
