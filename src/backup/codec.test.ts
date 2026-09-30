import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { bytesToBase64 } from "../chat/attachments";
import { defaultSessionConfig } from "../chat/sessionConfig";
import { decodeBackup, encodeBackup, KDF_ITERATIONS, MAX_BACKUP_FILE, sha256 } from "./codec";
import type { BackupDocument } from "./types";

const password = "synthetic-backup-password";
const syntheticKey = "synthetic-api-key-do-not-use";
const reference = "attachments/00000000-0000-4000-8000-000000000001.txt";

function document(credentials = false): BackupDocument {
  return {
    format: "ayase-studio-backup", version: 1, createdAt: "2026-09-30T00:00:00.000Z",
    options: { connections: credentials, credentials },
    rows: {
      assistants: [{ id: "assistant", name: "Synthetic", icon: "", sortOrder: 0, defaultModelId: null, defaultConfig: defaultSessionConfig() }],
      conversations: [{ id: "conversation", assistantId: "assistant", title: "Synthetic", titleNaming: "manual", createdAt: 1, updatedAt: 1,
        settings: { modelId: null, config: defaultSessionConfig() } }],
      chats: [{ id: "conversation", updatedAt: 1, messages: [{ id: "user", role: "user", content: "synthetic", status: "complete" },
        { id: "answer", role: "assistant", replyToId: "user", content: "answer", status: "incomplete" }] }],
      workspace: [{ id: "selection", activeAssistantId: "assistant", lastSelected: { assistant: "conversation" } }],
      avatarLibrary: [], userAvatar: [], cherryImports: [], legacyConversationConfigs: [],
    },
    preferences: { "ayase-studio.appearance.v1": null, "ayase-studio.chat-layout.v1": null, "ayase-studio.assistant-default-avatar": null },
    connections: credentials ? { version: 3, activeModelId: "model", providers: [{ id: "provider", name: "Synthetic", connections: [
      { id: "connection", name: "Synthetic", protocol: "openai-chat", baseUrl: "https://synthetic.invalid/v1", apiKey: syntheticKey,
        models: [{ id: "model", modelId: "synthetic-model" }] },
    ] }] } : null,
    assets: [],
  };
}

// Recompute the outer checksum so malformed documents reach the semantic validator.
async function plainEnvelope(value: unknown) {
  const serialized = JSON.stringify(value);
  return JSON.stringify({ format: "ayase-studio-envelope", version: 1, encrypted: false,
    payload: JSON.stringify({ document: serialized, sha256: await sha256(new TextEncoder().encode(serialized)) }) });
}

function changeByte(base64: string) {
  const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  bytes[0] ^= 1;
  return bytesToBase64(bytes);
}

afterEach(() => vi.restoreAllMocks());

