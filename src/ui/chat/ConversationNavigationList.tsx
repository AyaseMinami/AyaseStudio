import { memo, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from "react";
import { GripVertical, MessageSquare, Pencil, Trash2 } from "lucide-react";
import type { Conversation } from "../../chat/workspace";
import { isContextMenuKey } from "../ActionMenu";
import type { useNavigationListDrag } from "./useNavigationListDrag";

export type ConversationListActions = {
  openContextMenu(id: string, event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>): void;
  beginDrag(event: PointerEvent<HTMLElement>, item: Conversation): void;
  select(item: Conversation): void;
  edit(id: string): void;
  delete(id: string): void;
  cancelDelete(): void;
  clearPendingDelete(): void;
};

/** Private mounted list: visibility belongs to the surrounding pane, not its rows. */
export const ConversationNavigationList = memo(function ConversationNavigationList({
  conversations, selectedId, generatingIds, busy, dialogOpen, pendingDelete, pendingDeleteRef, drag, actions, management, selection, onSelect, mutationsDisabled,
}: {
  conversations: readonly Conversation[];
  selectedId?: string;
  generatingIds: ReadonlySet<string>;
  busy: boolean;
  dialogOpen: boolean;
  pendingDelete?: string;
  pendingDeleteRef: RefObject<HTMLLIElement | null>;
  drag: ReturnType<typeof useNavigationListDrag>["drag"];
  actions: ConversationListActions;
  management?: boolean;
  selection?: ReadonlySet<string>;
  onSelect?(id: string, checked: boolean): void;
  mutationsDisabled?: boolean;
}) {
  return <ul className="chat-navigation-list">{conversations.map((item) => <li key={item.id} className="chat-navigation-item conversation-leaf" data-conversation-id={item.id}
    data-navigation-sort-kind="conversation" data-navigation-sort-id={item.id}
    data-dragging={drag?.item.kind === "conversation" && drag.item.id === item.id || undefined}
    data-drop-placement={drag?.item.kind === "conversation" && drag.drop?.id === item.id ? drag.drop.placement : undefined}
    data-navigation-sort-scope={item.assistantId}
    onContextMenu={(event) => actions.openContextMenu(item.id, event)}
    onKeyDown={(event) => { if (isContextMenuKey(event)) actions.openContextMenu(item.id, event); }}
    ref={pendingDelete === item.id ? pendingDeleteRef : undefined}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) actions.clearPendingDelete(); }}>
    {management ? <label className="batch-row-select" data-selected={selection?.has(item.id) || undefined}><input type="checkbox" className="ui-checkbox" aria-label={`选择对话 ${item.title}`} checked={selection?.has(item.id) ?? false}
      disabled={busy} onChange={event => onSelect?.(item.id, event.target.checked)} /><span className="batch-row-title" title={item.title}>{item.title}</span>
      {generatingIds.has(item.id) && <small className="batch-row-meta">生成中</small>}</label> : <>
    <button type="button" className="navigation-drag-handle" disabled={busy || dialogOpen || mutationsDisabled} data-busy-only={busy && !dialogOpen} aria-label={`拖动对话 ${item.title}`}
      title="拖动排序；Shift+F10 或右键打开菜单上移／下移" onPointerDown={(event) => actions.beginDrag(event, item)}><GripVertical size={14} aria-hidden="true" /></button>
    <button className="chat-navigation-select conversation-leaf-select" type="button" aria-pressed={item.id === selectedId} disabled={busy} title={`${item.title}${generatingIds.has(item.id) ? " · 生成中" : ""}`}
      onPointerDown={(event) => actions.beginDrag(event, item)}
      onClick={() => actions.select(item)}><MessageSquare size={14} /><span>{item.title}{generatingIds.has(item.id) ? " · 生成中" : ""}</span></button>
    <div className="chat-navigation-actions conversation-row-actions">
      {pendingDelete === item.id
        ? <button className="conversation-delete-cancel" type="button" aria-label={`取消删除对话 ${item.title}`} onClick={actions.cancelDelete}>取消</button>
        : <button type="button" disabled={busy || mutationsDisabled} data-busy-only={busy} title="编辑对话" aria-label={`编辑对话 ${item.title}`} onClick={() => actions.edit(item.id)}><Pencil size={15} aria-hidden="true" /></button>}
      <button className="conversation-delete-button" data-pending={pendingDelete === item.id} type="button" disabled={busy || generatingIds.has(item.id) || mutationsDisabled} data-busy-only={busy && !generatingIds.has(item.id)}
        title={pendingDelete === item.id ? "永久删除对话及全部消息，无法撤销" : "删除"}
        aria-label={`${pendingDelete === item.id ? "确认删除对话" : "删除对话"} ${item.title}`} onClick={() => actions.delete(item.id)}>{pendingDelete === item.id ? "确认删除" : <Trash2 size={15} aria-hidden="true" />}</button>
    </div></>}
  </li>)}</ul>;
});
