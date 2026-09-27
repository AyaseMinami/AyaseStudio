import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight, MessageSquare, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Trash2, UserRound } from "lucide-react";
import { AssistantActions } from "./AssistantActions";
import { ConversationSettings } from "./ConversationSettings";
import type { useConversationWorkspace } from "../../chat/useConversationWorkspace";
import { defaultSessionConfig, validateSessionConfig } from "../../chat/sessionConfig";
import { validateRequestConfig } from "../../chat/requestMapping";
import { getActiveTarget, type ConnectionSettingsState } from "../../chat/settings";
import { DEFAULT_ASSISTANT_ID, type AssistantInput, type AssistantPreset, type WorkspaceCommand } from "../../chat/workspace";
import { SessionConfigPanel } from "./SessionConfigPanel";
import { ThinkingControl } from "./ThinkingControl";
import { WebSearchControl } from "./WebSearchControl";
import { getThinkingSettings, withThinkingSettings, switchThinkingProtocol } from "../../chat/thinking";

function ManagementDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, button")?.focus();
    return () => previous?.focus();
  }, []);
  return <div className="management-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={ref} className="management-dialog" role="dialog" aria-modal="true" aria-label={title} onKeyDown={(event) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const fields = [...(ref.current?.querySelectorAll<HTMLElement>("input:not(:disabled), button:not(:disabled), select:not(:disabled)") ?? [])];
      const first = fields[0]; const last = fields[fields.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}><h2>{title}</h2>{children}</div>
  </div>;
}

type Dialog =
  | { type: "conversation"; id: string }
  | { type: "assistant"; existing?: AssistantPreset; input: AssistantInput }
  | { type: "delete-assistant"; id: string; name: string; count: number; permanent: boolean };

