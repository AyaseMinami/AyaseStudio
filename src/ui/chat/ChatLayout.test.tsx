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
    const layoutButtons = () => [...host.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')];
    expect(layoutButtons()).toHaveLength(2);
    expect(layoutButtons().map(button => button.getAttribute("aria-pressed"))).toEqual(["false", "false"]);
    await act(async () => host.querySelector<HTMLButtonElement>('.composer-tools [aria-label="切换为宽屏"]')!.click());
    expect(host.querySelector("[data-chat-layout]")?.getAttribute("data-chat-layout")).toBe("wide");
    expect(layoutButtons().map(button => button.getAttribute("aria-pressed"))).toEqual(["true", "true"]);
    expect(layoutButtons().every(button => button.getAttribute("aria-label") === "切换为窄屏" &&
      button.title === "当前宽屏；切换为窄屏")).toBe(true);
    expect(host.querySelector("textarea")).toBe(input);
    expect(input?.value).toBe("保留草稿");
    expect(host.textContent).toContain("正在输出的回答");
    expect(host.textContent).toContain("当前模型");
    await act(async () => root.render(<Screen conversation="对话二" />));
    expect(host.querySelectorAll('[aria-label="切换为窄屏"]')).toHaveLength(2);
    await act(async () => root.render(null));
    await act(async () => root.render(<Screen />));
    expect(host.querySelectorAll('[aria-label="切换为窄屏"]')).toHaveLength(2);
    await act(async () => host.querySelector<HTMLButtonElement>('.chat-header [aria-label="切换为窄屏"]')!.click());
    expect(layoutButtons().map(button => button.getAttribute("aria-pressed"))).toEqual(["false", "false"]);
    await act(async () => root.render(null));
    await act(async () => root.render(<Screen />));
    expect(host.querySelectorAll('[aria-label="切换为宽屏"]')).toHaveLength(2);
  } finally {
    await act(async () => root.unmount());
    localStorage.clear();
  }
});

it("keeps input expansion independent of width toggles and preserves the input selection", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  function Screen({ interactive = true }) {
    const { layout, toggleLayout } = useChatLayout();
    return <ChatWorkspace title="样例对话" layout={layout} onToggleLayout={interactive ? toggleLayout : undefined}
      draft="保留草稿与光标" draftSelection={{ start: 2, end: 4 }} isHydrated isGenerating={false}
      messages={[]} protocolLabel="当前模型" onClear={() => {}} onDraftChange={() => {}}
      onSend={() => {}} onStop={() => {}} />;
  }
  const click = async (selector: string) => {
    await act(async () => host.querySelector<HTMLButtonElement>(selector)!.click());
  };
  try {
    await act(async () => root.render(<Screen />));
    const input = host.querySelector("textarea")!;
    await click('[aria-label="展开输入框"]');
    const footer = host.querySelector<HTMLElement>(".composer-footer")!;
    await click('.composer-tools [aria-label="切换为宽屏"]');
    expect(footer.style.height).toBe("50%");
    expect(host.querySelector('[aria-label="收起输入框"]')?.getAttribute("aria-expanded")).toBe("true");
    await click('.chat-header [aria-label="切换为窄屏"]');
    expect(footer.style.height).toBe("50%");
    await click('.chat-header [aria-label="切换为宽屏"]');
    await click('[aria-label="收起输入框"]');
    expect(footer.style.height).toBe("");
    expect(host.querySelector("[data-chat-layout]")?.getAttribute("data-chat-layout")).toBe("wide");
    await click('.composer-tools [aria-label="切换为窄屏"]');
    expect(host.querySelector("textarea")).toBe(input);
    expect(input.value).toBe("保留草稿与光标");
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 4]);
    await act(async () => root.render(<Screen interactive={false} />));
    expect(host.querySelector(".composer-layout-button")).toBeNull();
    expect(host.querySelector(".chat-layout-button")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    localStorage.clear();
  }
});
