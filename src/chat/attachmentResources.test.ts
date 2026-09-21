import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTauriAttachmentStore } from "./attachmentResources";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

describe("sent attachment reading", () => {
  beforeEach(() => mocks.invoke.mockReset());

  it("does not reinterpret an unreadable saved image using its original filename", async () => {
    mocks.invoke.mockResolvedValue(btoa("bad"));
    const sent = { reference: "attachments/123e4567-e89b-42d3-a456-426614174000.jpg",
      name: "renamed.png", mimeType: "image/jpeg" as const, size: 3 };
    await expect(createTauriAttachmentStore().read(sent)).resolves.toMatchObject({
      mimeType: "image/jpeg", data: btoa("bad"), size: 3,
    });
  });

  it("deletes a newly staged copy if native metadata conflicts with the prepared request", async () => {
    const reference = "attachments/123e4567-e89b-42d3-a456-426614174000.txt";
    mocks.invoke.mockResolvedValueOnce({ reference, name: "file.txt", mimeType: "text/plain", size: 3 })
      .mockResolvedValueOnce(undefined);
    await expect(createTauriAttachmentStore().save({ name: "file.txt", mimeType: "text/plain",
      size: 2, data: "SGk=" })).rejects.toThrow("元数据不一致");
    expect(mocks.invoke).toHaveBeenLastCalledWith("discard_uncommitted_attachments", { references: [reference] });
  });

  it("checks committed storage without loading attachment content back into JavaScript", async () => {
    mocks.invoke.mockResolvedValue(undefined);
    const sent = { reference: "attachments/123e4567-e89b-42d3-a456-426614174000.jpg",
      name: "picture.jpg", mimeType: "image/jpeg" as const, size: 123 };
    await createTauriAttachmentStore().verify([sent]);
    expect(mocks.invoke).toHaveBeenCalledWith("verify_sent_attachments", {
      items: [{ reference: sent.reference, size: sent.size }],
    });
  });
});
