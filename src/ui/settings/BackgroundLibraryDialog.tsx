import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check } from "lucide-react";
import { defaultAppearancePreferences, type BackgroundLibraryEdit, type BackgroundLibraryEntry, type BackgroundResource } from "../../appearance/appearance";
import { AppearanceChatPreview } from "./AppearanceChatPreview";
import { BackgroundDisplayControls } from "./BackgroundDisplayControls";
import { BackgroundFocusEditor } from "./BackgroundFocusDialog";
import "./BackgroundLibraryDialog.css";
import { BackgroundThumbnail } from "./BackgroundThumbnail";

export interface BackgroundLibraryDialogProps {
  entries: BackgroundLibraryEntry[];
  currentReference: string | null;
  busy: boolean;
  onPrepare(): Promise<BackgroundResource | null>;
  onSave(resource: BackgroundResource, replaceId?: string): Promise<BackgroundLibraryEntry>;
  onDiscard(reference: string): Promise<void>;
  onResolve(reference: string, options?: { thumbnail?: boolean; refresh?: boolean }): Promise<BackgroundResource>;
  onApply(id: string, edit?: BackgroundLibraryEdit): Promise<void>;
  onRemove(ids: string[]): Promise<void>;
  onClose(): void;
}

type View = { type: "replace"; entry: BackgroundLibraryEntry; resource: BackgroundResource } | { type: "import"; resource: BackgroundResource } | { type: "delete"; ids: string[] };

