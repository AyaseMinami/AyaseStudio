// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatRepository } from "../../chat/repository";
import { defaultSessionConfig } from "../../chat/sessionConfig";
import { emptyConnectionSettings } from "../../chat/settings";
import { useConversationWorkspace } from "../../chat/useConversationWorkspace";
import { ChatWorkspace } from "./ChatWorkspace";
import { ChatHeader } from "./ChatHeader";
import { ConversationNavigation } from "./ConversationNavigation";
import { useConversationNavigation } from "./useConversationNavigation";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mounted: Array<{ root: ReturnType<typeof createRoot>; host: HTMLDivElement; databaseName: string }> = [];
const originalWidth = window.innerWidth;
const legacyAvatarKey = "ayase-studio.assistant-default-avatar";

afterEach(async () => {
  vi.restoreAllMocks();
  for (const { root, host, databaseName } of mounted.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
    await Dexie.delete(databaseName);
  }
  localStorage.removeItem(legacyAvatarKey);
  Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
});

async function waitFor(predicate: () => boolean) {
  for (let count = 0; count < 100 && !predicate(); count++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  }
  expect(predicate()).toBe(true);
}

async function click(element: Element, detail = 1) {
  await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, detail })); });
}

async function key(element: Element, value: string, options: KeyboardEventInit = {}) {
  await act(async () => { element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: value, ...options })); });
}

