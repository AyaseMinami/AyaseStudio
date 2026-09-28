import { useEffect, useRef, useState } from "react";
import { Crop, ImagePlus } from "lucide-react";
import { centeredCrop, decodeAvatar, renderAvatar } from "../../avatar/image";
import type { AvatarCrop, UserAvatar } from "../../avatar/repository";
import { AvatarCropDialog, type Draft } from "../settings/AvatarSettings";
import { AssistantAvatar } from "./AssistantAvatar";
import { AssistantAvatarSelector } from "../avatar/AvatarLibrary";

export interface AssistantAvatarEditorProps {
  assistantName?: string;
  value?: UserAvatar;
  defaultAvatar?: string;
  legacyIcon?: string;
  disabled?: boolean;
  onChange(value: UserAvatar | undefined): void;
  onDefaultChange(value: string): void;
  onBusyChange?(busy: boolean): void;
}

export function AssistantAvatarEditor({ assistantName = "新助手", value, defaultAvatar, legacyIcon, disabled = false, onChange, onDefaultChange, onBusyChange }: AssistantAvatarEditorProps) {
  const active = useRef(false);
  const operation = useRef(0);
  const [draft, setDraft] = useState<Draft>();
  const [selecting, setSelecting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const busy = loading || saving;
  const blocked = disabled || busy || !!draft || selecting;
  useEffect(() => { active.current = true; return () => { active.current = false; operation.current++; }; }, []);
  useEffect(() => () => { if (draft) URL.revokeObjectURL(draft.url); }, [draft]);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);

  async function open(original: Blob, crop = centeredCrop) {
    const current = ++operation.current;
    setLoading(true); setError(undefined);
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(original.type) || original.size > 20 * 1024 * 1024)
        throw new Error("请选择 20 MB 以内的 PNG、JPEG 或 WebP 图片。");
      const image = await decodeAvatar(original);
      if (active.current && current === operation.current)
        setDraft({ original, image, url: URL.createObjectURL(original), crop: { ...crop } });
    } catch (error) {
      if (active.current && current === operation.current) setError(error instanceof Error ? error.message : "无法读取这张图片。");
    } finally { if (active.current && current === operation.current) setLoading(false); }
  }

  async function apply(crop: AvatarCrop) {
    if (!draft || saving || disabled) return;
    const current = ++operation.current;
    setSaving(true); setError(undefined);
    try {
      const thumbnail = await renderAvatar(draft.image, crop);
      if (active.current && current === operation.current) {
        onChange({ original: draft.original, thumbnail, crop, ...(value?.source ? { source: value.source } : {}) });
        setDraft(undefined);
      }
    } catch {
      if (active.current && current === operation.current) setError("裁切失败，原头像已保留，请重新选择。");
    } finally { if (active.current && current === operation.current) setSaving(false); }
  }

  return <section className="assistant-avatar-editor" aria-label="助手头像">
    <div className="assistant-avatar-editor-profile">
      <AssistantAvatar avatar={value} defaultAvatar={defaultAvatar} legacyIcon={legacyIcon} className="assistant-avatar-editor-preview" />
      <div className="avatar-buttons">
        <button type="button" className="settings-button" disabled={blocked} onClick={() => setSelecting(true)}><ImagePlus size={15} />选择头像</button>
        {value && <><button type="button" className="settings-button" disabled={blocked} onClick={() => void open(value.original, value.crop)}><Crop size={15} />重新裁切</button>
          <button type="button" className="settings-button" disabled={blocked} onClick={() => { setError(undefined); onChange(undefined); }}>移除图片</button></>}
      </div>
    </div>
    <p className="assistant-avatar-editor-note">PNG、JPEG 或 WebP · 最大 20 MB · 图片仅在本机保存</p>
    {error && <p className="avatar-error" role="alert">{error}</p>}
    {draft && <AvatarCropDialog draft={draft} saving={saving || disabled} error={error} onCancel={() => { operation.current++; setError(undefined); setDraft(undefined); }} onSave={apply} />}
    {selecting && <AssistantAvatarSelector assistantName={assistantName} value={value} defaultAvatar={defaultAvatar}
      onBusyChange={onBusyChange} onClose={() => setSelecting(false)} onApply={(next, builtin) => {
        onChange(next); if (builtin) onDefaultChange(builtin); setSelecting(false);
      }} />}
  </section>;
}
