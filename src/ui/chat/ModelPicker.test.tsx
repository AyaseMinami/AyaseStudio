// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { ConnectionSettingsState } from "../../chat/settings";
import { defaultSessionConfig } from "../../chat/sessionConfig";
import { ModelPicker } from "./ModelPicker";
import { ModelSelectField } from "./ModelSelectField";
import { SessionConfigPanel } from "./SessionConfigPanel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
  vi.restoreAllMocks();
});

async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function pressKey(target: EventTarget, key: string, init: KeyboardEventInit = {}) {
  let event!: KeyboardEvent;
  await act(async () => {
    event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
  });
  return event;
}

it("builds structured 3-tier hierarchy without merging duplicate connection/group names and deduplicates identical protocol labels", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const settings: ConnectionSettingsState = {
    version: 3,
    activeModelId: null,
    providers: [
      {
        id: "p-google",
        name: "Google",
        presetId: "gemini",
        connections: [
          {
            id: "c-same-1",
            name: "  gemini 聊天 ",
            protocol: "gemini-native",
            baseUrl: "https://example.invalid",
            apiKey: "",
            modelGroups: [{ id: "g-1", name: "gemini-4" }],
            models: [
              { id: "m-custom", modelId: "gemini-4-neon", displayName: "Gemini 4 Neon", groupId: "g-1" },
              { id: "m-auto", modelId: "gemini-4-flash", displayName: "gemini-4-flash" },
            ],
          },
          {
            id: "c-same-2",
            name: "Gemini 聊天",
            protocol: "gemini-native",
            baseUrl: "https://backup.invalid",
            apiKey: "",
            models: [{ id: "m-backup", modelId: "gemini-4-pro" }],
          },
          {
            id: "c-custom-name",
            name: "香港专线",
            protocol: "openai-chat",
            baseUrl: "https://hk.invalid",
            apiKey: "",
            models: [{ id: "m-hk", modelId: "gpt-5.3-chat" }],
          },
        ],
      },
    ],
  };
  const select = vi.fn(async () => true);

  try {
    await act(async () =>
      root.render(
        <ModelPicker settings={settings} selectedModelId={null} disabled={false} onSelect={select} onClose={() => {}} />,
      ),
    );

    // Single chat-capable provider hides top filter pills and keeps L1 provider heading with avatar.
    expect(document.querySelector(".chat-model-picker-pills")).toBeNull();
    expect(document.querySelectorAll(".chat-model-picker-provider-heading")).toHaveLength(1);
    expect(document.querySelector(".chat-model-picker-provider-heading .chat-model-picker-provider-avatar")).not.toBeNull();
    expect(document.querySelector(".chat-model-picker-provider-name")?.textContent).toBe("Google");

    // Two same-name, same-protocol connections stay separate L2 sections and deduplicate identical protocol badge.
    const connectionSections = [...document.querySelectorAll(".chat-model-picker-connection-section")];
    expect(connectionSections).toHaveLength(3);
    expect(connectionSections[0].querySelector(".chat-model-picker-connection-name")?.textContent).toBe("gemini 聊天");
    expect(connectionSections[0].querySelector(".chat-model-picker-protocol-badge")).toBeNull();
    expect(connectionSections[1].querySelector(".chat-model-picker-connection-name")?.textContent).toBe("Gemini 聊天");
    expect(connectionSections[1].querySelector(".chat-model-picker-protocol-badge")).toBeNull();
    expect(connectionSections[2].querySelector(".chat-model-picker-connection-name")?.textContent).toBe("香港专线");
    expect(connectionSections[2].querySelector(".chat-model-picker-protocol-badge")?.textContent).toBe("OpenAI Chat");

    // Custom group vs same-name automatic group remain distinct (#119).
    const firstConnGroups = [...connectionSections[0].querySelectorAll(".chat-model-picker-group-section")];
    expect(firstConnGroups).toHaveLength(2);
    expect(firstConnGroups[0].querySelector(".chat-model-picker-custom-badge")?.textContent).toBe("自定义");
    expect(firstConnGroups[1].querySelector(".chat-model-picker-custom-badge")).toBeNull();

    // Secondary monospace modelId only renders when distinct from primary label.
    const customRow = document.querySelector<HTMLButtonElement>('[data-value="m-custom"]')!;
    expect(customRow.querySelector("strong")?.textContent).toBe("Gemini 4 Neon");
    expect(customRow.querySelector("small")?.textContent).toBe("gemini-4-neon");
    expect(customRow.title).toContain("Google");
    expect(customRow.title).toContain("gemini-4（自定义）");

    const sameAliasRow = document.querySelector<HTMLButtonElement>('[data-value="m-auto"]')!;
    expect(sameAliasRow.querySelector("strong")?.textContent).toBe("gemini-4-flash");
    expect(sameAliasRow.querySelector("small")).toBeNull();

    // Clicking the model in the second duplicate-name connection returns its exact model.id.
    await act(async () => document.querySelector<HTMLButtonElement>('[data-value="m-backup"]')!.click());
    expect(select).toHaveBeenCalledExactlyOnceWith("m-backup");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("shows provider filter pills for 2+ chat providers, omits L1 when filtered, and bridges cross-provider search empty states", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const settings: ConnectionSettingsState = {
    version: 3,
    activeModelId: null,
    providers: [
      {
        id: "p-google",
        name: "Google",
        presetId: "gemini",
        connections: [
          {
            id: "c-g",
            name: "主连接",
            protocol: "gemini-native",
            baseUrl: "https://example.invalid",
            apiKey: "",
            models: [{ id: "m-neon", modelId: "gemini-4-neon", displayName: "Gemini 4 Neon" }],
          },
        ],
      },
      {
        id: "p-deepseek",
        name: "DeepSeek",
        presetId: "deepseek",
        connections: [
          {
            id: "c-ds",
            name: "官方接口",
            protocol: "openai-chat",
            baseUrl: "https://example.invalid",
            apiKey: "",
            models: [
              { id: "m-ds-chat", modelId: "deepseek-chat" },
              { id: "m-ds-reason", modelId: "deepseek-reasoner" },
            ],
          },
        ],
      },
      {
        id: "p-drawing-only",
        name: "仅绘图供应商",
        connections: [
          {
            id: "c-img",
            name: "绘图",
            protocol: "openai-images",
            baseUrl: "https://example.invalid",
            apiKey: "",
            models: [{ id: "m-img", modelId: "gpt-image-1" }],
          },
        ],
      },
    ],
  };

  try {
    await act(async () =>
      root.render(
        <ModelPicker settings={settings} selectedModelId={null} disabled={false} onSelect={async () => true} onClose={() => {}} />,
      ),
    );

    const pills = [...document.querySelectorAll<HTMLButtonElement>(".chat-model-picker-pill")];
    // "全部 (3)", "Google (1)", "DeepSeek (2)" — drawing-only provider excluded.
    expect(pills).toHaveLength(3);
    expect(pills[0].textContent).toContain("全部");
    expect(pills[0].textContent).toContain("3");
    expect(pills[0].getAttribute("aria-pressed")).toBe("true");
    expect(pills[1].textContent).toContain("Google");
    expect(pills[1].textContent).toContain("1");
    expect(pills[2].textContent).toContain("DeepSeek");
    expect(pills[2].textContent).toContain("2");
    expect(document.querySelectorAll(".chat-model-picker-provider-heading")).toHaveLength(2);

    // Selecting DeepSeek omits L1 provider heading and scopes visible options.
    await act(async () => pills[2].click());
    expect(pills[2].getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelectorAll(".chat-model-picker-provider-heading")).toHaveLength(0);
    expect(document.querySelectorAll(".model-picker-option")).toHaveLength(2);

    // Searching for "google neon" inside DeepSeek shows cross-provider count + one-click action outside listbox.
    const input = document.querySelector<HTMLInputElement>(".model-picker-search input")!;
    await typeInto(input, "google neon");
    expect(document.querySelectorAll(".model-picker-option")).toHaveLength(0);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.getAttribute("aria-controls")).toBeNull();
    expect(document.querySelector(".model-picker-empty")?.textContent).toContain("其他供应商有 1 个匹配");

    const viewAllBtn = document.querySelector<HTMLButtonElement>(".chat-model-picker-empty-action")!;
    expect(viewAllBtn.closest('[role="listbox"]')).toBeNull();
    expect(viewAllBtn.textContent).toBe("在全部供应商中查看");
    await act(async () => viewAllBtn.click());

    expect(pills[0].getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelectorAll(".model-picker-option")).toHaveLength(1);
    expect(document.querySelector(".model-picker-option")?.getAttribute("data-value")).toBe("m-neon");

    // Shrinking providers from 2+ down to 1 while filtered clears stale invisible filter, restores L1 heading,
    // and expanding back to 2+ stays on "全部" instead of reviving the old filter.
    await act(async () => pills[1].click());
    expect(document.querySelectorAll(".chat-model-picker-provider-heading")).toHaveLength(0);
    await typeInto(input, "");
    const singleProviderSettings: ConnectionSettingsState = {
      ...settings,
      providers: [settings.providers[0]],
    };
    await act(async () =>
      root.render(
        <ModelPicker settings={singleProviderSettings} selectedModelId={null} disabled={false} onSelect={async () => true} onClose={() => {}} />,
      ),
    );
    expect(document.querySelector(".chat-model-picker-pills")).toBeNull();
    expect(document.querySelectorAll(".chat-model-picker-provider-heading")).toHaveLength(1);

    await act(async () =>
      root.render(
        <ModelPicker settings={settings} selectedModelId={null} disabled={false} onSelect={async () => true} onClose={() => {}} />,
      ),
    );
    const restoredPills = [...document.querySelectorAll<HTMLButtonElement>(".chat-model-picker-pill")];
    expect(restoredPills[0].getAttribute("aria-pressed")).toBe("true");
    expect(restoredPills[1].getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelectorAll(".chat-model-picker-provider-heading")).toHaveLength(2);
    expect(document.querySelectorAll(".model-picker-option")).toHaveLength(3);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("supports multi-token cross-field search, clear button focus return, scroll-into-view, combobox keyboard flow, and IME protection", async () => {
  const scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const settings: ConnectionSettingsState = {
    version: 3,
    activeModelId: null,
    providers: [
      {
        id: "p",
        name: "OpenAI",
        connections: [
          {
            id: "c",
            name: "主连接",
            protocol: "openai-responses",
            baseUrl: "https://example.invalid",
            apiKey: "",
            modelGroups: [{ id: "g", name: "常用" }],
            models: [
              { id: "m-1", modelId: "gpt-5.3-chat", displayName: "主力对话", groupId: "g" },
              { id: "m-2", modelId: "gpt-5.3-thinking", displayName: "深度思考" },
              { id: "m-3", modelId: "gpt-5.3-mini", displayName: "极速版" },
            ],
          },
        ],
      },
    ],
  };
  const onSelect = vi.fn(async () => true);
  const onClose = vi.fn();

  try {
    await act(async () =>
      root.render(
        <ModelPicker settings={settings} selectedModelId="m-2" disabled={false} onSelect={onSelect} onClose={onClose} />,
      ),
    );

    const input = document.querySelector<HTMLInputElement>(".model-picker-search input")!;
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("role")).toBe("combobox");
    // Scrolls valid selected model into view on open.
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });

    // Home/End stay native for text cursor editing.
    const homeEvent = await pressKey(input, "Home");
    const endEvent = await pressKey(input, "End");
    expect(homeEvent.defaultPrevented).toBe(false);
    expect(endEvent.defaultPrevented).toBe(false);

    // IME composing (isComposing and keyCode 229 independently) ignores ArrowDown / Enter / Escape.
    await pressKey(input, "ArrowDown", { isComposing: true });
    expect(input.getAttribute("aria-activedescendant")).toBeNull();
    await pressKey(input, "ArrowDown", { keyCode: 229 } as KeyboardEventInit);
    expect(input.getAttribute("aria-activedescendant")).toBeNull();
    await pressKey(input, "Escape", { isComposing: true });
    await pressKey(input, "Escape", { keyCode: 229 } as KeyboardEventInit);
    expect(onClose).not.toHaveBeenCalled();

    // Automatic family group sorts alphabetically by modelId, so visible order is [m-1 (custom), m-3 (mini), m-2 (thinking)].
    // ArrowDown from selected m-2 (last item) wraps to m-1 while keeping focus in search input.
    await pressKey(input, "ArrowDown");
    expect(document.activeElement).toBe(input);
    const activeIdAfterDown = input.getAttribute("aria-activedescendant");
    expect(activeIdAfterDown).toBeTruthy();
    expect(document.getElementById(activeIdAfterDown!)?.getAttribute("data-value")).toBe("m-1");
    expect(document.getElementById(activeIdAfterDown!)?.getAttribute("data-active")).toBe("true");

    // Enter with keyCode 229 alone does not commit selection.
    await pressKey(input, "Enter", { keyCode: 229 } as KeyboardEventInit);
    expect(onSelect).not.toHaveBeenCalled();

    // Next ArrowDown moves to m-3.
    await pressKey(input, "ArrowDown");
    expect(document.getElementById(input.getAttribute("aria-activedescendant")!)?.getAttribute("data-value")).toBe("m-3");

    // Typing a query resets scrolled results position and scrolls the newly activated top hit into view.
    const results = document.querySelector<HTMLDivElement>(".chat-model-picker-results")!;
    results.scrollTop = 600;
    scrollIntoView.mockClear();
    await typeInto(input, "主连接 自定义 gpt-5.3");
    expect(results.scrollTop).toBe(0);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(document.querySelectorAll(".model-picker-option")).toHaveLength(1);
    expect(document.querySelector(".model-picker-option")?.getAttribute("data-value")).toBe("m-1");

    // Clear search button restores focus from the button itself back to search input.
    const clearBtn = document.querySelector<HTMLButtonElement>(".chat-model-picker-clear")!;
    expect(clearBtn).not.toBeNull();
    await act(async () => clearBtn.focus());
    expect(document.activeElement).toBe(clearBtn);
    await act(async () => clearBtn.click());
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(document.querySelector(".chat-model-picker-clear")).toBeNull();
    expect(document.querySelectorAll(".model-picker-option")).toHaveLength(3);

    // ArrowUp from selected m-2 activates m-3, Enter confirms selection.
    await pressKey(input, "ArrowUp");
    await pressKey(input, "Enter");
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("m-3");
    expect(onClose).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("places unset action in footer when allowEmpty is true, shows chat models only, and surfaces async false/rejected errors", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const settings: ConnectionSettingsState = {
    version: 3,
    activeModelId: null,
    providers: [
      {
        id: "provider",
        name: "Synthetic",
        connections: [
          { id: "chat", name: "Chat", protocol: "gemini-native", baseUrl: "https://example.test", apiKey: "", models: [{ id: "chat-model", modelId: "chat/example" }] },
          { id: "image", name: "Drawing", protocol: "gemini-image", baseUrl: "https://example.test", apiKey: "", models: [{ id: "image-model", modelId: "image/example" }] },
        ],
      },
    ],
  };

  let resolvePending!: (ok: boolean) => void;
  const onSelect = vi
    .fn<(modelId: string) => Promise<boolean>>()
    .mockImplementationOnce(() => new Promise<boolean>((resolve) => { resolvePending = resolve; }))
    .mockRejectedValueOnce(new Error("boom"))
    .mockResolvedValueOnce(true);
  const onClose = vi.fn();

  try {
    await act(async () =>
      root.render(
        <ModelPicker
          settings={settings}
          selectedModelId="image-model"
          disabled={false}
          allowEmpty
          hint="仅修改配置草稿，点击保存后生效。"
          onSelect={onSelect}
          onClose={onClose}
        />,
      ),
    );

    const panel = document.querySelector(".model-picker")!;
    expect(panel.textContent).toContain("chat/example");
    expect(panel.textContent).not.toContain("image/example");
    expect(panel.querySelector('[role="status"]')?.textContent).toContain("当前模型已失效，请重新选择。");
    expect(panel.querySelector(".chat-model-picker-hint")?.textContent).toBe("仅修改配置草稿，点击保存后生效。");

    // "设为未选择" lives in footer, NOT as a listbox option row.
    expect(panel.querySelectorAll(".model-picker-option")).toHaveLength(1);
    const unsetBtn = panel.querySelector<HTMLButtonElement>(".chat-model-picker-unset")!;
    expect(unsetBtn.textContent).toBe("设为未选择");

    // 1) Async returning false keeps dialog open, serializes concurrent clicks, blocks Escape while pending, and renders alert.
    const option = panel.querySelector<HTMLButtonElement>('[data-value="chat-model"]')!;
    await act(async () => {
      option.click();
      option.click();
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    await pressKey(panel, "Escape");
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => resolvePending(false));
    expect(onClose).not.toHaveBeenCalled();
    expect(panel.querySelector('[role="alert"]')?.textContent).toContain("未能切换模型");

    // 2) Async throwing keeps dialog open and renders alert.
    await act(async () => option.click());
    expect(onClose).not.toHaveBeenCalled();
    expect(panel.querySelector('[role="alert"]')?.textContent).toContain("未能切换模型");

    // 3) Clicking footer "设为未选择" submits empty string and closes on true.
    await act(async () => unsetBtn.click());
    expect(onSelect).toHaveBeenLastCalledWith("");
    expect(onClose).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("preserves nested modal isolation inside SessionConfigPanel (Escape, backdrop, inert, paste/drop, Tab trap, focus return)", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const settings: ConnectionSettingsState = {
    version: 3,
    activeModelId: null,
    providers: [
      {
        id: "p1",
        name: "Provider A",
        connections: [{ id: "c1", name: "Conn 1", protocol: "openai-chat", baseUrl: "https://example.invalid", apiKey: "", models: [{ id: "m1", modelId: "model-1" }] }],
      },
      {
        id: "p2",
        name: "Provider B",
        connections: [{ id: "c2", name: "Conn 2", protocol: "gemini-native", baseUrl: "https://example.invalid", apiKey: "", models: [{ id: "m2", modelId: "model-2" }] }],
      },
    ],
  };
  const closeParent = vi.fn();
  const pasteParent = vi.fn();
  const dropParent = vi.fn();
  const dragOverParent = vi.fn();
  let finishSelect: ((ok: boolean) => void) | undefined;
  const onSelect = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finishSelect = resolve;
      }),
  );

  try {
    await act(async () =>
      root.render(
        <div onPaste={pasteParent} onDrop={dropParent} onDragOver={dragOverParent}>
          <SessionConfigPanel
            presentation="modal"
            title="编辑对话"
            config={defaultSessionConfig()}
            errors={{}}
            model="model-1"
            onChange={() => {}}
            onClose={closeParent}
            onReset={() => {}}
          >
            <ModelSelectField
              id="conversation-model"
              label="当前对话模型"
              settings={settings}
              selectedModelId="m1"
              disabled={false}
              onSelect={onSelect}
            />
          </SessionConfigPanel>
        </div>,
      ),
    );

    const trigger = document.getElementById("conversation-model") as HTMLButtonElement;
    trigger.focus();
    await act(async () => trigger.click());

    const backdrop = document.querySelector<HTMLElement>(".chat-model-picker-backdrop")!;
    const dialog = document.querySelector<HTMLElement>(".chat-model-picker")!;
    expect(backdrop).not.toBeNull();
    expect(container.inert).toBe(true);

    // Paste / drop / dragover inside picker do not leak to parent workspace.
    dialog.dispatchEvent(new Event("paste", { bubbles: true }));
    const dropEvent = new Event("drop", { bubbles: true, cancelable: true });
    dialog.dispatchEvent(dropEvent);
    const dragOverEvent = new Event("dragover", { bubbles: true, cancelable: true });
    dialog.dispatchEvent(dragOverEvent);
    expect(dropEvent.defaultPrevented).toBe(true);
    expect(dragOverEvent.defaultPrevented).toBe(true);
    expect(pasteParent).not.toHaveBeenCalled();
    expect(dropParent).not.toHaveBeenCalled();
    expect(dragOverParent).not.toHaveBeenCalled();

    // Tab trap cycles only among tabbable controls (excluding tabIndex=-1 option buttons).
    const closeBtn = dialog.querySelector<HTMLButtonElement>(".chat-model-picker-close")!;
    const unsetBtn = dialog.querySelector<HTMLButtonElement>(".chat-model-picker-unset")!;
    await act(async () => {
      closeBtn.focus();
    });
    await pressKey(closeBtn, "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(unsetBtn);
    await pressKey(unsetBtn, "Tab");
    expect(document.activeElement).toBe(closeBtn);

    // Even when child dialog loses focus to document.body, Escape still closes ONLY ModelPicker, never SessionConfigPanel.
    await act(async () => {
      closeBtn.blur();
    });
    expect(document.activeElement).toBe(document.body);
    await pressKey(document.body, "Escape");
    expect(document.querySelector(".chat-model-picker")).toBeNull();
    expect(closeParent).not.toHaveBeenCalled();
    expect(container.inert).toBe(false);
    expect(document.activeElement).toBe(trigger);

    // While saving is pending and focus is blurred, Escape is blocked from closing either dialog.
    await act(async () => trigger.click());
    const option2 = document.querySelector<HTMLButtonElement>('[data-value="m2"]')!;
    await act(async () => {
      option2.click();
    });
    await act(async () => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    await pressKey(document.body, "Escape");
    expect(document.querySelector(".chat-model-picker")).not.toBeNull();
    expect(closeParent).not.toHaveBeenCalled();
    await act(async () => finishSelect?.(true));
    expect(document.querySelector(".chat-model-picker")).toBeNull();

    // Backdrop mousedown also closes only ModelPicker.
    await act(async () => trigger.click());
    const backdrop2 = document.querySelector<HTMLElement>(".chat-model-picker-backdrop")!;
    await act(async () => {
      backdrop2.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(document.querySelector(".chat-model-picker")).toBeNull();
    expect(closeParent).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
