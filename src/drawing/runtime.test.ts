import { describe, expect, it, vi } from "vitest";
import { createRuntimeImageTransport } from "./runtime";
import { fetch } from "@tauri-apps/plugin-http";
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
describe("native image transport", () => {
  it.each(["gemini-image", "openai-images"] as const)("disables native redirect following for %s before sending the key header", async protocol => {
    vi.mocked(fetch).mockResolvedValue(new Response("", { status: 302 }));
    const transport = await createRuntimeImageTransport();
    await expect(transport.generate({ prompt: "test", ...(protocol === "gemini-image" ? { protocol, aspectRatio: "auto", resolution: "auto" } : { protocol, size: "auto", quality: "auto" }), baseUrl: "https://example.test",
      providerId: "p", connectionId: "c", configuredModelId: "m", modelId: "test", modelName: "test" }, "synthetic-key", new AbortController().signal)).rejects.toMatchObject({ outcome: "unknown", message: expect.stringContaining("302") });
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ maxRedirections: 0, redirect: "error", credentials: "omit" }));
  });
});
