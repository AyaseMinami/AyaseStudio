import { createRoot } from "react-dom/client";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getIdentifier } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AyaseDatabase } from "../../src/storage/database";
import { BackupRepository } from "../../src/backup/repository";
import { allPreferenceKeys, createBackupDocument, type LocalSnapshot } from "../../src/backup/snapshot";
import { createBackupApi, nativeBackupFiles, recoverBackupAtStartup } from "../../src/backup/runtime";
import { decodeBackup, encodeBackup, sha256, check } from "../../src/backup/codec";
import type { BackupFiles, BackupPreview } from "../../src/backup/types";
import { defaultSessionConfig } from "../../src/chat/sessionConfig";
import { initialDrawingDraft } from "../../src/drawing/types";
import { APPEARANCE_STORAGE_KEY, readAppearancePreferences } from "../../src/appearance/appearance";
import { defaultSearchSettings, loadSearchConfiguration, SEARCH_SETTINGS_KEY } from "../../src/search/settings";
import { BackupWorkspace, type BackupWorkspaceApi } from "../../src/ui/settings/BackupWorkspace";
import { projectDrawingSettings, readDrawingPromptPresetData } from "../../src/drawing/settingsData";
import { compatibilityFixtures, fixtureNames, type FixtureName } from "./fixtures";
import "../../src/App.css";
import "./styles.css";

