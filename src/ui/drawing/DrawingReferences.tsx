import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { DrawingImageInput, DrawingReference } from "../../drawing/types";

function ReferenceImage({ item, number, read, onView }: {
  item: DrawingReference;
  number: number;
  read(reference: string): Promise<DrawingImageInput>;
  onView(url: string, opener: HTMLButtonElement): void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    let previewUrl: string | undefined;
    setUrl(null);
    setError(false);
    void read(item.reference).then(image => {
      if (!alive) return;
      const bytes = Uint8Array.from(atob(image.data), char => char.charCodeAt(0));
      previewUrl = URL.createObjectURL(new Blob([bytes], { type: image.mime }));
      setUrl(previewUrl);
    }).catch(() => { if (alive) setError(true); });
    return () => { alive = false; if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [item.reference, read]);
  return <button type="button" className="drawing-reference-thumbnail" disabled={!url || error}
    aria-label={`查看参考图 ${number}`} onClick={event => { if (url) onView(url, event.currentTarget); }}>
    {error ? <span role="alert">预览读取失败</span> : url
      ? <img src={url} alt={`参考图 ${number}`} onError={() => setError(true)} />
      : <span>正在读取…</span>}
  </button>;
}

function ReferencePreview({ url, number, opener, onClose }: {
  url: string;
  number: number;
  opener: HTMLButtonElement;
  onClose(): void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    return () => { if (opener.isConnected) opener.focus({ preventScroll: true }); };
  }, [opener]);
  return <div className="drawing-reference-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <div className="drawing-reference-dialog" role="dialog" aria-modal="true" aria-label={`参考图 ${number} 大图预览`}
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
        if (event.key === "Tab") { event.preventDefault(); close.current?.focus(); }
      }}>
      <div className="drawing-section-heading"><h2>参考图 {number}</h2>
        <button ref={close} type="button" className="drawing-button" onClick={onClose}>关闭参考图预览</button></div>
      <img src={url} alt={`参考图 ${number}`} />
    </div>
  </div>;
}

export function DrawingReferences({ references, disabled, busy, read, onAdd, onRemove, onMove }: {
  references: DrawingReference[];
  disabled: boolean;
  busy: boolean;
  read(reference: string): Promise<DrawingImageInput>;
  onAdd(files: File[]): void;
  onRemove(id: string): void;
  onMove(id: string, direction: -1 | 1): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ id: string; url: string; opener: HTMLButtonElement } | null>(null);
  const previewIndex = preview ? references.findIndex(item => item.id === preview.id) : -1;
  return <div className="drawing-field drawing-references" aria-label="参考图">
    <span className="drawing-label">参考图{references.length > 0 ? ` · ${references.length}` : ""}</span>
    <input ref={input} id="drawing-reference-input" className="drawing-reference-input" type="file" multiple
      accept=".png,.jpg,.jpeg,.webp,.bmp,image/png,image/jpeg,image/webp,image/bmp" disabled={disabled}
      aria-label="选择参考图文件" onChange={event => {
        const files = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = "";
        if (!disabled && files.length) onAdd(files);
      }} />
    <button type="button" className="drawing-button drawing-reference" disabled={disabled} onClick={() => input.current?.click()}>
      <Plus size={16} aria-hidden="true" />添加参考图
    </button>
    <p className="drawing-muted">可多选、拖入或粘贴图片；支持 PNG、JPG、JPEG、WebP、BMP。</p>
    {busy && <p className="drawing-muted" role="status">正在添加参考图…</p>}
    {references.length > 0 && <ol className="drawing-reference-list">
      {references.map((item, index) => <li key={item.id} className="drawing-reference-card">
        <ReferenceImage item={item} number={index + 1} read={read}
          onView={(url, opener) => setPreview({ id: item.id, url, opener })} />
        <div className="drawing-reference-info">
          <span className="drawing-label">参考图 {index + 1}</span>
          <span className="drawing-muted drawing-reference-name" title={item.name}>{item.name}</span>
          <div className="drawing-actions">
            <button type="button" className="drawing-button" aria-label={`上移参考图 ${index + 1}`}
              disabled={disabled || index === 0} onClick={() => onMove(item.id, -1)}>上移</button>
            <button type="button" className="drawing-button" aria-label={`下移参考图 ${index + 1}`}
              disabled={disabled || index === references.length - 1} onClick={() => onMove(item.id, 1)}>下移</button>
            <button type="button" className="drawing-button" aria-label={`移除参考图 ${index + 1}`}
              disabled={disabled} onClick={() => onRemove(item.id)}>移除</button>
          </div>
        </div>
      </li>)}
    </ol>}
    {preview && previewIndex >= 0 && <ReferencePreview url={preview.url} number={previewIndex + 1}
      opener={preview.opener} onClose={() => setPreview(null)} />}
  </div>;
}
