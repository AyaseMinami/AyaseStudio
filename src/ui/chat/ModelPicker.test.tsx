// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { ConnectionSettingsState } from "../../chat/settings";
import { ModelPicker } from "./ModelPicker";

it("shows manual and automatic families with connection context and searches custom group names", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const settings: ConnectionSettingsState = { version: 3, activeModelId: null, providers: [{ id: "p", name: "供应商", connections: [
    { id: "c", name: "主连接", protocol: "openai-chat", baseUrl: "https://example.invalid", apiKey: "", modelGroups: [{ id: "g", name: "常用" }],
      models: [{ id: "manual", modelId: "gpt-5.3-chat", groupId: "g" }, { id: "auto", modelId: "gpt-5.3-thinking" }] },
    { id: "other", name: "备用连接", protocol: "openai-chat", baseUrl: "https://example.invalid", apiKey: "", models: [{ id: "alias", modelId: "gpt-5.3-chat" }] },
  ] }] };
  const select = vi.fn(async () => true);
  try {
    await act(async () => root.render(<ModelPicker settings={settings} selectedModelId={null} disabled={false} onSelect={select} onClose={() => {}} />));
    const headings = [...document.querySelectorAll(".model-picker-results h3")].map(node => node.textContent);
    expect(headings).toEqual(expect.arrayContaining(["供应商 · 主连接 · OpenAI Chat · 常用（自定义）", "供应商 · 主连接 · OpenAI Chat · gpt-5.3", "供应商 · 备用连接 · OpenAI Chat · gpt-5.3"]));
    const input = document.querySelector<HTMLInputElement>(".model-picker-search input")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "常用"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(document.querySelectorAll(".model-picker-option")).toHaveLength(1);
    await act(async () => document.querySelector<HTMLButtonElement>(".model-picker-option")!.click());
    expect(select).toHaveBeenCalledWith("manual");
  } finally { await act(async () => root.unmount()); container.remove(); }
});

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
