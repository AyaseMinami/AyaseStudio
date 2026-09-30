import { useEffect, useId, useRef, useState } from "react";
import { encryptedBackup } from "../../backup/codec";
import type { BackupExportOptions, BackupPreview, RestoreMode } from "../../backup/types";
import { BackupRecoveryError } from "../../backup/errors";
import "./BackupWorkspace.css";

export interface BackupWorkspaceApi {
  exportBackup(options: BackupExportOptions, password: string, confirmation: string): Promise<{ saved: boolean; preview: BackupPreview }>;
  selectBackup(): Promise<string | null>;
  inspect(serialized: string, password: string): Promise<BackupPreview>;
  conflicts(preview: BackupPreview, mode: RestoreMode): Promise<{ conflicts: number; warnings: string[] }>;
  restore(preview: BackupPreview, mode: RestoreMode): Promise<string[]>;
}

function keyCount(preview: BackupPreview) {
  if (!preview.document.options.credentials) return 0;
  const search = preview.document.searchSettings;
  const searchKeys = !search ? [] : search.version === 2 ? [search.exaApi.apiKey, search.exaMcp.apiKey] : [search.apiKey];
  const searchCount = searchKeys.filter((key) => typeof key === "string" && key.length > 0).length;
  const config = preview.document.connections;
  if (!config || typeof config !== "object" || !("providers" in config) || !Array.isArray(config.providers)) return searchCount;
  return config.providers.reduce((count: number, provider: unknown) => {
    if (!provider || typeof provider !== "object" || !("connections" in provider) || !Array.isArray(provider.connections)) return count;
    return count + provider.connections.filter((connection: unknown) => connection && typeof connection === "object" && "apiKey" in connection && typeof connection.apiKey === "string" && connection.apiKey.length > 0).length;
  }, searchCount);
}

function PreviewSummary({ preview }: { preview: BackupPreview }) {
  return <dl className="backup-summary">
    <div><dt>备份版本</dt><dd>{preview.document.version}</dd></div>
    <div><dt>助手</dt><dd>{preview.counts.assistants}</dd></div>
    <div><dt>对话</dt><dd>{preview.counts.conversations}</dd></div>
    <div><dt>消息（含保留候选）</dt><dd>{preview.counts.messages}</dd></div>
    <div><dt>头像库</dt><dd>{preview.counts.avatars}</dd></div>
    <div><dt>文件资源</dt><dd>{preview.counts.files}</dd></div>
    <div><dt>连接配置</dt><dd>{preview.document.options.connections ? `包含 · ${preview.counts.connections} 个连接` : "不包含"}</dd></div>
    <div><dt>网络搜索配置</dt><dd>{preview.document.searchSettings
      ? preview.document.searchSettings.version === 2 ? "包含 · Exa API 与 Exa MCP" : "包含 · Exa MCP（旧配置），保留本机 Exa API 设置与 Key"
      : "不包含（旧备份），保留本机搜索设置与 Key"}</dd></div>
    <div><dt>API Key</dt><dd>{preview.document.options.credentials ? `包含 · ${keyCount(preview)} 个` : "不包含"}</dd></div>
    <div><dt>加密</dt><dd>{preview.encrypted ? "已加密" : "未加密"}</dd></div>
  </dl>;
}

const strategies: Record<RestoreMode, { label: string; description: string }> = {
  merge: { label: "合并（默认）", description: "保留现有冲突对象、连接、API Key、全局设置、网络搜索设置和用户头像；仅追加新助手、对话、连接和资源库条目。备份中的 API Key 仅写入新增连接。" },
  copy: { label: "另存副本", description: "为导入的助手、对话、供应商、连接、模型及资源库条目分配新 ID；保留现有全局设置、网络搜索设置、用户头像和当前选择。备份中的 API Key 仅写入新增连接。" },
  replace: { label: "替换", description: "替换备份支持的数据表、应用偏好、背景引用和用户头像。包含连接时替换连接配置；包含网络搜索设置时应用该设置。包含 API Key 时还会覆盖现有密钥，须单独确认。" },
};