describe("backup envelope", () => {
  let encrypted: string;
  beforeAll(async () => { encrypted = await encodeBackup(document(true), true, password, password); });

  it("round trips plain synthetic data with explicit counts and no credential field", async () => {
    const original = document();
    const output = await encodeBackup(original);
    expect(JSON.parse(output)).toMatchObject({ format: "ayase-studio-envelope", version: 1, encrypted: false });
    expect(output).not.toContain("apiKey");
    expect(await decodeBackup(output)).toEqual({ document: original, encrypted: false,
      counts: { assistants: 1, conversations: 1, messages: 2, avatars: 0, files: 0, connections: 0 } });
  });

  it("round trips Cherry import markers whose source path contains many message IDs", async () => {
    const original = document();
    const messageIds = Array.from({ length: 24 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
    const sourceKey = `cherry:${JSON.stringify(["source-topic", messageIds])}`;
    const markerId = JSON.stringify(["conversation", sourceKey]);
    expect(markerId.length).toBeGreaterThan(512);
    original.rows.cherryImports = [{ id: markerId, conversationIds: ["conversation"] }];

    const exported = await encodeBackup(original);
    expect((await decodeBackup(exported)).document.rows.cherryImports).toEqual(original.rows.cherryImports);
  });

  it("uses PBKDF2 SHA256/600000 and AES256-GCM with a 128-bit tag", async () => {
    const derive = vi.spyOn(crypto.subtle, "deriveKey");
    const encrypt = vi.spyOn(crypto.subtle, "encrypt");
    const exported = await encodeBackup(document(true), true, password, password);
    const envelope = JSON.parse(exported);
    expect(envelope).toMatchObject({ encrypted: true, kdf: "PBKDF2-SHA256", iterations: 600_000, cipher: "AES-256-GCM" });
    expect(KDF_ITERATIONS).toBe(600_000);
    expect(atob(envelope.salt)).toHaveLength(16);
    expect(atob(envelope.iv)).toHaveLength(12);
    expect(derive.mock.calls[0][0]).toMatchObject({ name: "PBKDF2", hash: "SHA-256", iterations: 600_000 });
    expect(derive.mock.calls[0][2]).toEqual({ name: "AES-GCM", length: 256 });
    expect(encrypt.mock.calls[0][0]).toMatchObject({ name: "AES-GCM", tagLength: 128 });
    expect(new TextDecoder().decode((encrypt.mock.calls[0][0] as AesGcmParams).additionalData)).toBe(
      "ayase-studio-backup|1|PBKDF2-SHA256|600000|AES-256-GCM|128",
    );
    expect(exported).not.toContain(syntheticKey);
    expect(exported).not.toContain("apiKey");
    const restored = await decodeBackup(exported, password);
    expect(restored.document).toEqual(document(true));
    expect(restored.encrypted).toBe(true);
    expect(restored.counts.connections).toBe(1);
  });

  it("generates independent random salt, IV and ciphertext for repeat exports", async () => {
    const next = JSON.parse(await encodeBackup(document(true), true, password, password));
    const previous = JSON.parse(encrypted);
    for (const field of ["salt", "iv", "payload"]) expect(next[field]).not.toBe(previous[field]);
  });

  it.each([[password, "different-confirmation"], [password, ""]])(
    "rejects only a mismatched export password (%s)", async (input, confirmation) => {
      const encrypt = vi.spyOn(crypto.subtle, "encrypt");
      await expect(encodeBackup(document(true), true, input, confirmation)).rejects.toThrow(/不一致/);
      expect(encrypt).not.toHaveBeenCalled();
    },
  );
  it.each(["", "1", "中文密码", " 🙂 !\t\n ", "长".repeat(2048)])("encrypts and decrypts arbitrary matching password %s", async value => {
    const original = document(true);
    const exported = await encodeBackup(original, true, value, value);
    expect((await decodeBackup(exported, value)).document).toEqual(original);
  });

  it("rejects a wrong password without returning a restore document", async () => {
    await expect(decodeBackup(encrypted, "wrong-synthetic-password")).rejects.toThrow(/密码错误/);
  });

  it.each(["payload", "iv", "salt"])("authenticates changed %s bytes", async field => {
    const envelope = JSON.parse(encrypted);
    envelope[field] = changeByte(envelope[field]);
    await expect(decodeBackup(JSON.stringify(envelope), password)).rejects.toThrow(/损坏／被篡改/);
  });

  it.each([
    ["iterations", 1], ["iterations", 600_001], ["iterations", "600000"], ["kdf", "PBKDF2-SHA1"],
    ["cipher", "AES-128-GCM"], ["version", 2], ["unknown", true], ["salt", "AA=="], ["iv", "AA=="], ["payload", "not base64"],
  ])("rejects unsupported envelope %s=%s before decryption", async (field, value) => {
    const decrypt = vi.spyOn(crypto.subtle, "decrypt");
    const envelope = JSON.parse(encrypted);
    envelope[field] = value;
    await expect(decodeBackup(JSON.stringify(envelope), password)).rejects.toThrow();
    expect(decrypt).not.toHaveBeenCalled();
  });

  it.each([false, true])("roundtrips credential selection %s without encryption or a password", async credentials => {
    const original = document(credentials);
    const exported = await encodeBackup(original, false);
    expect(JSON.parse(exported).encrypted).toBe(false);
    expect(exported.includes(syntheticKey)).toBe(credentials);
    const restored = await decodeBackup(exported);
    expect(restored.document).toEqual(original);
    expect(restored.encrypted).toBe(false);
  });
  it("encrypts a backup without credentials", async () => {
    const original = document();
    const exported = await encodeBackup(original, true, password, password);
    expect(JSON.parse(exported).encrypted).toBe(true);
    expect((await decodeBackup(exported, password)).document).toEqual(original);
    await expect(decodeBackup(exported, "wrong-synthetic-password")).rejects.toThrow(/密码错误/);
  });

  it("rejects changed document bytes even if the JSON remains valid", async () => {
    const envelope = JSON.parse(await encodeBackup(document()));
    const container = JSON.parse(envelope.payload);
    container.document = container.document.replace("Synthetic", "Changed");
    envelope.payload = JSON.stringify(container);
    await expect(decodeBackup(JSON.stringify(envelope))).rejects.toThrow(/完整性校验/);
  });

  it.each(["not json", "null", "{}"])("rejects unrecognized input %s", async input => {
    await expect(decodeBackup(input)).rejects.toThrow();
  });

  it("rejects input over the file budget before parsing", async () => {
    await expect(decodeBackup(" ".repeat(MAX_BACKUP_FILE + 1))).rejects.toThrow(/过大/);
  });
});

describe("backup document validation", () => {
  it("roundtrips a large encrypted resource without regex stack overflow", async () => {
    const value = document(true), bytes = new Uint8Array(12 * 1024 * 1024).fill(65);
    value.assets = [{ id: reference, mime: "text/plain", data: bytesToBase64(bytes), size: bytes.length, sha256: await sha256(bytes) }];
    Object.assign((value.rows.chats[0] as { messages: object[] }).messages[0]!, { attachments: [{ reference, name: "large.txt", mimeType: "text/plain", size: bytes.length }] });
    const encoded = await encodeBackup(value, true, password, password);
    const decoded = await decodeBackup(encoded, password);
    expect(decoded.document.assets[0]!.sha256).toBe(value.assets[0]!.sha256);
  }, 60000);
  it("roundtrips valid near-budget data despite JSON container escaping expansion", async () => {
    const value = document(), bytes = new Uint8Array(47 * 1024 * 1024).fill(65);
    value.assets = [{ id: reference, mime: "text/plain", data: bytesToBase64(bytes), size: bytes.length, sha256: await sha256(bytes) }];
    Object.assign((value.rows.chats[0] as { messages: object[] }).messages[0]!, { content: "\n".repeat(7 * 1024 * 1024), attachments: [{ reference, name: "large.txt", mimeType: "text/plain", size: bytes.length }] });
    const decoded = await decodeBackup(await encodeBackup(value));
    expect(decoded.document.assets[0]!.size).toBe(bytes.length);
  }, 60000);
  it.each([
    ["future version", (value: BackupDocument) => Object.assign(value, { version: 2 })],
    ["unknown document field", (value: BackupDocument) => Object.assign(value, { apiKey: syntheticKey })],
    ["unknown nested field", (value: BackupDocument) => Object.assign(value.rows.assistants[0]!, { apiKey: syntheticKey })],
    ["missing table", (value: BackupDocument) => Reflect.deleteProperty(value.rows, "userAvatar")],
    ["orphan conversation", (value: BackupDocument) => Object.assign(value.rows.conversations[0]!, { assistantId: "missing" })],
    ["orphan chat", (value: BackupDocument) => Object.assign(value.rows.chats[0]!, { id: "missing" })],
    ["duplicate row ID", (value: BackupDocument) => value.rows.assistants.push(value.rows.assistants[0])],
    ["forward reply", (value: BackupDocument) => {
      const chat = value.rows.chats[0] as { messages: object[] };
      Object.assign(chat.messages[0]!, { replyToId: "answer" });
    }],
    ["invalid round selection", (value: BackupDocument) => {
      const chat = value.rows.chats[0] as { messages: object[] };
      Object.assign(chat.messages[0]!, { roundVersions: { selected: 1, pairs: [structuredClone(chat.messages)] } });
    }],
    ["too many assets", (value: BackupDocument) => { value.assets = Array.from({ length: 2001 }, () => ({ id: "x", mime: "text/plain", data: "", size: 0, sha256: "" })); }],
    ["metadata budget", (value: BackupDocument) => Object.assign(value.rows.assistants[0]!, { name: "x".repeat(8 * 1024 * 1024 + 1) })],
    ["deep recursion", (value: BackupDocument) => {
      let nested: object = {};
      for (let i = 0; i < 35; i++) nested = { nested };
      Object.assign(value.rows.assistants[0]!, { unknown: nested });
    }],
    ["prototype key", (value: BackupDocument) => Object.defineProperty(value.rows.assistants[0]!, "__proto__", { value: { injected: true }, enumerable: true })],
  ] satisfies [string, (value: BackupDocument) => unknown][])("rejects %s with a matching outer checksum", async (_name, mutate) => {
    const value = document();
    mutate(value);
    await expect(decodeBackup(await plainEnvelope(value))).rejects.toThrow();
  });

  it.each(["checksum", "size", "missing asset", "unused asset", "path traversal", "unsafe name", "base64"])(
    "rejects attachment %s corruption", async corruption => {
      const value = document();
      const bytes = new TextEncoder().encode("synthetic attachment");
      const asset = { id: reference, mime: "text/plain", data: bytesToBase64(bytes), size: bytes.length, sha256: await sha256(bytes) };
      value.assets = [asset];
      const chat = value.rows.chats[0] as { messages: object[] };
      const attachment = { reference, name: "synthetic.txt", mimeType: "text/plain", size: bytes.length };
      Object.assign(chat.messages[0]!, { attachments: [attachment] });
      if (corruption === "checksum") asset.sha256 = bytesToBase64(new Uint8Array(32));
      if (corruption === "size") asset.size++;
      if (corruption === "missing asset") value.assets = [];
      if (corruption === "unused asset") Reflect.deleteProperty(chat.messages[0]!, "attachments");
      if (corruption === "path traversal") { asset.id = "attachments/../synthetic.txt"; attachment.reference = asset.id; }
      if (corruption === "unsafe name") attachment.name = "../synthetic.txt";
      if (corruption === "base64") asset.data += "\n";
      await expect(decodeBackup(await plainEnvelope(value))).rejects.toThrow();
    },
  );
});