export function ConversationNavigation({ workspace, settings, generatingIds, children, toolbar }: {
  workspace: ReturnType<typeof useConversationWorkspace>;
  settings: ConnectionSettingsState;
  generatingIds: ReadonlySet<string>;
  children: ReactNode;
  toolbar?: ReactNode;
}) {
  const [navigationOpen, setNavigationOpen] = useState(() => window.innerWidth > 860);
  const [conversationPanelOpen, setConversationPanelOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>();
  const [pendingDelete, setPendingDelete] = useState<string>();
  const pendingDeleteRef = useRef<HTMLLIElement>(null);
  const navigationRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  function closeNavigation() {
    toggleRef.current?.focus({ preventScroll: true });
    setNavigationOpen(false);
  }
  function closeConversations() {
    const selected = navigationRef.current?.querySelector<HTMLButtonElement>('.assistant-branch-toggle[aria-pressed="true"]');
    (selected && !selected.disabled ? selected : toggleRef.current)?.focus({ preventScroll: true });
    setConversationPanelOpen(false);
  }
  const { snapshot, conversation, busy, execute } = workspace;
  useEffect(() => {
    setPendingDelete(undefined);
  }, [snapshot?.selection.activeAssistantId, conversation?.id, navigationOpen, conversationPanelOpen, dialog, busy]);
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
  const conversations = snapshot?.conversations.filter((item) => item.assistantId === selectedAssistant?.id) ?? [];
  const close = () => { if (!busy) setDialog(undefined); };
  async function perform(command: WorkspaceCommand) {
    if (await execute(command)) setDialog(undefined);
  }
  function editAssistant(existing?: AssistantPreset) {
    setDialog({ type: "assistant", existing, input: existing ? structuredClone(existing) : {
      name: "新助手", icon: "", defaultModelId: selectedAssistant?.defaultModelId ?? null, defaultConfig: defaultSessionConfig(),
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
      setConversationPanelOpen((current) => !current);
    } else if (await execute({ type: "select", assistantId: id })) {
      setConversationPanelOpen(true);
    }
  }

  async function openConversation(command: WorkspaceCommand) {
    await execute(command);
  }

  return <div ref={navigationRef} className="conversation-workspace" onKeyDown={(event) => {
    if (event.key !== "Escape" || event.defaultPrevented || dialog || !navigationOpen) return;
    event.preventDefault();
    event.stopPropagation();
    if (pendingDelete) {
      pendingDeleteRef.current?.querySelector<HTMLButtonElement>(".conversation-delete-button")?.focus();
      setPendingDelete(undefined);
      return;
    }
    if (conversationPanelOpen) closeConversations();
    else closeNavigation();
  }}>
    <div className="conversation-navigation-toolbar" data-tauri-drag-region>
      <button ref={toggleRef} className="workspace-sidebar-toggle" type="button" aria-label="助手与对话" aria-expanded={navigationOpen} aria-controls="assistant-navigation" title={navigationOpen ? "收起助手与对话侧栏" : "展开助手与对话侧栏"} onClick={() => navigationOpen ? closeNavigation() : setNavigationOpen(true)}>
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
    <div className="conversation-workspace-body" data-navigation-open={navigationOpen} data-conversations-open={navigationOpen && conversationPanelOpen}>
      <aside id="assistant-navigation" className="chat-navigation-pane" aria-label="助手列表" data-open={navigationOpen} inert={!navigationOpen} aria-hidden={!navigationOpen}>
        <div className="chat-navigation-heading"><h2>助手</h2></div>
        <button type="button" className="settings-button" disabled={busy || !snapshot} onClick={() => editAssistant()}><Plus size={15} />新建助手</button>
        <ul className="chat-navigation-list">{snapshot?.assistants.map((assistant, index) => {
          const selected = assistant.id === selectedAssistant?.id;
          const expanded = selected && conversationPanelOpen;
          const count = snapshot.conversations.filter((item) => item.assistantId === assistant.id).length;
          return <li className="chat-navigation-item assistant-branch" key={assistant.id}>
          <button type="button" className="chat-navigation-select assistant-branch-toggle" aria-label={assistant.name} aria-expanded={expanded} aria-controls={`assistant-conversations-${assistant.id}`} aria-pressed={selected} disabled={busy}
            onClick={() => void openAssistant(assistant.id)}>
            <span className="assistant-branch-icon" aria-hidden="true">{assistant.icon || <UserRound size={17} />}</span>
            <span className="assistant-branch-name" title={assistant.name}>{assistant.name}</span><span className="assistant-conversation-count" aria-hidden="true">({count})</span>
            <ChevronRight size={16} />
          </button>
          <AssistantActions name={assistant.name} disabled={busy} canMoveUp={index > 0} canMoveDown={index < snapshot.assistants.length - 1}
            onEdit={() => editAssistant(assistant)} onMove={(direction) => void execute({ type: "move-assistant", id: assistant.id, direction })}
            onDelete={assistant.id === DEFAULT_ASSISTANT_ID ? undefined : () => setDialog({ type: "delete-assistant", id: assistant.id, name: assistant.name, count, permanent: false })} />
          </li>;
        })}</ul>
      </aside>
      {selectedAssistant && <aside id={`assistant-conversations-${selectedAssistant.id}`} className="conversation-cascade-pane" aria-label={`${selectedAssistant.name}的对话`} data-open={navigationOpen && conversationPanelOpen} inert={!navigationOpen || !conversationPanelOpen} aria-hidden={!navigationOpen || !conversationPanelOpen}>
            <div className="chat-navigation-heading">
              <h2>{selectedAssistant.name}的对话</h2>
              <button className="conversation-collapse-button" type="button" onClick={closeConversations} aria-label="收起对话栏" title="收起对话栏">
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M8 2 3 6l5 4Z" fill="currentColor" /></svg>
              </button>
            </div>
            <button className="settings-button new-conversation-button" type="button" disabled={busy} onClick={() => void openConversation({ type: "create-conversation", id: crypto.randomUUID(), assistantId: selectedAssistant.id })}><Plus size={14} />新建对话</button>
            {conversations.length === 0 && <p className="muted-text assistant-conversations-empty">还没有对话</p>}
            <ul className="chat-navigation-list">{conversations.map((item) => <li key={item.id} className="chat-navigation-item conversation-leaf"
              ref={pendingDelete === item.id ? pendingDeleteRef : undefined}
              onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPendingDelete(undefined); }}>
          <button className="chat-navigation-select conversation-leaf-select" type="button" aria-pressed={item.id === conversation?.id} disabled={busy} title={`${item.title}${generatingIds.has(item.id) ? " · 生成中" : ""}`}
            onClick={() => { setPendingDelete(undefined); void openConversation({ type: "select", assistantId: item.assistantId, conversationId: item.id }); }}><MessageSquare size={14} /><span>{item.title}{generatingIds.has(item.id) ? " · 生成中" : ""}</span></button>
          <div className="chat-navigation-actions conversation-row-actions">
            {pendingDelete === item.id
              ? <button className="conversation-delete-cancel" type="button" aria-label={`取消删除对话 ${item.title}`} onClick={() => {
                pendingDeleteRef.current?.querySelector<HTMLButtonElement>(".conversation-delete-button")?.focus();
                setPendingDelete(undefined);
              }}>取消</button>
              : <button type="button" disabled={busy} title="编辑对话" aria-label={`编辑对话 ${item.title}`} onClick={() => setDialog({ type: "conversation", id: item.id })}><Pencil size={15} aria-hidden="true" /></button>}
            <button className="conversation-delete-button" data-pending={pendingDelete === item.id} type="button" disabled={busy}
              title={pendingDelete === item.id ? "永久删除对话及全部消息，无法撤销" : "删除"}
              aria-label={`${pendingDelete === item.id ? "确认删除对话" : "删除对话"} ${item.title}`} onClick={() => {
                if (pendingDelete !== item.id) setPendingDelete(item.id);
                else { setPendingDelete(undefined); void execute({ type: "delete-conversation", id: item.id }); }
              }}>{pendingDelete === item.id ? "确认删除" : <Trash2 size={15} aria-hidden="true" />}</button>
          </div>
            </li>)}</ul>
      </aside>}
      <section className="active-chat-workspace">
        {snapshot && !conversation ? <div className="conversation-empty"><h2>{selectedAssistant?.name}</h2><p>此助手还没有对话。新对话会复制助手当前的模型和生成配置。</p>
          <button className="settings-button" type="button" disabled={busy} onClick={() => selectedAssistant && void execute({ type: "create-conversation", id: crypto.randomUUID(), assistantId: selectedAssistant.id })}>创建第一个对话</button>
          <button className="settings-button" type="button" disabled={busy} onClick={() => editAssistant(selectedAssistant)}>编辑助手设置</button>
        </div> : <>
          {children}
        </>}
      </section>
    </div>
    {editingConversation && <ConversationSettings key={editingConversation.id} workspace={workspace} conversation={editingConversation} settings={settings} onClose={close} />}
    {dialog?.type === "assistant" && <SessionConfigPanel presentation="modal" disabled={busy} title={dialog.existing ? "编辑助手" : "新建助手"} description="作为新对话的默认设置，已有对话保持不变。"
      config={dialog.input.defaultConfig} errors={editorErrors} protocol={editorTarget?.connection.protocol} model={editorTarget?.model.modelId ?? ""}
      onChange={(config) => setDialog({ ...dialog, input: { ...dialog.input, defaultConfig: config } })}
      onReset={() => setDialog({ ...dialog, input: { ...dialog.input, defaultConfig: defaultSessionConfig() } })} onClose={close}
      footer={<><button className="settings-button" type="button" disabled={busy} onClick={close}>取消</button><button className="settings-button" type="button" disabled={busy || !dialog.input.name.trim() || Object.keys(editorErrors).length > 0}
        onClick={() => void perform({ type: dialog.existing ? "edit-assistant" : "create-assistant", id: dialog.existing?.id ?? crypto.randomUUID(), input: dialog.input })}>保存助手</button></>}>
      <section className="session-config-section">
        <label htmlFor="assistant-name">助手名称</label>
        <div className="assistant-identity-row">
        <div className="assistant-icon-picker" title="选择助手图标">
          <span aria-hidden="true">{dialog.input.icon || <UserRound size={21} />}<ChevronRight size={12} /></span>
          <select id="assistant-icon" aria-label="图标" value={dialog.input.icon} disabled={busy} onChange={(event) => setDialog({ ...dialog, input: { ...dialog.input, icon: event.target.value } })}>
            {["", "💬", "📝", "💻", "🌐", "📚", "🎨"].map((icon) => <option key={icon} value={icon}>{icon || "默认图标"}</option>)}
          </select>
        </div>
        <input id="assistant-name" value={dialog.input.name} disabled={busy || dialog.existing?.id === DEFAULT_ASSISTANT_ID} maxLength={100}
          onChange={(event) => setDialog({ ...dialog, input: { ...dialog.input, name: event.target.value } })} />
        </div>
        <label htmlFor="assistant-model">助手模型 / 连接</label><select id="assistant-model" value={dialog.input.defaultModelId ?? ""} disabled={busy}
          onChange={(event) => {
            const defaultModelId = event.target.value || null;
            const next = getActiveTarget({ ...settings, activeModelId: defaultModelId });
            setDialog({ ...dialog, input: { ...dialog.input, defaultModelId,
              defaultConfig: next ? switchThinkingProtocol(dialog.input.defaultConfig, editorTarget?.connection.protocol, next.connection.protocol) : dialog.input.defaultConfig } });
          }}>
          <option value="">未选择模型</option>
          {dialog.input.defaultModelId && !editorTarget && <option value={dialog.input.defaultModelId}>原模型已失效，请重新选择</option>}
          {settings.providers.flatMap((provider) => provider.connections.flatMap((connection) => connection.models.map((model) => <option value={model.id} key={model.id}>{provider.name} / {connection.name} / {model.displayName || model.modelId}</option>)))}
        </select>
        <div className="session-config-capabilities">
        <WebSearchControl config={dialog.input.defaultConfig} disabled={busy}
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
    {dialog && dialog.type !== "assistant" && dialog.type !== "conversation" && <ManagementDialog title="删除确认" onClose={close}>
      {dialog.type === "delete-assistant" && <><p>助手“{dialog.name}”包含 {dialog.count} 个对话。迁移后保留各对话设置和消息，仅改变所属助手。</p>
        {dialog.permanent ? <><p>将永久删除该助手、全部对话和消息，无法撤销。</p><button className="settings-button" type="button" disabled={busy} onClick={() => void perform({ type: "delete-assistant", id: dialog.id, mode: "delete" })}>确认永久删除助手及对话</button></>
          : <><button className="settings-button" type="button" disabled={busy} onClick={() => void perform({ type: "delete-assistant", id: dialog.id, mode: "move" })}>迁移对话到默认助手并删除助手</button><button className="settings-button" type="button" disabled={busy} onClick={() => setDialog({ ...dialog, permanent: true })}>选择永久删除全部内容…</button></>}
      </>}
      {workspace.operationError && <p role="alert">{workspace.operationError}</p>}
      <button className="settings-button" type="button" disabled={busy} onClick={close}>取消</button>
    </ManagementDialog>}
  </div>;
}