const identifier = "io.github.ayaseminami.ayasestudio.data105finish";
const helperKey = "data105.synthetic.expected";
const query = new URLSearchParams(location.search);
const phase = query.get("phase") ?? "browser";
const journal = query.get("journal") ?? "staging";
const native = isTauri();
let actualIdentifier = native ? "unverified" : "browser";
const reportName = phase === "seed" || phase === "recover" ? `${phase}-${journal}` : phase;
const root = createRoot(document.getElementById("root")!);
let providerCalls = 0;
let browserSelection: FixtureName | "last-export" = "last-export";
const localFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const address = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (native && (address.protocol === "ipc:" || address.protocol === "http:" && address.hostname === "ipc.localhost")) {
    return localFetch(input, init);
  }
  if (address.origin !== location.origin || !["/data105-report", "/data105-fixture"].includes(address.pathname)) {
    providerCalls++; throw new Error("Harness permits only its local report endpoint.");
  }
  return localFetch(input, init);
};
interface Expected { hash: string; reference: string; journal: "staging" | "applying" }
async function hash(snapshot: LocalSnapshot) {
  return sha256(new TextEncoder().encode(JSON.stringify(snapshot)));
}
async function report(details: Record<string, unknown>) {
  const response = await fetch("/data105-report", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ report: reportName, identifier: actualIdentifier, native, phase, journal, scope: "backup-only harness",
      generatedAt: new Date().toISOString(), providerCalls, ...details }) });
  check(response.ok, "Unable to save local evidence report.");
}
function expected(): Expected {
  const value: unknown = JSON.parse(localStorage.getItem(helperKey) ?? "null");
  check(value && typeof value === "object" && "hash" in value && "reference" in value && "journal" in value);
  const record = value as Expected;
  check(typeof record.hash === "string" && /^attachments\/[0-9a-f-]{36}\.txt$/.test(record.reference)
    && ["staging", "applying"].includes(record.journal), "Missing isolated seed evidence.");
  return record;
}
async function seedRows(repository: BackupRepository) {
  const db = repository.database;
  check(!await db.backupJournal.get("restore"), "An unfinished journal exists; run the matching recovery first.");
  const prior = localStorage.getItem(helperKey);
  if (prior) check(await hash(await repository.snapshot()) === expected().hash,
    "Existing isolated data differs from its synthetic seed. Preserve it before starting another seed.");
  else {
    for (const table of db.tables) check(await table.count() === 0, "Refusing to overwrite existing data.");
    check(allPreferenceKeys.every(key => localStorage.getItem(key) === null), "Refusing to overwrite existing preferences.");
  }
  await db.transaction("rw", [db.assistants, db.conversations, db.chats, db.workspace, db.drawingDrafts, db.drawingPromptPresets], async () => {
    await db.assistants.put({ id: "default", name: "#105 synthetic assistant", icon: "", sortOrder: 0,
      defaultModelId: null, defaultConfig: defaultSessionConfig() });
    await db.conversations.put({ id: "data105-conversation", assistantId: "default", title: "#105 synthetic conversation",
      createdAt: 1, updatedAt: 2, settings: { modelId: null, config: defaultSessionConfig() } });
    await db.chats.put({ id: "data105-conversation", updatedAt: 2,
      messages: [{ id: "data105-message", role: "user", content: "Synthetic recovery evidence only.", status: "complete" }] });
    await db.workspace.put({ id: "selection", activeAssistantId: "default", lastSelected: { default: "data105-conversation" } });
    await db.drawingDrafts.put({ ...initialDrawingDraft, prompt: "Synthetic private draft retained locally." });
    await db.drawingPromptPresets.put({ id: "data105-preset", name: "Synthetic preset", content: "Synthetic portable preset.",
      createdAt: "2026-10-02T00:00:00.000Z", updatedAt: "2026-10-02T00:00:01.000Z" });
  });
  localStorage.setItem(SEARCH_SETTINGS_KEY, JSON.stringify({ ...defaultSearchSettings(), baseUrl: "https://mcp.example.invalid/mcp", numResults: 8 }));
  localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({ themeMode: "dark", accentColor: "#7357c8" }));
}
function simulatedFiles(): BackupFiles {
  const values = new Map<string, string>();
  return {
    read: async reference => { check(values.has(reference), "Synthetic resource absent."); return values.get(reference)!; },
    assertAvailable: async references => { check(references.every(reference => !values.has(reference))); },
    write: async (reference, data) => { check(!values.has(reference)); values.set(reference, data); },
    remove: async references => { references.forEach(reference => values.delete(reference)); },
  };
}
async function roundTrip(repository: BackupRepository, files: BackupFiles): Promise<BackupPreview> {
  const before = await repository.snapshot();
  const document = await createBackupDocument(before, { connections: true, credentials: true }, files);
  const preview = await decodeBackup(await encodeBackup(document));
  check(preview.document.version === 5 && preview.document.searchSettings?.version === 2);
  const search = loadSearchConfiguration({ getItem: key => before.preferences[key] ?? null, setItem: () => {} });
  check(preview.document.searchSettings.exaMcp.numResults === search.exaMcp.numResults
    && preview.document.searchSettings.exaApi.baseUrl === search.exaApi.baseUrl);
  const appearance = readAppearancePreferences({ getItem: key => before.preferences[key] ?? null });
  check(JSON.stringify(JSON.parse(preview.document.preferences[APPEARANCE_STORAGE_KEY]!)) === JSON.stringify(appearance));
  check(JSON.stringify(preview.document.drawing?.settings) === JSON.stringify(projectDrawingSettings(before.drawing?.draft))
    && JSON.stringify(preview.document.drawing?.presets) === JSON.stringify((before.drawing?.presets ?? []).map(readDrawingPromptPresetData)));
  check(await hash(await repository.snapshot()) === await hash(before), "Export must not write normalized legacy preferences.");
  return preview;
}
function workspace(api: BackupWorkspaceApi, label: string) {
  root.render(<main><h1>#105 合成数据验收 · {label}</h1>
    <p>此页面只操作隔离标识／数据库中的合成数据。不要选择真实用户备份。原生模式可手动保存、打开本页导出的合成备份，依次检查合并／副本／替换、取消和加密密码。</p>
    <p>自动报告只验证初始化／恢复与编解码；实际文件窗口、人工结果和视觉检查需另行记录。修改代码后请重启端口 1505 的服务。</p>
    {!native && <label>模拟选择的备份 <select defaultValue="last-export" onChange={event => { browserSelection = event.target.value as FixtureName | "last-export"; }}>
      <option value="last-export">最近导出的备份</option>{fixtureNames.map(name => <option key={name} value={name}>{name}</option>)}
    </select></label>}
    <BackupWorkspace api={api} onExit={() => { root.render(<main><h1>合成数据验收已退出</h1><p>关闭测试窗口即可；普通 App 未挂载。</p></main>); }} />
  </main>);
}
async function main() {
  check(location.hostname === "127.0.0.1" && location.port === "1505", "Use the dedicated localhost entry.");
  check(["seed", "recover", "manual", "browser"].includes(phase) && ["staging", "applying"].includes(journal));
  check(native ? phase !== "browser" : phase === "browser", "Native seed/recovery cannot run in a browser.");
  if (native) {
    actualIdentifier = await getIdentifier();
    check(actualIdentifier === identifier, "Refusing the ordinary application identifier.");
    await invoke("ayase_backup_fence");
  }
  // Open only after the native identifier check. Production recovery intentionally uses this fixed name.
  const database = new AyaseDatabase(native ? "AyaseStudio" : "Data105-browser");
  await database.open();
  const repository = new BackupRepository(database);
  if (phase === "seed") {
    await seedRows(repository);
    const before = await repository.snapshot(), beforeHash = await hash(before);
    const reference = `attachments/${crypto.randomUUID()}.txt`;
    await nativeBackupFiles.assertAvailable([reference]);
    await database.backupJournal.add({ id: "restore", before, references: [reference], phase: journal as Expected["journal"] });
    localStorage.setItem(helperKey, JSON.stringify({ hash: beforeHash, reference, journal: journal as Expected["journal"] } satisfies Expected));
    await nativeBackupFiles.write(reference, btoa("Synthetic pending restore resource."));
    if (journal === "applying") {
      await database.assistants.update("default", { name: "Synthetic interrupted replacement" });
      localStorage.setItem(SEARCH_SETTINGS_KEY, JSON.stringify({ ...defaultSearchSettings(), numResults: 1 }));
      localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({ themeMode: "light", accentColor: "#a34242" }));
    }
    check(await nativeBackupFiles.read(reference) === btoa("Synthetic pending restore resource."));
    await report({ status: "seeded", beforeHash, reference, journalPresent: true });
    await getCurrentWindow().close();
    return;
  }
  if (phase === "recover") {
    const evidence = expected();
    check(evidence.journal === journal, "Use the recovery config matching the seeded journal phase.");
    check(await recoverBackupAtStartup(), "Expected interrupted restore journal.");
    const recoveredHash = await hash(await repository.snapshot());
    check(recoveredHash === evidence.hash, "Recovery differs from the captured BEFORE snapshot.");
    let fileRemoved = false;
    try { await nativeBackupFiles.read(evidence.reference); } catch { fileRemoved = true; }
    check(fileRemoved && !await database.backupJournal.get("restore"));
    check(!await recoverBackupAtStartup(), "Repeated recovery must be a no-op.");
    const preview = await roundTrip(repository, nativeBackupFiles);
    await compatibilityFixtures(preview.document);
    await report({ status: "passed", beforeHash: evidence.hash, recoveredHash, fileRemoved, journalAbsent: true,
      repeatedRecovery: false, backupVersion: preview.document.version, legacyDefaultsPreserved: true,
      oldVersionsDecoded: [1, 3], futureWarningsReexported: true });
    root.render(<main><h1>#105 {journal} 恢复通过</h1><p>报告已保存。程序化退出与恢复并不证明 OS 文件窗口／实际断电接受项。</p></main>);
    if (query.get("autoclose") === "1") await getCurrentWindow().close();
    return;
  }
  if (native) await recoverBackupAtStartup();
  if (!localStorage.getItem(helperKey)) await seedRows(repository);
  const beforeHash = await hash(await repository.snapshot());
  // Browser/manual retain altered synthetic fixtures across reloads. Seed phases remain strict.
  if (!localStorage.getItem(helperKey)) localStorage.setItem(helperKey, JSON.stringify({ hash: beforeHash,
    reference: `attachments/${crypto.randomUUID()}.txt`, journal: "staging" } satisfies Expected));
  const files = native ? nativeBackupFiles : simulatedFiles();
  const preview = await roundTrip(repository, files);
  const fixtures = await compatibilityFixtures(preview.document);
  for (const fixture of fixtureNames) {
    const response = await fetch("/data105-fixture", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fixture, serialized: fixtures[fixture] }) });
    check(response.ok, "Unable to save synthetic compatibility fixture.");
  }
  const api = createBackupApi(repository, files);
  if (native) {
    await report({ status: "ready-for-manual", beforeHash, backupVersion: preview.document.version,
      fixtures: fixtureNames, oldVersionsDecoded: [1, 3], futureWarningsReexported: true, manualAcceptance: "pending" });
    workspace(api, "原生文件窗口待人工检查");
  } else {
    let serialized = await encodeBackup(preview.document);
    const browserApi: BackupWorkspaceApi = { ...api,
      exportBackup: async (options, password, confirmation) => {
        serialized = await encodeBackup(await createBackupDocument(await repository.snapshot(), { connections: true, credentials: true }, files), options.encrypted, password, confirmation);
        const exported = await decodeBackup(serialized, password);
        await report({ status: "browser-exported", backupVersion: exported.document.version, encrypted: exported.encrypted });
        return { saved: true, preview: exported };
      },
      selectBackup: async () => browserSelection === "last-export" ? serialized : fixtures[browserSelection],
      restore: async (selected, mode) => {
        const warnings = await api.restore(selected, mode);
        await report({ status: "browser-restored", mode, journalAbsent: !await database.backupJournal.get("restore"), warnings: warnings.length });
        return warnings;
      },
    };
    await report({ status: "ready", beforeHash, backupVersion: preview.document.version, legacyDefaultsPreserved: true,
      fixtures: fixtureNames, oldVersionsDecoded: [1, 3], futureWarningsReexported: true });
    workspace(browserApi, "浏览器模拟文件选择");
  }
}
root.render(<main><h1>#105 合成数据验收初始化</h1><p>检查隔离标识及存储…</p></main>);
void main().catch(async () => {
  // Do not copy exception contents, raw storage, credentials or arbitrary provider values into reports.
  root.render(<main><h1>验收入口已停止</h1><p>隔离／数据／恢复校验失败。原数据未自动重置；请检查专用配置和匹配的种子阶段。</p></main>);
  if (["seed-staging", "seed-applying", "recover-staging", "recover-applying", "browser", "manual"].includes(reportName)) {
    try { await report({ status: "failed", error: "Harness precondition or acceptance check failed." }); } catch { /* Leave the visible failure intact. */ }
  }
});
