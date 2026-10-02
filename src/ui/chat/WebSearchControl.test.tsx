// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { defaultSessionConfig } from "../../chat/sessionConfig";
import { WebSearchControl, WebSearchToolbarControl } from "./WebSearchControl";
import { defaultSearchConfiguration, saveSearchConfiguration, SEARCH_SETTINGS_KEY } from "../../search/settings";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => localStorage.clear());

it("maps the custom selector to the same search configuration without changing on open", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); const change = vi.fn(); const config = defaultSessionConfig();
  try {
    await act(async () => root.render(<WebSearchControl config={config} disabled={false} customSelect onChange={change} />));
    await act(async () => host.querySelector<HTMLButtonElement>('[role="combobox"]')!.click());
    expect(change).not.toHaveBeenCalled();
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent === "Exa API")!;
    await act(async () => option.click());
    expect(change).toHaveBeenCalledExactlyOnceWith({ ...config, webSearch: true, webSearchProvider: "exa-api" });
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("keeps old enabled configs native and changes the provider explicitly", async () => {
  const host = document.createElement("div"); const root = createRoot(host); const change = vi.fn();
  const config = { ...defaultSessionConfig(), webSearch: true };
  try {
    await act(async () => root.render(<WebSearchControl config={config} disabled={false} onChange={change} />));
    const select = host.querySelector("select")!;
    expect(select.value).toBe("native");
    expect([...select.options].map((option) => option.text)).toEqual(["关闭", "模型原生", "Exa API", "Exa MCP"]);
    await act(async () => { select.value = "exa-mcp"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(change).toHaveBeenLastCalledWith({ ...config, webSearchProvider: "exa-mcp" });
    await act(async () => { select.value = "exa-api"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(change).toHaveBeenLastCalledWith({ ...config, webSearchProvider: "exa-api" });
    await act(async () => { select.value = "off"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(change).toHaveBeenLastCalledWith({ ...config, webSearch: false, webSearchProvider: "native" });
    await act(async () => root.render(<WebSearchControl config={config} disabled onChange={change} />));
    expect(select.disabled).toBe(true);
  } finally { await act(async () => root.unmount()); }
});

it("opens the globe menu at its current option, navigates with arrows, and restores focus", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); const change = vi.fn();
  try {
    await act(async () => root.render(<WebSearchToolbarControl mode="native" disabled={false} onChange={change} />));
    const trigger = host.querySelector("button")!;
    expect(trigger.getAttribute("aria-label")).toBe("联网搜索：模型原生");
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" })));
    const items = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
    expect(items.map((item) => item.textContent)).toEqual(["关闭", "模型原生", "Exa API", "Exa MCP"]);
    expect(document.activeElement).toBe(items[1]);
    expect(items[1].getAttribute("aria-checked")).toBe("true");
    await act(async () => items[1].dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" })));
    expect(document.activeElement).toBe(items[2]);
    await act(async () => items[2].dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" })));
    expect(document.activeElement).toBe(items[3]);
    await act(async () => items[3].dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Home" })));
    expect(document.activeElement).toBe(items[0]);
    await act(async () => items[0].dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" })));
    expect(document.activeElement).toBe(items[3]);
    await act(async () => items[3].click());
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
    expect([...host.querySelectorAll('[role="menuitemradio"]')].map(item => item.textContent)).toEqual(["关闭", "模型原生", "Exa API", "Exa MCP"]);
    expect(trigger.getAttribute("aria-label")).toContain("已关闭"); expect(host.querySelector("select")!.value).toBe("tavily");
    expect(host.querySelector<HTMLOptionElement>('option[value="tavily"]')!.hidden).toBe(true);
    expect(document.activeElement).toBe(host.querySelector('[role="menuitemradio"]'));
    const saved = defaultSearchConfiguration();
    await act(async () => saveSearchConfiguration({ ...saved, tavily: { ...saved.tavily, enabled: true, apiKey: "synthetic" }, zhipu: { ...saved.zhipu, enabled: true, apiKey: "synthetic-z" } }));
    expect([...host.querySelectorAll('[role="menuitemradio"]')].map(item => item.textContent)).toEqual(["关闭", "模型原生", "Exa API", "Exa MCP", "Tavily", "智谱"]);
    expect(host.querySelector<HTMLOptionElement>('option[value="tavily"]')!.hidden).toBe(false);
    await act(async () => saveSearchConfiguration(saved));
    expect(host.querySelector('[role="menuitemradio"]')?.textContent).toBe("关闭");
    expect(host.querySelector('[role="menuitemradio"][aria-checked="true"]')).toBeNull();
    expect(change).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("does not expose new services from corrupt settings and preserves original data", async () => {
  const raw = '{"version":99,"apiKey":"synthetic"}'; localStorage.setItem(SEARCH_SETTINGS_KEY, raw);
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<WebSearchToolbarControl mode="off" disabled={false} onChange={() => {}} />));
    await act(async () => host.querySelector("button")!.click());
    expect(host.querySelector('[role="status"]')?.textContent).toContain("无法读取");
    expect(host.querySelectorAll('[role="menuitemradio"]')).toHaveLength(4);
    expect(localStorage.getItem(SEARCH_SETTINGS_KEY)).toBe(raw);
  } finally { await act(async () => root.unmount()); }
});
