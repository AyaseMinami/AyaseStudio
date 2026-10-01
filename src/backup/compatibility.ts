import { assertReadableData, backupFields, dataCheck, dataRecord, filterOptionalParameters } from "../storage/dataContract";
import { dataModules, backupModuleIds, currentModuleVersions } from "../storage/dataRegistry";
import { dataPolicies } from "../storage/dataPolicies";
import { readSessionConfigData } from "../chat/sessionConfig";
import type { BackupCompatibility } from "./types";
import { readDrawingSettingsData } from "../drawing/settingsData";

export function validateFilteredParameters(raw: unknown): asserts raw is string[] {
  dataCheck(Array.isArray(raw) && raw.length <= 1000 && raw.every(path => typeof path === "string" && path.length <= 512
    && (/^rows\.(assistants|conversations|legacyConversationConfigs)\[\d+\]\.[A-Za-z][A-Za-z0-9_.]*$/.test(path)
      || /^drawing\.settings\.[A-Za-z][A-Za-z0-9_.]*$/.test(path))),
  "参数兼容报告无效或超过预算。");
}

export function validateBackupCompatibility(raw: unknown, version = 4, drawing?: { settings?: unknown; presets?: unknown }): asserts raw is BackupCompatibility {
  dataRecord(raw);
  dataCheck(Object.keys(raw).every(key => ["minimumReaderVersion", "requiredCapabilities", "modules", "filteredParameters"].includes(key)));
  dataCheck(raw.minimumReaderVersion === version, "此备份需要更新版本的应用。");
  dataCheck(Array.isArray(raw.requiredCapabilities) && raw.requiredCapabilities.length === 0, "此备份要求不支持的必需能力，请升级应用。");
  dataRecord(raw.modules);
  const modules = raw.modules;
  const expected = Object.keys(currentModuleVersions(version === 5 ? drawing : undefined));
  dataCheck(Object.keys(modules).length === expected.length && expected.every(id => id in modules),
    "备份包含不支持的模块结构，请升级应用。");
  for (const id of backupModuleIds) assertReadableData(raw.modules[id], dataModules[id].version, dataModules[id].capabilities);
  for (const id of ["drawingSettings", "drawingPresets"] as const) if (expected.includes(id)) assertReadableData(modules[id], dataModules[id].version, dataModules[id].capabilities);
  if (raw.filteredParameters !== undefined) {
    validateFilteredParameters(raw.filteredParameters);
    dataCheck(version === 5 || raw.filteredParameters.every(path => path.startsWith("rows.")), "旧备份包含不支持的兼容报告结构，请升级应用。");
  }
}

