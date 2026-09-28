import { useEffect, useRef, useState } from "react";
import { Crop, ImagePlus } from "lucide-react";
import { assistantAvatarDefaults } from "../../avatar/assistantDefaults";
import { centeredCrop, decodeAvatar, renderAvatar } from "../../avatar/image";
import type { AvatarCrop, UserAvatar } from "../../avatar/repository";
import { AvatarCropDialog, type Draft } from "../settings/AvatarSettings";
import { AssistantAvatar } from "./AssistantAvatar";

export interface AssistantAvatarEditorProps {
  value?: UserAvatar;
  defaultAvatar?: string;
  legacyIcon?: string;
  disabled?: boolean;
  onChange(value: UserAvatar | undefined): void;
  onDefaultChange(value: string): void;
  onBusyChange?(busy: boolean): void;
}

export function AssistantAvatarEditor({ value, defaultAvatar, legacyIcon, disabled = false, onChange, onDefaultChange, onBusyChange }: AssistantAvatarEditorProps) {
  const picker = useRef<HTMLInputElement>(null);
  const active = useRef(false);
  const operation = useRef(0);
  const [draft, setDraft] = useState<Draft>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const busy = loading || saving;
  const blocked = disabled || busy || !!draft;
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
        onChange({ original: draft.original, thumbnail, crop });
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
        <button type="button" className="settings-button" disabled={blocked} onClick={() => picker.current?.click()}><ImagePlus size={15} />{value ? "更换图片" : "选择图片"}</button>
        {value && <><button type="button" className="settings-button" disabled={blocked} onClick={() => void open(value.original, value.crop)}><Crop size={15} />重新裁切</button>
          <button type="button" className="settings-button" disabled={blocked} onClick={() => { setError(undefined); onChange(undefined); }}>移除图片</button></>}
      </div>
    </div>
    <input ref={picker} hidden type="file" accept="image/png,image/jpeg,image/webp" aria-label="选择助手头像图片" disabled={blocked} onChange={(event) => {
      const file = event.target.files?.[0]; event.target.value = ""; if (file && !blocked) void open(file);
    }} />
    <p className="assistant-avatar-editor-note">PNG、JPEG 或 WebP · 最大 20 MB · 图片仅在本机保存</p>
    <div className="assistant-avatar-defaults" aria-label="内置助手头像">
      {assistantAvatarDefaults.map((avatar) => <button key={avatar.id} type="button" className="assistant-avatar-default-choice" disabled={blocked}
        aria-pressed={!value && defaultAvatar === avatar.id} onClick={() => { setError(undefined); onChange(undefined); onDefaultChange(avatar.id); }}>
        <AssistantAvatar defaultAvatar={avatar.id} />{avatar.label}
      </button>)}
    </div>
    {error && <p className="avatar-error" role="alert">{error}</p>}
    {draft && <AvatarCropDialog draft={draft} saving={saving || disabled} error={error} onCancel={() => { operation.current++; setError(undefined); setDraft(undefined); }} onSave={apply} />}
  </section>;
}
