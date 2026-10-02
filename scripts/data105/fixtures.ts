import { check, decodeBackup, encodeBackup, sha256 } from "../../src/backup/codec";
import { compatibilityWarnings } from "../../src/backup/compatibility";
import type { BackupDocument } from "../../src/backup/types";
import { defaultSessionConfig } from "../../src/chat/sessionConfig";

export const fixtureNames = ["modern", "v1", "v3", "future-readable"] as const;
export type FixtureName = typeof fixtureNames[number];
async function rawEnvelope(document: BackupDocument) {
  const text = JSON.stringify(document);
  return JSON.stringify({ format: "ayase-studio-envelope", version: 1, encrypted: false,
    payload: JSON.stringify({ document: text, sha256: await sha256(new TextEncoder().encode(text)) }) });
}
export async function compatibilityFixtures(source: BackupDocument) {
  // Fixed synthetic content only; never use raw local preference texts or imported credentials.
  const modern = structuredClone(source);
  modern.options = { connections: false, credentials: false }; modern.connections = null;
  modern.assets = [];
  modern.preferences = { "ayase-studio.appearance.v1": null, "ayase-studio.chat-layout.v1": null, "ayase-studio.assistant-default-avatar": null };
  modern.rows = { assistants: [{ id: "default", name: "#105 synthetic assistant", icon: "", sortOrder: 0, defaultModelId: null, defaultConfig: defaultSessionConfig() }],
    conversations: [{ id: "data105-conversation", assistantId: "default", title: "#105 synthetic conversation", createdAt: 1, updatedAt: 2,
      settings: { modelId: null, config: defaultSessionConfig() } }],
    chats: [{ id: "data105-conversation", updatedAt: 2, messages: [{ id: "data105-message", role: "user", content: "Synthetic compatibility sample.", status: "complete" }] }],
    workspace: [{ id: "selection", activeAssistantId: "default", lastSelected: { default: "data105-conversation" } }],
    avatarLibrary: [], userAvatar: [], cherryImports: [], legacyConversationConfigs: [] };
  modern.searchSettings = { version: 2,
    exaMcp: { version: 1, baseUrl: "https://mcp.example.invalid/mcp", numResults: 8 },
    exaApi: { version: 1, baseUrl: "https://api.exa.ai/", numResults: 5 } };
  modern.drawing = { settings: { aspectRatio: "auto", resolution: "auto", modelId: null, openai: { size: "auto", quality: "auto" },
    count: 1, concurrency: 1, completionSound: true }, presets: [{ id: "data105-preset", name: "Synthetic preset", content: "Synthetic portable preset.",
      createdAt: "2026-10-02T00:00:00.000Z", updatedAt: "2026-10-02T00:00:01.000Z" }] };
  delete modern.compatibility!.filteredParameters;
  const v1 = structuredClone(modern); v1.version = 1;
  delete v1.compatibility; delete v1.drawing; delete v1.searchSettings;
  const v3 = structuredClone(modern); v3.version = 3;
  delete v3.compatibility; delete v3.drawing;
  const future = structuredClone(modern);
  future.compatibility!.modules.session = { version: 2, minimumReaderVersion: 1, requiredCapabilities: [] };
  const config = (future.rows.assistants[0] as { defaultConfig: Record<string, unknown> }).defaultConfig;
  config.version = 2; config.futureParameter = "synthetic-optional-value";
  const values: Record<FixtureName, string> = { modern: await encodeBackup(modern), v1: await rawEnvelope(v1), v3: await rawEnvelope(v3), "future-readable": await rawEnvelope(future) };
  for (const name of fixtureNames) {
    const original = values[name];
    const decoded = await decodeBackup(original);
    check(decoded.document.version === (name === "v1" ? 1 : name === "v3" ? 3 : 5));
    if (name === "future-readable") {
      const paths = decoded.document.compatibility!.filteredParameters;
      check(paths?.includes("rows.assistants[0].defaultConfig.futureParameter"));
      check(!compatibilityWarnings(decoded.document.compatibility).join(" ").includes("synthetic-optional-value"));
      const reexported = await decodeBackup(await encodeBackup(decoded.document));
      check(JSON.stringify(reexported.document.compatibility!.filteredParameters) === JSON.stringify(paths));
      check(values[name] === original && JSON.parse(JSON.parse(original).payload).document.includes("synthetic-optional-value"));
    }
  }
  return values;
}
