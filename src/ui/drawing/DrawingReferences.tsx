import { useEffect, useRef, useState } from "react";
import { ImagePlus, Plus, X } from "lucide-react";
import { ActionMenu, isContextMenuKey, useActionMenu } from "../ActionMenu";
import { DrawingResultThumbnail } from "./DrawingResultThumbnail";
import type { DrawingImageInput, DrawingReferenceSelection } from "../../drawing/types";

function SessionThumbnail({ blob, label }: { blob: Blob; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    setError(false);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);
  return <span className="drawing-result-thumbnail">
    {error ? <span role="status">缩略图读取失败</span> : url
      ? <img src={url} alt={label} onError={() => setError(true)} />
      : <span>正在读取缩略图…</span>}
  </span>;
}

function ReferenceImage({ item, number, read, onView }: {
  item: DrawingReferenceSelection;
  number: number;
  read?: (reference: string) => Promise<DrawingImageInput>;
  onView(opener: HTMLButtonElement): void;
}) {
  const blob = "blob" in item ? item.blob : undefined;
  const reference = "reference" in item ? item.reference : undefined;
  // Keep the already displayed snapshot across its first managed-file promotion.
  // This belongs only to the mounted selection, never to durable records or a global cache.
  const [retained, setRetained] = useState<{ blob: Blob; reference?: string } | null>(() => blob ? { blob } : null);
  useEffect(() => {
    if (blob) setRetained({ blob });
    else setRetained(current => current && current.reference === undefined ? { ...current, reference }
      : current?.reference === reference ? current : null);
  }, [blob, reference]);
  const thumbnailBlob = blob ?? (retained?.reference === undefined || retained.reference === reference ? retained?.blob : undefined);
  return <button type="button" className="drawing-reference-thumbnail"
    title={`参考图 ${number} · ${item.name}（右键管理）`}
    aria-label={`查看参考图 ${number}`} onClick={event => onView(event.currentTarget)}>
    {thumbnailBlob ? <SessionThumbnail blob={thumbnailBlob} label={`参考图 ${number}`} />
      : reference && <DrawingResultThumbnail reference={reference} label={`参考图 ${number}`} read={read} />}
  </button>;
}

