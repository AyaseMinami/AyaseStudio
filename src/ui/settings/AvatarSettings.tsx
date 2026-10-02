import { useEffect, useRef, useState } from "react";
import { Crop, UserRound } from "lucide-react";
import { centeredCrop, cropRectangle, decodeAvatar, renderAvatar } from "../../avatar/image";
import type { AvatarCrop } from "../../avatar/repository";
import type { UserAvatarState } from "../../avatar/useUserAvatar";
import { AssistantAvatar } from "../chat/AssistantAvatar";
import "./AvatarSettings.css";

export interface Draft { original: Blob; image: HTMLImageElement; url: string; crop: AvatarCrop }

export function AvatarSettings({ avatar, importBusy = false }: { avatar: UserAvatarState; importBusy?: boolean }) {
  const [draft, setDraft] = useState<Draft>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => () => { if (draft) URL.revokeObjectURL(draft.url); }, [draft]);
  async function open(original: Blob, crop = centeredCrop) {
    setLoading(true); setError(undefined);
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(original.type) || original.size > 20 * 1024 * 1024)
        throw new Error("请选择 20 MB 以内的 PNG、JPEG 或 WebP 图片。");
      const image = await decodeAvatar(original);
      if (active.current) setDraft({ original, image, url: URL.createObjectURL(original), crop });
    } catch (error) { if (active.current) setError((error as Error).message); }
    finally { if (active.current) setLoading(false); }
  }
  const busy = avatar.busy || loading || importBusy;
  return <>
      <div className="avatar-card-heading"><h3 id="user-avatar-title">用户头像</h3><span>仅在本机</span></div>
      <div className="avatar-profile">
        <div className={`avatar-large${avatar.url || avatar.value ? " avatar-large-image" : ""}`}>{avatar.url ? <img src={avatar.url} alt="当前用户头像" /> : <UserRound size={32} strokeWidth={1.5} />}</div>
        <div><p className="muted-text">{avatar.url ? "显示在用户消息气泡内，所有对话共用。" : "当前使用默认头像，可从下方头像库选择。"}</p>
          <div className="avatar-buttons">
            {avatar.value && <button className="settings-button" disabled={busy} onClick={() => void open(avatar.value!.original, avatar.value!.crop)}><Crop size={15} />重新裁切</button>}
            {(avatar.value || avatar.error) && <button className="settings-button" disabled={busy} onClick={() => { setError(undefined); void avatar.save(); }}>恢复默认</button>}</div>
        </div>
      </div>
    {(error || avatar.error) && <p role="alert" className="avatar-error">{error || avatar.error}</p>}
    {draft && <AvatarCropDialog draft={draft} saving={avatar.busy} onCancel={() => setDraft(undefined)} onSave={async (crop) => {
      try {
        const thumbnail = await renderAvatar(draft.image, crop);
        if (await avatar.save({ original: draft.original, thumbnail, crop, ...(draft.original === avatar.value?.original && avatar.value.source ? { source: avatar.value.source } : {}) })) setDraft(undefined);
      } catch { setError("裁切失败，原头像已保留，请重新选择。"); }
    }} error={error || avatar.error} />}
  </>;
}

export function AvatarPreview({ avatar }: { avatar: UserAvatarState }) {
  return <section className="avatar-preview" aria-label="头像聊天效果预览"><div className="avatar-preview-label">当前用户头像效果</div>
    <div className="avatar-preview-user"><div className="user-message-group message-surface">
      <div className="message-identity message-identity-user">{avatar.url ? <img className="message-user-avatar" src={avatar.url} alt="" /> : <span className="message-user-avatar message-avatar-fallback" style={avatar.value ? { background: "transparent" } : undefined} role="img" aria-label="默认用户头像"><UserRound size={20} strokeWidth={1.6} aria-hidden="true" /></span>}</div>
      <div className="user-message message-body">今天也聊点有趣的吧。</div>
    </div></div>
    <div className="avatar-preview-reply assistant-message-group message-surface">
      <div className="message-identity"><AssistantAvatar assistantName="示例助手" assistantId="avatar-settings-preview" className="message-assistant-avatar" /><span className="message-author">示例助手</span></div>
      <div className="message-body">好呀，你想从哪里开始？</div>
    </div>
  </section>;
}

