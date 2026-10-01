import { describe, expect, it, vi } from "vitest";
import { createRuntimeImageTransport, openDrawingOutputDirectory } from "./runtime";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { fetch } from "@tauri-apps/plugin-http";
vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn(() => true), invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
describe("native image transport", () => {
  it("opens only the host-chosen directory without accepting or supplying a path", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await openDrawingOutputDirectory();
    expect(invoke).toHaveBeenCalledExactlyOnceWith("open_drawing_output_directory");
    vi.mocked(invoke).mockClear();
    vi.mocked(isTauri).mockReturnValueOnce(false);
    await expect(openDrawingOutputDirectory()).rejects.toThrow("桌面应用");
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each(["gemini-image", "openai-images"] as const)("disables native redirect following for %s before sending the key header", async protocol => {
    vi.mocked(fetch).mockResolvedValue(new Response("", { status: 302 }));
    const transport = await createRuntimeImageTransport();
    await expect(transport.generate({ prompt: "test", ...(protocol === "gemini-image" ? { protocol, aspectRatio: "auto", resolution: "auto" } : { protocol, size: "auto", quality: "auto" }), baseUrl: "https://example.test",
      providerId: "p", connectionId: "c", configuredModelId: "m", modelId: "test", modelName: "test" }, "synthetic-key", new AbortController().signal)).rejects.toMatchObject({ outcome: "unknown", message: expect.stringContaining("302") });
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ maxRedirections: 0, redirect: "error", credentials: "omit" }));
  });
});
