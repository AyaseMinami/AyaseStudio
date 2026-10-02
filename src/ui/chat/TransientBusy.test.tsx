// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChatWorkspace, type ChatWorkspaceProps } from "./ChatWorkspace";

const props: ChatWorkspaceProps = {
  title: "Synthetic", draft: "草稿", isHydrated: false, isWorkspaceBusy: true,
  isGenerating: false, messages: [{ id: "u", role: "user", content: "问题", status: "complete" },
    { id: "a", role: "assistant", content: "回答", status: "complete" }],
  messageActionsDisabled: true,
  messageActions: { edit: vi.fn(), editAndSend: vi.fn(), delete: vi.fn(), retry: vi.fn(), branch: vi.fn() },
  protocol: "openai-chat", protocolLabel: "Synthetic", onThinkingChange: vi.fn(), onSearchModeChange: vi.fn(),
  onClear: vi.fn(), onDraftChange: vi.fn(), onSend: vi.fn(), onStop: vi.fn(),
};
function view(overrides: Partial<ChatWorkspaceProps> = {}) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<ChatWorkspace {...props} {...overrides} />);
  return host;
}
const blockedSendCases: Partial<ChatWorkspaceProps>[] = [{ draft: "" }, { attachmentBusy: true },
  { draftAttachments: [{ id: "x", name: "x.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 1, file: new File(["x"], "x.docx") }] }];
describe("transient workspace disabled visuals", () => {
  it("marks clear, composer tools, draft, send and message actions while preserving disabled", () => {
    const host = view();
    for (const selector of ['.clear-button', '.composer-input', '[aria-label="添加附件"]',
      '[aria-label="思考设置"]', '[aria-label="联网搜索：关闭"]', '[aria-label="发送"]',
      '.message-action[aria-label="编辑"]', '.message-action[aria-label="删除"]',
      '.message-action[aria-label="重新生成"]', '.message-action[aria-label="分支"]']) {
      const control = host.querySelector(selector)!;
      expect(control.hasAttribute("disabled"), selector).toBe(true);
      expect(control.getAttribute("data-busy-only"), selector).toBe("true");
    }
  });
  it.each(blockedSendCases)("keeps genuinely unavailable sending dimmed (%j)", overrides => {
    const send = view(overrides).querySelector('[aria-label="发送"]')!;
    expect(send.hasAttribute("disabled")).toBe(true);
    expect(send.getAttribute("data-busy-only")).not.toBe("true");
  });
  it("keeps generating, unavailable actions and initial hydration visually disabled", () => {
    const generating = view({ isGenerating: true });
    expect(generating.querySelector('.clear-button')?.getAttribute("data-busy-only")).not.toBe("true");
    expect(generating.querySelector('.message-action[aria-label="编辑"]')?.getAttribute("data-busy-only")).not.toBe("true");
    const unavailable = view({ messageActions: undefined, messages: [{ id: "a", role: "assistant", content: "孤立回答", status: "complete" }] });
    expect(unavailable.querySelector('.message-action[aria-label="重新生成"]')?.getAttribute("data-busy-only")).not.toBe("true");
    expect(unavailable.querySelector('.message-action[aria-label="编辑"]')?.getAttribute("data-busy-only")).not.toBe("true");
    expect(view({ isWorkspaceBusy: false }).querySelector('[data-busy-only="true"]')).toBeNull();
  });
  it("preserves version boundaries and unavailable regeneration targets during a wait", () => {
    const [user, answer] = props.messages;
    const host = view({ messageActions: { ...props.messageActions!, selectVersion: vi.fn() },
      messages: [{ ...user, roundVersions: { selected: 0, pairs: [[user, answer], [user, answer]] } }, answer] });
    expect(host.querySelector('[aria-label="上一版问答"]')?.getAttribute("data-busy-only")).toBe("false");
    expect(host.querySelector('[aria-label="下一版问答"]')?.getAttribute("data-busy-only")).toBe("true");
    const orphan = view({ messages: [answer] });
    expect(orphan.querySelector('[aria-label="重新生成"]')?.getAttribute("data-busy-only")).toBe("false");
  });
});
