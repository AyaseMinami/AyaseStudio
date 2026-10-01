import { AyaseDatabase } from "../storage/database";
import { readDrawingPromptPresetData } from "./settingsData";

export interface DrawingPromptPreset {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface DrawingPresetInput { name: string; content: string }
export interface DrawingPresetRepository {
  load(): Promise<DrawingPromptPreset[]>;
  create(input: DrawingPresetInput): Promise<DrawingPromptPreset>;
  update(id: string, input: DrawingPresetInput): Promise<DrawingPromptPreset>;
  remove(id: string): Promise<void>;
}

function validatedInput(input: DrawingPresetInput): DrawingPresetInput {
  if (typeof input.name !== "string" || !input.name.trim()) throw new Error("请输入预设名称。");
  if (typeof input.content !== "string" || !input.content.trim()) throw new Error("请输入提示词内容。");
  return { name: input.name.trim(), content: input.content };
}

export class DexieDrawingPresetRepository implements DrawingPresetRepository {
  constructor(private readonly database = new AyaseDatabase("AyaseStudio")) {}

  async load(): Promise<DrawingPromptPreset[]> {
    const presets = (await this.database.drawingPromptPresets.toArray()).map(readDrawingPromptPresetData);
    return presets.sort((a, b) => a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1
      : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }

  async create(input: DrawingPresetInput): Promise<DrawingPromptPreset> {
    const { name, content } = validatedInput(input), now = new Date().toISOString();
    const preset: DrawingPromptPreset = { id: crypto.randomUUID(), name, content, createdAt: now, updatedAt: now };
    await this.database.drawingPromptPresets.add(preset);
    return preset;
  }

  async update(id: string, input: DrawingPresetInput): Promise<DrawingPromptPreset> {
    const { name, content } = validatedInput(input), db = this.database;
    return db.transaction("rw", db.drawingPromptPresets, async () => {
      const previous = await db.drawingPromptPresets.get(id);
      if (!previous) throw new Error("绘图预设已不存在。");
      const preset: DrawingPromptPreset = {
        id: previous.id, name, content, createdAt: previous.createdAt, updatedAt: new Date().toISOString(),
      };
      await db.drawingPromptPresets.put(preset);
      return preset;
    });
  }

  async remove(id: string): Promise<void> { await this.database.drawingPromptPresets.delete(id); }
}
