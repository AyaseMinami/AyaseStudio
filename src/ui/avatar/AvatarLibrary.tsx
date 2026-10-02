import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { SettingsHelp } from "../settings/SettingsHelp";
import { avatarLibrary, type AvatarLibraryEntry, type AvatarUsage } from "../../avatar/library";
import { brandAvatars, materializeBrandAvatar } from "../../avatar/brandCatalog";
import type { BrandId } from "../../avatar/brandIds";
import { centeredCrop, decodeAvatar, renderAvatar } from "../../avatar/image";
import type { UserAvatar } from "../../avatar/repository";
import type { UserAvatarState } from "../../avatar/useUserAvatar";
import { AssistantAvatar } from "../chat/AssistantAvatar";
import { BrandAvatar } from "./BrandAvatar";
import { AvatarCropContent, AvatarSettings, type Draft } from "../settings/AvatarSettings";
import "./AvatarLibrary.css";

export function AvatarModal({ title, children, busy = false, onClose }: { title: string; children: ReactNode; busy?: boolean; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = dialog.current!; node.showModal();
    return () => { node.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="avatar-crop-dialog avatar-library-dialog" aria-label={title}
    onKeyDown={(event) => { event.stopPropagation(); }} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="avatar-library-modal-heading"><h2>{title}</h2><button type="button" className="settings-button" aria-label="关闭头像弹窗" disabled={busy} onClick={onClose}><X size={18} /></button></div>{children}
  </dialog>;
}

type View = { type: "crop"; draft: Draft; entry?: AvatarLibraryEntry } | { type: "delete"; entries: AvatarLibraryEntry[] };
type Choice = { type: "library"; id: string } | { type: "builtin"; id: BrandId } | { type: "automatic" };

export function AvatarLibraryPanel({ avatar, inline = false, value, defaultAvatar, legacyIcon, assistantName, assistantId, automaticChoice, onApply, onBuiltinApply, onClose, onBusyChange }: {
  avatar?: UserAvatarState; inline?: boolean; value?: UserAvatar; defaultAvatar?: string; legacyIcon?: string; assistantName?: string; assistantId?: string;
  automaticChoice?: { label: string; preview: ReactNode; isCurrent: boolean };
  onApply?(avatar: UserAvatar | undefined, defaultAvatar?: string): void; onBuiltinApply?(id: BrandId): void; onClose?(): void; onBusyChange?(busy: boolean): void;
}) {
  const [entries, setEntries] = useState<AvatarLibraryEntry[]>([]);
  const [usages, setUsages] = useState<Record<string, AvatarUsage[]>>({});
  const [choice, setChoice] = useState<Choice>();
  const [view, setView] = useState<View>();
  const [managing, setManaging] = useState(false);
  const [marked, setMarked] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const picker = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<AvatarLibraryEntry | undefined>(undefined);
  const active = useRef(false);
  const lock = useRef(false);
  const pendingRefresh = useRef(false);
  const fileGeneration = useRef(0);
  const previousValue = useRef(avatar?.value);
  const surface = useRef<HTMLElement>(null);
  const returnTarget = useRef<HTMLButtonElement | null>(null);
  const blocked = busy || !!avatar?.busy;
  const markedEntries = entries.filter((entry) => marked.includes(entry.id));
  const singleMarked = markedEntries.length === 1 ? markedEntries[0] : undefined;
  async function refresh() {
    const next = await avatarLibrary.list();
    const uses = await Promise.all(next.map(async (entry) => [entry.id, await avatarLibrary.usages(entry.id)] as const));
    if (active.current) { setEntries(next); setUsages(Object.fromEntries(uses)); }
  }
  useEffect(() => { active.current = true; void run(refresh); return () => { active.current = false; fileGeneration.current++; onBusyChange?.(false); }; }, []);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => { if (previousValue.current !== avatar?.value) { previousValue.current = avatar?.value; if (lock.current) pendingRefresh.current = true; else void run(refresh); } }, [avatar?.value]);
  useEffect(() => { if (!view && !busy && returnTarget.current) { const target = !inline && returnTarget.current.isConnected ? returnTarget.current : surface.current?.querySelector<HTMLButtonElement>('[data-import-avatar]'); target?.focus(); } }, [view, inline, busy]);
  const draft = view?.type === "crop" ? view.draft : undefined;
  useEffect(() => () => { if (draft) URL.revokeObjectURL(draft.url); }, [draft]);
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(undefined);
    try { await action(); }
    catch (error) { if (active.current) setError(error instanceof Error ? error.message : "操作失败，请重试。"); }
    finally {
      try {
        while (pendingRefresh.current && active.current) { pendingRefresh.current = false; await refresh(); }
      } catch { if (active.current) setError("头像库刷新失败，请点击刷新头像库重试。"); }
      finally { lock.current = false; if (active.current) setBusy(false); }
    }
  }
  async function reloadAfterSave() {
    try { await refresh(); }
    catch { throw new Error("更改已保存，但头像库刷新失败，请点击刷新头像库重试。"); }
  }
  async function openFile(file: File) {
    const generation = ++fileGeneration.current;
    const entry = replaceTarget.current; replaceTarget.current = undefined;
    if (!entry) returnTarget.current = surface.current?.querySelector<HTMLButtonElement>('[data-import-avatar]') ?? null;
    await run(async () => {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 20 * 1024 * 1024)
        throw new Error("请选择 20 MB 以内的 PNG、JPEG 或 WebP 图片。");
      const image = await decodeAvatar(file);
      if (active.current && generation === fileGeneration.current) {
        setName(entry?.name ?? (file.name.replace(/\.[^.]+$/, "").trim().slice(0, 100) || "头像"));
        setView({ type: "crop", entry, draft: { original: file, image, url: URL.createObjectURL(file), crop: { ...centeredCrop } } });
      }
    });
  }
  function cancelView() { if (!blocked) { setView(undefined); setError(undefined); } }
  async function apply() {
    if (!choice) return;
    await run(async () => {
      if (choice.type === "automatic") { onApply?.(undefined, undefined); return; }
      if (choice.type === "builtin" && onBuiltinApply) { onBuiltinApply(choice.id); return; }
      const selected = choice.type === "builtin" ? await materializeBrandAvatar(choice.id) : await avatarLibrary.select(choice.id);
      if (!active.current) return;
      if (onApply) onApply(selected);
      else if (avatar && await avatar.save(selected)) await reloadAfterSave();
    });
  }
  const viewContent = view?.type === "crop" ? <AvatarCropContent draft={view.draft} saving={blocked} error={error}
    saveLabel={view.entry ? "保存替换" : "保存到头像库"} onCancel={cancelView} onSave={async (crop) => {
      await run(async () => {
        const thumbnail = await renderAvatar(view.draft.image, crop);
        const next = { original: view.draft.original, thumbnail, crop };
        const saved = view.entry ? await avatarLibrary.replace(view.entry.id, next) : await avatarLibrary.import(name.trim(), next);
        if (active.current) {
          setEntries((current) => view.entry ? current.map((entry) => entry.id === saved.id ? saved : entry) : [...current, saved]);
          if (!inline && !view.entry) setChoice({ type: "library", id: saved.id });
          setView(undefined);
        }
        await reloadAfterSave();
      });
    }}>
    {view.entry && <p className="muted-text">替换“{view.entry.name}”。正在使用它的用户和助手保留原头像；重新选择后才使用新图片。</p>}
  </AvatarCropContent> : view?.type === "delete" ? <div className="avatar-delete-confirm">
    <p>从头像库删除选中的 {view.entries.length} 张图片？</p>
    <p>已使用此图片的头像不受影响，仍可重新裁切。</p>
    {error && <p role="alert" className="avatar-error">{error}</p>}
    <footer><button type="button" className="settings-button" disabled={blocked} onClick={cancelView}>取消</button><button type="button" className="settings-button confirm-danger" disabled={blocked} onClick={() => void run(async () => {
      const ids = view.entries.map((entry) => entry.id);
      await avatarLibrary.removeMany(ids);
      if (active.current) {
        if (choice?.type === "library" && ids.includes(choice.id)) setChoice(undefined);
        setMarked([]); setEntries((current) => current.filter((entry) => !ids.includes(entry.id))); setView(undefined);
      }
      await reloadAfterSave();
    })}>确认删除</button></footer>
  </div> : undefined;

  function startImport() { replaceTarget.current = undefined; picker.current?.click(); }
  return <section ref={surface} className={inline ? "avatar-library-content" : "settings-page avatar-page"} aria-label={avatar && !inline ? "用户头像" : "头像库"} onKeyDown={(event) => { if (inline && view && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelView(); } }}>
    <input ref={picker} hidden type="file" accept="image/png,image/jpeg,image/webp" aria-label="导入头像图片" disabled={blocked} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file && !blocked) void openFile(file); }} />
    {inline && view ? viewContent : <div className={inline ? undefined : "avatar-card"}>
      {!inline && avatar && <AvatarSettings avatar={avatar} importBusy={busy || managing} />}
      {inline && !automaticChoice && <div className="avatar-selector-current"><AssistantAvatar avatar={value} defaultAvatar={defaultAvatar} legacyIcon={legacyIcon} assistantName={assistantName} assistantId={assistantId} /><div><strong>{assistantName?.trim() || "新助手"}</strong><span>当前头像 · 选择后点击使用</span></div></div>}
      <div className={`avatar-card-heading${!inline && avatar ? " avatar-library-subheading" : ""}`}><h3 id={inline ? undefined : "avatar-library-heading"} tabIndex={-1}>{inline ? "我的头像" : "头像库"}</h3><div className="avatar-library-heading-actions">{inline && <SettingsHelp label="导入头像">PNG、JPEG 或 WebP，最大 20 MB，支持正方形裁切。导入只保存到本机头像库，不会自动应用。</SettingsHelp>}{<button data-import-avatar type="button" className={`settings-button${inline ? "" : " settings-button-primary"}`} disabled={blocked || managing} onClick={startImport}>导入图片</button>}{!inline && <button type="button" className="settings-button" aria-pressed={managing} disabled={blocked} onClick={(event) => { returnTarget.current = event.currentTarget; setManaging(!managing); setMarked([]); }}>{managing ? "完成管理" : "管理"}</button>}</div></div>
      {!inline && <p className="avatar-library-note">{managing ? `已选择 ${markedEntries.length} 张，点击头像可多选。` : "选择图片后，点击用作用户头像。"}</p>}
      {inline && <div className="assistant-avatar-defaults avatar-library-builtins" aria-label={automaticChoice?.label ?? "自动助手头像"}><button type="button" className="assistant-avatar-default-choice" disabled={blocked} aria-label={`选择${automaticChoice?.label ?? "自动头像"}`} aria-pressed={choice?.type === "automatic"} onClick={() => setChoice({ type: "automatic" })}>{automaticChoice?.preview ?? <AssistantAvatar assistantName={assistantName} assistantId={assistantId} />}{automaticChoice?.label ?? "自动头像"}{(automaticChoice ? automaticChoice.isCurrent : !value && !defaultAvatar && !legacyIcon) && <small>当前草稿</small>}</button></div>}
      {!inline && <><p className="avatar-library-note">PNG、JPEG 或 WebP · 最大 20 MB · 支持正方形裁切</p>
      <h4 className="avatar-library-section-heading">我的头像</h4></>}
      <div className="avatar-library-grid">{entries.map((entry) => {
        const selected = managing ? marked.includes(entry.id) : choice?.type === "library" && choice.id === entry.id;
        const usage = usages[entry.id]?.length ? `使用中 · ${usages[entry.id].map((item) => item.name).join("、")}` : "";
        const currentDraft = inline && value?.source?.resourceId === entry.id ? `当前草稿${value.source.version !== entry.version ? " · 原图片" : ""}` : "";
        const description = [entry.name, usage, currentDraft].filter(Boolean).join(" · ");
        return <button key={entry.id} type="button" className="avatar-library-choice" disabled={blocked}
          role={managing ? "checkbox" : undefined} aria-checked={managing ? selected : undefined} aria-pressed={managing ? undefined : selected}
          aria-label={`${managing ? "勾选" : "选择"} ${entry.name}`} title={description} onClick={() => {
            if (managing) setMarked((current) => current.includes(entry.id) ? current.filter((id) => id !== entry.id) : [...current, entry.id]);
            else setChoice({ type: "library", id: entry.id });
          }}>
          <AssistantAvatar avatar={entry.avatar} />
          {(selected || managing) && <span className="avatar-library-check" aria-hidden="true">{selected && <Check size={12} />}</span>}
          {(usage || currentDraft) && <span className="avatar-library-in-use" role="img" aria-label={usage || currentDraft} />}
        </button>;
      })}</div>
      {!entries.length && !busy && <p className="avatar-library-note">还没有头像，导入一张图片开始。</p>}
      {(error || avatar?.error) && <div className="avatar-library-note"><p role="alert" className="avatar-error">{error || avatar?.error}</p><button type="button" className="settings-button" disabled={blocked} onClick={() => void run(refresh)}>刷新头像库</button></div>}
      <h4 className="avatar-library-section-heading">内置头像</h4>
      <div className="avatar-library-grid" aria-label="内置头像">{brandAvatars.map((brand) => {
        const selected = choice?.type === "builtin" && choice.id === brand.id;
        return <button key={brand.id} type="button" className="avatar-library-choice" disabled={blocked || managing}
          aria-label={`选择 ${brand.label}`} title={brand.label} aria-pressed={selected}
          onClick={() => setChoice({ type: "builtin", id: brand.id })}>
          <BrandAvatar id={brand.id} />
          {selected && <span className="avatar-library-check" aria-hidden="true"><Check size={12} /></span>}
        </button>;
      })}</div>
      {managing ? <footer className="avatar-library-actions">
        <button type="button" className="settings-button" disabled={blocked || !entries.length} onClick={() => setMarked(markedEntries.length === entries.length ? [] : entries.map((entry) => entry.id))}>{entries.length > 0 && markedEntries.length === entries.length ? "取消全选" : "全选"}</button>
        <button type="button" className="settings-button" disabled={blocked || !singleMarked} onClick={() => { replaceTarget.current = singleMarked; picker.current?.click(); }}>替换图片</button>
        <button type="button" className="settings-button" disabled={blocked || !markedEntries.length} onClick={() => setView({ type: "delete", entries: markedEntries })}>删除所选{markedEntries.length ? `（${markedEntries.length}）` : ""}</button>
      </footer> : <footer className="avatar-library-actions">{!inline && <button type="button" className="settings-button" disabled={blocked || !choice} onClick={() => setChoice(undefined)}>清除选择</button>}
        {inline && <button type="button" className="settings-button" disabled={blocked} onClick={onClose}>取消</button>}
        <button type="button" className="settings-button settings-button-primary" disabled={blocked || !choice} onClick={() => void apply()}>{inline ? "使用此头像" : "用作用户头像"}</button>
      </footer>}
    </div>}
    {!inline && avatar && <p className="avatar-local-note">图片与裁切结果只保存在本机，不会上传或随消息发送。恢复默认不会删除头像库图片。</p>}
    {!inline && view && <AvatarModal title={view.type === "crop" ? view.entry ? "替换头像" : "导入头像" : "删除头像"} busy={blocked} onClose={cancelView}>{viewContent}</AvatarModal>}
  </section>;
}

export function AssistantAvatarSelector({ assistantName, assistantId, value, defaultAvatar, legacyIcon, onApply, onClose, onBusyChange }: {
  assistantName: string; assistantId?: string; value?: UserAvatar; defaultAvatar?: string; legacyIcon?: string; onApply(avatar: UserAvatar | undefined, defaultAvatar?: string): void; onClose(): void; onBusyChange?(busy: boolean): void;
}) {
  const [busy, setBusy] = useState(false);
  return <AvatarModal title={`为 ${assistantName.trim() || "新助手"} 选择头像`} busy={busy} onClose={onClose}>
    <AvatarLibraryPanel inline assistantName={assistantName} assistantId={assistantId} value={value} defaultAvatar={defaultAvatar} legacyIcon={legacyIcon} onApply={onApply} onClose={onClose} onBusyChange={(next) => { setBusy(next); onBusyChange?.(next); }} />
  </AvatarModal>;
}
