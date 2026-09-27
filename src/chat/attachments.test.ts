import { describe, expect, it, vi } from "vitest";
import { addDraftAttachments, materializeDraftAttachment, prepareDraftAttachment, type DraftAttachment } from "./attachments";

const file = (name: string, bytes: Uint8Array) => new File([new Uint8Array(bytes).buffer], name);

describe("attachment drafts", () => {
  it("reads structured and source files as UTF-8 without transforming their contents", async () => {
    for (const name of ["data.csv", "settings.json", "page.html", "main.ts", "notes.yaml"]) {
      const draft = await prepareDraftAttachment(file(name, new TextEncoder().encode("<raw> 中文")));
      expect(await materializeDraftAttachment(draft)).toMatchObject({ name, mimeType: "text/plain" });
    }
    const invalid = await prepareDraftAttachment(file("bad.csv", new Uint8Array([255])));
    await expect(materializeDraftAttachment(invalid)).rejects.toThrow("UTF-8");
  });

  it("keeps Office bytes intact and rejects a non-container masquerading as Office", async () => {
    for (const ext of ["docx", "xlsx", "pptx"]) {
      const draft = await prepareDraftAttachment(file(`test.${ext}`, new Uint8Array([80, 75, 3, 4, 1])));
      expect((await materializeDraftAttachment(draft)).data).toBe("UEsDBAE=");
    }
    await expect(prepareDraftAttachment(file("fake.docx", new TextEncoder().encode("plain text"))))
      .rejects.toThrow("容器格式无效");
  });
  it("uses the actual JPEG type when a valid image is named .png", async () => {
    const jpeg = Uint8Array.from(atob(
      "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDi6KKK+ZP3E//Z"),
      (character) => character.charCodeAt(0));
    const draft = await prepareDraftAttachment(file("renamed.png", jpeg));
    expect(draft).toMatchObject({ name: "renamed.png", mimeType: "image/jpeg", size: jpeg.length });
  });

  it("accepts supported content without copying it to durable storage", async () => {
    const draft = await prepareDraftAttachment(file("notes.md", new TextEncoder().encode("# hello")));
    expect(draft).toMatchObject({ name: "notes.md", mimeType: "text/markdown", size: 7 });
    expect(draft.file).toBeInstanceOf(File);
    expect(draft).not.toHaveProperty("data");
    expect(draft).not.toHaveProperty("reference");
  });

  it("keeps a draft as a file handle rather than caching its full Base64 content", async () => {
    const source = file("view.png", new Uint8Array(10_000_001));
    const readFull = vi.spyOn(source, "arrayBuffer");
    const draft = await prepareDraftAttachment(source);
    expect(readFull).not.toHaveBeenCalled();
    expect(draft).not.toHaveProperty("data");
    expect(draft).toHaveProperty("file", source);
  });

  it("does not impose the former 10 MB file or 20 MB draft aggregate limits", async () => {
    const large = await prepareDraftAttachment(file("large.txt", new Uint8Array(10_000_001)));
    expect(large.size).toBe(10_000_001);
    const sample = await prepareDraftAttachment(file("one.txt", new TextEncoder().encode("hello")));
    const almostFull: DraftAttachment = { ...sample, size: 19_999_998 };
    expect(addDraftAttachments([almostFull], [sample])).toHaveLength(2);
  });

  it("does not locally decide whether a supported-format image is decodable", async () => {
    const draft = await prepareDraftAttachment(file("damaged.png", new TextEncoder().encode("not an image")));
    expect(draft.mimeType).toBe("image/png");
  });

  it("passes an unreadable PDF to the provider instead of pre-rejecting it", async () => {
    const draft = await prepareDraftAttachment(file("damaged.pdf", new TextEncoder().encode("not a PDF")));
    expect(draft.mimeType).toBe("application/pdf");
  });

  it("allows a long source name because stored copies use UUIDs but rejects control characters consistently", async () => {
    const longName = `${"中".repeat(100)}.txt`;
    await expect(prepareDraftAttachment(file(longName, new TextEncoder().encode("hello"))))
      .resolves.toMatchObject({ name: longName });
    await expect(prepareDraftAttachment(file("bad\u007fname.txt", new TextEncoder().encode("hello"))))
      .rejects.toThrow("文件名无效");
  });

  it("materializes Base64 only for a send attempt", async () => {
    const draft = await prepareDraftAttachment(file("notes.txt", new TextEncoder().encode("Hello")));
    const readFull = vi.spyOn(draft.file, "arrayBuffer");
    expect(readFull).not.toHaveBeenCalled();
    const request = await materializeDraftAttachment(draft);
    expect(readFull).toHaveBeenCalledTimes(1);
    expect(request).toEqual({ name: "notes.txt", mimeType: "text/plain", size: 5, data: "SGVsbG8=" });
  });
});
