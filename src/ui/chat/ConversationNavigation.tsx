import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Check, ChevronRight, GripVertical, ListChecks, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { AssistantAvatar } from "./AssistantAvatar";
import { AssistantAvatarEditor } from "./AssistantAvatarEditor";
import { useNavigationDocking } from "./useNavigationDocking";
import { useConversationNavigation, useConversationNavigationSnapshot, type ConversationNavigationController } from "./useConversationNavigation";
import { ActionMenu, isContextMenuKey, isEditableContextTarget, useActionMenu, type ActionMenuItem } from "../ActionMenu";
import { ConversationSettings } from "./ConversationSettings";
import type { useConversationWorkspace } from "../../chat/useConversationWorkspace";
import { defaultSessionConfig, validateSessionConfig } from "../../chat/sessionConfig";
import { validateRequestConfig } from "../../chat/requestMapping";
import { getActiveTarget, type ConnectionSettingsState } from "../../chat/settings";
import { ModelSelectField } from "./ModelSelectField";
import { DEFAULT_ASSISTANT_ID, type AssistantInput, type AssistantPreset, type WorkspaceCommand } from "../../chat/workspace";
import { SessionConfigPanel } from "./SessionConfigPanel";
import { ThinkingControl } from "./ThinkingControl";
import { WebSearchControl } from "./WebSearchControl";
import { getThinkingSettings, withThinkingSettings, switchThinkingProtocol } from "../../chat/thinking";
import { useNavigationListDrag } from "./useNavigationListDrag";
import { ConversationNavigationList, type ConversationListActions } from "./ConversationNavigationList";
import { BatchDeleteDialog, BatchManagementBar } from "../BatchManagement";
import { workspaceDeletionFingerprint } from "../../chat/workspace";
import "./AssistantConfig.css";

type Dialog =
  | { type: "conversation"; id: string }
  | { type: "assistant"; id: string; existing?: AssistantPreset; input: AssistantInput };

type Management = { kind: "assistants" } | { kind: "conversations"; assistantId: string };
type DeletePlan = { kind: "assistants" | "conversations"; ids: string[]; names: string[]; expected: string;
  conversationCount: number; assistantId: string; mode: "move" | "delete" };

