// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { ConnectionSettingsState } from "../../chat/settings";
import { ModelPicker } from "./ModelPicker";

it("shows chat models only and treats a drawing model reference as invalid", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const settings: ConnectionSettingsState = { version: 3, activeModelId: null, providers: [{
    id: "provider", name: "Synthetic", connections: [
      { id: "chat", name: "Chat", protocol: "gemini-native", baseUrl: "https://example.test", apiKey: "", models: [{ id: "chat-model", modelId: "chat/example" }] },
      { id: "image", name: "Drawing", protocol: "gemini-image", baseUrl: "https://example.test", apiKey: "", models: [{ id: "image-model", modelId: "image/example" }] },
    ],
  }] };
  const onSelect = vi.fn(async () => true);
  const onClose = vi.fn();
  try {
    await act(async () => root.render(<ModelPicker settings={settings} selectedModelId="image-model" disabled={false} onSelect={onSelect} onClose={onClose} />));
    const panel = document.querySelector('.model-picker')!;
    expect(panel.textContent).toContain("chat/example");
    expect(panel.textContent).not.toContain("image/example");
    expect(panel.textContent).toContain("当前模型已失效，请重新选择。");
    await act(async () => panel.querySelector<HTMLButtonElement>(".model-picker-option")!.click());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("chat-model");
    expect(onClose).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
