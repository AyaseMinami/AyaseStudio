import { useState } from "react";
import { assistantAvatarDefaults, readAssistantDefaultAvatar, writeAssistantDefaultAvatar } from "../../avatar/assistantDefaults";
import { AssistantAvatar } from "../chat/AssistantAvatar";

export function AssistantAvatarDefaults() {
  const [selected, setSelected] = useState(readAssistantDefaultAvatar);
  const [error, setError] = useState<string>();
  return <section className="settings-page avatar-page">
    <section className="avatar-card" aria-labelledby="assistant-default-heading">
      <div className="avatar-card-heading"><h3 id="assistant-default-heading">新助手默认头像</h3><span>仅在本机</span></div>
      <div className="avatar-profile avatar-buttons">{assistantAvatarDefaults.map(({ id, label }) =>
        <button key={id} type="button" className="settings-button" aria-pressed={selected === id} onClick={() => {
          try { writeAssistantDefaultAvatar(id); setSelected(id); setError(undefined); }
          catch { setError("默认头像保存失败，请重试。"); }
        }}><AssistantAvatar defaultAvatar={id} />{label}</button>)}</div>
      <p className="avatar-format">只影响以后新建的助手。每个助手也可以在编辑界面单独选图、裁切或更换默认头像。</p>
      {error && <p className="avatar-error" role="alert">{error}</p>}
    </section>
  </section>;
}
