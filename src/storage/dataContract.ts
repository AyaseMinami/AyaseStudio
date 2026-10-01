/** Pure data conversion. Callers commit only after the whole conversion succeeds. */
export class DataContractError extends Error {
  constructor(message: string) { super(message); this.name = "DataContractError"; }
}

export function dataCheck(value: unknown, message = "数据结构不受支持，请升级应用或修复数据后重试。"): asserts value {
  if (!value) throw new DataContractError(message);
}

export function dataRecord(value: unknown): asserts value is Record<string, unknown> {
  dataCheck(value !== null && typeof value === "object" && !Array.isArray(value));
  dataCheck(Object.keys(value).every(key => !["__proto__", "constructor", "prototype"].includes(key)));
}

export interface DataVersion {
  version: number;
  minimumReaderVersion: number;
  requiredCapabilities: string[];
}

export function assertReadableData(raw: unknown, current: number, capabilities: readonly string[] = []): asserts raw is DataVersion {
  dataRecord(raw);
  dataCheck(Object.keys(raw).every(key => ["version", "minimumReaderVersion", "requiredCapabilities"].includes(key)));
  dataCheck(Number.isSafeInteger(raw.version) && (raw.version as number) >= 1);
  dataCheck(Number.isSafeInteger(raw.minimumReaderVersion) && (raw.minimumReaderVersion as number) >= 1
    && (raw.minimumReaderVersion as number) <= (raw.version as number));
  dataCheck(Array.isArray(raw.requiredCapabilities) && raw.requiredCapabilities.length <= 100
    && raw.requiredCapabilities.every(value => typeof value === "string" && capabilities.includes(value))
    && new Set(raw.requiredCapabilities).size === raw.requiredCapabilities.length,
  "数据要求本程序不支持的能力，请升级应用。");
  dataCheck((raw.minimumReaderVersion as number) <= current, "数据版本无法兼容，请升级应用。");
}

export interface DataMigration {
  version: number;
  oldestVersion: number;
  migrations: Readonly<Record<number, (value: Record<string, unknown>) => Record<string, unknown>>>;
}

/** Every step operates on a private copy; skipped versions and duplicate reads are safe. */
export function migrateData(raw: unknown, contract: DataMigration): Record<string, unknown> {
  dataRecord(raw);
  dataCheck(Number.isSafeInteger(raw.version) && (raw.version as number) >= contract.oldestVersion
    && (raw.version as number) <= contract.version, "数据版本不受支持，请升级应用。");
  let value = structuredClone(raw);
  while ((value.version as number) < contract.version) {
    const version = value.version as number, convert = contract.migrations[version];
    dataCheck(convert, "缺少数据迁移规则；原数据未被修改。");
    value = convert(value);
    dataRecord(value);
    dataCheck(value.version === version + 1, "数据迁移未完成；原数据未被修改。");
  }
  return value;
}

export type FieldDisposition = "backup" | "credential" | "resource" | "exclude" | "legacy";
type UnionKeys<T> = T extends unknown ? keyof T : never;
export type FieldPolicy<T> = Record<Extract<UnionKeys<T>, string>, FieldDisposition>;

export function backupFields(policy: Record<string, FieldDisposition>, credentials = false): string[] {
  return Object.keys(policy).filter(key => ["backup", "resource"].includes(policy[key]) || credentials && policy[key] === "credential");
}

/** The caller must select a declared parameter object, never a credential/reference/record boundary. */
export function filterOptionalParameters(raw: unknown, allowed: readonly string[], path: string, filtered: string[]): Record<string, unknown> {
  dataRecord(raw);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (allowed.includes(key)) result[key] = value;
    else {
      // Do not turn security fields or arbitrary property names into permissive extensions or UI text.
      dataCheck(/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)
        && !/(key|token|secret|password|credential|auth|header|path|reference|resource|url|protocol|model|version|capabilit|connection|provider|endpoint|attachment|file|image|source|target|script|tool|id$)/i.test(key),
      "参数区包含不支持的安全或结构字段，请升级应用。");
      filtered.push(`${path}.${key}`);
    }
  }
  return result;
}