export function AvatarCropDialog({ draft, saving, error, onCancel, onSave }: {
  draft: Draft; saving: boolean; error?: string; onCancel(): void; onSave(crop: AvatarCrop): Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [processing, setProcessing] = useState(false);
  useEffect(() => { const node = dialog.current!; node.showModal(); return () => node.close(); }, []);
  return <dialog ref={dialog} className="avatar-crop-dialog" aria-labelledby="avatar-crop-title" onKeyDown={(event) => event.stopPropagation()} onCancel={(event) => { event.preventDefault(); if (!saving && !processing) onCancel(); }}>
    <AvatarCropContent draft={draft} saving={saving} error={error} onCancel={onCancel} onSave={onSave} onProcessingChange={setProcessing} />
  </dialog>;
}

export function AvatarCropContent({ draft, saving, error, onCancel, onSave, saveLabel = "应用头像", saveDisabled = false, children, onProcessingChange }: {
  draft: Draft; saving: boolean; error?: string; onCancel(): void; onSave(crop: AvatarCrop): Promise<void>; saveLabel?: string; saveDisabled?: boolean; children?: React.ReactNode; onProcessingChange?(busy: boolean): void;
}) {
  const [crop, setCrop] = useState(draft.crop);
  const [processing, setProcessing] = useState(false);
  const active = useRef(false);
  const drag = useRef<{ x: number; y: number; crop: AvatarCrop } | null>(null);
  const busy = saving || processing;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const width = draft.image.naturalWidth, height = draft.image.naturalHeight;
  const rect = cropRectangle(width, height, crop);
  return <>
    <header><h2 id="avatar-crop-title">裁切头像</h2><p className="muted-text">拖动图片调整位置，缩放选择合适的范围。</p></header>
    <svg className="avatar-crop-stage" viewBox={`${rect.x} ${rect.y} ${rect.side} ${rect.side}`} aria-label="正方形头像裁切预览"
      onPointerDown={(event) => { if (busy) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, crop: { ...crop, x: (rect.x + rect.side / 2) / width, y: (rect.y + rect.side / 2) / height } }; }}
      onPointerMove={(event) => { if (!drag.current) return; const scale = rect.side / event.currentTarget.getBoundingClientRect().width;
        const next = { ...drag.current.crop, x: drag.current.crop.x - (event.clientX - drag.current.x) * scale / width, y: drag.current.crop.y - (event.clientY - drag.current.y) * scale / height };
        const bounds = cropRectangle(width, height, next); setCrop({ ...next, x: (bounds.x + bounds.side / 2) / width, y: (bounds.y + bounds.side / 2) / height }); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <image href={draft.url} width={width} height={height} />
      <path d={`M ${rect.x + rect.side / 3} ${rect.y} v ${rect.side} M ${rect.x + rect.side * 2 / 3} ${rect.y} v ${rect.side} M ${rect.x} ${rect.y + rect.side / 3} h ${rect.side} M ${rect.x} ${rect.y + rect.side * 2 / 3} h ${rect.side}`} stroke="#ffffff80" vectorEffect="non-scaling-stroke" fill="none" />
    </svg>
    {children}
    <div className="avatar-crop-sliders">{([
      ["zoom", "缩放", 1, 4, 0.01], ["x", "横向位置", 0, 1, 0.01], ["y", "纵向位置", 0, 1, 0.01],
    ] as const).map(([key, label, min, max, step]) => <label key={key}>{label}<input type="range" aria-label={label} min={min} max={max} step={step} value={crop[key]} disabled={busy} onChange={(event) => setCrop({ ...crop, [key]: Number(event.target.value) })} /><output>{Math.round(crop[key] * 100)}%</output></label>)}</div>
    {error && <p role="alert" className="avatar-error">{error}</p>}
    <footer><button type="button" className="settings-button" disabled={busy} onClick={() => setCrop(centeredCrop)}>恢复居中</button><span /><button type="button" className="settings-button" disabled={busy} onClick={onCancel}>取消</button><button type="button" className="settings-button settings-button-primary" disabled={busy || saveDisabled} onClick={async () => { setProcessing(true); onProcessingChange?.(true); try { await onSave(crop); } finally { if (active.current) { setProcessing(false); onProcessingChange?.(false); } } }}>{busy ? "保存中…" : saveLabel}</button></footer>
  </>;
}