function ReferencePreview({ item, read, number, opener, onClose }: {
  item: DrawingReferenceSelection;
  read(reference: string): Promise<DrawingImageInput>;
  number: number;
  opener: HTMLButtonElement;
  onClose(): void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const blob = "blob" in item ? item.blob : undefined;
  const reference = "reference" in item ? item.reference : undefined;
  useEffect(() => {
    let alive = true;
    let previewUrl: string | undefined;
    setUrl(null);
    setError(false);
    if (blob) {
      previewUrl = URL.createObjectURL(blob);
      setUrl(previewUrl);
    } else if (reference) void read(reference).then(image => {
      if (!alive) return;
      const bytes = Uint8Array.from(atob(image.data), char => char.charCodeAt(0));
      previewUrl = URL.createObjectURL(new Blob([bytes], { type: image.mime }));
      setUrl(previewUrl);
    }).catch(() => { if (alive) setError(true); });
    return () => { alive = false; if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [blob, reference, read]);
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
      <div className="drawing-section-heading"><h2 title={`参考图 ${number} · ${item.name}`}>参考图 {number} · {item.name}</h2>
        <button ref={close} type="button" className="drawing-button" aria-label="关闭参考图预览" onClick={onClose}><X size={18} /></button></div>
      {error ? <p role="alert">原图读取失败，请关闭后重试。</p> : url
        ? <img src={url} alt={`参考图 ${number}`} onError={() => setError(true)} />
        : <p role="status">正在加载原图…</p>}
    </div>
  </div>;
}

export function DrawingReferences({ references, disabled, busy, read, readThumbnail, onAdd, onRemove, onMove, onClear }: {
  references: DrawingReferenceSelection[];
  disabled: boolean;
  busy: boolean;
  read(reference: string): Promise<DrawingImageInput>;
  readThumbnail?: (reference: string) => Promise<DrawingImageInput>;
  onAdd(files: File[]): void;
  onRemove(id: string): void;
  onMove(id: string, direction: -1 | 1): void;
  onClear?(): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const menu = useActionMenu<string>();
  const menuIndex = references.findIndex(item => item.id === menu.state?.target);
  const [preview, setPreview] = useState<{ id: string; opener: HTMLButtonElement } | null>(null);
  const previewIndex = preview ? references.findIndex(item => item.id === preview.id) : -1;
  return <div className="drawing-field drawing-references" data-empty={references.length === 0 ? "true" : "false"} aria-label="参考图">
    <div className="drawing-reference-heading">
      <span className="drawing-label">参考图{references.length > 0 ? ` · ${references.length}` : ""}</span>
      <input ref={input} id="drawing-reference-input" className="drawing-reference-input" type="file" multiple
        accept=".png,.jpg,.jpeg,.webp,.bmp,image/png,image/jpeg,image/webp,image/bmp" disabled={disabled}
        aria-label="选择参考图文件" onChange={event => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          if (!disabled && files.length) onAdd(files);
        }} />
      <div className="drawing-reference-heading-actions">
        <button type="button" className="drawing-button drawing-reference" aria-label="添加参考图"
          title="添加参考图（支持 PNG、JPG、JPEG、WebP、BMP）" disabled={disabled} onClick={() => input.current?.click()}>
          <Plus size={14} aria-hidden="true" />添加
        </button>
        {onClear && references.length > 0 && <button type="button" className="drawing-button drawing-reference-clear"
          aria-label="清空参考图" title="清空参考图" disabled={disabled}
          onClick={() => { setPreview(null); onClear(); }}>清空</button>}
      </div>
    </div>
    {busy && <p className="drawing-muted drawing-reference-busy" role="status">正在添加参考图…</p>}
    <div className="drawing-reference-stage">
      {references.length === 0 ? <div className="drawing-reference-empty" title="支持 PNG、JPG、JPEG、WebP、BMP">
        <ImagePlus size={18} strokeWidth={1.6} aria-hidden="true" />
        <p className="drawing-muted drawing-reference-hint">可多选，也可拖入或粘贴图片</p>
      </div> : <ol className="drawing-reference-list">
        {references.map((item, index) => <li key={item.id} className="drawing-reference-card"
          onContextMenu={event => {
            event.preventDefault(); event.stopPropagation();
            menu.open(item.id, event.currentTarget.querySelector<HTMLButtonElement>(".drawing-reference-thumbnail")!, { x: event.clientX, y: event.clientY });
          }}
          onKeyDown={event => {
            if (!isContextMenuKey(event)) return;
            event.preventDefault(); event.stopPropagation();
            menu.open(item.id, event.currentTarget.querySelector<HTMLButtonElement>(".drawing-reference-thumbnail")!);
          }}>
          <ReferenceImage item={item} number={index + 1} read={readThumbnail}
            onView={opener => setPreview({ id: item.id, opener })} />
          <span className="drawing-reference-index" aria-hidden="true">{index + 1}</span>
          <button type="button" className="drawing-reference-remove" disabled={disabled}
            aria-label={`移除参考图 ${index + 1}`} title={`移除参考图 ${index + 1}`}
            onClick={event => {
              event.stopPropagation();
              if (preview?.id === item.id) setPreview(null);
              onRemove(item.id);
            }}><X size={12} aria-hidden="true" /></button>
        </li>)}
      </ol>}
    </div>
    <p className="drawing-muted drawing-reference-footnote">未提交的参考图仅在本次打开期间保留。</p>
    {menu.state && menuIndex >= 0 && <ActionMenu state={menu.state} label={`参考图 ${menuIndex + 1} 操作`} onClose={menu.close}
      items={[
        { id: "previous", label: "前移", disabled: disabled || menuIndex === 0,
          onSelect: () => onMove(references[menuIndex].id, -1) },
        { id: "next", label: "后移", disabled: disabled || menuIndex === references.length - 1,
          onSelect: () => onMove(references[menuIndex].id, 1) },
        { id: "remove", label: "移除", danger: true, disabled,
          onSelect: () => onRemove(references[menuIndex].id) },
      ]} />}
    {preview && previewIndex >= 0 && <ReferencePreview key={preview.id} item={references[previewIndex]} read={read} number={previewIndex + 1}
      opener={preview.opener} onClose={() => setPreview(null)} />}
  </div>;
}