export function BackgroundLibraryDialog({ entries, currentReference, busy, onPrepare, onSave, onDiscard, onResolve, onApply, onRemove, onClose }: BackgroundLibraryDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef(true);
  const lock = useRef(false);
  const pendingReplacement = useRef<string | undefined>(undefined);
  const discard = useRef(onDiscard);
  discard.current = onDiscard;
  const returnTarget = useRef<HTMLElement | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const resolver = useRef(onResolve);
  resolver.current = onResolve;
  const resolved = useRef<Record<string, BackgroundResource>>({});
  const [resources, setResources] = useState<Record<string, BackgroundResource>>({});
  const [unavailable, setUnavailable] = useState<Record<string, boolean>>({});
  const [readAttempt, setReadAttempt] = useState(0);
  const [choice, setChoice] = useState<string | undefined>(() => entries.find((entry) => entry.reference === currentReference)?.id);
  const [managing, setManaging] = useState(false);
  const [marked, setMarked] = useState<string[]>([]);
  const [view, setView] = useState<View>();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const [edits, setEdits] = useState<Record<string, BackgroundLibraryEdit>>({});
  const [editingFocus, setEditingFocus] = useState(false);
  const returnToFocus = useRef(false);
  const blocked = busy || working;
  const selected = entries.find((entry) => entry.id === choice);
  const selectedEdit = selected ? edits[selected.reference] ?? {
    reference: selected.reference, focus: selected.focus, fit: selected.fit, mask: selected.mask, blur: selected.blur,
  } : undefined;
  const markedEntries = entries.filter((entry) => marked.includes(entry.id));
  const replacement = view?.type === "replace" ? view : undefined;
  const draft = view?.type === "replace" || view?.type === "import" ? view : undefined;
  const previewResource = draft?.resource ?? (selected ? resources[selected.reference] : undefined);
  const previewEntry = replacement ? { ...replacement.entry, focus: null } : draft ? undefined : selectedEdit;
  const selectedReference = selected?.reference;
  const hasUnavailable = entries.some((entry) => unavailable[entry.reference] || unavailable[`thumbnail:${entry.reference}`]);

  useEffect(() => {
    active.current = true;
    const previous = document.activeElement as HTMLElement | null;
    const node = dialog.current!;
    node.showModal();
    return () => { active.current = false; node.close(); previous?.focus(); if (pendingReplacement.current) void discard.current(pendingReplacement.current).catch(() => {}); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const references = selectedReference ? [selectedReference] : [];
    void Promise.all(references.filter((reference) => !resolved.current[reference]).map(async (reference) => {
      try {
        const resource = await resolver.current(reference, { refresh: readAttempt > 0 });
        if (!cancelled) {
          resolved.current[reference] = resource;
          setResources((current) => ({ ...current, [reference]: resource }));
          setUnavailable((current) => ({ ...current, [reference]: false }));
        }
      } catch (cause) {
        if (!cancelled) { setUnavailable((current) => ({ ...current, [reference]: true })); setError(cause instanceof Error ? cause.message : "背景图片读取失败，请重试。"); }
      }
    }));
    return () => { cancelled = true; };
  }, [selectedReference, readAttempt]);
  useEffect(() => { if (!view && !blocked && returnTarget.current) {
    const previous = returnTarget.current;
    const target = previous.isConnected ? previous : [...dialog.current!.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === previous.textContent);
    if (!target || target instanceof HTMLButtonElement && target.disabled) dialog.current?.querySelector<HTMLButtonElement>('[data-background-manage]')?.focus();
    else target.focus();
  } }, [view, blocked]);
  useEffect(() => { grid.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView?.({ block: "nearest" }); }, [choice, managing]);
  useEffect(() => {
    if (!editingFocus && returnToFocus.current) {
      dialog.current?.querySelector<HTMLButtonElement>('[data-edit-background-focus]')?.focus();
      returnToFocus.current = false;
    }
  }, [editingFocus]);

  function changeSelected(patch: Partial<BackgroundLibraryEdit>) {
    if (!selectedEdit || blocked) return;
    const next = { ...selectedEdit, ...patch };
    setEdits((current) => ({ ...current, [next.reference]: next }));
  }

  async function run(action: () => Promise<void>) {
    if (lock.current || busy) return;
    lock.current = true; setWorking(true); setError(undefined);
    try { await action(); }
    catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "操作失败，请重试。"); }
    finally { lock.current = false; if (active.current) setWorking(false); }
  }
  async function importImage(replace?: BackgroundLibraryEntry) {
    await run(async () => {
      const resource = await onPrepare();
      if (!resource) return;
      if (!active.current) { await onDiscard(resource.reference); return; }
      if (replace) { pendingReplacement.current = resource.reference; setView({ type: "replace", entry: replace, resource }); return; }
      try {
        const saved = await onSave(resource);
        if (!active.current) return;
        resolved.current[saved.reference] = resource;
        setResources((current) => ({ ...current, [saved.reference]: resource }));
        setChoice(saved.id);
      } catch (cause) {
        if (!active.current) { await onDiscard(resource.reference); throw cause; }
        pendingReplacement.current = resource.reference;
        setView({ type: "import", resource });
        throw cause;
      }
    });
  }
  function cancelView() {
    if (blocked) return;
    if (draft) void run(async () => { await onDiscard(draft.resource.reference); pendingReplacement.current = undefined; setView(undefined); });
    else { setView(undefined); setError(undefined); }
  }
  function escape() {
    if (blocked) return;
    if (editingFocus) setEditingFocus(false);
    else if (view) cancelView();
    else if (managing) { setManaging(false); setMarked([]); }
    else onClose();
  }
  return <dialog ref={dialog} className={`background-library-dialog${editingFocus ? " background-library-focus-view" : ""}${view?.type === "delete" ? " background-library-delete-view" : ""}`} aria-labelledby={editingFocus ? "background-focus-title" : "background-library-title"}
    style={editingFocus && selectedEdit ? { "--appearance-background-mask": String(selectedEdit.mask / 100), "--appearance-background-blur": `${selectedEdit.blur}px` } as CSSProperties : undefined}
    onCancel={(event) => { event.preventDefault(); escape(); }} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); escape(); } }}>
    {editingFocus && selectedEdit && previewResource ? <BackgroundFocusEditor key={selectedEdit.reference}
      url={previewResource.url} focus={selectedEdit.focus} fit={selectedEdit.fit} blur={selectedEdit.blur} confirmLabel="确认取景"
      onConfirm={(focus) => { changeSelected({ focus }); setEditingFocus(false); }} onCancel={() => setEditingFocus(false)} /> : <>
    <header className="background-library-header"><h2 id="background-library-title">{replacement ? "替换背景图片" : draft ? "导入背景图片" : view?.type === "delete" ? "删除背景图片" : "选择背景"}</h2>
      <button type="button" className="settings-button" disabled={blocked} onClick={() => view ? cancelView() : onClose()}>{view ? "返回图库" : "关闭"}</button></header>
    <div className="background-library-body">
      <section className="background-library-browser" aria-label="本地背景库">
        {view?.type === "delete" ? <div className="background-library-confirm"><p>从背景库删除选中的 {view.ids.length} 张图片？</p><p>当前已应用的背景不受影响，仍可调整取景和参数。</p></div> : draft ? <div className="background-library-confirm">{replacement ? <><p>替换“{replacement.entry.name}”。</p><p>当前已应用的背景保留原图；明确应用后才使用新图片。</p></> : <p>图片尚未保存到背景库，可以重试保存或取消导入。</p>}<img className="background-library-replacement" src={draft.resource.url} alt={replacement ? "替换图片预览" : "导入图片预览"} /></div> : <>
          <div className="background-library-toolbar"><button type="button" className="settings-button" disabled={blocked || managing} onClick={() => void importImage()}>导入图片</button><button data-background-manage type="button" className="settings-button" aria-pressed={managing} disabled={blocked} onClick={() => { setManaging(!managing); setMarked([]); }}>{managing ? "完成管理" : "管理"}</button>{hasUnavailable && <button type="button" className="settings-button" disabled={blocked} onClick={() => { setError(undefined); setReadAttempt((value) => value + 1); }}>重试读取图片</button>}</div>
          <p className="muted-text background-library-note">{managing ? `已选择 ${markedEntries.length} 张，点击图片可多选。` : "选择候选后点击应用。导入即保存到本机背景库，取消选择不会删除导入图片。"}</p>
          <div ref={grid} className="background-library-grid">{entries.map((entry) => {
            const chosen = managing ? marked.includes(entry.id) : choice === entry.id;
            const current = entry.reference === currentReference;
            return <button key={entry.id} type="button" className="background-library-choice" disabled={blocked} title={`${entry.name}${current ? " · 当前背景" : ""}`}
              aria-label={`${managing ? "勾选" : "选择"} ${entry.name}`} role={managing ? "checkbox" : undefined} aria-checked={managing ? chosen : undefined} aria-pressed={managing ? undefined : chosen}
              onClick={() => managing ? setMarked((ids) => ids.includes(entry.id) ? ids.filter((id) => id !== entry.id) : [...ids, entry.id]) : setChoice(entry.id)}>
              <BackgroundThumbnail reference={entry.reference} resolve={onResolve} attempt={readAttempt}
                onUnavailable={() => { setUnavailable((current) => ({ ...current, [`thumbnail:${entry.reference}`]: true })); setError("背景缩略图无法显示，请重试读取。"); }}
                onReady={() => setUnavailable((current) => current[`thumbnail:${entry.reference}`] ? { ...current, [`thumbnail:${entry.reference}`]: false } : current)} />
              {(chosen || managing) && <span className="background-library-check" aria-hidden="true">{chosen && <Check size={12} />}</span>}
              {current && <span className="background-library-current" role="img" aria-label="当前背景" />}
            </button>;
          })}</div>
          {!entries.length && <p className="muted-text">还没有背景图片，导入一张图片开始。</p>}
        </>}
      </section>
      <aside className="appearance-preview-column background-library-preview"><p className="appearance-preview-caption">{previewResource ? replacement ? "替换效果预览" : draft ? draft.resource.name ?? "导入效果预览" : selected?.name : "选择图片预览聊天效果"}</p>
        <AppearanceChatPreview url={previewResource?.url ?? null} focus={previewEntry?.focus ?? null} fit={previewEntry?.fit ?? defaultAppearancePreferences.backgroundFit} mask={previewEntry?.mask ?? defaultAppearancePreferences.backgroundMask} blur={previewEntry?.blur ?? defaultAppearancePreferences.backgroundBlur}
          onImageError={() => {
            if (draft || !selected) { setError("背景预览无法显示，请重新导入。"); return; }
            const reference = selected.reference;
            delete resolved.current[reference];
            setResources((current) => { const next = { ...current }; delete next[reference]; return next; });
            setUnavailable((current) => ({ ...current, [reference]: true }));
            setError("背景原图无法显示，请重试读取或替换图片。");
          }} />
        {!view && !managing && <section className="background-library-adjustments" aria-label="候选背景参数">
          <div className="background-library-adjustments-heading"><strong>背景效果</strong><button data-edit-background-focus type="button" className="settings-button" disabled={blocked || !selectedEdit || !previewResource} onClick={() => { returnToFocus.current = true; setEditingFocus(true); }}>调整取景中心</button></div>
          <BackgroundDisplayControls fit={selectedEdit?.fit ?? defaultAppearancePreferences.backgroundFit}
            mask={selectedEdit?.mask ?? defaultAppearancePreferences.backgroundMask} blur={selectedEdit?.blur ?? defaultAppearancePreferences.backgroundBlur}
            disabled={blocked || !selectedEdit || !previewResource} onFitChange={(fit) => changeSelected({ fit })}
            onMaskChange={(mask) => changeSelected({ mask })} onBlurChange={(blur) => changeSelected({ blur })} />
          <p className="muted-text background-library-note">调整仅用于预览，应用背景时保存当前图片的参数。</p>
        </section>}
      </aside>
    </div>
    {error && <p className="notice notice-warning background-library-error" role="alert">{error}</p>}
    <footer className="background-library-actions">
      {view?.type === "delete" ? <><button type="button" className="settings-button" disabled={blocked} onClick={cancelView}>取消</button><button type="button" className="settings-button settings-button-danger" disabled={blocked} onClick={() => void run(async () => { const ids = view.ids; await onRemove(ids); if (choice && ids.includes(choice)) setChoice(undefined); setMarked([]); setView(undefined); })}>确认删除</button></> : draft ? <><button type="button" className="settings-button" disabled={blocked} onClick={cancelView}>{replacement ? "取消替换" : "取消导入"}</button><button type="button" className="settings-button settings-button-primary" disabled={blocked} onClick={() => void run(async () => { const saved = await onSave(draft.resource, replacement?.entry.id); pendingReplacement.current = undefined; setResources((current) => ({ ...current, [saved.reference]: draft.resource })); if (!replacement) setChoice(saved.id); setView(undefined); })}>{replacement ? "保存替换" : "保存到背景库"}</button></> : managing ? <>
        <button type="button" className="settings-button" disabled={blocked || !entries.length} onClick={() => setMarked(markedEntries.length === entries.length ? [] : entries.map((entry) => entry.id))}>{entries.length > 0 && markedEntries.length === entries.length ? "取消全选" : "全选"}</button>
        <button type="button" className="settings-button" disabled={blocked || markedEntries.length !== 1} onClick={(event) => { returnTarget.current = event.currentTarget; void importImage(markedEntries[0]); }}>替换图片</button>
        <button type="button" className="settings-button settings-button-danger" disabled={blocked || !markedEntries.length} onClick={(event) => { returnTarget.current = event.currentTarget; setView({ type: "delete", ids: markedEntries.map((entry) => entry.id) }); }}>删除所选{markedEntries.length ? `（${markedEntries.length}）` : ""}</button>
      </> : <><button type="button" className="settings-button" disabled={blocked} onClick={onClose}>取消</button><button type="button" className="settings-button settings-button-primary" disabled={blocked || !selected || !previewResource} onClick={() => void run(async () => { if (!selected) return; await onApply(selected.id, selectedEdit); onClose(); })}>应用背景</button></>}
    </footer>
    </>}
  </dialog>;
}
