import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight, MessageSquare, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Trash2 } from "lucide-react";
import type { useConversationWorkspace } from "../../chat/useConversationWorkspace";
import { defaultSessionConfig, validateSessionConfig } from "../../chat/sessionConfig";
import { validateRequestConfig } from "../../chat/requestMapping";
import { getActiveTarget, type ConnectionSettingsState } from "../../chat/settings";
import { DEFAULT_ASSISTANT_ID, type AssistantInput, type AssistantPreset, type WorkspaceCommand } from "../../chat/workspace";
import { SessionConfigPanel } from "./SessionConfigPanel";
import { ThinkingControl } from "./ThinkingControl";
import { getThinkingSettings, withThinkingSettings } from "../../chat/thinking";

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
  | { type: "assistant"; existing?: AssistantPreset; input: AssistantInput }
  | { type: "rename"; id: string; title: string }
  | { type: "delete-conversation"; id: string; title: string }
  | { type: "delete-assistant"; id: string; name: string; count: number; permanent: boolean };

export function ConversationNavigation({ workspace, settings, generatingId, children }: {
  workspace: ReturnType<typeof useConversationWorkspace>;
  settings: ConnectionSettingsState;
  generatingId: string | null;
  children: ReactNode;
}) {
  const [navigationOpen, setNavigationOpen] = useState(() => window.innerWidth > 860);
  const [conversationPanelOpen, setConversationPanelOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>();
  const { snapshot, conversation, busy, execute } = workspace;
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
  const running = snapshot?.conversations.find((item) => item.id === generatingId);

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

  return <div className="conversation-workspace">
    <div className="conversation-navigation-toolbar">
      <button className="settings-button" type="button" aria-expanded={navigationOpen} aria-controls="assistant-navigation" title={navigationOpen ? "收起侧栏" : "展开侧栏"} onClick={() => setNavigationOpen(!navigationOpen)}>
        {navigationOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}助手与对话
      </button>
      <span className="muted-text workspace-breadcrumb">{selectedAssistant?.name ?? "加载工作区"} / {conversation?.title ?? "尚无对话"}</span>
    </div>
    {workspace.loadError && <div role="alert" className="error-banner">{workspace.loadError}<button className="settings-button" type="button" disabled={busy} onClick={workspace.retry}>重试加载</button></div>}
    {workspace.operationError && <div role="alert" className="error-banner">{workspace.operationError}</div>}
    {Object.keys(workspace.view.configErrors).length > 0 && selectedAssistant && <div role="alert" className="error-banner">
      助手配置需要调整：{Object.values(workspace.view.configErrors)[0]}
      <button className="settings-button" type="button" disabled={busy} onClick={() => editAssistant(selectedAssistant)}>编辑助手设置</button>
    </div>}
    {running && running.id !== conversation?.id && <div className="background-generation" role="status">
      “{running.title}”正在生成，完成或停止后可发送下一条消息。
      <button className="settings-button" type="button" disabled={busy} onClick={() => void execute({ type: "select", assistantId: running.assistantId, conversationId: running.id })}>返回生成中的对话</button>
    </div>}
    <div className="conversation-workspace-body" onKeyDown={(event) => {
      if (event.key === "Escape" && conversationPanelOpen) {
        setConversationPanelOpen(false);
        event.currentTarget.querySelector<HTMLElement>('.assistant-branch-toggle[aria-pressed="true"]')?.focus();
      }
    }}>
      {navigationOpen && <aside id="assistant-navigation" className="chat-navigation-pane" aria-label="助手列表">
        <div className="chat-navigation-heading"><h2>助手</h2></div>
        <button type="button" className="settings-button" disabled={busy || !snapshot} onClick={() => editAssistant()}><Plus size={15} />新建助手</button>
        <ul className="chat-navigation-list">{snapshot?.assistants.map((assistant, index) => {
          const selected = assistant.id === selectedAssistant?.id;
          const expanded = selected && conversationPanelOpen;
          const count = snapshot.conversations.filter((item) => item.assistantId === assistant.id).length;
          return <li className="chat-navigation-item assistant-branch" key={assistant.id}>
          <button type="button" className="chat-navigation-select assistant-branch-toggle" aria-label={assistant.name} aria-expanded={expanded} aria-controls={`assistant-conversations-${assistant.id}`} aria-pressed={selected} disabled={busy}
            onClick={() => void openAssistant(assistant.id)}>
            <span className="assistant-branch-name">{assistant.icon} {assistant.name}</span><span className="assistant-conversation-count" aria-hidden="true">{count}</span>
            <ChevronRight size={16} />
          </button>
          <div className="chat-navigation-actions">
            <button type="button" disabled={busy} onClick={() => editAssistant(assistant)} aria-label={`编辑助手 ${assistant.name}`}>编辑</button>
            <button type="button" disabled={busy || index === 0} onClick={() => void execute({ type: "move-assistant", id: assistant.id, direction: -1 })} aria-label={`上移助手 ${assistant.name}`}>↑</button>
            <button type="button" disabled={busy || index === snapshot.assistants.length - 1} onClick={() => void execute({ type: "move-assistant", id: assistant.id, direction: 1 })} aria-label={`下移助手 ${assistant.name}`}>↓</button>
            {assistant.id !== DEFAULT_ASSISTANT_ID && <button type="button" disabled={busy} aria-label={`删除助手 ${assistant.name}`} onClick={() => setDialog({ type: "delete-assistant", id: assistant.id, name: assistant.name, count: snapshot.conversations.filter((item) => item.assistantId === assistant.id).length, permanent: false })}>删除</button>}
          </div>
          </li>;
        })}</ul>
      </aside>}
      {navigationOpen && conversationPanelOpen && selectedAssistant && <aside id={`assistant-conversations-${selectedAssistant.id}`} className="conversation-cascade-pane" aria-label={`${selectedAssistant.name}的对话`}>
            <div className="chat-navigation-heading">
              <h2>{selectedAssistant.name}的对话</h2>
              <button className="conversation-collapse-button" type="button" onClick={() => setConversationPanelOpen(false)} aria-label="收起对话栏" title="收起对话栏">
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M8 2 3 6l5 4Z" fill="currentColor" /></svg>
              </button>
            </div>
            <button className="settings-button new-conversation-button" type="button" disabled={busy} onClick={() => void openConversation({ type: "create-conversation", id: crypto.randomUUID(), assistantId: selectedAssistant.id })}><Plus size={14} />新建对话</button>
            {conversations.length === 0 && <p className="muted-text assistant-conversations-empty">还没有对话</p>}
            <ul className="chat-navigation-list">{conversations.map((item) => <li key={item.id} className="chat-navigation-item conversation-leaf">
          <button className="chat-navigation-select conversation-leaf-select" type="button" aria-pressed={item.id === conversation?.id} disabled={busy}
            onClick={() => void openConversation({ type: "select", assistantId: item.assistantId, conversationId: item.id })}><MessageSquare size={14} /><span>{item.title}{item.id === generatingId ? " · 生成中" : ""}</span></button>
          <div className="chat-navigation-actions conversation-row-actions">
            <button type="button" disabled={busy} title="重命名" aria-label={`重命名对话 ${item.title}`} onClick={() => setDialog({ type: "rename", id: item.id, title: item.title })}><Pencil size={15} aria-hidden="true" /></button>
            <button type="button" disabled={busy} title="删除" aria-label={`删除对话 ${item.title}`} onClick={() => setDialog({ type: "delete-conversation", id: item.id, title: item.title })}><Trash2 size={15} aria-hidden="true" /></button>
          </div>
            </li>)}</ul>
      </aside>}
      <section className="active-chat-workspace">
        {snapshot && !conversation ? <div className="conversation-empty"><h2>{selectedAssistant?.name}</h2><p>此助手还没有对话。所有对话共用助手的模型和生成配置。</p>
          <button className="settings-button" type="button" disabled={busy} onClick={() => selectedAssistant && void execute({ type: "create-conversation", id: crypto.randomUUID(), assistantId: selectedAssistant.id })}>创建第一个对话</button>
          <button className="settings-button" type="button" disabled={busy} onClick={() => editAssistant(selectedAssistant)}>编辑助手设置</button>
        </div> : <>
          {children}
        </>}
      </section>
    </div>
    {dialog?.type === "assistant" && <SessionConfigPanel disabled={busy} title={dialog.existing ? "编辑助手" : "新建助手"} description="保存后，所有对话的后续请求共用此配置；历史消息与正在生成的请求保持不变。"
      config={dialog.input.defaultConfig} errors={editorErrors} protocol={editorTarget?.connection.protocol} model={editorTarget?.model.modelId ?? ""}
      onChange={(config) => setDialog({ ...dialog, input: { ...dialog.input, defaultConfig: config } })}
      onReset={() => setDialog({ ...dialog, input: { ...dialog.input, defaultConfig: defaultSessionConfig() } })} onClose={close}
      footer={<div className="management-dialog-actions"><button className="settings-button" type="button" disabled={busy || !dialog.input.name.trim() || Object.keys(editorErrors).length > 0}
        onClick={() => void perform({ type: dialog.existing ? "edit-assistant" : "create-assistant", id: dialog.existing?.id ?? crypto.randomUUID(), input: dialog.input })}>保存助手</button></div>}>
      <section className="session-config-section">
        <label htmlFor="assistant-name">助手名称</label><input id="assistant-name" value={dialog.input.name} disabled={busy || dialog.existing?.id === DEFAULT_ASSISTANT_ID} maxLength={100}
          onChange={(event) => setDialog({ ...dialog, input: { ...dialog.input, name: event.target.value } })} />
        <label htmlFor="assistant-icon">图标</label><select id="assistant-icon" value={dialog.input.icon} disabled={busy} onChange={(event) => setDialog({ ...dialog, input: { ...dialog.input, icon: event.target.value } })}>
          {["", "💬", "📝", "💻", "🌐", "📚", "🎨"].map((icon) => <option key={icon} value={icon}>{icon || "无图标"}</option>)}
        </select>
        <label htmlFor="assistant-model">助手模型 / 连接</label><select id="assistant-model" value={dialog.input.defaultModelId ?? ""} disabled={busy}
          onChange={(event) => {
            const defaultModelId = event.target.value || null;
            setDialog({ ...dialog, input: { ...dialog.input, defaultModelId } });
          }}>
          <option value="">未选择模型</option>
          {dialog.input.defaultModelId && !editorTarget && <option value={dialog.input.defaultModelId}>原模型已失效，请重新选择</option>}
          {settings.providers.flatMap((provider) => provider.connections.flatMap((connection) => connection.models.map((model) => <option value={model.id} key={model.id}>{provider.name} / {connection.name} / {model.displayName || model.modelId}</option>)))}
        </select>
        {editorTarget && <ThinkingControl
          key={`${editorTarget.connection.protocol}-${editorTarget.model.modelId}-${getThinkingSettings(dialog.input.defaultConfig, editorTarget.connection.protocol)?.budget}`}
          protocol={editorTarget.connection.protocol} model={editorTarget.model.modelId} value={getThinkingSettings(dialog.input.defaultConfig, editorTarget.connection.protocol)}
          disabled={busy} hint="保存助手后生效"
          onChange={(thinking) => setDialog({ ...dialog, input: { ...dialog.input,
            defaultConfig: withThinkingSettings(dialog.input.defaultConfig, editorTarget.connection.protocol, thinking) } })} />}
        {editorErrors.thinking && <p className="session-config-error" role="alert">{editorErrors.thinking}</p>}
      </section>
    </SessionConfigPanel>}
    {dialog && dialog.type !== "assistant" && <ManagementDialog title={dialog.type === "rename" ? "重命名对话" : "删除确认"} onClose={close}>
      {dialog.type === "rename" && <form onSubmit={(event) => { event.preventDefault(); void perform({ type: "rename-conversation", id: dialog.id, title: dialog.title }); }}>
        <label htmlFor="conversation-title">对话标题</label><input id="conversation-title" value={dialog.title} maxLength={200} disabled={busy} onChange={(event) => setDialog({ ...dialog, title: event.target.value })} />
        <button className="settings-button" type="submit" disabled={busy || !dialog.title.trim()}>保存标题</button>
      </form>}
      {dialog.type === "delete-conversation" && <><p>永久删除“{dialog.title}”及全部消息，无法撤销。</p><button className="settings-button" type="button" disabled={busy} onClick={() => void perform({ type: "delete-conversation", id: dialog.id })}>确认永久删除对话</button></>}
      {dialog.type === "delete-assistant" && <><p>助手“{dialog.name}”包含 {dialog.count} 个对话。迁移后，后续请求将使用默认助手的配置。</p>
        {dialog.permanent ? <><p>将永久删除该助手、全部对话和消息，无法撤销。</p><button className="settings-button" type="button" disabled={busy} onClick={() => void perform({ type: "delete-assistant", id: dialog.id, mode: "delete" })}>确认永久删除助手及对话</button></>
          : <><button className="settings-button" type="button" disabled={busy} onClick={() => void perform({ type: "delete-assistant", id: dialog.id, mode: "move" })}>迁移对话到默认助手并删除助手</button><button className="settings-button" type="button" disabled={busy} onClick={() => setDialog({ ...dialog, permanent: true })}>选择永久删除全部内容…</button></>}
      </>}
      {workspace.operationError && <p role="alert">{workspace.operationError}</p>}
      <button className="settings-button" type="button" disabled={busy} onClick={close}>取消</button>
    </ManagementDialog>}
  </div>;
}
