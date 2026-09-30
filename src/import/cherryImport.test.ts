import { describe, expect, it, vi } from "vitest";
import { AttachmentLifecycle } from "../chat/attachmentLifecycle";
import type { RequestAttachment, SentAttachment } from "../chat/attachments";
import { commitCherryImport } from "./cherryImport";
import type { CherryImportPlan, CherryImportRepository } from "./cherryTypes";

const draft: RequestAttachment = { name: "file.txt", mimeType: "text/plain", size: 2, data: "SGk=" };
const sent: SentAttachment = { name: "file.txt", mimeType: "text/plain", size: 2, reference: "attachments/saved.txt" };
function plan(): CherryImportPlan {
  return { format: 5, assistants: [{ id: "assistant", name: "name" }], warnings: [], conversations: [
    { sourceKey: "key", topicId: "topic", assistantId: "assistant", title: "title", createdAt: 1, updatedAt: 2,
      messages: [{ sourceId: "u", role: "user", content: "content", status: "complete", createdAt: 1, files: [{ key: "file", name: "file.txt" }] }] },
  ] };
}
function setup() {
  const store = { save: vi.fn().mockResolvedValue(sent), verify: vi.fn().mockResolvedValue(undefined),
    discardUncommitted: vi.fn().mockResolvedValue(undefined), cleanup: vi.fn().mockResolvedValue(undefined), read: vi.fn() };
  const references: string[] = [];
  const lifecycle = new AttachmentLifecycle(store, async () => references);
  const commit = vi.fn().mockImplementation(async () => { references.push(sent.reference); return { imported: 1, skipped: 0 }; });
  const repository: CherryImportRepository = { existingSourceKeys: vi.fn().mockResolvedValue([]), commit };
  const resources = { readFile: vi.fn().mockResolvedValue(draft), verify: store.verify, lifecycle };
  return { store, repository, resources, commit, references };
}

