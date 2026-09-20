// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { ChatWorkspace } from "./ChatWorkspace";
import { useChatLayout } from "./useChatLayout";

it("toggles during generation without replacing chat content and restores the preference on remount", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  const host = document.createElement("div");
  const root = createRoot(host);
  const messages = [{ id: "answer", role: "assistant" as const, content: "正在输出的回答", status: "streaming" as const }];
  function Screen({ conversation = "对话一" }) {
    const { layout, toggleLayout } = useChatLayout();
    return <ChatWorkspace title={conversation} layout={layout} onToggleLayout={toggleLayout}
      draft="保留草稿" isHydrated isGenerating messages={messages} protocolLabel="当前模型"
      onClear={() => {}} onDraftChange={() => {}} onSend={() => {}} onStop={() => {}} />;
  }
  try {
    await act(async () => root.render(<Screen />));
    expect(host.querySelector("[data-chat-layout]")?.getAttribute("data-chat-layout")).toBe("narrow");
    const input = host.querySelector("textarea");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="展开聊天内容"]')!.click());
    expect(host.querySelector("[data-chat-layout]")?.getAttribute("data-chat-layout")).toBe("wide");
    expect(host.querySelector("textarea")).toBe(input);
    expect(input?.value).toBe("保留草稿");
    expect(host.textContent).toContain("正在输出的回答");
    expect(host.textContent).toContain("当前模型");
    await act(async () => root.render(<Screen conversation="对话二" />));
    expect(host.querySelector('[aria-label="收窄聊天内容"]')).not.toBeNull();
    await act(async () => root.render(null));
    await act(async () => root.render(<Screen />));
    expect(host.querySelector('[aria-label="收窄聊天内容"]')).not.toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="收窄聊天内容"]')!.click());
    await act(async () => root.render(null));
    await act(async () => root.render(<Screen />));
    expect(host.querySelector('[aria-label="展开聊天内容"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    localStorage.clear();
  }
});