async function input(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function mount({ width = 1200, generating = false, controlled = true, modelPicker = false } = {}) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  const databaseName = `ConversationNavigation-test-${crypto.randomUUID()}`;
  const repository = createChatRepository(databaseName);
  await repository.initializeWorkspace(null, []);
  await repository.execute({ type: "rename-conversation", id: "current", title: "对话一" });
  await repository.execute({ type: "create-conversation", id: "second", assistantId: "default" });
  await repository.execute({ type: "rename-conversation", id: "second", title: "对话二" });
  await repository.execute({ type: "create-assistant", id: "writer", input: {
    name: "写作助手", icon: "", defaultModelId: null, defaultConfig: defaultSessionConfig(),
  } });
  await repository.execute({ type: "create-conversation", id: "writer-chat", assistantId: "writer" });
  await repository.execute({ type: "select", assistantId: "default", conversationId: "current" });
  const generatingIds = new Set(generating ? ["current"] : []);
  const onSend = vi.fn();
  const onStop = vi.fn();
  const ownerRender = vi.fn();
  const siblingRender = vi.fn();
  let workspace!: ReturnType<typeof useConversationWorkspace>;
  function SiblingContent() { siblingRender(); return <p>隔离的兄弟正文</p>; }
  function Harness() {
    ownerRender();
    const navigation = useConversationNavigation();
    workspace = useConversationWorkspace(repository, null, [], id => generatingIds.has(id));
    const [visible, setVisible] = useState(true);
    return <>
      <button onClick={() => setVisible(!visible)}>切换测试页面</button>
      <SiblingContent />
      {visible && <ConversationNavigation navigation={controlled ? navigation : undefined} workspace={workspace}
        settings={emptyConnectionSettings} generatingIds={generatingIds} toolbar={<><button>测试工具</button><ChatHeader title="测试" isHydrated={workspace.isReady} isGenerating={generating} isWorkspaceBusy={workspace.isTemporarilyBusy} onClear={() => {}} /></>}>
        <ChatWorkspace title={workspace.conversation?.title ?? ""} hideHeader protocolLabel="测试模型"
          modelPicker={modelPicker ? { settings: emptyConnectionSettings, selectedModelId: null, disabled: false, onSelect: async () => true } : undefined}
          draft={workspace.view.draft} draftSelection={workspace.view.draftSelection}
          onDraftSelectionChange={workspace.setDraftSelection} onDraftChange={workspace.setDraft}
          onDraftActivate={controlled ? navigation.activateDraft : undefined} isHydrated={workspace.isReady}
          isWorkspaceBusy={workspace.isTemporarilyBusy}
          onSearchModeChange={() => {}} protocol="openai-chat" onThinkingChange={() => {}}
          isGenerating={!!workspace.conversation && generatingIds.has(workspace.conversation.id)}
          messages={workspace.view.messages} onClear={() => {}} onSend={onSend} onStop={onStop} />
      </ConversationNavigation>}
    </>;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted.push({ root, host, databaseName });
  await act(async () => root.render(<Harness />));
  await waitFor(() => workspace.isReady);
  const button = (label: string, scope: ParentNode = host) => {
    const element = [...scope.querySelectorAll<HTMLButtonElement>("button")]
      .find(item => item.getAttribute("aria-label") === label || item.textContent === label);
    expect(element, `button ${label}`).toBeDefined();
    return element!;
  };
  const layout = () => {
    const body = host.querySelector<HTMLElement>(".conversation-workspace-body")!;
    return { open: body.dataset.navigationOpen, conversations: body.dataset.conversationsOpen, expanded: body.dataset.assistantExpanded };
  };
  const settled = () => waitFor(() => !workspace.busy);
  return { host, repository, workspace: () => workspace, button, layout, settled, onSend, onStop, ownerRender, siblingRender };
}

describe("conversation navigation runtime layout", () => {
  it.each([false, true])("keeps busy-only navigation controls visually stable without enabling actions (generating=%s)", async generating => {
    const ui = await mount({ generating });
    await click(ui.button("默认助手"));
    const originalExecute = ui.repository.execute.bind(ui.repository);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const execute = vi.spyOn(ui.repository, "execute").mockImplementationOnce(async command => {
      await gate;
      return originalExecute(command);
    });
    await click(ui.button("对话二"));
    expect(ui.workspace().busy).toBe(true);
    const controls = [ui.button("新建助手"), ui.button("新建对话"), ui.button("编辑对话 对话一"), ui.button("删除对话 对话二"), ui.button("拖动助手 默认助手")];
    try {
      for (const label of ["添加附件", "思考设置", "联网搜索：关闭"]) {
        const control = ui.button(label);
        expect(control.disabled).toBe(true);
        expect(control.dataset.busyOnly).toBe("true");
        await click(control);
      }
      expect(ui.button("清空").dataset.busyOnly).toBe(String(!generating));
      expect(ui.host.querySelector<HTMLTextAreaElement>(".composer-input")?.dataset.busyOnly).toBe("true");
      for (const control of controls) {
        expect(control.disabled).toBe(true);
        expect(control.dataset.busyOnly).toBe("true");
        await click(control);
      }
      const deletion = ui.button("删除对话 对话一");
      expect(deletion.disabled).toBe(true);
      expect(deletion.dataset.busyOnly).toBe(String(!generating));
      expect(execute).toHaveBeenCalledTimes(1);
      expect(ui.host.querySelector('[role="dialog"]')).toBeNull();
      expect(ui.host.querySelector('[data-pending="true"]')).toBeNull();
    } finally {
      await act(async () => release());
      await ui.settled();
    }
    for (const control of controls) {
      expect(control.disabled).toBe(false);
      expect(control.dataset.busyOnly).toBe("false");
    }
    expect(ui.button("删除对话 对话一").disabled).toBe(generating);
  });

  it.each([true, false])("updates navigation without rerendering the workspace owner or sibling text (controlled=%s)", async controlled => {
    const ui = await mount({ controlled });
    const ownerCount = ui.ownerRender.mock.calls.length;
    const siblingCount = ui.siblingRender.mock.calls.length;
    await click(ui.button("默认助手"));
    expect(ui.layout().expanded).toBe("true");
    await click(ui.button("收起对话栏"));
    expect(ui.layout().conversations).toBe("false");
    await click(ui.button("助手与对话"));
    expect(ui.layout().open).toBe("false");
    await click(ui.button("助手与对话"));
    expect(ui.layout()).toEqual({ open: "true", conversations: "false", expanded: "true" });
    expect(ui.ownerRender).toHaveBeenCalledTimes(ownerCount);
    expect(ui.siblingRender).toHaveBeenCalledTimes(siblingCount);
  });

  it.each([861, 860, 600])("starts at width %i with compact assistants and opens the conversation pane", async width => {
    const ui = await mount({ width });
    expect(ui.layout()).toEqual({ open: String(width > 860), conversations: String(width > 860), expanded: "false" });
    if (width <= 860) {
      expect(ui.host.querySelector("#assistant-navigation")?.hasAttribute("inert")).toBe(true);
      await click(ui.button("助手与对话"));
    }
    expect(ui.layout()).toEqual({ open: "true", conversations: "true", expanded: "false" });
    for (const control of ui.host.querySelectorAll<HTMLButtonElement>(".assistant-branch .navigation-drag-handle, .assistant-menu-trigger")) {
      expect(control.tabIndex).toBe(-1);
      expect(control.closest("[inert]")).not.toBeNull();
      expect(control.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it("expands the current assistant immediately and another assistant only after a successful command", async () => {
    const ui = await mount();
    const originalExecute = ui.repository.execute.bind(ui.repository);
    const execute = vi.spyOn(ui.repository, "execute");
    await click(ui.button("默认助手"));
    expect(execute).not.toHaveBeenCalled();
    expect(ui.layout().expanded).toBe("true");
    await click(ui.host.querySelector(".composer-input")!);
    execute.mockRejectedValueOnce(new Error("synthetic selection failure"));
    await click(ui.button("写作助手"));
    await ui.settled();
    expect(ui.workspace().conversation?.id).toBe("current");
    expect(ui.layout()).toEqual({ open: "true", conversations: "true", expanded: "false" });
    expect(ui.host.querySelector('[role="alert"]')?.textContent).toContain("synthetic selection failure");
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    execute.mockImplementationOnce(async command => { await gate; return originalExecute(command); });
    await click(ui.button("写作助手"));
    expect(ui.layout().expanded).toBe("false");
    expect(ui.workspace().conversation?.id).toBe("current");
    await act(async () => release());
    await ui.settled();
    expect(ui.workspace().conversation?.id).toBe("writer-chat");
    expect(ui.layout()).toEqual({ open: "true", conversations: "true", expanded: "true" });
  });

  it("does not shrink on conversation selection or creation and retains per-conversation drafts", async () => {
    const ui = await mount();
    await act(async () => { ui.workspace().setDraft("未发送草稿"); ui.workspace().setDraftSelection({ start: 1, end: 4 }); });
    await click(ui.button("默认助手"));
    await click(ui.button("对话二"));
    await ui.settled();
    expect(ui.workspace().conversation?.id).toBe("second");
    expect(ui.layout().expanded).toBe("true");
    await click(ui.button("对话一"));
    await ui.settled();
    expect(ui.workspace().view.draft).toBe("未发送草稿");
    expect(ui.workspace().view.draftSelection).toEqual({ start: 1, end: 4 });
    const count = ui.workspace().snapshot!.conversations.length;
    await click(ui.button("新建对话"));
    await ui.settled();
    expect(ui.workspace().snapshot!.conversations).toHaveLength(count + 1);
    expect(ui.layout().expanded).toBe("true");
  });

  it("shrinks on explicit clicks throughout the chat region without disrupting generation or selection", async () => {
    const ui = await mount({ generating: true });
    await act(async () => { ui.workspace().setDraft("保留原草稿"); ui.workspace().setDraftSelection({ start: 1, end: 4 }); });
    await click(ui.button("默认助手"));
    const textarea = ui.host.querySelector<HTMLTextAreaElement>(".composer-input")!;
    await act(async () => { textarea.focus(); textarea.blur(); window.dispatchEvent(new Event("blur")); });
    await key(textarea, "Tab");
    await click(textarea, 0);
    await click(ui.button("测试工具"));
    expect(ui.layout().expanded).toBe("true");
    await click(ui.button("展开输入框"));
    expect(ui.layout().expanded).toBe("false");
    await click(ui.button("默认助手"));
    await click(ui.host.querySelector(".message-scroll") ?? ui.host.querySelector(".active-chat-workspace")!);
    expect(ui.layout().expanded).toBe("false");
    await click(ui.button("默认助手"));
    await click(ui.host.querySelector(".active-chat-workspace")!);
    expect(ui.layout().expanded).toBe("false");
    await click(ui.button("默认助手"));
    await click(ui.host.querySelector(".chat-navigation-pane")!);
    await click(ui.host.querySelector(".conversation-cascade-pane")!);
    expect(ui.layout().expanded).toBe("true");
    await click(ui.host.querySelector(".conversation-workspace-body")!);
    expect(ui.layout().expanded).toBe("false");
    await click(ui.button("默认助手"));
    await click(textarea);
    expect(ui.layout()).toEqual({ open: "true", conversations: "true", expanded: "false" });
    await click(ui.button("默认助手"));
    await act(async () => textarea.focus());
    await click(textarea);
    expect(ui.layout().expanded).toBe("false");
    expect(ui.host.querySelector(".composer-input")).toBe(textarea);
    expect(textarea.value).toBe("保留原草稿");
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([1, 4]);
    expect(ui.workspace().view.draftSelection).toEqual({ start: 1, end: 4 });
    expect(ui.button("停止生成").disabled).toBe(false);
    expect(ui.onSend).not.toHaveBeenCalled();
    expect(ui.onStop).not.toHaveBeenCalled();
  });

  it("keeps expansion for scrolling, secondary clicks and locally rendered modal controls", async () => {
    const ui = await mount({ modelPicker: true });
    await click(ui.button("默认助手"));
    const region = ui.host.querySelector(".active-chat-workspace")!;
    await act(async () => {
      region.dispatchEvent(new Event("scroll", { bubbles: true }));
      region.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 2, detail: 1 }));
    });
    expect(ui.layout().expanded).toBe("true");
    // Keyboard activation opens the actual model picker without collapsing navigation.
    await click(ui.button("切换模型"), 0);
    const overlay = region.querySelector(".model-picker-backdrop")!;
    expect(overlay).not.toBeNull();
    await click(overlay.querySelector("input")!);
    await click(overlay);
    expect(ui.layout().expanded).toBe("true");
    await click(ui.button("关闭模型选择"));
    expect(ui.layout().expanded).toBe("true");
    await click(region);
    expect(ui.layout().expanded).toBe("false");
  });

  it.each([false, true])("the conversation handle exists only when closed and preserves assistantExpanded=%s", async assistantExpanded => {
    const ui = await mount();
    if (assistantExpanded) await click(ui.button("默认助手"));
    expect(ui.host.querySelector('.conversation-expand-handle')).toBeNull();
    await click(ui.button("收起对话栏"));
    await click(ui.button("展开对话列表"));
    expect(ui.layout()).toEqual({ open: "true", conversations: "true", expanded: String(assistantExpanded) });
    expect(ui.host.querySelector('.conversation-expand-handle')).toBeNull();
    expect(document.activeElement).toBe(ui.button("默认助手"));
    await click(ui.button("收起对话栏"));
    expect(ui.button("展开对话列表")).toBeDefined();
  });

  it("keeps compact assistants when conversations close and restores layout through sidebar toggles and page remounts", async () => {
    const ui = await mount();
    await click(ui.button("收起对话栏"));
    expect(ui.layout()).toEqual({ open: "true", conversations: "false", expanded: "false" });
    expect(document.activeElement).toBe(ui.button("默认助手"));
    await click(ui.button("助手与对话"));
    expect(ui.layout().open).toBe("false");
    await click(ui.host.querySelector(".composer-input")!);
    await click(ui.button("助手与对话"));
    expect(ui.layout()).toEqual({ open: "true", conversations: "false", expanded: "false" });
    await click(ui.button("切换测试页面"));
    expect(ui.host.querySelector(".conversation-workspace-body")).toBeNull();
    await click(ui.button("切换测试页面"));
    expect(ui.layout()).toEqual({ open: "true", conversations: "false", expanded: "false" });
    await click(ui.button("默认助手"));
    await click(ui.host.querySelector(".composer-input")!);
    await click(ui.button("助手与对话"));
    await click(ui.button("助手与对话"));
    expect(ui.layout()).toEqual({ open: "true", conversations: "true", expanded: "false" });
  });

  it("gives menus, delete confirmation and the expanded composer priority over closing navigation on Escape", async () => {
    const ui = await mount();
    await click(ui.button("默认助手"));
    const opener = ui.button("管理助手 默认助手");
    await click(opener);
    const menu = document.querySelector('[role="menu"]')!;
    expect(menu).not.toBeNull();
    await key(menu, "Escape");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(ui.layout().conversations).toBe("true");
    await click(ui.button("删除对话 对话二"));
    await key(ui.button("确认删除对话 对话二"), "Escape");
    expect(ui.button("删除对话 对话二")).toBeDefined();
    expect(ui.workspace().snapshot!.conversations.some(item => item.id === "second")).toBe(true);
    expect(ui.layout().conversations).toBe("true");
    await click(ui.button("展开输入框"));
    await key(ui.host.querySelector(".composer-input")!, "Escape");
    expect(ui.button("展开输入框")).toBeDefined();
    expect(ui.layout().conversations).toBe("true");
    await key(ui.host.querySelector(".composer-input")!, "Escape");
    expect(ui.layout()).toEqual({ open: "true", conversations: "false", expanded: "false" });
    await key(ui.host.querySelector(".composer-input")!, "Escape");
    expect(ui.layout().open).toBe("false");
  });

  it("closes management menus when their assistant controls become hidden and clears hidden delete confirmation", async () => {
    const ui = await mount();
    await click(ui.button("默认助手"));
    await click(ui.button("管理助手 默认助手"));
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    await click(ui.host.querySelector(".composer-input")!);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(ui.layout().expanded).toBe("false");
    expect(document.activeElement).toBe(ui.button("助手与对话"));
    await click(ui.button("默认助手"));
    await click(ui.button("管理助手 默认助手"));
    await click(ui.button("助手与对话"));
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(ui.host.querySelector("#assistant-navigation")?.hasAttribute("inert")).toBe(true);
    await click(ui.button("助手与对话"));
    await click(ui.button("删除对话 对话二"));
    await click(ui.button("收起对话栏"));
    expect(ui.host.querySelector('[aria-label="确认删除对话 对话二"]')).toBeNull();
    await click(ui.button("默认助手"));
    expect(ui.button("删除对话 对话二")).toBeDefined();
  });

  it("cancels dragging before Escape changes layout and suppresses the following pointer click", async () => {
    const ui = await mount();
    await click(ui.button("默认助手"));
    const execute = vi.spyOn(ui.repository, "execute");
    const handle = ui.button("拖动助手 默认助手");
    const target = ui.button("写作助手");
    vi.spyOn(document, "elementFromPoint").mockReturnValue(target);
    await act(async () => {
      handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, isPrimary: true, pointerId: 1, clientX: 10, clientY: 10 }));
      window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 30, clientY: 30 }));
    });
    expect(ui.host.querySelector('[data-dragging="true"]')).not.toBeNull();
    await key(handle, "Escape");
    expect(ui.host.querySelector('[data-dragging="true"]')).toBeNull();
    expect(ui.layout()).toEqual({ open: "true", conversations: "true", expanded: "true" });
    await act(async () => {
      window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 30, clientY: 30 }));
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    });
    expect(execute).not.toHaveBeenCalled();
    expect(ui.workspace().snapshot!.selection.activeAssistantId).toBe("default");
  });
});

