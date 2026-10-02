import { backupFields, dataCheck, dataRecord, migrateData } from "../storage/dataContract";
import { dataPolicies } from "../storage/dataPolicies";
import { drawingAspectRatios, drawingResolutions } from "./geminiImage";
import { openAIImageQualities } from "./openaiImages";
import type { DrawingPromptPreset } from "./presets";
import type { DrawingDraft, DrawingReference } from "./types";
import { validGeminiDrawingOptions } from "./geminiOptions";
import { validGrokDrawingOptions } from "./grokImages";
import { validSeedreamDrawingOptions } from "./seedreamImages";
import { isDrawingProtocol } from "../chat/protocolOptions";

export type DrawingSettingsData = Required<Pick<DrawingDraft,
  "aspectRatio" | "resolution" | "modelId" | "openai" | "count" | "concurrency" | "completionSound">>
  & Pick<DrawingDraft, "reusedProtocol" | "gemini" | "grok" | "seedream">;

function fields(raw: unknown, allowed: readonly string[]): asserts raw is Record<string, unknown> {
  dataRecord(raw);
  dataCheck(Object.keys(raw).every(key => allowed.includes(key)));
}

/** Drawing module v1 has no conversion steps; reads still use the shared private-copy seam. */
function cloneV1(raw: Record<string, unknown>): Record<string, unknown> {
  const copy = migrateData({ version: 1, value: raw }, { version: 1, oldestVersion: 1, migrations: {} });
  dataRecord(copy.value);
  return copy.value;
}

function identifier(raw: unknown): asserts raw is string {
  dataCheck(typeof raw === "string" && raw.length <= 512 && !!raw.trim()
    && !["__proto__", "prototype", "constructor"].includes(raw));
}

function integer(raw: unknown, maximum: number): asserts raw is number {
  dataCheck(typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 1 && raw <= maximum);
}

function option(raw: unknown, allowed: readonly string[]): asserts raw is string {
  dataCheck(typeof raw === "string" && allowed.includes(raw));
}

function openaiSize(raw: unknown): asserts raw is string {
  // Custom dimensions are editable text. Invalid intermediate input remains editable;
  // the generation transport owns capability and dimension validation.
  dataCheck(typeof raw === "string");
}

export function readDrawingSettingsData(raw: unknown): DrawingSettingsData {
  fields(raw, backupFields(dataPolicies.drawingDraft));
  const value = cloneV1(raw);
  const aspectRatio = "aspectRatio" in value ? value.aspectRatio : "auto";
  const resolution = "resolution" in value ? value.resolution : "auto";
  const modelId = "modelId" in value ? value.modelId : null;
  const count = "count" in value ? value.count : 1;
  const concurrency = "concurrency" in value ? value.concurrency : 1;
  const completionSound = "completionSound" in value ? value.completionSound : true;
  option(aspectRatio, drawingAspectRatios); option(resolution, drawingResolutions);
  if (modelId !== null) identifier(modelId);
  integer(count, 99); integer(concurrency, 4);
  dataCheck(typeof completionSound === "boolean");
  const openai = "openai" in value ? value.openai : {};
  fields(openai, backupFields(dataPolicies.drawingOpenai));
  const size = "size" in openai ? openai.size : "auto";
  const quality = "quality" in openai ? openai.quality : "auto";
  openaiSize(size); option(quality, openAIImageQualities);
  const result: DrawingSettingsData = { aspectRatio, resolution, modelId, openai: { size, quality }, count, concurrency, completionSound };
  if ("gemini" in value) {
    fields(value.gemini, backupFields(dataPolicies.drawingGemini));
    dataCheck(validGeminiDrawingOptions(value.gemini));
    result.gemini = value.gemini;
  }
  if ("reusedProtocol" in value) {
    dataCheck(isDrawingProtocol(value.reusedProtocol));
    result.reusedProtocol = value.reusedProtocol;
  }
  if ("grok" in value) {
    fields(value.grok, backupFields(dataPolicies.drawingGrok));
    dataCheck(validGrokDrawingOptions(value.grok)); result.grok = value.grok;
  }
  if ("seedream" in value) {
    fields(value.seedream, backupFields(dataPolicies.drawingSeedream));
    dataCheck(validSeedreamDrawingOptions(value.seedream)); result.seedream = value.seedream;
  }
  return result;
}

