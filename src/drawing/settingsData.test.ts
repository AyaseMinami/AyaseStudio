import { describe, expect, it } from "vitest";
import { DataContractError } from "../storage/dataContract";
import { readDrawingPromptPresetData, readDrawingSettingsData, projectDrawingSettings } from "./settingsData";
import { initialDrawingDraft } from "./types";
import { readDrawingDraftData } from "./settingsData";
import { validateOpenAIImagesParameters } from "./openaiImages";

const defaults = { aspectRatio: "auto", resolution: "auto", modelId: null, openai: { size: "auto", quality: "auto" },
  count: 1, concurrency: 1, completionSound: true };
const preset = { id: "preset", name: "Landscape", content: "  mountains\n\nclouds  ",
  createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T01:00:00.000Z" };

describe("drawing settings data boundary", () => {
  it("clones and projects Gemini controls with exact finite defaults and no private nested fields", () => {
    const gemini = { temperature: 0, safetyThreshold: "BLOCK_NONE" as const, outputMode: "image" as const };
    const draft = { ...initialDrawingDraft, gemini: { ...gemini, apiKey: "synthetic" } };
    const projected = projectDrawingSettings(draft);
    expect(projected).toEqual({ ...defaults, gemini });
    expect(readDrawingSettingsData(readDrawingSettingsData(projected))).toEqual(projected);
    projected.gemini!.temperature = 2;
    expect(draft.gemini.temperature).toBe(0);
    expect(readDrawingDraftData({ ...initialDrawingDraft, gemini }).gemini).toEqual(gemini);
    expect(readDrawingSettingsData({ gemini: {} }).gemini).toEqual({});
  });
  it.each([null, [], { temperature: NaN }, { temperature: Infinity }, { temperature: -0.1 }, { temperature: 2.1 },
    { temperature: "1" }, { temperature: undefined }, { safetyThreshold: "UNKNOWN" }, { outputMode: "TEXT" },
    { apiKey: "synthetic" }, { futureSafety: true }])("rejects invalid Gemini options %j without changing source", gemini => {
    const raw = { gemini }, before = structuredClone(raw);
    expect(() => readDrawingSettingsData(raw)).toThrow(DataContractError);
    expect(raw).toEqual(before);
  });
  it("normalizes missing historical preferences without mutating source records", () => {
    const old = { aspectRatio: "auto", resolution: "auto", modelId: null };
    const before = structuredClone(old);
    expect(readDrawingSettingsData(old)).toEqual(defaults);
    expect(old).toEqual(before);
    expect(readDrawingSettingsData({})).toEqual(defaults);
    expect(projectDrawingSettings(initialDrawingDraft)).toEqual(defaults);
    expect(projectDrawingSettings()).toEqual(defaults);
    expect(readDrawingSettingsData({ openai: {} })).toEqual(defaults);
  });

  it.each(["gemini-image", "openai-images"] as const)("retains current %s preferences and repeated reads", reusedProtocol => {
    const current = { aspectRatio: "16:9", resolution: "512", modelId: "model", openai: { size: "3072x1024", quality: "max" },
      count: 99, concurrency: 4, completionSound: false, reusedProtocol };
    const result = readDrawingSettingsData(current);
    expect(result).toEqual(current);
    expect(readDrawingSettingsData(result)).toEqual(current);
    result.openai.size = "auto";
    expect(current.openai.size).toBe("3072x1024");
  });

  it("projects declared settings and nested fields without leaking arbitrary stored data", () => {
    const draft = { ...initialDrawingDraft, prompt: "private prompt", references: [], apiKey: "synthetic", file: "private-path",
      openai: { size: "3840x2160", quality: "xhigh", apiKey: "synthetic", unknown: "future" }, count: undefined };
    expect(projectDrawingSettings(draft)).toEqual({ ...defaults, openai: { size: "3840x2160", quality: "xhigh" } });
    expect(draft.openai).toHaveProperty("apiKey");
  });

  it.each(["", "2048x", "4096x4096", "1025x1024", "800x800", "3840x2176", "1024X1024", "x".repeat(101), "x".repeat(20000)])("preserves editable OpenAI size text for transport validation (case %#)", size => {
    const raw = { openai: { size, quality: "auto" } };
    expect(readDrawingSettingsData(raw).openai.size).toBe(size);
    expect(projectDrawingSettings({ ...initialDrawingDraft, ...raw }).openai.size).toBe(size);
    expect(readDrawingDraftData({ ...initialDrawingDraft, ...raw }).openai!.size).toBe(size);
    expect(() => validateOpenAIImagesParameters({ protocol: "openai-images", prompt: "synthetic", baseUrl: "https://synthetic.invalid",
      modelId: "synthetic-image", modelName: "synthetic-image", configuredModelId: "m", providerId: "p", connectionId: "c", size, quality: "auto" })).toThrow();
  });

  it.each([null, [], "settings", { aspectRatio: "5:7" }, { resolution: "8K" }, { modelId: "" }, { modelId: 1 },
    { modelId: "constructor" }, { modelId: "x".repeat(513) }, { modelId: undefined }, { count: 0 }, { count: 100 },
    { count: 1.5 }, { count: NaN }, { concurrency: 0 }, { concurrency: 5 }, { concurrency: Infinity }, { completionSound: "true" },
    { reusedProtocol: "openai-chat" }, { openai: null }, { openai: [] }, { openai: { size: 1024 } },
    { openai: { quality: "ultra" } }, { openai: { apiKey: "synthetic" } },
    { prompt: "private" }, { references: [] }, { apiKey: "synthetic" }, { future: true }, { version: 2 },
    JSON.parse('{"__proto__": {"size": "auto"}}')])("rejects unsupported settings structure %j", raw => {
    const before = structuredClone(raw);
    expect(() => readDrawingSettingsData(raw)).toThrow(DataContractError);
    expect(raw).toEqual(before);
  });
});

describe("local full drawing draft boundary", () => {
  const id = "12345678-1234-4123-8123-123456789abc";
  const reference = { id, reference: `drawing/references/${id}.png`, mime: "image/png", size: 10, width: 1, height: 1, name: "sample.png" };
  it("clones excluded text and canonical reference descriptors while normalizing settings", () => {
    const raw = { ...initialDrawingDraft, prompt: "  private draft\n", references: [reference] };
    const result = readDrawingDraftData(raw);
    expect(result).toEqual({ ...raw, ...defaults });
    result.references![0].name = "changed";
    expect(raw.references[0].name).toBe("sample.png");
  });
  it.each([{}, { ...initialDrawingDraft, id: "other" }, { ...initialDrawingDraft, prompt: null },
    { ...initialDrawingDraft, future: true }, { ...initialDrawingDraft, apiKey: "synthetic" },
    { ...initialDrawingDraft, openai: { size: "auto", quality: "auto", apiKey: "synthetic" } },
    { ...initialDrawingDraft, references: null }, { ...initialDrawingDraft, references: [{ ...reference, future: true }] },
    { ...initialDrawingDraft, references: [{ ...reference, reference: "C:\\private.png" }] },
    { ...initialDrawingDraft, references: [{ ...reference, reference: `drawing/references/nested/${id}.png` }] },
    { ...initialDrawingDraft, references: [{ ...reference, mime: null }] },
    { ...initialDrawingDraft, references: [{ ...reference, size: NaN }] },
    { ...initialDrawingDraft, references: [{ ...reference, width: 0 }] },
    { ...initialDrawingDraft, references: [{ ...reference, digest: 42 }] }])("rejects invalid local data %j without source changes", raw => {
    const before = structuredClone(raw);
    expect(() => readDrawingDraftData(raw)).toThrow(DataContractError);
    expect(raw).toEqual(before);
  });
});

describe("drawing prompt preset data boundary", () => {
  it("preserves five-field text records, whitespace and source data", () => {
    const raw = { ...preset, name: "  Landscape  " };
    expect(readDrawingPromptPresetData(raw)).toEqual(raw);
    expect(readDrawingPromptPresetData(readDrawingPromptPresetData(raw))).toEqual(raw);
    expect(raw.content).toBe(preset.content);
  });

  it.each([null, [], {}, { ...preset, id: "" }, { ...preset, id: "prototype" }, { ...preset, id: "x".repeat(513) },
    { ...preset, name: " \n" }, { ...preset, content: " \n" }, { ...preset, createdAt: NaN }, { ...preset, createdAt: 1 },
    { ...preset, createdAt: "not-a-date" }, { ...preset, updatedAt: Infinity }, { ...preset, updatedAt: "not-a-date" },
    { ...preset, prompt: "private" }, { ...preset, references: [] }, { ...preset, modelId: "model" },
    { ...preset, apiKey: "synthetic" }, { ...preset, file: "private-path" }, { ...preset, parameters: {} }])(
    "rejects malformed or bound preset data %j without changing it", raw => {
      const before = structuredClone(raw);
      expect(() => readDrawingPromptPresetData(raw)).toThrow(DataContractError);
      expect(raw).toEqual(before);
    },
  );
});
