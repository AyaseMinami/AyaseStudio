import assert from "node:assert/strict";
import test from "node:test";
import { checkDataContracts, inspectDataContracts } from "./check-data-contracts.mjs";

function fixture() {
  return {
    "src/storage/database.ts": `db.version(1).stores({ chats: "id", drafts: "id", journal: "id" });`,
    "src/storage/dataRegistry.ts": `
      export const persistentTables = {
        chats: { backup: "included" }, drafts: { backup: "pending-93" }, journal: { backup: "excluded" }
      } as const satisfies Record<string, unknown>;
      export const persistentPreferences = { "ayase-studio.theme.v1": { backup: "included" } } as const;
    `,
    "src/backup/types.ts": `export const backupTables = ["chats"] as const;`,
    "src/settings.ts": `const KEY = "ayase-studio.theme.v1"; localStorage.getItem(KEY);`,
  };
}

test("covers active tables, storage keys and only included backup tables", () => {
  const result = inspectDataContracts(fixture());
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.tables, ["chats", "drafts", "journal"]);
  assert.deepEqual(result.preferences, ["ayase-studio.theme.v1"]);
  assert.deepEqual(result.backupTables, ["chats"]);
});

test("new database table requires a registration", () => {
  const sources = fixture();
  sources["src/storage/database.ts"] += `db.version(2).stores({ newTable: "id" });`;
  assert.deepEqual(checkDataContracts(sources), ["Unregistered table: newTable."]);
});

test("stale table registration fails and null dropped schemas are ignored", () => {
  const sources = fixture();
  sources["src/storage/database.ts"] += `db.version(2).stores({ drafts: null });`;
  assert.deepEqual(checkDataContracts(sources), ["Stale table registration: drafts."]);
  sources["src/storage/database.ts"] += `db.version(3).stores({ drafts: "id" });`;
  assert.deepEqual(checkDataContracts(sources), []);
});

test("new direct persistence key fails without exposing stored values", () => {
  const sources = fixture();
  sources["src/settings.ts"] += `localStorage.setItem("ayase-studio.new.v1", "private-secret-value");`;
  assert.deepEqual(checkDataContracts(sources), ["Unregistered preference key: ayase-studio.new.v1."]);
  assert.ok(!JSON.stringify(inspectDataContracts(sources)).includes("private-secret-value"));
});

test("traces imported keys and local helper parameter calls including legacy keys", () => {
  const sources = fixture();
  sources["src/keys.ts"] = `export const LEGACY_KEY = "ayase-studio.legacy.v1";`;
  sources["src/settings.ts"] += `
    import { LEGACY_KEY as previousKey } from "./keys";
    function parse(storage, key) { return storage.getItem(key); }
    function load(key) { return parse(localStorage, key); }
    load(previousKey);
  `;
  assert.deepEqual(checkDataContracts(sources), ["Unregistered preference key: ayase-studio.legacy.v1."]);
});

test("stale preference registration is not counted merely because it is in the registry", () => {
  const sources = fixture();
  sources["src/settings.ts"] = `const KEY = "ayase-studio.theme.v1";`;
  assert.deepEqual(checkDataContracts(sources), ["Stale preference key registration: ayase-studio.theme.v1."]);
});

test("format markers, library IDs, stored values and test-only keys are not preferences", () => {
  const sources = fixture();
  sources["src/settings.ts"] += `
    const format = "ayase-studio.format.v1";
    const libraryId = "ayase-studio.library.v1";
    localStorage.setItem(KEY, "ayase-studio.value.v1");
  `;
  sources["src/settings.test.ts"] = `localStorage.setItem("ayase-studio.test.v1", "test");`;
  sources["src/__tests__/fixture.ts"] = `localStorage.setItem("ayase-studio.fixture.v1", "test");`;
  assert.deepEqual(checkDataContracts(sources), []);
});

test("array iteration, spreads and bracket storage calls discover keys", () => {
  const sources = fixture();
  sources["src/settings.ts"] = `
    const KEY = "ayase-studio.theme.v1";
    const keys = [KEY, "ayase-studio.list.v1"] as const;
    const allKeys = [...keys];
    for (const key of allKeys) localStorage.removeItem(key);
    allKeys.map(key => localStorage["getItem"](key));
  `;
  assert.deepEqual(checkDataContracts(sources), ["Unregistered preference key: ayase-studio.list.v1."]);
});

