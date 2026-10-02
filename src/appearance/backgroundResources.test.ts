import { beforeEach, expect, it, vi } from "vitest";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { createTauriBackgroundResourceStore } from "./backgroundResources";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: vi.fn((path: string) => `asset://${path}`) }));
beforeEach(() => vi.clearAllMocks());

it("requests thumbnail resolution explicitly and converts only the native returned path", async () => {
  vi.mocked(invoke).mockResolvedValue({ reference: "backgrounds/image.jpg", absolutePath: "private/backgrounds/thumbnails/image.jpg.png" });
  const resource = await createTauriBackgroundResourceStore().resolve("backgrounds/image.jpg", { thumbnail: true, refresh: true });
  expect(invoke).toHaveBeenCalledWith("resolve_background_image", { reference: "backgrounds/image.jpg", thumbnail: true, refresh: true });
  expect(convertFileSrc).toHaveBeenCalledWith("private/backgrounds/thumbnails/image.jpg.png");
  expect(resource.url).toBe("asset://private/backgrounds/thumbnails/image.jpg.png");
});

it("keeps original resolution as the default", async () => {
  vi.mocked(invoke).mockResolvedValue({ reference: "backgrounds/image.jpg", absolutePath: "private/backgrounds/image.jpg" });
  await createTauriBackgroundResourceStore().resolve("backgrounds/image.jpg");
  expect(invoke).toHaveBeenCalledWith("resolve_background_image", { reference: "backgrounds/image.jpg", thumbnail: false, refresh: false });
});
