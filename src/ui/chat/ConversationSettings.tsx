import { useState } from "react";
import { copyAssistantConfig, readConversationConfig } from "../../chat/conversationConfig";
import type { useConversationWorkspace } from "../../chat/useConversationWorkspace";
import type { Conversation } from "../../chat/workspace";
import { getActiveTarget, type ConnectionSettingsState } from "../../chat/settings";
import { ModelSelectField } from "./ModelSelectField";
import { validateRequestConfig } from "../../chat/requestMapping";
import { getThinkingSettings, withThinkingSettings, switchThinkingProtocol } from "../../chat/thinking";
import { SessionConfigPanel } from "./SessionConfigPanel";
import { ThinkingControl } from "./ThinkingControl";
import { WebSearchControl } from "./WebSearchControl";
import "./AssistantConfig.css";

export function ConversationSettings({ workspace, conversation, settings, onClose }: {
  workspace: ReturnType<typeof useConversationWorkspace>; conversation: Conversation; settings: ConnectionSettingsState; onClose(): void;
}) {
  const [draft, setDraft] = useState(() => readConversationConfig(conversation.settings));
  const [title, setTitle] = useState(conversation.title);
  const [titleEdited, setTitleEdited] = useState(false);
  const [resetCount, setResetCount] = useState(0);
  const assistant = workspace.snapshot?.assistants.find((item) => item.id === conversation.assistantId);
  const target = getActiveTarget({ ...settings, activeModelId: draft.modelId });
  const protocol = target?.connection.protocol;
  const errors = validateRequestConfig(draft.config, protocol ?? "openai-chat", target?.model.modelId ?? "");
  async function save() {
    if (await workspace.execute({ type: "configure-conversation", id: conversation.id, settings: draft,
      ...(titleEdited ? { title } : {}) })) onClose();
  }
  return <SessionConfigPanel presentation="modal" title="编辑对话" description="设置仅用于此对话，保存后用于下一次请求。"
    disabled={workspace.busy} config={draft.config} errors={errors} protocol={protocol} model={target?.model.modelId ?? ""}
    onChange={(config) => setDraft({ ...draft, config })}
    onClose={() => { if (!workspace.busy) onClose(); }} resetLabel="恢复助手默认值" onReset={() => { setDraft(copyAssistantConfig(assistant)); setResetCount((count) => count + 1); }}
    footer={<><button type="button" className="settings-button" disabled={workspace.busy} onClick={onClose}>取消</button>
      <button type="button" className="settings-button settings-button-primary" disabled={workspace.busy || !title.trim()} onClick={() => void save()}>保存对话</button></>}>
    <section className="session-config-section conversation-config-basics">
      <h3>对话信息</h3>
      <label htmlFor="conversation-title">对话标题</label>
      <input id="conversation-title" value={title} maxLength={200} onChange={(event) => { setTitle(event.target.value); setTitleEdited(true); }} />
      <p className="muted-text">恢复助手默认值只更新此处的模型与配置草稿，不改对话标题；点击“保存对话”后生效。</p>
    </section>
    <section className="session-config-section conversation-config-model">
      <h3>模型与能力</h3>
      <label htmlFor="conversation-model">当前对话模型 / 连接</label>
      <ModelSelectField id="conversation-model" label="当前对话模型 / 连接" settings={settings} selectedModelId={draft.modelId}
        disabled={workspace.busy} hint="仅修改配置草稿，点击保存对话后生效。" onSelect={async value => {
        const modelId = value || null;
        const next = getActiveTarget({ ...settings, activeModelId: modelId });
        setDraft({ modelId, config: next ? switchThinkingProtocol(draft.config, protocol, next.connection.protocol) : draft.config });
        return true;
      }} />
      {!target && <p role="status" className="session-config-error">{draft.modelId ? "模型引用已失效，不会自动切换到其他模型。" : "尚未选择模型。"}请选择模型或恢复助手默认值后再发送。</p>}
      <div className="session-config-capabilities">
      <WebSearchControl config={draft.config} disabled={workspace.busy}
        onChange={(config) => setDraft({ ...draft, config })} />
      {protocol && target && <ThinkingControl key={`${resetCount}-${protocol}-${getThinkingSettings(draft.config, protocol)?.budget}`} protocol={protocol} model={target.model.modelId}
        value={getThinkingSettings(draft.config, protocol)} scope="当前会话" disabled={workspace.busy} hint=""
        onChange={(value) => setDraft({ ...draft, config: withThinkingSettings(draft.config, protocol, value) })} />}
      </div>
      {errors.thinking && <p className="session-config-error" role="alert">{errors.thinking}</p>}
      {Object.keys(errors).length > 0 && <p className="session-config-error">可保存未完成的设置；配置错误修正前不能发送。</p>}
      {workspace.operationError && <p className="session-config-error" role="alert">{workspace.operationError}</p>}
    </section>
  </SessionConfigPanel>;
}