describe("new assistant dialog", () => {
  it("opens with a focused empty name, rejects whitespace and cancels without creating", async () => {
    const ui = await mount();
    const execute = vi.spyOn(ui.repository, "execute");
    const opener = ui.button("新建助手");
    await act(async () => opener.focus());
    await click(opener);
    const name = ui.host.querySelector<HTMLInputElement>("#assistant-name")!;
    expect(name.value).toBe("");
    expect(document.activeElement).toBe(name);
    expect(ui.button("创建助手").disabled).toBe(true);
    await input(name, " \t  ");
    expect(ui.button("创建助手").disabled).toBe(true);
    await click(ui.button("取消"));
    expect(ui.host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(execute).not.toHaveBeenCalled();
    expect(ui.workspace().snapshot!.assistants).toHaveLength(2);
    await click(ui.button("新建助手"));
    await input(ui.host.querySelector<HTMLInputElement>("#assistant-name")!, "取消的助手");
    await key(ui.host.querySelector<HTMLInputElement>("#assistant-name")!, "Escape");
    expect(ui.host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(execute).not.toHaveBeenCalled();
  });

  it("allows duplicate names, ignores the legacy global avatar preference and creates once with the dialog's stable ID", async () => {
    const ui = await mount();
    localStorage.setItem(legacyAvatarKey, "violet");
    const id = "10000000-0000-4000-8000-000000000081";
    const randomUUID = vi.spyOn(crypto, "randomUUID").mockReturnValue(id);
    const originalExecute = ui.repository.execute.bind(ui.repository);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const execute = vi.spyOn(ui.repository, "execute").mockImplementation(async command => {
      await gate;
      return originalExecute(command);
    });
    await click(ui.button("新建助手"));
    await input(ui.host.querySelector<HTMLInputElement>("#assistant-name")!, "临时名称");
    await input(ui.host.querySelector<HTMLInputElement>("#assistant-name")!, "写作助手");
    expect(ui.button("创建助手").disabled).toBe(false);
    const submit = ui.button("创建助手");
    await act(async () => { submit.click(); submit.click(); });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ type: "create-assistant", id,
      input: expect.objectContaining({ name: "写作助手", icon: "" }) }));
    expect(randomUUID).toHaveBeenCalledTimes(1);
    await act(async () => release());
    await ui.settled();
    expect(ui.host.querySelector('[role="dialog"]')).toBeNull();
    const created = ui.workspace().snapshot!.assistants.find(item => item.id === id)!;
    expect(created.name).toBe("写作助手");
    expect(created.defaultAvatar).toBeUndefined();
    expect(created.icon).toBe("");
    expect(ui.workspace().snapshot!.assistants.filter(item => item.name === "写作助手")).toHaveLength(2);
    expect(localStorage.getItem(legacyAvatarKey)).toBe("violet");
  });

  it("retains dialog edits and its allocated identity after a failed create, then retries that same identity", async () => {
    const ui = await mount();
    const id = "20000000-0000-4000-8000-000000000081";
    const randomUUID = vi.spyOn(crypto, "randomUUID").mockReturnValue(id);
    const execute = vi.spyOn(ui.repository, "execute").mockRejectedValueOnce(new Error("synthetic save failure"));
    await click(ui.button("新建助手"));
    await input(ui.host.querySelector<HTMLInputElement>("#assistant-name")!, "重试助手");
    await click(ui.button("创建助手"));
    await ui.settled();
    expect(ui.host.querySelector<HTMLInputElement>("#assistant-name")!.value).toBe("重试助手");
    expect(ui.workspace().snapshot!.assistants).toHaveLength(2);
    await input(ui.host.querySelector<HTMLInputElement>("#assistant-name")!, "保存成功");
    await click(ui.button("创建助手"));
    await ui.settled();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.map(([command]) => command.type === "create-assistant" ? command.id : undefined)).toEqual([id, id]);
    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(ui.workspace().snapshot!.assistants.find(item => item.id === id)?.name).toBe("保存成功");
  });
});