describe("Cherry local import orchestration", () => {
  it("stages each file once, preserves message attachment names, and does not mutate preview", async () => {
    const data = plan();
    data.conversations.push({ ...data.conversations[0]!, sourceKey: "second" });
    data.conversations[0]!.messages[0]!.files.push({ key: "file", name: "renamed.txt" });
    const before = structuredClone(data);
    const test = setup();
    await commitCherryImport(data, "copy", test.repository, test.resources);
    expect(test.resources.readFile).toHaveBeenCalledTimes(1);
    expect(test.store.save).toHaveBeenCalledTimes(1);
    const submitted = test.commit.mock.calls[0]![0] as CherryImportPlan;
    expect(submitted.conversations[0]!.messages[0]!.attachments?.map((item) => item.name)).toEqual(["file.txt", "renamed.txt"]);
    expect(test.store.cleanup).toHaveBeenCalledWith([sent.reference], []);
    expect(data).toEqual(before);
  });

  it("never stages already imported conversations", async () => {
    const test = setup();
    vi.mocked(test.repository.existingSourceKeys).mockResolvedValue(["key"]);
    expect(await commitCherryImport(plan(), "skip", test.repository, test.resources)).toEqual({ imported: 0, skipped: 1, warnings: [] });
    expect(test.resources.readFile).not.toHaveBeenCalled();
    expect(test.commit).not.toHaveBeenCalled();
  });

  it("counts preexisting and racing duplicates together", async () => {
    const test = setup();
    const data = plan(); data.conversations.push({ ...data.conversations[0]!, sourceKey: "second" });
    vi.mocked(test.repository.existingSourceKeys).mockResolvedValue(["key"]);
    test.commit.mockImplementation(async () => ({ imported: 0, skipped: 1 }));
    expect(await commitCherryImport(data, "skip", test.repository, test.resources)).toEqual({ imported: 0, skipped: 2, warnings: [] });
    expect(test.store.discardUncommitted).not.toHaveBeenCalled();
    expect(test.store.cleanup).toHaveBeenCalledWith([], []);
  });

  it("reports missing files without losing message content or file metadata", async () => {
    const test = setup(); test.resources.readFile.mockResolvedValue(null);
    const result = await commitCherryImport(plan(), "skip", test.repository, test.resources);
    expect(result.imported).toBe(1); expect(result.warnings).toHaveLength(1);
    const submitted = test.commit.mock.calls[0]![0] as CherryImportPlan;
    expect(submitted.conversations[0]!.messages[0]).toMatchObject({ content: "content", files: [{ key: "file", name: "file.txt" }], unavailableAttachments: ["file.txt"] });
    expect(test.store.save).not.toHaveBeenCalled();
  });

  it.each(["read", "save", "verify", "database"])("rolls back staged copies on %s failure and hides native details", async (failure) => {
    const test = setup();
    const data = plan(); data.conversations[0]!.messages[0]!.files.push({ key: "second", name: "second.txt" });
    data.conversations[0]!.messages[0]!.unavailableAttachments = ["second.txt"];
    const before = structuredClone(data);
    const error = new Error("PRIVATE PATH AND CONTENT");
    if (failure === "read") test.resources.readFile.mockResolvedValueOnce(draft).mockRejectedValueOnce(error);
    if (failure === "save") test.store.save.mockResolvedValueOnce(sent).mockRejectedValueOnce(error);
    if (failure === "verify") test.store.verify.mockRejectedValue(error);
    if (failure === "database") test.commit.mockRejectedValue(error);
    await expect(commitCherryImport(data, "skip", test.repository, test.resources)).rejects.toThrow("未提交聊天记录");
    expect(test.store.discardUncommitted).toHaveBeenCalled();
    if (failure !== "database") expect(test.commit).not.toHaveBeenCalled();
    expect(test.store.cleanup).not.toHaveBeenCalled();
    expect(data).toEqual(before);
  });

  it.each(["verify", "cleanup"])("returns successful DB commit with warning on postcommit %s failure", async (failure) => {
    const test = setup();
    if (failure === "verify") test.store.verify.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("PRIVATE"));
    else test.store.cleanup.mockRejectedValue(new Error("PRIVATE"));
    const result = await commitCherryImport(plan(), "skip", test.repository, test.resources);
    expect(result.imported).toBe(1); expect(result.warnings).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(test.store.discardUncommitted).not.toHaveBeenCalled();
  });

  it("verifies before DB commit while reservations protect copies from concurrent cleanup", async () => {
    const test = setup();
    test.commit.mockImplementation(async () => {
      expect(test.store.verify).toHaveBeenCalledTimes(1);
      await test.resources.lifecycle.cleanup();
      expect(test.store.cleanup).toHaveBeenLastCalledWith([], [sent.reference]);
      test.references.push(sent.reference);
      return { imported: 1, skipped: 0 };
    });
    await commitCherryImport(plan(), "skip", test.repository, test.resources);
    expect(test.store.cleanup).toHaveBeenLastCalledWith([sent.reference], []);
  });

  it("does not discard authoritative racing duplicates if reservation release fails", async () => {
    const test = setup();
    test.commit.mockImplementation(async () => ({ imported: 0, skipped: 1 }));
    test.store.verify.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("PRIVATE"));
    const result = await commitCherryImport(plan(), "skip", test.repository, test.resources);
    expect(result).toMatchObject({ imported: 0, skipped: 1 });
    expect(result.warnings).toHaveLength(1);
    expect(test.store.discardUncommitted).not.toHaveBeenCalled();
  });

  it("preserves all original aliases for a missing cached file and clears recovered preview descriptors", async () => {
    const test = setup();
    const data = plan();
    data.conversations[0]!.messages[0]!.files.push({ key: "file", name: "renamed.txt" }, { key: "file", name: "file.txt" });
    test.resources.readFile.mockResolvedValue(null);
    await commitCherryImport(data, "skip", test.repository, test.resources);
    const missing = test.commit.mock.calls[0]![0] as CherryImportPlan;
    expect(missing.conversations[0]!.messages[0]!.unavailableAttachments).toEqual(["file.txt", "renamed.txt"]);
    expect(test.resources.readFile).toHaveBeenCalledTimes(1);
    const recoveredTest = setup();
    data.conversations[0]!.messages[0]!.unavailableAttachments = ["file.txt", "renamed.txt"];
    const before = structuredClone(data);
    await commitCherryImport(data, "skip", recoveredTest.repository, recoveredTest.resources);
    const recovered = recoveredTest.commit.mock.calls[0]![0] as CherryImportPlan;
    expect(recovered.conversations[0]!.messages[0]!.unavailableAttachments).toBeUndefined();
    expect(recovered.conversations[0]!.messages[0]!.attachments).toHaveLength(3);
    expect(data).toEqual(before);
  });
});