export function BackupWorkspace({ api, onExit }: { api: BackupWorkspaceApi; onExit(): void }) {
  const [encrypted, setEncrypted] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [serialized, setSerialized] = useState<string | null>(null);
  const [importPassword, setImportPassword] = useState("");
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [exportResult, setExportResult] = useState<{ saved: boolean; preview: BackupPreview } | null>(null);
  const [mode, setMode] = useState<RestoreMode>("merge");
  const [conflicts, setConflicts] = useState<{ preview: BackupPreview; mode: RestoreMode; conflicts: number; warnings: string[] } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [keysConfirmed, setKeysConfirmed] = useState(false);
  const [result, setResult] = useState<string[] | null>(null);
  const [restoredPreview, setRestoredPreview] = useState<BackupPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recoveryLocked, setRecoveryLocked] = useState(false);
  const operation = useRef(false);
  const mounted = useRef(false);
  const modeName = useId();

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function run(action: () => Promise<void>, failure: string) {
    if (operation.current || recoveryLocked || !mounted.current) return;
    operation.current = true; setBusy(true); setError(null);
    try { await action(); }
    catch (caught) { if (mounted.current) {
      if (caught instanceof BackupRecoveryError) { setRecoveryLocked(true); setError(caught.message); }
      else setError(failure);
    } }
    finally { operation.current = false; if (mounted.current) setBusy(false); }
  }
  async function refreshConflicts(next: BackupPreview, strategy: RestoreMode) {
    const found = await api.conflicts(next, strategy);
    if (mounted.current) setConflicts({ ...found, preview: next, mode: strategy });
  }
  async function inspect(next: string, secret: string) {
    const valid = await api.inspect(next, secret);
    if (!mounted.current) return;
    setPreview(valid); setSerialized(null); setImportPassword("");
    await refreshConflicts(valid, "merge");
  }
  function chooseFile() {
    void run(async () => {
      const next = await api.selectBackup();
      if (!mounted.current || next === null) return;
      setPreview(null); setSerialized(null); setImportPassword(""); setConflicts(null);
      setConfirmed(false); setKeysConfirmed(false); setMode("merge"); setResult(null); setRestoredPreview(null);
      if (encryptedBackup(next)) setSerialized(next);
      else await inspect(next, "");
    }, "无法读取或校验此备份，请检查文件格式、版本和完整性后重试。");
  }
  function changeMode(next: RestoreMode) {
    if (operation.current || !preview) return;
    setMode(next); setConfirmed(false); setKeysConfirmed(false); setConflicts(null);
    void run(() => refreshConflicts(preview, next), "无法检查导入冲突，请重新选择策略或备份后重试。");
  }
  const currentConflicts = conflicts?.preview === preview && conflicts?.mode === mode ? conflicts : null;
  const passwordsMatch = !encrypted || password === confirmation;
  const replaceKeys = mode === "replace" && Boolean(preview?.document.options.credentials);
  const canRestore = Boolean(preview && currentConflicts && confirmed && (!replaceKeys || keysConfirmed));

  return <main className="backup-workspace" aria-label="数据管理" aria-busy={busy}>
    <header className="backup-heading">
      <div><h1>数据管理</h1><p className="muted-text">Ayase 备份与恢复 · 所有处理均在本机完成，不上传备份。</p></div>
    </header>
    <div className="backup-content">
      <nav className="backup-navigation" aria-label="数据管理导航">
        <button type="button" className="settings-button" disabled={busy} onClick={() => { if (!operation.current) onExit(); }}>返回设置</button>
      </nav>
      <section className="settings-card backup-card" inert={recoveryLocked || undefined} aria-labelledby={`${modeName}-export`}>
        <h2 id={`${modeName}-export`}>导出 Ayase 备份</h2>
        <p className="muted-text">包含助手、对话、消息、保存的附件、头像快照与背景原图、应用偏好、Exa API 与 Exa MCP 搜索设置、连接配置和 API Key。不包含运行时草稿、缓存或派生背景缩略图。新版备份需使用支持版本 3 的 Ayase 恢复。</p>
        <div className="backup-encryption">
          <span id={`${modeName}-encryption`}>加密备份</span>
          <button type="button" role="switch" aria-labelledby={`${modeName}-encryption`} aria-checked={encrypted} className="backup-switch" disabled={busy} onClick={() => {
            if (operation.current) return;
            setEncrypted(!encrypted); setPassword(""); setConfirmation("");
          }}><span aria-hidden="true" /></button>
        </div>
        {encrypted && <div className="backup-passwords">
          <label>备份密码<input type="password" autoComplete="off" disabled={busy} value={password} onChange={(event) => { if (!operation.current) setPassword(event.currentTarget.value); }} /></label>
          <label>确认备份密码<input type="password" autoComplete="off" disabled={busy} value={confirmation} onChange={(event) => { if (!operation.current) setConfirmation(event.currentTarget.value); }} /></label>
          <p className="muted-text">密码不限长度和字符，两次输入须一致。恢复时使用相同密码。</p>
        </div>}
        {!encrypted && <p className="backup-warning">此备份将以明文保存 API Key，能读取文件的人也能读取密钥。请妥善保管文件。</p>}
        <button type="button" className="settings-button settings-button-primary" disabled={busy || !passwordsMatch} onClick={() => {
          if (!passwordsMatch) return;
          void run(async () => {
            setExportResult(null);
            const saved = await api.exportBackup({ encrypted }, password, confirmation);
            if (mounted.current) { setExportResult(saved); setPassword(""); setConfirmation(""); }
          }, "备份导出失败，请检查本地资源和保存位置后重试。");
        }}>导出备份</button>
        {exportResult && <section aria-label="导出结果"><p role="status">{exportResult.saved ? "备份已保存。" : "已取消保存，未保存备份文件。"}</p><PreviewSummary preview={exportResult.preview} /></section>}
      </section>
      <section className="settings-card backup-card" inert={recoveryLocked || undefined} aria-labelledby={`${modeName}-import`}>
        <h2 id={`${modeName}-import`}>恢复 Ayase 备份</h2>
        <p className="muted-text">先选择本地备份并校验，再查看预览与冲突。确认导入之前不会写入当前数据。</p>
        <button type="button" className="settings-button" disabled={busy} onClick={chooseFile}>{preview || serialized ? "更换备份文件" : "选择备份文件"}</button>
        {serialized !== null && <div className="backup-passwords">
          <label>解密密码<input type="password" autoComplete="off" disabled={busy} value={importPassword} onChange={(event) => { if (!operation.current) setImportPassword(event.currentTarget.value); }} /></label>
          <p className="muted-text">此备份已加密。忘记密码无法恢复。</p>
          <button type="button" className="settings-button" disabled={busy} onClick={() => {
            void run(() => inspect(serialized, importPassword), "密码错误，或备份已损坏／被篡改。请检查后重试。");
          }}>解密并校验</button>
        </div>}
        {preview && <section className="backup-preview" aria-label="已校验的备份预览">
          <h3>备份预览</h3><PreviewSummary preview={preview} />
          {preview.document.options.credentials && !preview.encrypted && <p className="backup-warning">此备份包含明文 API Key，请妥善保管文件。</p>}
          <fieldset disabled={busy} className="backup-strategies"><legend>导入策略</legend>
            {(Object.keys(strategies) as RestoreMode[]).map((strategy) => <label key={strategy}>
              <input type="radio" name={modeName} checked={mode === strategy} onChange={() => changeMode(strategy)} />
              <span><strong>{strategies[strategy].label}</strong><small>{strategies[strategy].description}</small></span>
            </label>)}
          </fieldset>
          {!preview.document.options.connections && <p className="backup-warning">此备份不包含连接：保留当前连接配置，但导入聊天中的模型引用会取消选择，需重新选择模型。</p>}
          {mode === "replace" && <p className="backup-warning">替换会覆盖当前支持范围内的数据，无法通过此页面撤销。建议先导出当前数据。</p>}
          {currentConflicts && <div aria-label="冲突检查"><p>检测到 {currentConflicts.conflicts} 个冲突，按所选策略处理。</p>
            {currentConflicts.warnings.length > 0 && <ul>{currentConflicts.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
          </div>}
          <label className="backup-check"><input type="checkbox" checked={confirmed} disabled={busy || !currentConflicts} onChange={(event) => { if (!operation.current) setConfirmed(event.currentTarget.checked); }} />我已确认导入策略{mode === "replace" ? "，同意替换当前数据" : ""}</label>
          {replaceKeys && <label className="backup-check"><input type="checkbox" checked={keysConfirmed} disabled={busy || !currentConflicts} onChange={(event) => { if (!operation.current) setKeysConfirmed(event.currentTarget.checked); }} />我同意覆盖当前连接配置和 API Key（含 Exa API / MCP 搜索 Key）</label>}
          <button type="button" className={`settings-button ${mode === "replace" ? "settings-button-danger" : "settings-button-primary"}`} disabled={busy || !canRestore} onClick={() => {
            if (!canRestore) return;
            void run(async () => {
              const warnings = await api.restore(preview, mode);
              if (mounted.current) {
                setPreview(null); setConflicts(null); setSerialized(null); setImportPassword("");
                setConfirmed(false); setKeysConfirmed(false); setResult(warnings); setRestoredPreview(preview);
              }
            }, "恢复失败。请检查备份和本地资源后重试。");
          }}>确认导入</button>
        </section>}
        {result !== null && <section aria-label="恢复结果"><p role="status">数据恢复成功。返回设置后将刷新并加载恢复的数据。</p>
          {restoredPreview && <PreviewSummary preview={restoredPreview} />}
          {result.length > 0 && <ul aria-label="恢复提示">{result.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
        </section>}
      </section>
      {busy && <p className="muted-text" role="status">正在处理，请稍候…</p>}
    </div>
    {error && <p className="backup-error" role="alert">{error}</p>}
  </main>;
}