/** Budget checking precedes this conversion. The raw input is never changed or written back to its file. */
export function normalizeCompatibleParameters(raw: unknown): void {
  dataRecord(raw);
  if (raw.version !== 4 && raw.version !== 5) return;
  if (raw.drawing !== undefined) dataRecord(raw.drawing);
  validateBackupCompatibility(raw.compatibility, raw.version as number, raw.drawing as { settings?: unknown; presets?: unknown } | undefined);
  const compatibility = raw.compatibility;
  dataRecord(raw.rows);
  const filtered = [...(compatibility.filteredParameters ?? [])];
  const sessionVersion = compatibility.modules.session;
  const forward = sessionVersion.version > dataModules.session.version;
  function session(value: unknown, path: string): unknown {
    dataCheck(value !== undefined, "备份缺少必需会话配置，无法恢复。");
    if (!forward) return readSessionConfigData(value);
    dataRecord(value);
    dataCheck(value.version === sessionVersion.version || value.version === dataModules.session.version,
      "会话参数版本与模块声明不一致，请升级应用。");
    const next = filterOptionalParameters(value, backupFields(dataPolicies.session), path, filtered);
    for (const key of ["temperature", "topP", "topK", "contextBudget", "maxOutput"]) {
      next[key] = filterOptionalParameters(next[key], backupFields(dataPolicies.numeric), `${path}.${key}`, filtered);
    }
    if (next.geminiThinking !== undefined) next.geminiThinking = filterOptionalParameters(next.geminiThinking,
      backupFields(dataPolicies.geminiThinking), `${path}.geminiThinking`, filtered);
    if (next.thinking !== undefined) {
      dataRecord(next.thinking);
      // Protocol-map keys are structure, never optional parameters.
      dataCheck(Object.keys(next.thinking).every(key => ["openai-chat", "openai-responses", "anthropic-native"].includes(key)),
        "不支持此思考协议，请升级应用。");
      for (const protocol of Object.keys(next.thinking)) next.thinking[protocol] = filterOptionalParameters(next.thinking[protocol],
        backupFields(dataPolicies.thinking), `${path}.thinking.${protocol.replace(/-/g, "_")}`, filtered);
    }
    next.version = dataModules.session.version;
    return readSessionConfigData(next);
  }
  for (const table of ["assistants", "conversations", "legacyConversationConfigs"]) {
    const rows = raw.rows[table];
    dataCheck(Array.isArray(rows) && rows.length <= 100000);
    rows.forEach((row, index) => {
      dataRecord(row);
      const path = `rows.${table}[${index}]`;
      if (table === "assistants") row.defaultConfig = session(row.defaultConfig, `${path}.defaultConfig`);
      if (table === "legacyConversationConfigs" && row.generationConfig !== undefined)
        row.generationConfig = session(row.generationConfig, `${path}.generationConfig`);
      if (table === "conversations") for (const key of ["settings", "creationConfig"]) {
        if (row[key] !== undefined) { dataRecord(row[key]); row[key].config = session(row[key].config, `${path}.${key}.config`); }
      }
    });
  }
  if (filtered.length) {
    compatibility.filteredParameters = [...new Set(filtered)];
    validateFilteredParameters(compatibility.filteredParameters);
  }
  if (raw.version === 5 && raw.drawing !== undefined) {
    dataRecord(raw.drawing);
    if (raw.drawing.settings !== undefined) {
      const stamp = compatibility.modules.drawingSettings;
      let settings: unknown = raw.drawing.settings;
      dataRecord(settings);
      dataCheck(stamp.version !== 1 || !("gemini" in settings), "Gemini 高级参数与绘图模块版本不匹配，请升级应用。");
      if (stamp.version > dataModules.drawingSettings.version) {
        dataRecord(settings);
        dataCheck(!Object.keys(settings).some(key => dataPolicies.drawingDraft[key as keyof typeof dataPolicies.drawingDraft] === "exclude"),
          "绘图设置包含不支持的草稿、身份或图片字段，请升级应用。");
        const refuseUnknownSafety = (value: unknown, allowed: readonly string[]) => {
          dataRecord(value);
          dataCheck(Object.keys(value).every(key => allowed.includes(key) || !/(safety|threshold|modalit|output|response|mode)/i.test(key)),
            "绘图参数包含不支持的安全或输出结构，请升级应用。");
        };
        refuseUnknownSafety(settings, backupFields(dataPolicies.drawingDraft));
        const next = filterOptionalParameters(settings, backupFields(dataPolicies.drawingDraft), "drawing.settings", filtered);
        if (next.openai !== undefined) {
          refuseUnknownSafety(next.openai, backupFields(dataPolicies.drawingOpenai));
          next.openai = filterOptionalParameters(next.openai,
            backupFields(dataPolicies.drawingOpenai), "drawing.settings.openai", filtered);
        }
        if (next.gemini !== undefined) {
          refuseUnknownSafety(next.gemini, backupFields(dataPolicies.drawingGemini));
          next.gemini = filterOptionalParameters(next.gemini,
            backupFields(dataPolicies.drawingGemini), "drawing.settings.gemini", filtered);
        }
        settings = next;
      }
      raw.drawing.settings = readDrawingSettingsData(settings);
    }
  }
  if (filtered.length) {
    compatibility.filteredParameters = [...new Set(filtered)];
    validateFilteredParameters(compatibility.filteredParameters);
  }
  // A normalized export describes the data actually retained, not the future producer's schema.
  compatibility.modules = currentModuleVersions(raw.version === 5 ? raw.drawing as { settings?: unknown; presets?: unknown } : undefined);
}

export function compatibilityWarnings(compatibility?: BackupCompatibility): string[] {
  const paths = compatibility?.filteredParameters;
  if (!paths?.length) return [];
  return [`已过滤 ${paths.length} 项不支持的可选参数；不会发送这些参数。再次保存或导出可能丢失这些参数，请保留原始备份文件。`,
    ...paths.map(path => `过滤参数：${path}`)];
}
