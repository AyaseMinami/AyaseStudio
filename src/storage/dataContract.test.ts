import { describe, expect, it, vi } from "vitest";
import {
  assertReadableData, backupFields, dataRecord, DataContractError, migrateData,
  type DataMigration, type FieldPolicy,
} from "./dataContract";
import { dataPolicies } from "./dataPolicies";

function threeVersionContract(): DataMigration {
  return {
    version: 3, oldestVersion: 1,
    migrations: {
      1: value => {
        const { title, ...remaining } = value;
        return { ...remaining, version: 2, label: title };
      },
      2: value => {
        const { delayMs, ...remaining } = value;
        return { ...remaining, version: 3, delaySeconds: Number(delayMs) / 1000 };
      },
    },
  };
}

describe("pure data contract migration", () => {
  it("chains field renaming and unit conversion across skipped application versions", () => {
    const input = { version: 1, title: "Synthetic task", delayMs: 2500, metadata: { tags: ["retained"] } };
    const original = structuredClone(input);
    const output = migrateData(input, threeVersionContract());
    expect(output).toEqual({ version: 3, label: "Synthetic task", delaySeconds: 2.5, metadata: { tags: ["retained"] } });
    expect(output).not.toHaveProperty("title");
    expect(output).not.toHaveProperty("delayMs");
    expect(input).toEqual(original);
    expect(output.metadata).not.toBe(input.metadata);
    expect(migrateData(output, threeVersionContract())).toEqual(output);
  });

  it("does not rerun migrations for a current-version record and returns an isolated copy", () => {
    const convert = vi.fn(() => ({ version: 3 }));
    const input = { version: 3, metadata: { tags: ["original"] } };
    const output = migrateData(input, { version: 3, oldestVersion: 1, migrations: { 1: convert, 2: convert } });
    expect(convert).not.toHaveBeenCalled();
    expect(output).toEqual(input);
    expect(output).not.toBe(input);
    dataRecord(output.metadata);
    output.metadata.tags = ["changed"];
    expect(input.metadata.tags).toEqual(["original"]);
  });

  it("preserves input when a later callback mutates its private copy and fails", () => {
    const input = { version: 1, nested: { value: "original" } };
    const original = structuredClone(input);
    const contract: DataMigration = {
      version: 3, oldestVersion: 1,
      migrations: {
        1: value => ({ ...value, version: 2 }),
        2: value => {
          dataRecord(value.nested);
          value.nested.value = "private mutation";
          throw new Error("synthetic conversion failure");
        },
      },
    };
    expect(() => migrateData(input, contract)).toThrow("synthetic conversion failure");
    expect(input).toEqual(original);
  });

  it.each([1, 3, 4])("rejects a migration step returning version %s instead of the next version", version => {
    const input = { version: 1, nested: { value: "original" } };
    const original = structuredClone(input);
    expect(() => migrateData(input, {
      version: 3, oldestVersion: 1,
      migrations: { 1: value => { dataRecord(value.nested); value.nested.value = "changed"; return { ...value, version }; } },
    })).toThrow(DataContractError);
    expect(input).toEqual(original);
  });

  it("rejects a missing intermediate migration without modifying the original", () => {
    const input = { version: 1, title: "retained", delayMs: 1000 };
    const original = structuredClone(input);
    expect(() => migrateData(input, {
      version: 3, oldestVersion: 1, migrations: { 1: threeVersionContract().migrations[1] },
    })).toThrow("缺少数据迁移规则");
    expect(input).toEqual(original);
  });

  it.each([0, 4, 1.5, "1", undefined])("rejects unsupported input version %s before callbacks run", version => {
    const convert = vi.fn(() => ({ version: 2 }));
    const input = { version, content: "retained" };
    const original = structuredClone(input);
    expect(() => migrateData(input, { version: 3, oldestVersion: 1, migrations: { 1: convert } })).toThrow(DataContractError);
    expect(convert).not.toHaveBeenCalled();
    expect(input).toEqual(original);
  });
});

describe("reader compatibility gates and explicit field dispositions", () => {
  it("allows a newer writer version when the minimum reader and required capabilities are supported", () => {
    const input = { version: 5, minimumReaderVersion: 2, requiredCapabilities: ["synthetic-resource"] };
    const original = structuredClone(input);
    expect(() => assertReadableData(input, 2, ["synthetic-resource"])).not.toThrow();
    expect(input).toEqual(original);
  });

  it.each([
    { version: 3, minimumReaderVersion: 3, requiredCapabilities: [] },
    { version: 3, minimumReaderVersion: 1, requiredCapabilities: ["unsupported"] },
    { version: 3, minimumReaderVersion: 1, requiredCapabilities: ["supported", "supported"] },
    { version: 1, minimumReaderVersion: 2, requiredCapabilities: [] },
  ])("rejects unreadable metadata without mutating it: %j", input => {
    const original = structuredClone(input);
    expect(() => assertReadableData(input, 2, ["supported"])).toThrow(DataContractError);
    expect(input).toEqual(original);
  });

  it("exports only explicitly declared backup/resource fields and opted-in credentials", () => {
    const policy = {
      text: "backup", resource: "resource", secret: "credential", runtime: "exclude", oldField: "legacy",
    } satisfies FieldPolicy<{ text: string; resource: string; secret: string; runtime: string; oldField?: string }>;
    expect(backupFields(policy)).toEqual(["text", "resource"]);
    expect(backupFields(policy, true)).toEqual(["text", "resource", "secret"]);
    expect(backupFields(dataPolicies.connection)).not.toContain("apiKey");
    expect(backupFields(dataPolicies.connection, true)).toContain("apiKey");
    expect(backupFields(dataPolicies.searchProfile)).not.toContain("apiKey");
    expect(backupFields(dataPolicies.searchProfile, true)).toContain("apiKey");
    expect(backupFields(dataPolicies.messages, true)).not.toContain("continuation");
    expect(backupFields(dataPolicies.chats, true)).not.toContain("generationConfig");
    expect(backupFields(dataPolicies.drawingDraft, true)).not.toContain("prompt");
    expect(backupFields(dataPolicies.drawingDraft, true)).not.toContain("references");
    expect(backupFields(dataPolicies.drawingTasks, true)).toEqual([]);
  });
});
