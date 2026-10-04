import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { groupConfiguredModels } from "../../chat/modelGrouping";
import type { ConnectionProfile, ModelGroupCommand } from "../../chat/settings";
import { SelectField } from "../SelectField";
import { useConfirmation } from "../useConfirmation";
import "./ModelGroupManagement.css";

/** Selection and drafts belong only to the mounted connection. */
export function ModelGroupManagement({ connection, search, disabled, onCommand }: {
  connection: ConnectionProfile;
  search: string;
  disabled: boolean;
  onCommand(connectionId: string, command: ModelGroupCommand): boolean;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [targetGroupId, setTargetGroupId] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const { confirm, dialog } = useConfirmation();
  const current = useRef({ connection, disabled, onCommand });
  current.current = { connection, disabled, onCommand };
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const groups = connection.modelGroups ?? [];
  const query = search.trim().toLowerCase();
  const visibleGroups = useMemo(() => groupConfiguredModels(connection.models, connection.modelGroups)
    .map(group => ({ ...group, models: group.models.filter(model => !query
      || `${group.label} ${model.modelId} ${model.displayName ?? ""}`.toLowerCase().includes(query)) }))
    .filter(group => group.models.length || group.groupId && (!query || group.label.toLowerCase().includes(query))),
  [connection.models, connection.modelGroups, query]);
  const visibleModels = visibleGroups.flatMap(group => group.models);
  const selectedModels = connection.models.filter(model => selectedIds.has(model.id));
  const visibleSelected = visibleModels.filter(model => selectedIds.has(model.id)).length;
  const allVisibleSelected = visibleModels.length > 0 && visibleSelected === visibleModels.length;
  const allRef = useRef<HTMLInputElement>(null);
  const busy = disabled || confirming;
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = visibleSelected > 0 && !allVisibleSelected;
  }, [visibleSelected, allVisibleSelected]);
  useEffect(() => {
    const available = new Set(connection.models.map(model => model.id));
    setSelectedIds(previous => new Set([...previous].filter(id => available.has(id))));
  }, [connection.models]);
  useEffect(() => {
    if (targetGroupId && !groups.some(group => group.id === targetGroupId)) setTargetGroupId("");
    if (editingGroupId && !groups.some(group => group.id === editingGroupId)) {
      setEditingGroupId(null);
      setName("");
    }
  }, [groups, targetGroupId, editingGroupId]);

  function runCommand(command: ModelGroupCommand): boolean {
    if (!mounted.current || current.current.disabled) return false;
    setError(undefined);
    try {
      if (!current.current.onCommand(current.current.connection.id, command)) {
        setError("分组操作未完成，请重试。");
        return false;
      }
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "分组操作失败，请重试。");
      return false;
    }
  }

  function saveGroup(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) { setError("请输入分组名称。"); return; }
    if (groups.some(group => group.id !== editingGroupId && group.name.trim().toLowerCase() === trimmed.toLowerCase())) {
      setError("当前连接已存在同名分组。");
      return;
    }
    const command: ModelGroupCommand = editingGroupId
      ? { kind: "rename", id: editingGroupId, name: trimmed }
      : { kind: "create", id: crypto.randomUUID(), name: trimmed };
    if (runCommand(command)) { setName(""); setEditingGroupId(null); }
  }

  async function deleteGroup(group: { id: string; name: string }): Promise<void> {
    if (busy) return;
    setConfirming(true);
    const connectionId = connection.id;
    const accepted = await confirm({ title: `删除分组“${group.name}”`,
      message: "仅删除此分组，保留所有模型。组内模型将恢复自动分组。", confirmLabel: "删除分组并保留模型", danger: true });
    if (!mounted.current) return;
    setConfirming(false);
    if (!accepted) return;
    if (current.current.connection.id !== connectionId
      || !current.current.connection.modelGroups?.some(item => item.id === group.id && item.name === group.name)) {
      setError("分组已发生变化，请重新操作。");
      return;
    }
    runCommand({ kind: "delete", id: group.id });
  }

  function assignModels(): void {
    if (busy || !selectedModels.length) return;
    if (runCommand({ kind: "assign", modelIds: selectedModels.map(model => model.id), groupId: targetGroupId || null })) {
      setSelectedIds(new Set());
    }
  }

  return <div className="model-group-management">
    <div className="model-group-editor" aria-label="自定义分组">
      <p className="muted-text">自定义分组仅用于当前连接；未指定分组的模型继续自动归类。</p>
      <form className="model-group-name-form" onSubmit={saveGroup}>
        <label className="sr-only" htmlFor="model-group-name">{editingGroupId ? "分组新名称" : "新分组名称"}</label>
        <input id="model-group-name" className="compact-field" value={name} disabled={busy}
          placeholder={editingGroupId ? "输入分组新名称" : "输入新分组名称"} onChange={event => setName(event.target.value)} />
        <button type="submit" className="settings-button" disabled={busy}>
          {editingGroupId ? <Check size={15} /> : <Plus size={15} />}{editingGroupId ? "保存名称" : "创建分组"}
        </button>
        {editingGroupId && <button type="button" className="icon-button" aria-label="取消重命名分组"
          onClick={() => { setEditingGroupId(null); setName(""); setError(undefined); }}><X size={15} /></button>}
      </form>
      {groups.length > 0 && <ul className="model-custom-groups">{groups.map(group => <li key={group.id}>
        <span title={group.name}>{group.name}</span>
        <small>{connection.models.filter(model => model.groupId === group.id).length}</small>
        <button type="button" className="icon-button" aria-label={`重命名分组 ${group.name}`} title="重命名分组" disabled={busy}
          onClick={() => { setEditingGroupId(group.id); setName(group.name); setError(undefined); }}><Pencil size={14} /></button>
        <button type="button" className="icon-button danger-icon-button" aria-label={`删除分组 ${group.name}`} title="删除分组" disabled={busy}
          onClick={() => void deleteGroup(group)}><Trash2 size={14} /></button>
      </li>)}</ul>}
    </div>
    <div className="model-group-assignment" aria-label="分配模型分组">
      <label className="model-group-select-all"><input ref={allRef} type="checkbox" className="ui-checkbox"
        aria-label="全选当前搜索结果" checked={allVisibleSelected} disabled={busy || !visibleModels.length}
        onChange={() => {
          if (busy) return;
          setSelectedIds(previous => {
            const next = new Set(previous);
            for (const model of visibleModels) {
              if (allVisibleSelected) next.delete(model.id); else next.add(model.id);
            }
            return next;
          });
        }} />全选当前结果</label>
      <span className="model-group-selection-count">已选 {selectedModels.length} 个{selectedModels.length > visibleSelected ? `（含 ${selectedModels.length - visibleSelected} 个隐藏项）` : ""}</span>
      <SelectField label="目标分组" value={targetGroupId} disabled={busy} options={[
        { value: "", label: "自动分组" }, ...groups.map(group => ({ value: group.id, label: group.name })),
      ]} onChange={setTargetGroupId} />
      <button type="button" className="settings-button settings-button-primary" disabled={busy || !selectedModels.length}
        onClick={assignModels}>{targetGroupId ? "分配到分组" : "恢复自动分组"}</button>
      <button type="button" className="settings-button" disabled={busy || !selectedModels.length}
        onClick={() => setSelectedIds(new Set())}>清除选择</button>
    </div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {disabled && <p className="muted-text">加载或生成期间无法修改模型分组。</p>}
    <div className="model-list" aria-label="模型分组选择列表">
      {visibleGroups.map(group => <section key={group.key} className="model-group">
        <header><strong>{group.label}</strong><span>{group.models.length}</span></header>
        {group.models.map(model => <label key={model.id} className="model-row model-group-select-row">
          <input type="checkbox" className="ui-checkbox" aria-label={`选择模型 ${model.modelId}`} checked={selectedIds.has(model.id)} disabled={busy}
            onChange={() => {
              if (busy) return;
              setSelectedIds(previous => {
                const next = new Set(previous);
                if (next.has(model.id)) next.delete(model.id); else next.add(model.id);
                return next;
              });
            }} />
          <span className="model-row-copy"><strong>{model.displayName || model.modelId}</strong>
            {model.displayName && <small>{model.modelId}</small>}</span>
        </label>)}
        {!group.models.length && <p className="model-group-empty muted-text">此分组暂无模型</p>}
      </section>)}
      {!visibleGroups.length && <div className="pane-empty-state"><strong>{connection.models.length ? "没有匹配的模型" : "还没有模型"}</strong></div>}
    </div>
    {dialog}
  </div>;
}