test("imported preference inventories trace registry constants into dynamic storage calls", () => {
  const sources = fixture();
  sources["src/storage/dataRegistry.ts"] += `export const REPORT_KEY = "ayase-studio.report.v1";`;
  sources["src/inventory.ts"] = `
    import { REPORT_KEY } from "./storage/dataRegistry";
    export const preferenceKeys = ["ayase-studio.theme.v1"] as const;
    export const allPreferenceKeys = [...preferenceKeys, REPORT_KEY] as const;
  `;
  sources["src/settings.ts"] = `
    import { allPreferenceKeys } from "./inventory";
    allPreferenceKeys.map(key => storage.getItem(key));
    for (const key of allPreferenceKeys) storage.setItem(key, values[key]);
  `;
  assert.deepEqual(checkDataContracts(sources), ["Unregistered preference key: ayase-studio.report.v1."]);
});

test("registry-driven Object.keys inventories count keys actually read or written", () => {
  const sources = fixture();
  sources["src/inventory.ts"] = `
    import { persistentPreferences } from "./storage/dataRegistry";
    export const allPreferenceKeys = Object.keys(persistentPreferences);
  `;
  sources["src/settings.ts"] = `
    import { allPreferenceKeys } from "./inventory";
    for (const key of allPreferenceKeys) storage.getItem(key);
  `;
  assert.deepEqual(checkDataContracts(sources), []);
  sources["src/settings.ts"] = `import { allPreferenceKeys } from "./inventory";`;
  assert.deepEqual(checkDataContracts(sources), ["Stale preference key registration: ayase-studio.theme.v1."]);
});

test("excluded or pending tables must not silently enter backup list", () => {
  const sources = fixture();
  sources["src/backup/types.ts"] = `export const backupTables = ["chats", "drafts", "journal"] as const;`;
  assert.deepEqual(checkDataContracts(sources), ["Unregistered backup table: drafts.", "Unregistered backup table: journal."]);
});

test("included backup tables cannot silently leave backup list", () => {
  const sources = fixture();
  sources["src/backup/types.ts"] = `export const backupTables = [] as const;`;
  assert.deepEqual(checkDataContracts(sources), ["Stale backup table registration: chats."]);
});

test("projected tables require their own inventory and must not enter portable rows", () => {
  const sources = fixture();
  sources["src/storage/dataRegistry.ts"] = sources["src/storage/dataRegistry.ts"].replace('backup: "pending-93"', 'backup: "projected"');
  assert.ok(checkDataContracts(sources).includes("Stale projected backup table registration: drafts."));
  sources["src/backup/types.ts"] += `export const projectedBackupTables = ["drafts"] as const;`;
  assert.deepEqual(checkDataContracts(sources), []);
  sources["src/backup/types.ts"] = `export const backupTables = ["chats", "drafts"] as const; export const projectedBackupTables = ["drafts"] as const;`;
  assert.ok(checkDataContracts(sources).includes("Projected table must not be exported as raw rows: drafts."));
});

test("non-static contract shapes and duplicate backup entries fail closed", () => {
  const sources = fixture();
  sources["src/storage/database.ts"] += `db.version(2).stores(schema);`;
  sources["src/backup/types.ts"] = `export const backupTables = ["chats", "chats"] as const;`;
  assert.deepEqual(checkDataContracts(sources), [
    "Database stores schema must be a static object literal.", "backupTables contains a duplicate table: chats.",
  ]);
});

test("parse errors and missing contract sources are reported without source text", () => {
  const sources = fixture();
  sources["src/settings.ts"] = `const privateSecret = "never-print-this`;
  assert.ok(checkDataContracts(sources).includes("Cannot parse src/settings.ts."));
  assert.ok(!checkDataContracts(sources).join("\n").includes("never-print-this"));
  delete sources["src/storage/database.ts"];
  assert.ok(checkDataContracts(sources).includes("Missing contract source: src/storage/database.ts."));
});
