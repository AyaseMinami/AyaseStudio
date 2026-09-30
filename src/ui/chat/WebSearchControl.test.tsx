// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { defaultSessionConfig } from "../../chat/sessionConfig";
import { WebSearchControl, WebSearchToolbarControl } from "./WebSearchControl";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

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
