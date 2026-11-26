// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { defaultSessionConfig } from "../../chat/sessionConfig";
import { WebSearchControl, WebSearchToolbarControl } from "./WebSearchControl";
import { defaultSearchConfiguration, saveSearchConfiguration, SEARCH_SETTINGS_KEY } from "../../search/settings";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => localStorage.clear());

async function choose(host: HTMLElement, label: string) {
  await act(async () => host.querySelector<HTMLButtonElement>('[role="combobox"]')!.click());
  await act(async () => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === label)!.click());
}

it("maps the shared selector to the same search configuration without changing on open", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); const change = vi.fn(); const config = defaultSessionConfig();
  try {
    await act(async () => root.render(<WebSearchControl config={config} disabled={false} onChange={change} />));
    const trigger = host.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    const label = host.querySelector<HTMLLabelElement>("label")!;
    expect(trigger.id).toBeTruthy();
    expect(label.htmlFor).toBe(trigger.id);
    expect(label.contains(trigger)).toBe(false);
    await act(async () => trigger.click());
    expect(change).not.toHaveBeenCalled();
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent === "Exa API")!;
    await act(async () => option.click());
    expect(change).toHaveBeenCalledExactlyOnceWith({ ...config, webSearch: true, webSearchProvider: "exa-api" });
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("keeps old enabled configs native and changes the provider explicitly", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); const change = vi.fn();
  const config = { ...defaultSessionConfig(), webSearch: true };
  try {
    await act(async () => root.render(<WebSearchControl config={config} disabled={false} onChange={change} />));
    const select = host.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    expect(select.textContent).toBe("模型原生");
    await act(async () => select.click());
    expect([...document.querySelectorAll('[role="option"]')].map(option => option.textContent)).toEqual(["关闭", "模型原生", "DeepSeek 服务端联网", "Exa API", "Exa MCP"]);
    await act(async () => select.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(change).not.toHaveBeenCalled();
    await choose(host, "Exa MCP");
    expect(change).toHaveBeenLastCalledWith({ ...config, webSearchProvider: "exa-mcp" });
    await choose(host, "Exa API");
    expect(change).toHaveBeenLastCalledWith({ ...config, webSearchProvider: "exa-api" });
    await choose(host, "关闭");
    expect(change).toHaveBeenLastCalledWith({ ...config, webSearch: false, webSearchProvider: "native" });
    await act(async () => root.render(<WebSearchControl config={config} disabled onChange={change} />));
    expect(select.disabled).toBe(true);
    await act(async () => select.click()); expect(document.querySelector('[role="listbox"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("opens the globe menu at its current option, navigates with arrows, and restores focus", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); const change = vi.fn();
  try {
    await act(async () => root.render(<WebSearchToolbarControl mode="native" disabled={false} onChange={change} />));
    const trigger = host.querySelector("button")!;
    expect(trigger.getAttribute("aria-label")).toBe("联网搜索：模型原生");
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" })));
    const items = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
    expect(items.map((item) => item.textContent)).toEqual(["关闭", "模型原生", "DeepSeek 服务端联网", "Exa API", "Exa MCP"]);
    expect(document.activeElement).toBe(items[1]);
    expect(items[1].getAttribute("aria-checked")).toBe("true");
    await act(async () => items[1].dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" })));
    expect(document.activeElement).toBe(items[2]);
    await act(async () => items[2].dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" })));
    expect(document.activeElement).toBe(items[4]);
    await act(async () => items[4].dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Home" })));
    expect(document.activeElement).toBe(items[0]);
    await act(async () => items[0].dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" })));
    expect(document.activeElement).toBe(items[4]);
    await act(async () => items[4].click());
    expect(change).toHaveBeenLastCalledWith("exa-mcp");
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await act(async () => trigger.click());
    await act(async () => host.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })));
    expect(host.querySelector('[role="menu"]')).toBeNull(); expect(document.activeElement).toBe(trigger);
    await act(async () => trigger.click());
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(host.querySelector('[role="menu"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("disables the globe control until hydration", async () => {
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<WebSearchToolbarControl mode="off" disabled onChange={() => {}} />));
    expect(host.querySelector("button")!.disabled).toBe(true);
    expect(host.querySelector('[role="menu"]')).toBeNull();
  } finally { await act(async () => root.unmount()); }
});

it("refreshes both menus only after enabled settings are saved, and preserves a closed active selection", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); const change = vi.fn();
  const config = { ...defaultSessionConfig(), webSearch: true, webSearchProvider: "tavily" as const };
  try {
    await act(async () => root.render(<><WebSearchToolbarControl mode="tavily" disabled={false} onChange={change} />
      <WebSearchControl config={config} disabled={false} onChange={change} /></>));
    const trigger = host.querySelector("button")!;
    await act(async () => trigger.click());
    expect([...host.querySelectorAll('[role="menuitemradio"]')].map(item => item.textContent)).toEqual(["关闭", "模型原生", "DeepSeek 服务端联网", "Exa API", "Exa MCP"]);
    expect(trigger.getAttribute("aria-label")).toContain("已关闭");
    const select = host.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    expect(select.textContent).toBe("Tavily（已关闭或不可用）");
    expect(document.activeElement).toBe(host.querySelector('[role="menuitemradio"]'));
    await act(async () => select.click());
    const unavailable = document.querySelector<HTMLElement>('[role="option"][aria-disabled="true"]')!;
    expect(unavailable.textContent).toBe("Tavily（已关闭或不可用）");
    await act(async () => unavailable.click()); expect(change).not.toHaveBeenCalled();
    const saved = defaultSearchConfiguration();
    await act(async () => saveSearchConfiguration({
      ...saved,
      tavily: { ...saved.tavily, enabled: true, apiKey: "synthetic" },
      zhipu: { ...saved.zhipu, enabled: true, apiKey: "synthetic-z" },
      deepseek: { ...saved.deepseek, enabled: true, apiKey: "synthetic-d" },
    }));
    expect([...host.querySelectorAll('[role="menuitemradio"]')].map(item => item.textContent)).toEqual(["关闭", "模型原生", "DeepSeek 服务端联网", "Exa API", "Exa MCP", "Tavily", "智谱", "DeepSeek Search API"]);
    expect(document.querySelector('[role="option"][aria-disabled="true"]')).toBeNull();
    expect(select.textContent).toBe("Tavily");
    await act(async () => saveSearchConfiguration(saved));
    expect(host.querySelector('[role="menuitemradio"]')?.textContent).toBe("关闭");
    expect(host.querySelector('[role="menuitemradio"][aria-checked="true"]')).toBeNull();
    expect(change).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("preserves a disabled DeepSeek selection as unavailable in both controls until re-enabled", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); const change = vi.fn();
  const config = { ...defaultSessionConfig(), webSearch: true, webSearchProvider: "deepseek" as const };
  try {
    await act(async () => root.render(<><WebSearchToolbarControl mode="deepseek" disabled={false} onChange={change} />
      <WebSearchControl config={config} disabled={false} onChange={change} /></>));
    const trigger = host.querySelector("button")!;
    const select = host.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    expect(trigger.getAttribute("aria-label")).toBe("联网搜索：DeepSeek Search API（已关闭或不可用）");
    expect(select.textContent).toBe("DeepSeek Search API（已关闭或不可用）");
    const saved = defaultSearchConfiguration();
    await act(async () => saveSearchConfiguration({ ...saved, deepseek: { ...saved.deepseek, enabled: true, apiKey: "synthetic-d" } }));
    expect(trigger.getAttribute("aria-label")).toBe("联网搜索：DeepSeek Search API");
    expect(select.textContent).toBe("DeepSeek Search API");
    await choose(host, "关闭");
    expect(change).toHaveBeenLastCalledWith({ ...config, webSearch: false, webSearchProvider: "native" });
    await act(async () => root.render(<><WebSearchToolbarControl mode="off" disabled={false} onChange={change} />
      <WebSearchControl config={defaultSessionConfig()} disabled={false} onChange={change} /></>));
    await choose(host, "DeepSeek Search API");
    expect(change).toHaveBeenLastCalledWith({ ...defaultSessionConfig(), webSearch: true, webSearchProvider: "deepseek" });
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("does not expose new services from corrupt settings and preserves original data", async () => {
  const raw = '{"version":99,"apiKey":"synthetic"}'; localStorage.setItem(SEARCH_SETTINGS_KEY, raw);
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<><WebSearchToolbarControl mode="off" disabled={false} onChange={() => {}} />
      <WebSearchControl config={defaultSessionConfig()} disabled={false} onChange={() => {}} /></>));
    await act(async () => host.querySelector("button")!.click());
    expect(host.querySelector('[role="status"]')?.textContent).toContain("无法读取");
    expect(host.querySelectorAll('[role="menuitemradio"]')).toHaveLength(5);
    expect(host.querySelector('[role="combobox"]')?.getAttribute("title")).toContain("无法读取");
    expect(localStorage.getItem(SEARCH_SETTINGS_KEY)).toBe(raw);
  } finally { await act(async () => root.unmount()); }
});

it("renders DeepSeek server web tools with A1 sub-tool checkboxes, at-least-one guard, and protocol restrictions", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const onConfigChange = vi.fn();
  const onModeChange = vi.fn();
  const onToolsChange = vi.fn();
  const deepseekServerConfig = {
    ...defaultSessionConfig(),
    webSearch: true,
    webSearchProvider: "deepseek-server" as const,
    deepseekWebTools: { search: true, readUrl: true },
  };
  try {
    // 1) Supported protocol (openai-responses): sub-tool checkboxes toggle immediately without closing popover, at-least-one guard works
    await act(async () => root.render(<>
      <WebSearchToolbarControl
        mode="deepseek-server"
        protocol="openai-responses"
        deepseekWebTools={{ search: true, readUrl: true }}
        disabled={false}
        onChange={onModeChange}
        onDeepSeekWebToolsChange={onToolsChange}
      />
      <WebSearchControl
        config={deepseekServerConfig}
        protocol="openai-responses"
        disabled={false}
        onChange={onConfigChange}
      />
    </>));
    const trigger = host.querySelector<HTMLButtonElement>(".composer-tool-button")!;
    expect(trigger.getAttribute("aria-label")).toBe("联网搜索：DeepSeek 服务端联网");
    await act(async () => trigger.click());
    const popoverCheckboxes = [...host.querySelectorAll<HTMLInputElement>('.web-search-popover input[type="checkbox"]')];
    expect(popoverCheckboxes).toHaveLength(2);
    expect(popoverCheckboxes[0].checked).toBe(true);
    expect(popoverCheckboxes[1].checked).toBe(true);
    // Toggling readUrl off emits immediately and keeps popover open
    await act(async () => popoverCheckboxes[1].click());
    expect(onToolsChange).toHaveBeenCalledWith({ search: true, readUrl: false });
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
    // Escape closes popover and returns focus to trigger
    await act(async () => host.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })));
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    // At-least-one guard disables the last remaining checked box
    await act(async () => root.render(
      <WebSearchControl
        config={{ ...deepseekServerConfig, deepseekWebTools: { search: true, readUrl: false } }}
        protocol="anthropic-native"
        disabled={false}
        onChange={onConfigChange}
      />,
    ));
    const inlineChecks = [...host.querySelectorAll<HTMLInputElement>('.web-search-subtools input[type="checkbox"]')];
    expect(inlineChecks[0].checked).toBe(true);
    expect(inlineChecks[0].disabled).toBe(true);
    expect(inlineChecks[1].checked).toBe(false);
    expect(inlineChecks[1].disabled).toBe(false);
    expect(host.textContent).toContain("至少保留一项联网工具");

    // 2) openai-chat: disables selecting deepseek-server and marks active deepseek-server unavailable with exact reason
    onConfigChange.mockClear();
    await act(async () => root.render(<>
      <WebSearchToolbarControl mode="deepseek-server" protocol="openai-chat" disabled={false} onChange={onModeChange} />
      <WebSearchControl config={deepseekServerConfig} protocol="openai-chat" disabled={false} onChange={onConfigChange} />
    </>));
    expect(host.querySelector('[role="combobox"]')?.textContent).toBe("DeepSeek 服务端联网（当前协议不支持）");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Chat Completions 不支持 DeepSeek 服务端联网工具");
    await choose(host, "模型原生");
    expect(onConfigChange).toHaveBeenLastCalledWith({ ...deepseekServerConfig, webSearch: true, webSearchProvider: "native" });

    // 3) gemini-native: disables selecting deepseek-server
    await act(async () => root.render(
      <WebSearchControl config={defaultSessionConfig()} protocol="gemini-native" disabled={false} onChange={onConfigChange} />,
    ));
    await act(async () => host.querySelector<HTMLButtonElement>('[role="combobox"]')!.click());
    const disabledOpt = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent === "DeepSeek 服务端联网")!;
    expect(disabledOpt.getAttribute("aria-disabled")).toBe("true");
    await act(async () => host.querySelector<HTMLButtonElement>('[role="combobox"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));

    // 4) Unselected model (protocol undefined): shows "未选择模型", does NOT misreport protocol unsupported
    await act(async () => root.render(
      <WebSearchControl config={deepseekServerConfig} protocol={undefined} disabled={false} onChange={onConfigChange} />,
    ));
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("未选择模型");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