export function ConversationNavigation({ workspace, settings, generatingIds, children, toolbar, navigation: controlledNavigation }: {
  workspace: ReturnType<typeof useConversationWorkspace>;
  settings: ConnectionSettingsState;
  generatingIds: ReadonlySet<string>;
  children: ReactNode;
  toolbar?: ReactNode;
  navigation?: ConversationNavigationController;
}) {
  const localNavigation = useConversationNavigation();
  const navigation = controlledNavigation ?? localNavigation;
  const { open: navigationOpen, conversationsOpen: conversationPanelOpen, assistantExpanded } = useConversationNavigationSnapshot(navigation);
  const { bodyRef, docked } = useNavigationDocking({ open: navigationOpen, conversationsOpen: conversationPanelOpen, assistantExpanded });
  const [dialog, setDialog] = useState<Dialog>();
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string>();
  const [sortAnnouncement, setSortAnnouncement] = useState("");
  const [management, setManagement] = useState<Management>();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deletePlan, setDeletePlan] = useState<DeletePlan>();
  const [batchNotice, setBatchNotice] = useState("");
  const menu = useActionMenu<{ kind: "assistant" | "conversation"; id: string }>();
  const pendingDeleteRef = useRef<HTMLLIElement>(null);
  const navigationRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const assistantManagementRef = useRef<HTMLButtonElement>(null), conversationManagementRef = useRef<HTMLButtonElement>(null);
  const commandPending = useRef(false);
  function closeNavigation() {
    toggleRef.current?.focus({ preventScroll: true });
    navigation.setOpen(false);
  }
  function closeConversations() {
    const selected = navigationRef.current?.querySelector<HTMLButtonElement>('.assistant-branch-toggle[aria-pressed="true"]');
    (selected && !selected.disabled ? selected : toggleRef.current)?.focus({ preventScroll: true });
    navigation.closeConversations();
  }
  const { snapshot, conversation, busy, execute } = workspace;
  async function saveOrder(command: WorkspaceCommand, label: string) {
    setSortAnnouncement("");
    if (await execute(command)) setSortAnnouncement(`${label}的顺序已保存。`);
  }
  const navigationDrag = useNavigationListDrag({
    disabled: busy || !!dialog || !!management || !!deletePlan || !navigationOpen,
    onStart: () => { menu.close(); setPendingDelete(undefined); setSortAnnouncement(""); },
    onMove: (item, targetId, placement) => {
      const label = item.kind === "assistant" ? snapshot?.assistants.find((entry) => entry.id === item.id)?.name
        : snapshot?.conversations.find((entry) => entry.id === item.id)?.title;
      void saveOrder({ type: item.kind === "assistant" ? "reorder-assistant" : "reorder-conversation", id: item.id, targetId, placement }, label ?? "列表项");
    },
  });
  function sortAttributes(kind: "assistant" | "conversation", id: string) {
    return {
      "data-navigation-sort-kind": kind,
      "data-navigation-sort-id": id,
      "data-dragging": navigationDrag.drag?.item.kind === kind && navigationDrag.drag.item.id === id || undefined,
      "data-drop-placement": navigationDrag.drag?.item.kind === kind && navigationDrag.drag.drop?.id === id ? navigationDrag.drag.drop.placement : undefined,
    };
  }
  useEffect(() => {
    setPendingDelete(undefined);
    menu.close();
  }, [snapshot?.selection.activeAssistantId, conversation?.id, navigationOpen, conversationPanelOpen, dialog, busy]);
  useEffect(() => {
    if (!menu.state) return;
    const target = menu.state.target;
    const exists = target.kind === "assistant" ? snapshot?.assistants.some((item) => item.id === target.id)
      : snapshot?.conversations.some((item) => item.id === target.id);
    if (!exists || !menu.state.opener.isConnected || menu.state.opener.closest('[inert], [hidden]')) {
      menu.close();
      toggleRef.current?.focus({ preventScroll: true });
    }
  }, [snapshot, menu.state, menu.close, assistantExpanded]);
  useEffect(() => {
    if (!pendingDelete) return;
    const cancel = () => setPendingDelete(undefined);
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !pendingDeleteRef.current?.contains(event.target)) cancel();
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("blur", cancel);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("blur", cancel);
    };
  }, [pendingDelete]);
  const selectedAssistant = snapshot?.assistants.find((item) => item.id === snapshot.selection.activeAssistantId);
  const conversations = useMemo(() => snapshot?.conversations.filter((item) => item.assistantId === selectedAssistant?.id) ?? [],
    [snapshot?.conversations, selectedAssistant?.id]);
  const conversationCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of snapshot?.conversations ?? []) counts.set(item.assistantId, (counts.get(item.assistantId) ?? 0) + 1);
    return counts;
  }, [snapshot?.conversations]);
  const manageAssistants = management?.kind === "assistants";
  const manageConversations = management?.kind === "conversations" && management.assistantId === selectedAssistant?.id;
  const manageableIds = manageAssistants ? snapshot?.assistants.filter(item => item.id !== DEFAULT_ASSISTANT_ID).map(item => item.id) ?? []
    : manageConversations ? conversations.map(item => item.id) : [];
  const batchSelected = manageableIds.filter(id => selectedIds.has(id));
  const selectedGenerating = snapshot?.conversations.some(item => generatingIds.has(item.id) &&
    (manageAssistants ? selectedIds.has(item.assistantId) : manageConversations && selectedIds.has(item.id))) ?? false;
  const deletionBlocked = deletePlan && snapshot ? workspaceDeletionFingerprint(snapshot, deletePlan.kind, deletePlan.ids) !== deletePlan.expected
    ? "删除范围已变化，请取消后重新选择并确认。"
    : snapshot.conversations.some(item => generatingIds.has(item.id) && (deletePlan.kind === "assistants" ? deletePlan.ids.includes(item.assistantId) : deletePlan.ids.includes(item.id)))
      ? "请先停止所选对话的生成并等待保存完成。" : undefined : undefined;
  useEffect(() => {
    if (!navigationOpen || (management?.kind === "conversations" && (management.assistantId !== selectedAssistant?.id || !conversationPanelOpen))
      || (management?.kind === "assistants" && !assistantExpanded)) {
      setManagement(undefined); setSelectedIds(new Set()); setDeletePlan(undefined);
    }
  }, [navigationOpen, conversationPanelOpen, assistantExpanded, selectedAssistant?.id, management]);
  useEffect(() => {
    if (!management) return;
    const available = new Set(management.kind === "assistants" ? snapshot?.assistants.filter(item => item.id !== DEFAULT_ASSISTANT_ID).map(item => item.id)
      : snapshot?.conversations.filter(item => item.assistantId === management.assistantId).map(item => item.id));
    setSelectedIds(current => [...current].some(id => !available.has(id)) ? new Set([...current].filter(id => available.has(id))) : current);
  }, [snapshot, management]);
  useEffect(() => { if (!batchNotice) return; const timer = window.setTimeout(() => setBatchNotice(""), 3500); return () => window.clearTimeout(timer); }, [batchNotice]);
  function beginManagement(next?: Management) {
    if (busy || dialog || deletePlan) return;
    navigationDrag.cancel(); menu.close(); setPendingDelete(undefined); setBatchNotice("");
    setManagement(next); setSelectedIds(new Set());
  }
  const toggleSelected = useCallback((id: string, checked: boolean) => {
    setSelectedIds(current => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next; });
  }, []);
  function prepareDelete(kind: DeletePlan["kind"], ids: string[]) {
    if (!snapshot || busy || !ids.length) return;
    const rows = kind === "assistants" ? snapshot.assistants.filter(item => ids.includes(item.id)) : snapshot.conversations.filter(item => ids.includes(item.id));
    if (rows.length !== ids.length || kind === "assistants" && ids.includes(DEFAULT_ASSISTANT_ID)) return;
    menu.close(); setPendingDelete(undefined);
    setDeletePlan({ kind, ids: [...ids], names: rows.map(item => "name" in item ? item.name : item.title),
      expected: workspaceDeletionFingerprint(snapshot, kind, ids),
      conversationCount: kind === "assistants" ? snapshot.conversations.filter(item => ids.includes(item.assistantId)).length : ids.length,
      assistantId: selectedAssistant?.id ?? DEFAULT_ASSISTANT_ID, mode: "move" });
  }
  async function deleteSelected(): Promise<boolean> {
    if (!deletePlan || busy || deletionBlocked || commandPending.current) return false;
    const plan = deletePlan;
    commandPending.current = true;
    try {
      const saved = await execute(plan.kind === "assistants" ? { type: "delete-assistants", ids: plan.ids, mode: plan.mode, expected: plan.expected }
        : { type: "delete-conversations", ids: plan.ids, assistantId: plan.assistantId, expected: plan.expected });
      if (saved) { setDeletePlan(undefined); setSelectedIds(new Set()); setBatchNotice(`已删除 ${plan.ids.length} 个${plan.kind === "assistants" ? "助手" : "对话"}`); }
      return saved;
    } finally { commandPending.current = false; }
  }
  const close = () => { if (!busy && !avatarBusy) setDialog(undefined); };
  async function perform(command: WorkspaceCommand) {
    if (commandPending.current) return;
    commandPending.current = true;
    try { if (await execute(command)) setDialog(undefined); }
    finally { commandPending.current = false; }
  }
  function editAssistant(existing?: AssistantPreset) {
    setDialog({ type: "assistant", id: existing?.id ?? crypto.randomUUID(), existing, input: existing ? structuredClone(existing) : {
      name: "", icon: "", defaultModelId: selectedAssistant?.defaultModelId ?? null, defaultConfig: defaultSessionConfig(),
    } });
  }
  const editorTarget = dialog?.type === "assistant" ? getActiveTarget({ ...settings, activeModelId: dialog.input.defaultModelId }) : undefined;
  const editorErrors = dialog?.type === "assistant"
    ? editorTarget ? validateRequestConfig(dialog.input.defaultConfig, editorTarget.connection.protocol, editorTarget.model.modelId)
      : validateSessionConfig(dialog.input.defaultConfig) : {};
  const backgroundRuns = snapshot?.conversations.filter((item) => generatingIds.has(item.id) && item.id !== conversation?.id) ?? [];
  const editingConversation = dialog?.type === "conversation" ? snapshot?.conversations.find((item) => item.id === dialog.id) : undefined;

  async function openAssistant(id: string) {
    if (id === selectedAssistant?.id) {
      navigation.expandAssistant();
    } else if (await execute({ type: "select", assistantId: id })) {
      navigation.expandAssistant();
    }
  }

  async function openConversation(command: WorkspaceCommand) {
    await execute(command);
  }

  function openContextMenu(target: { kind: "assistant" | "conversation"; id: string }, event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) {
    if (busy || dialog || management || deletePlan || isEditableContextTarget(event.target)) return;
    const opener = event.target instanceof HTMLElement && event.target.closest<HTMLButtonElement>(".navigation-drag-handle")
      || event.currentTarget.querySelector<HTMLButtonElement>(".chat-navigation-select");
    if (!opener) return;
    event.preventDefault(); event.stopPropagation();
    navigationDrag.cancel();
    setPendingDelete(undefined);
    menu.open(target, opener, "clientX" in event ? { x: event.clientX, y: event.clientY } : undefined);
  }
  const latestListActions: ConversationListActions = {
    openContextMenu: (id, event) => openContextMenu({ kind: "conversation", id }, event),
    beginDrag: (event, item) => navigationDrag.begin(event, { kind: "conversation", id: item.id, assistantId: item.assistantId }, item.title),
    select: (item) => {
      setPendingDelete(undefined);
      void openConversation({ type: "select", assistantId: item.assistantId, conversationId: item.id });
    },
    edit: (id) => setDialog({ type: "conversation", id }),
    delete: (id) => {
      if (pendingDelete !== id) setPendingDelete(id);
      else { setPendingDelete(undefined); void execute({ type: "delete-conversation", id }); }
    },
    cancelDelete: () => {
      pendingDeleteRef.current?.querySelector<HTMLButtonElement>(".conversation-delete-button")?.focus();
      setPendingDelete(undefined);
    },
    clearPendingDelete: () => setPendingDelete(undefined),
  };
  const committedListActions = useRef(latestListActions);
  useLayoutEffect(() => { committedListActions.current = latestListActions; });
  // Stable event entry points forward to closures from the latest committed render.
  const [listActions] = useState<ConversationListActions>(() => ({
    openContextMenu: (id, event) => committedListActions.current.openContextMenu(id, event),
    beginDrag: (event, item) => committedListActions.current.beginDrag(event, item),
    select: (item) => committedListActions.current.select(item),
    edit: (id) => committedListActions.current.edit(id),
    delete: (id) => committedListActions.current.delete(id),
    cancelDelete: () => committedListActions.current.cancelDelete(),
    clearPendingDelete: () => committedListActions.current.clearPendingDelete(),
  }));
  const menuTarget = menu.state?.target;
  const menuAssistant = menuTarget?.kind === "assistant" ? snapshot?.assistants.find((item) => item.id === menuTarget.id) : undefined;
  const menuConversation = menuTarget?.kind === "conversation" ? snapshot?.conversations.find((item) => item.id === menuTarget.id) : undefined;
  const menuItems: ActionMenuItem[] = [];
  if (menuAssistant && snapshot) {
    const index = snapshot.assistants.findIndex((item) => item.id === menuAssistant.id);
    const generating = snapshot.conversations.some((item) => item.assistantId === menuAssistant.id && generatingIds.has(item.id));
    const defaultAssistant = menuAssistant.id === DEFAULT_ASSISTANT_ID;
    menuItems.push(
      { id: "edit", label: "编辑", accessibleLabel: `编辑助手 ${menuAssistant.name}`, icon: <Pencil size={15} />, disabled: busy, onSelect: () => editAssistant(menuAssistant) },
      { id: "up", label: "上移", accessibleLabel: `上移助手 ${menuAssistant.name}`, icon: <ArrowUp size={15} />, disabled: busy || index === 0,
        onSelect: () => { void saveOrder({ type: "move-assistant", id: menuAssistant.id, direction: -1 }, menuAssistant.name); } },
      { id: "down", label: "下移", accessibleLabel: `下移助手 ${menuAssistant.name}`, icon: <ArrowDown size={15} />, disabled: busy || index === snapshot.assistants.length - 1,
        onSelect: () => { void saveOrder({ type: "move-assistant", id: menuAssistant.id, direction: 1 }, menuAssistant.name); } },
      { id: "delete", label: "删除", accessibleLabel: `删除助手 ${menuAssistant.name}`, icon: <Trash2 size={15} />, danger: true, separatorBefore: true,
        disabled: busy || defaultAssistant || generating, description: defaultAssistant ? "默认助手不可删除" : generating ? "请先停止该助手下对话的生成并等待保存完成" : undefined,
        onSelect: () => prepareDelete("assistants", [menuAssistant.id]) },
    );
  } else if (menuConversation) {
    const siblings = snapshot?.conversations.filter((item) => item.assistantId === menuConversation.assistantId) ?? [];
    const index = siblings.findIndex((item) => item.id === menuConversation.id);
    menuItems.push(
      { id: "edit", label: "编辑对话…", accessibleLabel: `编辑对话 ${menuConversation.title}`, icon: <Pencil size={15} />, disabled: busy,
        onSelect: () => setDialog({ type: "conversation", id: menuConversation.id }) },
      { id: "up", label: "上移", accessibleLabel: `上移对话 ${menuConversation.title}`, icon: <ArrowUp size={15} />, disabled: busy || index === 0,
        onSelect: () => { void saveOrder({ type: "move-conversation", id: menuConversation.id, direction: -1 }, menuConversation.title); } },
      { id: "down", label: "下移", accessibleLabel: `下移对话 ${menuConversation.title}`, icon: <ArrowDown size={15} />, disabled: busy || index === siblings.length - 1,
        onSelect: () => { void saveOrder({ type: "move-conversation", id: menuConversation.id, direction: 1 }, menuConversation.title); } },
      { id: "delete", label: "删除对话", accessibleLabel: `删除对话 ${menuConversation.title}`, icon: <Trash2 size={15} />, danger: true, separatorBefore: true,
        disabled: busy || generatingIds.has(menuConversation.id), description: generatingIds.has(menuConversation.id) ? "请先停止该对话的生成并等待保存完成" : undefined,
        onSelect: () => {
          setPendingDelete(menuConversation.id);
          const row = [...(navigationRef.current?.querySelectorAll<HTMLElement>("[data-conversation-id]") ?? [])]
            .find((item) => item.dataset.conversationId === menuConversation.id);
          row?.querySelector<HTMLButtonElement>(".conversation-delete-button")?.focus({ preventScroll: true });
        } },
    );
  }

  return <div ref={navigationRef} className="conversation-workspace" onClickCapture={navigationDrag.suppressClick} onKeyDown={(event) => {
    if (event.key !== "Escape" || event.defaultPrevented || dialog || deletePlan || !navigationOpen) return;
    event.preventDefault();
    event.stopPropagation();
    if (management) { beginManagement(); return; }
    if (pendingDelete) {
      pendingDeleteRef.current?.querySelector<HTMLButtonElement>(".conversation-delete-button")?.focus();
      setPendingDelete(undefined);
      return;
    }
    if (conversationPanelOpen) closeConversations();
    else closeNavigation();
  }}>
    <span className="sr-only" role="status" aria-live="polite">{sortAnnouncement || navigationDrag.announcement}</span>
    <div className="conversation-navigation-toolbar" data-tauri-drag-region>
      <button ref={toggleRef} className="workspace-sidebar-toggle" type="button" aria-label="助手与对话" aria-expanded={navigationOpen} aria-controls="assistant-navigation" title={navigationOpen ? "收起助手与对话侧栏" : "展开助手与对话侧栏"} onClick={() => navigationOpen ? closeNavigation() : navigation.setOpen(true)}>
        {navigationOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
      </button>
      <span className="workspace-breadcrumb" data-tauri-drag-region title={`${selectedAssistant?.name ?? ""} / ${conversation?.title ?? ""}`}>
        <span className="workspace-conversation-title" data-tauri-drag-region>{conversation?.title ?? "尚无对话"}</span>
      </span>
      {toolbar}
    </div>
    {workspace.loadError && <div role="alert" className="error-banner">{workspace.loadError}<button className="settings-button" type="button" disabled={busy} onClick={workspace.retry}>重试加载</button></div>}
    {workspace.operationError && <div role="alert" className="error-banner">{workspace.operationError}</div>}
    {Object.keys(workspace.view.configErrors).length > 0 && selectedAssistant && <div role="alert" className="error-banner">
      当前配置需要调整：{Object.values(workspace.view.configErrors)[0]}
      <button className="settings-button" type="button" disabled={busy} onClick={() => conversation ? setDialog({ type: "conversation", id: conversation.id }) : editAssistant(selectedAssistant)}>调整配置</button>
    </div>}
    {backgroundRuns.length > 0 && <div className="background-generation" role="status">
      {backgroundRuns.length} 个其他对话正在生成。
      {backgroundRuns.map((running) => <button key={running.id} className="settings-button" type="button" disabled={busy} onClick={() => void execute({ type: "select", assistantId: running.assistantId, conversationId: running.id })}>查看 {running.title}</button>)}
    </div>}
    <div ref={bodyRef} className="conversation-workspace-body" data-navigation-docked={docked} data-navigation-open={navigationOpen} data-conversations-open={navigationOpen && conversationPanelOpen} data-assistant-expanded={assistantExpanded}
      onClickCapture={(event) => {
        // Include narrow-column gutters, but exclude navigation and portal/modal interactions.
        if (event.button === 0 && event.detail > 0 && workspace.isReady
          && event.currentTarget.contains(event.target as Node)
          && !event.currentTarget.querySelector('[aria-modal="true"]')
          && !(event.target as Element).closest('.chat-navigation-pane, .conversation-cascade-pane, .conversation-expand-handle, [role="dialog"], [role="menu"]')) navigation.activateDraft();
      }}>
      <span className="navigation-space-probe" aria-hidden="true" />
      <aside id="assistant-navigation" className="chat-navigation-pane" aria-label="助手列表" data-open={navigationOpen} inert={!navigationOpen} aria-hidden={!navigationOpen}>
        <div className="assistant-pane-tools" data-managing={manageAssistants || undefined}>
        <div className="chat-navigation-heading assistant-pane-heading" inert={!assistantExpanded} aria-hidden={!assistantExpanded}><h2>助手</h2>
          <button ref={assistantManagementRef} type="button" className="batch-manage-trigger" aria-label={manageAssistants ? "完成助手管理" : "批量管理助手"} disabled={busy || !!dialog || !!deletePlan || !snapshot}
            data-active={manageAssistants || undefined} onClick={() => beginManagement(manageAssistants ? undefined : { kind: "assistants" })}>
            {manageAssistants ? <Check size={14} aria-hidden="true" /> : <ListChecks size={14} aria-hidden="true" />}<span>{manageAssistants ? "完成" : "管理"}</span></button></div>
        {!manageAssistants && <button type="button" className="settings-button assistant-create-button" aria-label="新建助手" title="新建助手" disabled={busy || !snapshot || !!management} data-busy-only={busy && !!snapshot} onClick={() => editAssistant()}><Plus size={15} /><span className="assistant-create-label" aria-hidden={!assistantExpanded}>新建助手</span></button>}
        {manageAssistants && <BatchManagementBar label="助手" total={manageableIds.length} selected={batchSelected.length} disabled={busy} deleteDisabled={selectedGenerating}
          onSelectAll={checked => setSelectedIds(checked ? new Set(manageableIds) : new Set())} onDelete={() => prepareDelete("assistants", batchSelected)} />}
        </div>
        <ul className="chat-navigation-list">{snapshot?.assistants.map((assistant) => {
          const selected = assistant.id === selectedAssistant?.id;
          const expanded = selected && conversationPanelOpen && assistantExpanded;
          const count = conversationCounts.get(assistant.id) ?? 0;
          return <li className="chat-navigation-item assistant-branch" key={assistant.id} {...sortAttributes("assistant", assistant.id)}
            onContextMenu={(event) => openContextMenu({ kind: "assistant", id: assistant.id }, event)}
            onKeyDown={(event) => { if (isContextMenuKey(event)) openContextMenu({ kind: "assistant", id: assistant.id }, event); }}>
          {manageAssistants ? <label className="batch-row-select" data-selected={selectedIds.has(assistant.id) || undefined} data-disabled={assistant.id === DEFAULT_ASSISTANT_ID || undefined}><input className="ui-checkbox" type="checkbox" aria-label={`选择助手 ${assistant.name}`} checked={selectedIds.has(assistant.id)}
            disabled={busy || assistant.id === DEFAULT_ASSISTANT_ID} onChange={event => toggleSelected(assistant.id, event.target.checked)} />
            <AssistantAvatar className="assistant-branch-icon" assistantName={assistant.name} assistantId={assistant.id} avatar={assistant.avatar} defaultAvatar={assistant.defaultAvatar} legacyIcon={assistant.icon} />
            <span className="assistant-branch-copy"><span className="assistant-branch-name" title={assistant.name}>{assistant.name}</span><span className="assistant-conversation-count">{assistant.id === DEFAULT_ASSISTANT_ID ? "默认助手不可删除" : `${count} 个对话`}</span></span></label> : <>
          <button type="button" className="navigation-drag-handle" inert={!assistantExpanded} aria-hidden={!assistantExpanded} tabIndex={assistantExpanded ? undefined : -1} disabled={busy || !!dialog || !!management} data-busy-only={busy && !dialog} aria-label={`拖动助手 ${assistant.name}`}
            title="拖动排序；Shift+F10 或右键打开菜单上移／下移" onPointerDown={(event) => navigationDrag.begin(event, { kind: "assistant", id: assistant.id }, assistant.name)}><GripVertical size={14} aria-hidden="true" /></button>
          <button type="button" className="chat-navigation-select assistant-branch-toggle" aria-label={assistant.name} title={assistant.name} aria-expanded={expanded} aria-controls={selected ? `assistant-conversations-${assistant.id}` : undefined} aria-pressed={selected} disabled={busy}
            onPointerDown={(event) => navigationDrag.begin(event, { kind: "assistant", id: assistant.id }, assistant.name)}
            onClick={() => void openAssistant(assistant.id)}>
            <AssistantAvatar className="assistant-branch-icon" assistantName={assistant.name} assistantId={assistant.id} avatar={assistant.avatar} defaultAvatar={assistant.defaultAvatar} legacyIcon={assistant.icon} />
            <span className="assistant-branch-copy" aria-hidden={!assistantExpanded}><span className="assistant-branch-name" title={assistant.name}>{assistant.name}</span><span className="assistant-conversation-count" aria-hidden="true">{count} 个对话</span></span>
          </button>
          <div className="assistant-actions" inert={!assistantExpanded} aria-hidden={!assistantExpanded}><button className="assistant-menu-trigger" type="button" disabled={busy || !!management} tabIndex={assistantExpanded ? undefined : -1}
            aria-label={`管理助手 ${assistant.name}`} title="管理助手" aria-haspopup="menu"
            aria-expanded={menuTarget?.kind === "assistant" && menuTarget.id === assistant.id}
            onClick={(event) => {
              if (menuTarget?.kind === "assistant" && menuTarget.id === assistant.id) menu.close(true);
              else { setPendingDelete(undefined); menu.open({ kind: "assistant", id: assistant.id }, event.currentTarget); }
            }} onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault(); setPendingDelete(undefined); menu.open({ kind: "assistant", id: assistant.id }, event.currentTarget);
              }
            }}><MoreHorizontal size={16} aria-hidden="true" /></button></div></>}
          </li>;
        })}</ul>
      </aside>
      {selectedAssistant && <aside id={`assistant-conversations-${selectedAssistant.id}`} className="conversation-cascade-pane" aria-label={`${selectedAssistant.name}的对话`} data-open={navigationOpen && conversationPanelOpen} inert={!navigationOpen || !conversationPanelOpen} aria-hidden={!navigationOpen || !conversationPanelOpen}>
            <div className="chat-navigation-heading">
              <h2>{selectedAssistant.name}的对话</h2>
              <button ref={conversationManagementRef} type="button" className="batch-manage-trigger" aria-label={manageConversations ? "完成对话管理" : "批量管理对话"} disabled={busy || !!dialog || !!deletePlan}
                data-active={manageConversations || undefined} onClick={() => beginManagement(manageConversations ? undefined : { kind: "conversations", assistantId: selectedAssistant.id })}>
                {manageConversations ? <Check size={14} aria-hidden="true" /> : <ListChecks size={14} aria-hidden="true" />}<span>{manageConversations ? "完成" : "管理"}</span></button>
              <button className="conversation-collapse-button" type="button" disabled={!!deletePlan} onClick={closeConversations} aria-label="收起对话栏" title="收起对话栏">
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M8 2 3 6l5 4Z" fill="currentColor" /></svg>
              </button>
            </div>
            {manageConversations ? <BatchManagementBar label="对话" total={manageableIds.length} selected={batchSelected.length} disabled={busy} deleteDisabled={selectedGenerating}
              onSelectAll={checked => setSelectedIds(checked ? new Set(manageableIds) : new Set())} onDelete={() => prepareDelete("conversations", batchSelected)} />
              : <button className="settings-button new-conversation-button" type="button" disabled={busy || !!management} data-busy-only={busy} onClick={() => void openConversation({ type: "create-conversation", id: crypto.randomUUID(), assistantId: selectedAssistant.id })}><Plus size={14} />新建对话</button>}
            {conversations.length === 0 && <p className="muted-text assistant-conversations-empty">还没有对话</p>}
            <ConversationNavigationList conversations={conversations} selectedId={conversation?.id} generatingIds={generatingIds}
              busy={busy} dialogOpen={!!dialog} pendingDelete={pendingDelete} pendingDeleteRef={pendingDeleteRef}
              management={manageConversations} selection={manageConversations ? selectedIds : undefined} onSelect={manageConversations ? toggleSelected : undefined} mutationsDisabled={!!management}
              drag={navigationDrag.drag} actions={listActions} />
      </aside>}
      {navigationOpen && !conversationPanelOpen && selectedAssistant && <button type="button" className="conversation-expand-handle"
        aria-label="展开对话列表" title="展开对话列表"
        aria-controls={`assistant-conversations-${selectedAssistant.id}`} aria-expanded={false} disabled={busy}
        onClick={() => {
          const selected = navigationRef.current?.querySelector<HTMLButtonElement>('.assistant-branch-toggle[aria-pressed="true"]');
          (selected && !selected.disabled ? selected : toggleRef.current)?.focus({ preventScroll: true });
          navigation.openConversations();
        }}><svg className="conversation-expand-handle-shape" viewBox="0 0 14 40" aria-hidden="true"><path d="M0.5 0.5 C5 0.5 13.5 4 13.5 10 L13.5 30 C13.5 36 5 39.5 0.5 39.5 Z" /></svg><ChevronRight className="conversation-expand-handle-arrow" size={12} aria-hidden="true" /></button>}
      <section className="active-chat-workspace">
        {snapshot && !conversation ? <div className="conversation-empty"><AssistantAvatar assistantName={selectedAssistant?.name} assistantId={selectedAssistant?.id} avatar={selectedAssistant?.avatar} defaultAvatar={selectedAssistant?.defaultAvatar} legacyIcon={selectedAssistant?.icon} /><h2>{selectedAssistant?.name}</h2><p>此助手还没有对话。新对话会复制助手当前的模型和生成配置。</p>
          <button className="settings-button" type="button" disabled={busy} onClick={() => selectedAssistant && void execute({ type: "create-conversation", id: crypto.randomUUID(), assistantId: selectedAssistant.id })}>创建第一个对话</button>
          <button className="settings-button" type="button" disabled={busy} onClick={() => editAssistant(selectedAssistant)}>编辑助手设置</button>
        </div> : <>
          {children}
        </>}
      </section>
    </div>
    {menu.state && (menuAssistant || menuConversation) && <ActionMenu state={menu.state}
      label={`${menuAssistant?.name ?? menuConversation?.title}的管理菜单`} items={menuItems}
      note={menuAssistant?.id === DEFAULT_ASSISTANT_ID ? "默认助手不可删除" : undefined} onClose={menu.close} />}
    {editingConversation && <ConversationSettings key={editingConversation.id} workspace={workspace} conversation={editingConversation} settings={settings} onClose={close} />}
    {dialog?.type === "assistant" && <SessionConfigPanel presentation="modal" disabled={busy} title={dialog.existing ? "编辑助手" : "新建助手"} description="作为新对话的默认设置，已有对话保持不变。"
      initialFocusId={!dialog.existing ? "assistant-name" : undefined}
      config={dialog.input.defaultConfig} errors={editorErrors} protocol={editorTarget?.connection.protocol} model={editorTarget?.model.modelId ?? ""}
      onChange={(config) => setDialog({ ...dialog, input: { ...dialog.input, defaultConfig: config } })}
      onReset={() => setDialog({ ...dialog, input: { ...dialog.input, defaultConfig: defaultSessionConfig() } })} onClose={close}
      footer={<><button className="settings-button" type="button" disabled={busy || avatarBusy} onClick={close}>取消</button><button className="settings-button settings-button-primary" type="button" disabled={busy || avatarBusy || !dialog.input.name.trim() || Object.keys(editorErrors).length > 0}
        onClick={() => void perform({ type: dialog.existing ? "edit-assistant" : "create-assistant", id: dialog.id, input: dialog.input })}>{dialog.existing ? "保存助手" : "创建助手"}</button></>}>
      <section className="session-config-section assistant-config-basics">
        <h3>基本信息</h3>
        <div className="assistant-config-identity">
        <div className="assistant-config-name">
        <label htmlFor="assistant-name">助手名称</label>
        <div className="assistant-identity-row">
        <input id="assistant-name" placeholder="例如：写作助手" required value={dialog.input.name} disabled={busy || dialog.existing?.id === DEFAULT_ASSISTANT_ID} maxLength={100}
          onChange={(event) => setDialog({ ...dialog, input: { ...dialog.input, name: event.target.value } })} />
        </div>
        </div>
        <AssistantAvatarEditor assistantName={dialog.input.name} assistantId={dialog.id} value={dialog.input.avatar} defaultAvatar={dialog.input.defaultAvatar} legacyIcon={dialog.input.icon} disabled={busy}
          onBusyChange={setAvatarBusy}
          onChange={(avatar) => setDialog((current) => current?.type === "assistant" ? { ...current, input: { ...current.input, avatar } } : current)}
          onDefaultChange={(defaultAvatar) => setDialog((current) => current?.type === "assistant" ? { ...current, input: { ...current.input, defaultAvatar, icon: "" } } : current)} />
        </div>
      </section>
      <section className="session-config-section assistant-config-model">
        <h3>模型与能力</h3>
        <label htmlFor="assistant-model">默认模型 / 连接</label><ModelSelectField id="assistant-model" label="默认模型 / 连接"
          settings={settings} selectedModelId={dialog.input.defaultModelId} disabled={busy} hint="仅修改配置草稿，点击创建或保存助手后生效。"
          onSelect={async value => {
            const defaultModelId = value || null;
            const next = getActiveTarget({ ...settings, activeModelId: defaultModelId });
            setDialog({ ...dialog, input: { ...dialog.input, defaultModelId,
              defaultConfig: next ? switchThinkingProtocol(dialog.input.defaultConfig, editorTarget?.connection.protocol, next.connection.protocol) : dialog.input.defaultConfig } });
            return true;
          }} />
        <div className="session-config-capabilities">
        <WebSearchControl config={dialog.input.defaultConfig} disabled={busy} customSelect
          onChange={(defaultConfig) => setDialog({ ...dialog, input: { ...dialog.input, defaultConfig } })} />
        {editorTarget && <ThinkingControl
          key={`${editorTarget.connection.protocol}-${editorTarget.model.modelId}-${getThinkingSettings(dialog.input.defaultConfig, editorTarget.connection.protocol)?.budget}`}
          protocol={editorTarget.connection.protocol} model={editorTarget.model.modelId} value={getThinkingSettings(dialog.input.defaultConfig, editorTarget.connection.protocol)}
          disabled={busy} hint=""
          onChange={(thinking) => setDialog({ ...dialog, input: { ...dialog.input,
            defaultConfig: withThinkingSettings(dialog.input.defaultConfig, editorTarget.connection.protocol, thinking) } })} />}
        </div>
        {editorErrors.thinking && <p className="session-config-error" role="alert">{editorErrors.thinking}</p>}
      </section>
    </SessionConfigPanel>}
    {deletePlan && <BatchDeleteDialog title={`删除 ${deletePlan.ids.length} 个${deletePlan.kind === "assistants" ? "助手" : "对话"}？`} names={deletePlan.names}
      assistantMode={deletePlan.kind === "assistants" && deletePlan.conversationCount > 0 ? deletePlan.mode : undefined}
      onAssistantModeChange={mode => setDeletePlan(current => current && { ...current, mode })}
      impact={deletePlan.kind === "conversations" ? "同时删除所选对话的全部消息。" : deletePlan.conversationCount === 0 ? "所选助手均无对话。"
        : deletePlan.mode === "move" ? `${deletePlan.conversationCount} 个对话将移至默认助手，消息和对话设置保留。` : `同时删除 ${deletePlan.conversationCount} 个对话及全部消息。`}
      confirmLabel={deletePlan.kind === "assistants" && deletePlan.mode === "delete" && deletePlan.conversationCount > 0 ? "删除助手及对话"
        : `删除 ${deletePlan.ids.length} 个${deletePlan.kind === "assistants" ? "助手" : "对话"}`}
      busy={busy} blockedReason={deletionBlocked} failureReason={workspace.operationError} onConfirm={deleteSelected} onCancel={() => setDeletePlan(undefined)}
      returnFocus={() => {
        const target = deletePlan.kind === "assistants" ? assistantManagementRef.current : conversationManagementRef.current;
        return target?.isConnected && !target.disabled && !target.closest('[inert], [hidden], [aria-hidden="true"]') ? target : toggleRef.current;
      }} />}
    {batchNotice && <div className="batch-result-notice" role="status">{batchNotice}</div>}
  </div>;
}
