import { useEffect, useId, useRef, useState } from "react";
import { createCherryImportPlan } from "../../import/cherryMapping";
import type { CherryBackup, CherryImportPlan, CherryImportResult } from "../../import/cherryTypes";
import "./DataImportSettings.css";

export interface DataImportSettingsProps {
  disabled?: boolean;
  selectBackup(): Promise<CherryBackup | null>;
  closeBackup(token: string): Promise<void>;
  existingSourceKeys(keys: string[]): Promise<string[]>;
  importPlan(plan: CherryImportPlan, mode: "skip" | "copy"): Promise<CherryImportResult & { warnings: string[] }>;
}

interface BackupResource { token: string; close(token: string): Promise<void>; closed: boolean }
async function release(resource: BackupResource | null): Promise<boolean> {
  if (!resource || resource.closed) return true;
  resource.closed = true;
  try { await resource.close(resource.token); return true; } catch { return false; }
}

export function DataImportSettings(props: DataImportSettingsProps) {
  const [plan, setPlan] = useState<CherryImportPlan | null>(null);
  const [selected, setSelected] = useState(new Set<string>());
  const [duplicates, setDuplicates] = useState(new Set<string>());
  const [mode, setMode] = useState<"skip" | "copy">("skip");
  const [busy, setBusy] = useState<"select" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(CherryImportResult & { warnings: string[] }) | null>(null);
  const mounted = useRef(false);
  const operation = useRef<"select" | "import" | null>(null);
  const resource = useRef<BackupResource | null>(null);
  const modeName = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // A running import still reads this native session. Its finally block owns release.
      if (operation.current !== "import") void release(resource.current);
    };
  }, []);

  async function selectBackup() {
    if (props.disabled || operation.current) return;
    operation.current = "select"; setBusy("select"); setError(null); setResult(null);
    let opened: BackupResource | null = null;
    try {
      const backup = await props.selectBackup();
      if (!backup) return;
      opened = { token: backup.token, close: props.closeBackup, closed: false };
      if (!mounted.current) { await release(opened); return; }
      await release(resource.current);
      if (!mounted.current) { await release(opened); return; }
      resource.current = opened;
      setPlan(null); setSelected(new Set()); setDuplicates(new Set());
      const next = createCherryImportPlan(backup);
      const existing = await props.existingSourceKeys(next.conversations.map((conversation) => conversation.sourceKey));
      if (!mounted.current) { await release(opened); return; }
      setPlan(next); setSelected(new Set(next.conversations.map((conversation) => conversation.sourceKey)));
      setDuplicates(new Set(existing)); setMode("skip");
    } catch {
      if (opened) { await release(opened); if (resource.current === opened) resource.current = null; }
      if (mounted.current) setError("无法读取此 Cherry 备份，请检查格式和文件后重试。");
    } finally {
      operation.current = null;
      if (mounted.current) setBusy(null);
    }
  }

  async function importSelected() {
    if (props.disabled || operation.current || !plan || !selected.size) return;
    operation.current = "import"; setBusy("import"); setError(null); setResult(null);
    const currentResource = resource.current;
    try {
      const conversations = plan.conversations.filter((conversation) => selected.has(conversation.sourceKey));
      const assistantIds = new Set(conversations.map((conversation) => conversation.assistantId));
      const imported = await props.importPlan({ ...plan, conversations,
        assistants: plan.assistants.filter((assistant) => assistantIds.has(assistant.id)) }, mode);
      const released = await release(currentResource);
      if (resource.current === currentResource) resource.current = null;
      if (mounted.current) {
        setPlan(null); setSelected(new Set()); setDuplicates(new Set());
        setResult({ ...imported, warnings: released ? imported.warnings : [
          ...imported.warnings, "聊天记录已导入，但备份临时资源未能释放。",
        ] });
      }
    } catch {
      if (mounted.current) setError("导入失败。预览和选择已保留，请检查备份后重试。");
    } finally {
      operation.current = null;
      if (!mounted.current) await release(currentResource);
      else setBusy(null);
    }
  }

  const locked = Boolean(props.disabled || busy);
  const chosen = plan?.conversations.filter((conversation) => selected.has(conversation.sourceKey)) ?? [];
  const messageCount = chosen.reduce((sum, conversation) => sum + conversation.messages.length, 0);
  const fileCount = chosen.reduce((sum, conversation) => sum + conversation.messages.reduce((count, message) => count + message.files.length, 0), 0);
  const unavailableCount = chosen.reduce((sum, conversation) => sum + conversation.messages.reduce((count, message) => count + (message.unavailableAttachments?.length ?? 0), 0), 0);
  const duplicateCount = chosen.filter((conversation) => duplicates.has(conversation.sourceKey)).length;
  const topicCounts = new Map<string, number>();
  for (const conversation of plan?.conversations ?? []) topicCounts.set(conversation.topicId, (topicCounts.get(conversation.topicId) ?? 0) + 1);
  const splitTopics = [...topicCounts.values()].filter((count) => count > 1).length;
  function toggle(keys: string[], checked: boolean) {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const key of keys) { if (checked) next.add(key); else next.delete(key); }
      return next;
    });
  }

  return <section className="data-import-page" aria-label="从 Cherry Studio 迁移" aria-busy={Boolean(busy)}>
    <section className="settings-card data-import-intro" aria-label="Cherry 聊天导入说明">
      <div className="data-management-entry-heading"><h3>从 Cherry Studio 迁移</h3><span className="data-management-entry-tag">其他应用数据</span></div>
      <p>从本机 Cherry Studio 备份导入助手分组、聊天记录和可恢复的附件。</p>
      <p className="muted-text">支持备份格式 5（1.9.13 手机版）、6（1.9.13）和 7（2.1.3）。平行回答和树形分支将保留为独立对话。</p>
      <div className="data-management-entry-footer">
      <p className="data-management-entry-notice">不导入 API Key、账户、模型连接、助手提示词或生成配置，也不会执行工具。缺失或不支持的附件会明确提示。</p>
      <button type="button" className="settings-button" disabled={locked} onClick={() => void selectBackup()}>
        {busy === "select" ? "正在读取备份…" : "导入 Cherry Studio 聊天"}
      </button>
      </div>
      {props.disabled && <p className="muted-text" role="status">请等待当前任务完成、工作区准备就绪后再导入。</p>}
    </section>
    {error && <p className="data-import-error" role="alert">{error}</p>}
    {result && <section className="settings-card data-import-result" aria-label="导入结果">
      <p role="status">已导入 {result.imported} 个对话，跳过 {result.skipped} 个已导入对话。</p>
      {result.warnings.length > 0 && <ul aria-label="导入提示">{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
    </section>}
    {plan && <section className="settings-card data-import-preview" aria-label="备份预览">
      <div className="data-import-preview-heading"><h3>备份预览</h3><span className="muted-text">格式 {plan.format} · {plan.assistants.length} 个助手 · {plan.conversations.length} 个对话</span></div>
      {splitTopics > 0 && <p className="data-import-split-notice">已将 {splitTopics} 个主题的平行回答或树形分支展开为独立对话，每条路径均可单独选择。</p>}
      {plan.warnings.length > 0 && <ul className="data-import-warnings" aria-label="备份内容提示">{plan.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
      <div className="data-import-selection-actions">
        <button type="button" className="settings-button" disabled={locked} onClick={() => setSelected(new Set(plan.conversations.map((conversation) => conversation.sourceKey)))}>全选</button>
        <button type="button" className="settings-button" disabled={locked} onClick={() => setSelected(new Set())}>取消全选</button>
        <span className="muted-text">已识别 {plan.conversations.filter((conversation) => duplicates.has(conversation.sourceKey)).length} 个已导入对话</span>
      </div>
      <div className="data-import-conversations" aria-label="选择要导入的对话">
        {plan.assistants.map((assistant) => {
          const conversations = plan.conversations.filter((conversation) => conversation.assistantId === assistant.id);
          const keys = conversations.map((conversation) => conversation.sourceKey);
          const selectedCount = keys.filter((key) => selected.has(key)).length;
          const name = assistant.name || "未命名助手";
          return <section className="data-import-assistant" key={assistant.id}>
            <label className="data-import-assistant-heading" title={name}>
              <input className="ui-checkbox" type="checkbox" aria-label={`选择助手 ${name}`} disabled={locked || !keys.length}
                checked={keys.length > 0 && selectedCount === keys.length}
                ref={(input) => { if (input) input.indeterminate = selectedCount > 0 && selectedCount < keys.length; }}
                onChange={(event) => toggle(keys, event.currentTarget.checked)} />
              <strong>{name}</strong><span>{selectedCount}/{keys.length}</span>
            </label>
            {conversations.map((conversation) => {
              const title = conversation.title || "未命名对话";
              const files = conversation.messages.reduce((sum, message) => sum + message.files.length, 0);
              return <label className="data-import-conversation" key={conversation.sourceKey} title={title}>
                <input className="ui-checkbox" type="checkbox" aria-label={`选择对话 ${title}`} disabled={locked} checked={selected.has(conversation.sourceKey)}
                  onChange={(event) => toggle([conversation.sourceKey], event.currentTarget.checked)} />
                <span className="data-import-conversation-detail"><span className="data-import-conversation-title">{title}</span>
                  <small>{conversation.messages.length} 条消息 · {files} 个附件{duplicates.has(conversation.sourceKey) ? " · 已导入" : ""}</small>
                </span>
              </label>;
            })}
            {!conversations.length && <p className="muted-text">没有可导入的对话。</p>}
          </section>;
        })}
      </div>
      <fieldset className="data-import-mode" disabled={locked}><legend>重复导入</legend>
        <label><input type="radio" name={modeName} value="skip" checked={mode === "skip"} onChange={() => setMode("skip")} />默认跳过已导入</label>
        <label><input type="radio" name={modeName} value="copy" checked={mode === "copy"} onChange={() => setMode("copy")} />另存副本</label>
      </fieldset>
      <div className="data-import-confirm"><p className="muted-text">已选 {chosen.length} 个对话 · {messageCount} 条消息 · {fileCount} 个附件
        {unavailableCount > 0 && ` · ${unavailableCount} 个附件缺失或不受支持`}
        {duplicateCount > 0 && ` · ${mode === "skip" ? "将跳过" : "将另存"} ${duplicateCount} 个已导入对话`}</p>
        <button type="button" className="settings-button settings-button-primary" disabled={locked || !chosen.length} onClick={() => void importSelected()}>
          {busy === "import" ? "正在导入…" : "导入所选对话"}
        </button>
      </div>
    </section>}
  </section>;
}