/** Only declared backup fields cross the settings boundary; prompts and files remain local. */
export function projectDrawingSettings(draft?: DrawingDraft): DrawingSettingsData {
  const projected: Record<string, unknown> = {};
  if (draft) {
    for (const key of backupFields(dataPolicies.drawingDraft)) {
      const value = draft[key as keyof DrawingDraft];
      if (value === undefined) continue;
      if (key === "openai") {
        dataRecord(value);
        const nested: Record<string, unknown> = {};
        for (const field of backupFields(dataPolicies.drawingOpenai)) {
          if (field in value) nested[field] = value[field as keyof NonNullable<DrawingDraft["openai"]>];
        }
        projected[key] = nested;
      } else if (key === "gemini") {
        dataRecord(value);
        const nested: Record<string, unknown> = {};
        for (const field of backupFields(dataPolicies.drawingGemini)) {
          if (field in value) nested[field] = (value as Record<string, unknown>)[field];
        }
        projected[key] = nested;
      } else if (key === "grok" || key === "seedream") {
        dataRecord(value);
        const nested: Record<string, unknown> = {};
        for (const field of backupFields(key === "grok" ? dataPolicies.drawingGrok : dataPolicies.drawingSeedream)) {
          if (field in value) nested[field] = (value as Record<string, unknown>)[field];
        }
        projected[key] = nested;
      } else projected[key] = value;
    }
  }
  return readDrawingSettingsData(projected);
}

export function readDrawingPromptPresetData(raw: unknown): DrawingPromptPreset {
  const allowed = backupFields(dataPolicies.drawingPresets);
  fields(raw, allowed);
  dataCheck(allowed.every(key => key in raw));
  const value = cloneV1(raw);
  identifier(value.id);
  dataCheck(typeof value.name === "string" && !!value.name.trim());
  dataCheck(typeof value.content === "string" && !!value.content.trim());
  dataCheck(typeof value.createdAt === "string" && value.createdAt.length <= 64 && Number.isFinite(Date.parse(value.createdAt)));
  dataCheck(typeof value.updatedAt === "string" && value.updatedAt.length <= 64 && Number.isFinite(Date.parse(value.updatedAt)));
  return { id: value.id, name: value.name, content: value.content, createdAt: value.createdAt, updatedAt: value.updatedAt };
}

function readReference(raw: unknown): DrawingReference {
  fields(raw, Object.keys(dataPolicies.drawingReference));
  const value = cloneV1(raw);
  // Preserve the existing controller ownership boundary. Native access remains
  // responsible for canonical paths; these local descriptors never enter backups.
  dataCheck(typeof value.reference === "string" && /^drawing\/[^/]+\/[^/]+$/.test(value.reference));
  dataCheck(typeof value.id === "string" && !!value.id);
  dataCheck(typeof value.mime === "string");
  for (const key of ["size", "width", "height"]) dataCheck(typeof value[key] === "number" && Number.isFinite(value[key]) && (value[key] as number) > 0);
  dataCheck(typeof value.name === "string");
  if ("digest" in value) dataCheck(typeof value.digest === "string");
  return value as unknown as DrawingReference;
}

/** Local reads validate excluded fields too, before the controller starts task recovery. */
export function readDrawingDraftData(raw: unknown): DrawingDraft {
  fields(raw, Object.keys(dataPolicies.drawingDraft));
  dataCheck(raw.id === "current" && typeof raw.prompt === "string");
  const value = cloneV1(raw);
  const settings: Record<string, unknown> = {};
  for (const key of backupFields(dataPolicies.drawingDraft)) if (key in value) settings[key] = value[key];
  const result: DrawingDraft = { id: "current", prompt: raw.prompt, ...readDrawingSettingsData(settings) };
  if ("references" in value) {
    dataCheck(Array.isArray(value.references));
    result.references = value.references.map(readReference);
  }
  return result;
}
