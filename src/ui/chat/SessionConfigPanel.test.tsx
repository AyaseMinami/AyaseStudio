// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { defaultSessionConfig } from "../../chat/sessionConfig";
import type { ConnectionSettingsState } from "../../chat/settings";
import { ModelSelectField } from "./ModelSelectField";
import { SessionConfigPanel } from "./SessionConfigPanel";
import { ThinkingControl } from "./ThinkingControl";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("keeps the stream switch controlled and within the disabled panel", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const change = vi.fn(); const config = defaultSessionConfig();
  const render = (stream: boolean, disabled = false) => root.render(<SessionConfigPanel config={{ ...config, stream }} errors={{}} model="synthetic" disabled={disabled}
    onChange={change} onClose={() => {}} onReset={() => {}} />);
  try {
    await act(async () => render(false));
    const stream = host.querySelector<HTMLInputElement>("#session-stream")!;
    expect(stream.getAttribute("role")).toBe("switch");
    expect(stream.checked).toBe(false);
    expect(stream.labels?.[0]?.textContent).toContain("流式输出");
    await act(async () => stream.click());
    expect(change).toHaveBeenLastCalledWith({ ...config, stream: true });
    await act(async () => render(true, true));
    expect(stream.checked).toBe(true);
    expect(stream.closest("fieldset")?.disabled).toBe(true);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("maps numeric modes, cancels the popup before the dialog, and preserves errors", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const change = vi.fn(); const close = vi.fn(); const config = defaultSessionConfig();
  try {
    await act(async () => root.render(<SessionConfigPanel config={config} errors={{ temperature: "Synthetic error" }} model="synthetic"
      onChange={change} onClose={close} onReset={() => {}} />));
    const trigger = host.querySelector<HTMLButtonElement>("#config-temperature")!;
    expect(trigger.getAttribute("aria-label")).toBe("Temperature");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Synthetic error");
    await act(async () => trigger.click());
    expect(document.querySelector('[role="listbox"]')?.id).toBe(trigger.getAttribute("aria-controls"));
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(close).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled();
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(change).toHaveBeenLastCalledWith({ ...config, temperature: { mode: "custom", value: "" } });
    await act(async () => root.render(<SessionConfigPanel config={{ ...config, temperature: { mode: "custom", value: "0.7" } }} errors={{}} model="synthetic"
      onChange={change} onClose={close} onReset={() => {}} />));
    await act(async () => trigger.click());
    await act(async () => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === "自动")!.click());
    expect(change).toHaveBeenLastCalledWith(config);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("keeps unsupported custom values visible, blocks custom selection, and disables modes with the panel", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const change = vi.fn(); const config = { ...defaultSessionConfig(), topK: { mode: "custom" as const, value: "12" } };
  const render = (disabled = false) => root.render(<SessionConfigPanel config={config} errors={{}} protocol="openai-chat" model="synthetic" disabled={disabled}
    onChange={change} onClose={() => {}} onReset={() => {}} />);
  try {
    await act(async () => render());
    const trigger = host.querySelector<HTMLButtonElement>("#config-topK")!;
    expect(trigger.textContent).toBe("自定义");
    expect(host.querySelector<HTMLInputElement>('[aria-label="Top-K 自定义值"]')?.value).toBe("12");
    expect(host.querySelector<HTMLInputElement>('[aria-label="Top-K 自定义值"]')?.disabled).toBe(true);
    await act(async () => trigger.click());
    const custom = document.querySelector<HTMLElement>('[role="option"][aria-disabled="true"]')!;
    expect(custom.textContent).toBe("自定义");
    await act(async () => custom.click()); expect(change).not.toHaveBeenCalled();
    await act(async () => render(true));
    expect(trigger.disabled).toBe(true); expect(document.querySelector('[role="listbox"]')).toBeNull();
    await act(async () => trigger.click()); expect(document.querySelector('[role="listbox"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("links field errors, protocol hints, and reset guidance through aria-describedby and aria-invalid", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const base = defaultSessionConfig();
  const config = {
    ...base,
    temperature: { mode: "custom" as const, value: "bad" },
    customJson: { ...base.customJson, "anthropic-native": "{" },
  };
  try {
    await act(async () => root.render(<SessionConfigPanel
      presentation="modal"
      config={config}
      errors={{
        temperature: "温度无效",
        systemInstruction: "提示词超长",
        stream: "流式配置无效",
        customJson: "JSON 语法错误",
      }}
      protocol="anthropic-native"
      model="claude-synthetic"
      resetLabel="恢复助手默认值"
      resetHint="仅更新草稿，不改标题。"
      footer={<button type="button">保存</button>}
      onChange={() => {}}
      onClose={() => {}}
      onReset={() => {}}
    />));

    const tempInput = host.querySelector<HTMLInputElement>('[aria-label="Temperature 自定义值"]')!;
    expect(tempInput.getAttribute("aria-invalid")).toBe("true");
    expect(tempInput.getAttribute("aria-describedby")).toContain("config-temperature-error");
    expect(host.querySelector("#config-temperature-error")?.textContent).toBe("温度无效");

    const systemTextarea = host.querySelector<HTMLTextAreaElement>("#session-system")!;
    expect(systemTextarea.getAttribute("aria-invalid")).toBe("true");
    expect(systemTextarea.getAttribute("aria-describedby")).toBe("session-system-error");
    expect(host.querySelector("#session-system-error")?.textContent).toBe("提示词超长");

    const stream = host.querySelector<HTMLInputElement>("#session-stream")!;
    expect(stream.closest(".session-config-stream-cell")).not.toBeNull();
    expect(stream.getAttribute("aria-invalid")).toBe("true");
    expect(stream.getAttribute("aria-describedby")).toBe("session-stream-error");

    const maxOutput = host.querySelector<HTMLButtonElement>("#config-maxOutput")!;
    expect(maxOutput.getAttribute("aria-describedby")).toContain("session-anthropic-max-output-hint");
    expect(host.querySelector("#session-anthropic-max-output-hint")?.textContent).toContain("4096");

    const customJson = host.querySelector<HTMLTextAreaElement>("#session-custom-json")!;
    expect(customJson.getAttribute("aria-invalid")).toBe("true");
    expect(customJson.getAttribute("aria-describedby")).toContain("session-custom-json-hint");
    expect(customJson.getAttribute("aria-describedby")).toContain("session-custom-json-error");
    expect(host.querySelector("#session-custom-json-error")?.textContent).toBe("JSON 语法错误");

    const resetButton = host.querySelector<HTMLButtonElement>(".session-config-reset")!;
    expect(resetButton.getAttribute("aria-describedby")).toBe("session-config-reset-hint");
    expect(host.querySelector("#session-config-reset-hint")?.textContent).toBe("仅更新草稿，不改标题。");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("marks the mode selector invalid and deduplicates unsupported parameter error copy", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const config = { ...defaultSessionConfig(), topK: { mode: "custom" as const, value: "10" } };
  const reason = "OpenAI API 不提供 Top-K 请求字段。";
  try {
    await act(async () => root.render(<SessionConfigPanel
      config={config}
      errors={{ topK: reason }}
      protocol="openai-chat"
      model="gpt-5-synthetic"
      onChange={() => {}}
      onClose={() => {}}
      onReset={() => {}}
    />));

    const trigger = host.querySelector<HTMLButtonElement>("#config-topK")!;
    const input = host.querySelector<HTMLInputElement>('[aria-label="Top-K 自定义值"]')!;
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
    expect(trigger.getAttribute("aria-describedby")).toBe("config-topK-error");
    expect(input.disabled).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(host.querySelector("#config-topK-hint")).toBeNull();
    const errorNode = host.querySelector("#config-topK-error")!;
    expect(errorNode.getAttribute("role")).toBe("alert");
    expect(errorNode.textContent).toBe(reason);
    expect(host.textContent?.split(reason).length).toBe(2);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("scrolls keyboard-focused clipped controls into view without shifting scroll on pointer focus", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<SessionConfigPanel
      presentation="modal"
      config={defaultSessionConfig()}
      errors={{}}
      protocol="anthropic-native"
      model="claude-synthetic"
      onChange={() => {}}
      onClose={() => {}}
      onReset={() => {}}
    />));

    const panel = host.querySelector<HTMLElement>(".session-config-panel")!;
    const scroller = host.querySelector<HTMLDivElement>(".session-config-panel-scroll")!;
    const maxOutput = host.querySelector<HTMLButtonElement>("#config-maxOutput")!;
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 79, 600, 310));
    vi.spyOn(maxOutput, "getBoundingClientRect").mockReturnValue(new DOMRect(16, 365, 260, 36));

    scroller.scrollTop = 100;
    await act(async () => {
      panel.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      maxOutput.focus();
    });
    expect(scroller.scrollTop).toBe(100);

    await act(async () => {
      maxOutput.blur();
      panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      maxOutput.focus();
    });
    // bottom 401 - (scroller bottom 389 - 12px pad) = +24px
    expect(scroller.scrollTop).toBe(124);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("splits general config and system prompt into accessible tabs while preserving unapplied child drafts", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const onReset = vi.fn();
  const base = defaultSessionConfig();
  const config = {
    ...base,
    systemInstruction: "你好👋世界",
  };
  try {
    await act(async () => root.render(<SessionConfigPanel
      presentation="modal"
      config={config}
      errors={{ customJson: "自定义 JSON 结构无效", stored: "原配置版本无效" }}
      generalBlocker="请先在“常规配置”中填写助手名称后再保存。"
      globalError="保存助手失败，请重试。"
      model=""
      onChange={() => {}}
      onClose={() => {}}
      onReset={onReset}
      footer={<button type="button">保存助手</button>}
    >
      <ThinkingControl
        protocol="gemini-native"
        model="gemini-synthetic"
        value={{ choice: "budget", budget: "1024", includeSummary: true }}
        disabled={false}
        onChange={() => {}}
      />
    </SessionConfigPanel>));

    const generalTab = host.querySelector<HTMLButtonElement>("#session-config-tab-general")!;
    const promptTab = host.querySelector<HTMLButtonElement>("#session-config-tab-prompt")!;
    const generalPanel = host.querySelector<HTMLDivElement>("#session-config-tabpanel-general")!;
    const promptPanel = host.querySelector<HTMLDivElement>("#session-config-tabpanel-prompt")!;

    // Default active tab is general; prompt tab displays non-empty badge and grapheme count.
    expect(generalTab.getAttribute("aria-selected")).toBe("true");
    expect(generalTab.tabIndex).toBe(0);
    expect(promptTab.getAttribute("aria-selected")).toBe("false");
    expect(promptTab.tabIndex).toBe(-1);
    expect(generalPanel.hidden).toBe(false);
    expect(promptPanel.hidden).toBe(true);
    expect(promptTab.textContent).toContain("已填写");
    expect(host.querySelector(".session-config-prompt-count")?.textContent).toBe("5 字");

    // customJson error is visible even without a selected protocol.
    expect(host.querySelector("#session-custom-json-error")?.textContent).toBe("自定义 JSON 结构无效");

    // Type an unapplied thinking budget draft before switching tabs.
    const budgetInput = host.querySelector<HTMLInputElement>('[aria-label="思考 Token 预算"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(budgetInput, "2048");
      budgetInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(budgetInput.value).toBe("2048");

    // General blocker stays hidden while already on general tab; global stored/save errors are visible.
    expect(host.textContent).not.toContain("请先在“常规配置”中填写助手名称后再保存。");
    expect(host.textContent).toContain("原配置版本无效");
    expect(host.textContent).toContain("保存助手失败，请重试。");

    // ArrowRight on tablist switches to prompt tab and moves focus to prompt tab button.
    await act(async () => {
      generalTab.focus();
      generalTab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(promptTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(promptTab);
    expect(generalPanel.hidden).toBe(true);
    expect(promptPanel.hidden).toBe(false);
    // General blocker and global alerts remain visible while on prompt tab.
    expect(host.textContent).toContain("请先在“常规配置”中填写助手名称后再保存。");
    expect(host.textContent).toContain("原配置版本无效");
    expect(host.textContent).toContain("保存助手失败，请重试。");

    // Reset while on prompt tab stays on prompt tab and announces reset.
    const resetBtn = host.querySelector<HTMLButtonElement>(".session-config-reset")!;
    await act(async () => resetBtn.click());
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(promptTab.getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector('.sr-only[role="status"]')?.textContent).toBe("已恢复到草稿");

    // Home returns to general tab and unapplied budget input is preserved.
    await act(async () => {
      promptTab.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    });
    expect(generalTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(generalTab);
    expect(host.querySelector<HTMLInputElement>('[aria-label="思考 Token 预算"]')?.value).toBe("2048");
    expect(host.querySelector(".thinking-budget-applied")?.textContent).toContain("1024");

    // Tab switching still works when panel is disabled (busy).
    await act(async () => root.render(<SessionConfigPanel
      presentation="modal"
      disabled
      config={{ ...base, systemInstruction: 123 as unknown as string }}
      errors={{ systemInstruction: "系统指令必须是文本。" }}
      model=""
      onChange={() => {}}
      onClose={() => {}}
      onReset={onReset}
      footer={<button type="button" disabled>保存助手</button>}
    />));
    expect(promptTab.disabled).toBe(false);
    expect(promptTab.querySelector(".session-config-tab-alert")).not.toBeNull();
    await act(async () => promptTab.click());
    expect(promptTab.getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector<HTMLTextAreaElement>("#session-system")?.value).toBe("");
    expect(host.querySelector(".session-config-prompt-count")?.textContent).toBe("未填写");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("displays only the model name on ModelSelectField trigger while keeping provider and connection in title", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const settings: ConnectionSettingsState = {
    version: 3,
    activeModelId: "m-1",
    providers: [{
      id: "p-1",
      name: "测试供应商1",
      connections: [{
        id: "c-1",
        name: "测试连接",
        protocol: "gemini-native",
        baseUrl: "https://synthetic.example/v1beta",
        apiKey: "",
        models: [{ id: "m-1", modelId: "gemini-3.8-flash" }],
      }],
    }],
  };
  try {
    await act(async () => root.render(<ModelSelectField
      id="conversation-model"
      label="当前对话模型"
      settings={settings}
      selectedModelId="m-1"
      disabled={false}
      onSelect={async () => true}
    />));
    const trigger = host.querySelector<HTMLButtonElement>("#conversation-model")!;
    expect(trigger.textContent).toBe("gemini-3.8-flash");
    expect(trigger.title).toBe("测试供应商1 / 测试连接 / gemini-3.8-flash");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("ignores negative-tabIndex initialFocusId targets and keeps Tab trapped when focused save button turns disabled", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const render = (disabled: boolean) => root.render(<SessionConfigPanel
    presentation="modal"
    disabled={disabled}
    initialFocusId="session-config-tab-prompt"
    config={defaultSessionConfig()}
    errors={{}}
    model="synthetic"
    onChange={() => {}}
    onClose={() => {}}
    onReset={() => {}}
    footer={<button id="test-save" type="button" disabled={disabled}>保存助手</button>}
  />);
  try {
    await act(async () => render(false));
    const closeBtn = host.querySelector<HTMLButtonElement>(".session-config-close")!;
    const generalTab = host.querySelector<HTMLButtonElement>("#session-config-tab-general")!;
    const promptTab = host.querySelector<HTMLButtonElement>("#session-config-tab-prompt")!;
    const saveBtn = host.querySelector<HTMLButtonElement>("#test-save")!;
    // Inactive prompt tab has tabIndex === -1 and must not steal initial focus.
    expect(promptTab.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(closeBtn);

    // Focus the save button, then turn the panel busy so the focused button becomes disabled.
    await act(async () => saveBtn.focus());
    expect(document.activeElement).toBe(saveBtn);
    await act(async () => render(true));
    expect(saveBtn.disabled).toBe(true);

    // Pressing Tab from a now-disabled button stays trapped inside the dialog on the active tab.
    const panel = host.querySelector<HTMLElement>(".session-config-panel")!;
    await act(async () => {
      panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(document.activeElement).toBe(generalTab);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
