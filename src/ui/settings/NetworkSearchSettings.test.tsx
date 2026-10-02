// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { NetworkSearchSettings } from "./NetworkSearchSettings";
import { defaultSearchConfiguration, defaultSearchSettings, loadSearchConfiguration, saveSearchConfiguration, type ExternalSearchProvider } from "../../search/settings";
import { searchExa } from "../../search/runtime";
import { openExternal } from "../../chat/externalLinks";

vi.mock("../../search/settings", async (original) => {
  const actual = await original<typeof import("../../search/settings")>();
  return { ...actual, loadSearchConfiguration: vi.fn(), saveSearchConfiguration: vi.fn() };
});
vi.mock("../../search/runtime", () => ({ searchExa: vi.fn() }));
vi.mock("../../chat/externalLinks", async (original) => ({
  ...await original<typeof import("../../chat/externalLinks")>(), openExternal: vi.fn(async () => {}),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => {
  vi.mocked(loadSearchConfiguration).mockReset().mockReturnValue(defaultSearchConfiguration());
  vi.mocked(saveSearchConfiguration).mockReset().mockImplementation((settings) => {
    vi.mocked(loadSearchConfiguration).mockReturnValue(settings);
    return settings;
  });
  vi.mocked(searchExa).mockReset().mockResolvedValue({ sources: [{ id: "one", title: "Exa", url: "https://exa.ai", excerpt: "Public API documentation" }] });
  vi.mocked(openExternal).mockReset().mockResolvedValue(undefined);
});
async function mount() {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(<NetworkSearchSettings />));
  const card = (provider: ExternalSearchProvider = "exa-mcp") => host.querySelector<HTMLElement>('[aria-labelledby="' + provider + '-title"]')!;
  const button = (text: string, provider?: ExternalSearchProvider) => {
    const area = provider ? card(provider) : host;
    return [...area.querySelectorAll("button")].find((element) => element.textContent === text || element.getAttribute("aria-label") === text)!;
  };
  const click = async (text: string, provider: ExternalSearchProvider = "exa-mcp") => {
    await act(async () => button(text, provider).click());
  };
  const field = (name: string, provider: ExternalSearchProvider = "exa-mcp") => host.querySelector<HTMLInputElement>("#" + provider + "-" + name)!;
  const change = async (name: string, value: string, provider: ExternalSearchProvider = "exa-mcp") => {
    const input = field(name, provider);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const choose = async (name: string, value: string, provider: ExternalSearchProvider) => {
    const select = host.querySelector<HTMLSelectElement>("#" + provider + "-" + name)!;
    await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
  };
  const toggle = async (provider: ExternalSearchProvider) => { await act(async () => field("enabled", provider).click()); };
  const help = async (label: string) => {
    const trigger = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}说明"]`)!;
    await act(async () => trigger.focus());
    const tooltip = document.getElementById(trigger.getAttribute("aria-describedby")!)!;
    expect(tooltip.getAttribute("role")).toBe("tooltip");
    const text = tooltip.textContent;
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await act(async () => trigger.blur());
    return text;
  };
  return { host, root, card, button, click, field, change, choose, toggle, help, cleanup: async () => { await act(async () => root.unmount()); host.remove(); } };
}

it("opens masked independent profiles and saves anonymous MCP without network", async () => {
  const ui = await mount();
  try {
    expect(ui.field("api-key").type).toBe("password");
    expect(ui.field("api-key", "exa-api").type).toBe("password");
    expect(ui.field("api-key", "exa-api").required).toBe(true);
    expect(ui.field("base-url", "exa-api").value).toBe("https://api.exa.ai");
    expect(await ui.help("Exa MCP API Key")).toContain("本机以明文保存");
    expect(await ui.help("Exa MCP测试搜索")).toContain("不保存设置，也不使用聊天记录或附件");
    expect(searchExa).not.toHaveBeenCalled();
    await ui.click("保存搜索设置");
    expect(saveSearchConfiguration).toHaveBeenCalledWith(defaultSearchConfiguration());
    expect(searchExa).not.toHaveBeenCalled();
    expect(ui.card().textContent).toContain("搜索设置已保存");
  } finally { await ui.cleanup(); }
});

it("requires an API key for both saving and testing API while MCP remains anonymous", async () => {
  const ui = await mount();
  try {
    await ui.click("保存搜索设置", "exa-api"); await ui.click("测试搜索", "exa-api");
    expect(ui.card("exa-api").textContent).toContain("Exa API 需要 API Key");
    expect(saveSearchConfiguration).not.toHaveBeenCalled(); expect(searchExa).not.toHaveBeenCalled();
    await ui.click("测试搜索");
    expect(searchExa).toHaveBeenCalledWith(defaultSearchSettings(), "What is the Exa search API?", expect.any(AbortSignal), "exa-mcp");
    await ui.change("api-key", "synthetic-api-secret", "exa-api");
    await ui.click("测试搜索", "exa-api");
    expect(searchExa).toHaveBeenLastCalledWith({ ...defaultSearchSettings("exa-api"), baseUrl: "https://api.exa.ai/", apiKey: "synthetic-api-secret" }, "What is the Exa search API?", expect.any(AbortSignal), "exa-api");
    expect(saveSearchConfiguration).not.toHaveBeenCalled();
  } finally { await ui.cleanup(); }
});

it("saves one profile without persisting the other draft and keeps earlier saved profiles", async () => {
  const ui = await mount();
  try {
    await ui.change("api-key", "draft-mcp-secret");
    await ui.change("num-results", "3");
    await ui.change("api-key", "saved-api-secret", "exa-api");
    await ui.change("num-results", "7", "exa-api");
    await ui.click("保存搜索设置", "exa-api");
    const apiProfile = { ...defaultSearchSettings("exa-api"), baseUrl: "https://api.exa.ai/", apiKey: "saved-api-secret", numResults: 7 };
    expect(saveSearchConfiguration).toHaveBeenLastCalledWith({ ...defaultSearchConfiguration(), exaApi: apiProfile });
    expect(ui.field("api-key").value).toBe("draft-mcp-secret"); expect(ui.field("num-results").value).toBe("3");
    await ui.change("api-key", "unsaved-api-secret", "exa-api");
    await ui.click("保存搜索设置");
    expect(saveSearchConfiguration).toHaveBeenLastCalledWith({ ...defaultSearchConfiguration(), exaApi: apiProfile, exaMcp: { ...defaultSearchSettings(), apiKey: "draft-mcp-secret", numResults: 3 } });
    expect(ui.field("api-key", "exa-api").value).toBe("unsaved-api-secret");
  } finally { await ui.cleanup(); }
});

it("restores only the selected address and clears only its key with explicit actions", async () => {
  vi.mocked(loadSearchConfiguration).mockReturnValue({ ...defaultSearchConfiguration(),
    exaMcp: { ...defaultSearchSettings(), baseUrl: "https://search.example/mcp", apiKey: "synthetic-mcp-secret" },
    exaApi: { ...defaultSearchSettings("exa-api"), apiKey: "synthetic-api-secret" } });
  const ui = await mount();
  try {
    await ui.click("恢复官方地址");
    expect(ui.field("base-url").value).toBe(defaultSearchSettings().baseUrl);
    expect(ui.field("api-key").value).toBe("synthetic-mcp-secret");
    expect(saveSearchConfiguration).not.toHaveBeenCalled();
    await ui.click("清空 Key");
    expect(ui.field("api-key").value).toBe("");
    expect(ui.field("api-key", "exa-api").value).toBe("synthetic-api-secret");
    await act(async () => ui.card("exa-api").querySelector<HTMLButtonElement>('[aria-label="显示 Exa API Key"]')!.click());
    expect(ui.field("api-key", "exa-api").type).toBe("text"); expect(ui.field("api-key").type).toBe("password");
  } finally { await ui.cleanup(); }
});

it("retains both drafts on save failure without updating the other saved profile", async () => {
  vi.mocked(saveSearchConfiguration).mockImplementationOnce(() => { throw new Error("secret-from-storage"); }).mockImplementation((settings) => settings);
  const ui = await mount();
  try {
    await ui.change("api-key", "unsaved-mcp-secret");
    await ui.change("api-key", "synthetic-api-secret", "exa-api");
    await ui.click("保存搜索设置", "exa-api");
    expect(ui.card("exa-api").textContent).toContain("草稿已保留");
    expect(ui.host.textContent).not.toContain("secret-from-storage");
    expect(ui.field("api-key", "exa-api").value).toBe("synthetic-api-secret");
    expect(ui.field("api-key").value).toBe("unsaved-mcp-secret");
    await ui.click("保存搜索设置");
    expect(saveSearchConfiguration).toHaveBeenLastCalledWith({ ...defaultSearchConfiguration(), exaMcp: { ...defaultSearchSettings(), apiKey: "unsaved-mcp-secret" } });
  } finally { await ui.cleanup(); }
});

it("tests a current draft snapshot with a fixed public query without saving or citation warning", async () => {
  const ui = await mount();
  try {
    await ui.change("base-url", "https://search.example/mcp"); await ui.change("api-key", "synthetic-search-secret"); await ui.change("num-results", "3");
    await ui.click("测试搜索");
    expect(searchExa).toHaveBeenCalledWith({ ...defaultSearchSettings(), baseUrl: "https://search.example/mcp", apiKey: "synthetic-search-secret", numResults: 3 }, "What is the Exa search API?", expect.any(AbortSignal), "exa-mcp");
    expect(saveSearchConfiguration).not.toHaveBeenCalled(); expect(ui.card().textContent).toContain("已检索 · 1 个来源");
    expect(ui.host.textContent).not.toContain("正文未提供有效引用");
  } finally { await ui.cleanup(); }
});

it.each<ExternalSearchProvider>(["exa-mcp", "exa-api", "tavily", "zhipu"])("stops %s promptly and ignores its late result", async (provider) => {
  let finish!: (value: Awaited<ReturnType<typeof searchExa>>) => void;
  vi.mocked(searchExa).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const ui = await mount();
  try {
    if (provider !== "exa-mcp") await ui.change("api-key", "synthetic-api-secret", provider);
    await ui.click("测试搜索", provider);
    const signal = vi.mocked(searchExa).mock.calls[0][2]!;
    expect(ui.card(provider).textContent).toContain("正在搜索 · " + ({ "exa-api": "Exa API", "exa-mcp": "Exa MCP", tavily: "Tavily", zhipu: "智谱" })[provider]);
    expect(ui.card(provider === "exa-api" ? "exa-mcp" : "exa-api").querySelector("fieldset")!.disabled).toBe(false);
    await ui.click("停止测试", provider);
    expect(signal.aborted).toBe(true); expect(ui.card(provider).textContent).toContain("搜索已取消");
    await act(async () => finish({ sources: [{ id: "late", title: "Late", url: "https://late.example", excerpt: "late" }] }));
    expect(ui.host.textContent).not.toContain("Late"); expect(ui.card(provider).textContent).toContain("搜索已取消");
  } finally { await ui.cleanup(); }
});

it("rejects invalid counts before save or test", async () => {
  const ui = await mount();
  try {
    await ui.change("num-results", "11"); await ui.click("测试搜索");
    expect(ui.host.querySelector('[role="alert"]')?.textContent).toContain("1 至 10");
    expect(searchExa).not.toHaveBeenCalled(); expect(saveSearchConfiguration).not.toHaveBeenCalled();
  } finally { await ui.cleanup(); }
});

it("rejects an API endpoint with query parameters before saving or testing", async () => {
  const ui = await mount();
  try {
    await ui.change("api-key", "synthetic-api-secret", "exa-api");
    await ui.change("base-url", "https://api.exa.ai?custom=true", "exa-api");
    await ui.click("保存搜索设置", "exa-api"); await ui.click("测试搜索", "exa-api");
    expect(ui.card("exa-api").textContent).toContain("不能包含查询参数或片段");
    expect(saveSearchConfiguration).not.toHaveBeenCalled(); expect(searchExa).not.toHaveBeenCalled();
  } finally { await ui.cleanup(); }
});

it("shows safe adapter failures distinctly and lets the user retry", async () => {
  vi.mocked(searchExa).mockRejectedValueOnce(new Error("Exa 搜索请求失败（HTTP 429），未自动重试。"));
  const ui = await mount();
  try {
    await ui.click("测试搜索");
    expect(ui.host.textContent).toContain("HTTP 429"); expect(ui.host.textContent).toContain("搜索失败");
    expect(saveSearchConfiguration).not.toHaveBeenCalled();
    await ui.click("测试搜索"); expect(ui.host.textContent).toContain("已检索 · 1 个来源");
  } finally { await ui.cleanup(); }
});

it("recovers corrupted configuration as explicit default drafts with no automatic writes", async () => {
  vi.mocked(loadSearchConfiguration).mockImplementation(() => { throw new Error("private-storage-error"); });
  const ui = await mount();
  try {
    expect(ui.host.textContent).toContain("无法读取搜索设置"); expect(ui.host.textContent).not.toContain("private-storage-error");
    await act(async () => ui.button("使用默认设置编辑").click());
    expect(ui.host.textContent).toContain("原本机配置保持不变");
    expect(saveSearchConfiguration).not.toHaveBeenCalled(); expect(searchExa).not.toHaveBeenCalled();
    await ui.click("保存搜索设置");
    expect(saveSearchConfiguration).toHaveBeenCalledWith(defaultSearchConfiguration());
  } finally { await ui.cleanup(); }
});

it.each<"tavily" | "zhipu">(["tavily", "zhipu"])("defaults %s off and saves a blank-key disabled draft without requests", async (provider) => {
  const ui = await mount();
  try {
    expect(ui.field("enabled", provider).checked).toBe(false);
    expect(ui.field("api-key", provider).type).toBe("password");
    expect(ui.field("api-key", provider).required).toBe(false);
    expect(await ui.help((provider === "tavily" ? "Tavily" : "智谱") + "启用")).toContain("启用并保存后出现在聊天搜索菜单");
    await ui.click("保存搜索设置", provider);
    expect(saveSearchConfiguration).toHaveBeenCalledOnce();
    expect(vi.mocked(saveSearchConfiguration).mock.calls[0][0][provider]).toMatchObject({ enabled: false, apiKey: "" });
    expect(searchExa).not.toHaveBeenCalled();
    await ui.toggle(provider);
    expect(ui.field("api-key", provider).required).toBe(true);
    await ui.click("保存搜索设置", provider);
    expect(ui.card(provider).textContent).toContain("需要 API Key");
    expect(saveSearchConfiguration).toHaveBeenCalledOnce();
    expect(searchExa).not.toHaveBeenCalled();
  } finally { await ui.cleanup(); }
});

it.each<"tavily" | "zhipu">(["tavily", "zhipu"])("requires a key for explicit %s tests while disabled and tests only its draft", async (provider) => {
  const ui = await mount();
  try {
    await ui.click("测试搜索", provider);
    expect(ui.card(provider).textContent).toContain("需要 API Key");
    expect(searchExa).not.toHaveBeenCalled();
    await ui.change("api-key", "synthetic-" + provider + "-secret", provider);
    await ui.change("num-results", "3", provider);
    await ui.change("api-key", "unrelated-secret", "exa-mcp");
    await ui.click("测试搜索", provider);
    expect(searchExa).toHaveBeenCalledExactlyOnceWith({ ...defaultSearchConfiguration()[provider],
      baseUrl: defaultSearchConfiguration()[provider].baseUrl + "/", apiKey: "synthetic-" + provider + "-secret", numResults: 3 },
    "上海今天的天气", expect.any(AbortSignal), provider);
    expect(saveSearchConfiguration).not.toHaveBeenCalled();
    expect(ui.field("enabled", provider).checked).toBe(false);
    expect(ui.field("api-key", "exa-mcp").value).toBe("unrelated-secret");
    expect(ui.card(provider).textContent).toContain("消耗服务商额度或产生费用");
    expect(ui.host.textContent).not.toContain("正文未提供有效引用");
  } finally { await ui.cleanup(); }
});

it("persists independent provider choices and enable toggles without other drafts", async () => {
  const ui = await mount();
  try {
    await ui.choose("search-depth", "advanced", "tavily");
    await ui.change("api-key", "synthetic-tavily", "tavily");
    await ui.toggle("tavily");
    await ui.choose("search-engine", "search_pro_quark", "zhipu");
    await ui.change("api-key", "synthetic-zhipu", "zhipu");
    await ui.toggle("zhipu");
    expect(saveSearchConfiguration).not.toHaveBeenCalled();
    expect(searchExa).not.toHaveBeenCalled();
    await ui.click("保存搜索设置", "tavily");
    const savedTavily = { ...defaultSearchConfiguration().tavily, baseUrl: "https://api.tavily.com/", apiKey: "synthetic-tavily", enabled: true, searchDepth: "advanced" };
    expect(saveSearchConfiguration).toHaveBeenLastCalledWith({ ...defaultSearchConfiguration(), tavily: savedTavily });
    await ui.change("api-key", "unsaved-tavily", "tavily");
    await ui.click("保存搜索设置", "zhipu");
    const savedZhipu = { ...defaultSearchConfiguration().zhipu, baseUrl: "https://open.bigmodel.cn/", apiKey: "synthetic-zhipu", enabled: true, searchEngine: "search_pro_quark" };
    expect(saveSearchConfiguration).toHaveBeenLastCalledWith({ ...defaultSearchConfiguration(), tavily: savedTavily, zhipu: savedZhipu });
    expect(ui.field("api-key", "tavily").value).toBe("unsaved-tavily");
    await ui.toggle("tavily");
    await ui.click("保存搜索设置", "tavily");
    expect(saveSearchConfiguration).toHaveBeenLastCalledWith({ ...defaultSearchConfiguration(),
      tavily: { ...savedTavily, apiKey: "unsaved-tavily", enabled: false }, zhipu: savedZhipu });
    expect(searchExa).not.toHaveBeenCalled();
    await ui.cleanup();
    const restored = await mount();
    try {
      expect(restored.field("enabled", "tavily").checked).toBe(false);
      expect(restored.field("enabled", "zhipu").checked).toBe(true);
      expect(restored.card("tavily").querySelector<HTMLSelectElement>("select")!.value).toBe("advanced");
      expect(restored.card("zhipu").querySelector<HTMLSelectElement>("select")!.value).toBe("search_pro_quark");
    } finally { await restored.cleanup(); }
  } finally { if (ui.host.isConnected) await ui.cleanup(); }
});

it("merges a card into freshly saved configuration without overwriting external changes", async () => {
  const ui = await mount();
  try {
    const externallySaved = { ...defaultSearchConfiguration(), zhipu: { ...defaultSearchConfiguration().zhipu, apiKey: "external-zhipu", enabled: true, searchEngine: "search_pro" as const } };
    vi.mocked(loadSearchConfiguration).mockReturnValue(externallySaved);
    await ui.click("保存搜索设置", "tavily");
    expect(saveSearchConfiguration).toHaveBeenLastCalledWith({ ...externallySaved, tavily: { ...defaultSearchConfiguration().tavily, baseUrl: "https://api.tavily.com/" } });
    expect(ui.field("api-key", "zhipu").value).toBe("");
  } finally { await ui.cleanup(); }
});

it("shows provider prices and opens only clicked official links safely", async () => {
  const ui = await mount();
  try {
    const tavily = ui.card("tavily"); const zhipu = ui.card("zhipu");
    expect(tavily.textContent).toContain("1,000 credits");
    const tavilyPricing = await ui.help("Tavily 计费");
    const zhipuPricing = await ui.help("智谱计费与限制");
    for (const text of ["$0.008/credit", "$8/1,000", "$16/1,000", "不会自动升级"]) expect(tavilyPricing).toContain(text);
    for (const text of ["¥0.01/次", "¥0.03/次", "¥0.05/次", "Coding Plan", "不代表包含本接口额度", "70 个字符"]) expect(zhipuPricing).toContain(text);
    expect([...tavily.querySelectorAll("option")].map(option => option.textContent)).toEqual(["Basic（1 credit/次）", "Advanced（2 credits/次）"]);
    const links = [...tavily.querySelectorAll("a"), ...zhipu.querySelectorAll("a")];
    expect(links.map(link => link.getAttribute("href"))).toEqual(["https://app.tavily.com", "https://docs.tavily.com/documentation/api-credits", "https://bigmodel.cn", "https://docs.bigmodel.cn/cn/guide/tools/web-search"]);
    expect(openExternal).not.toHaveBeenCalled();
    for (const link of links) {
      await act(async () => link.click());
      expect(openExternal).toHaveBeenLastCalledWith(link.getAttribute("href"));
      expect(link.rel).toBe("noopener noreferrer");
    }
    vi.mocked(openExternal).mockRejectedValueOnce(new Error("private-link-error"));
    await act(async () => links[0].click());
    expect(tavily.textContent).toContain("无法打开链接");
    expect(ui.host.textContent).not.toContain("private-link-error");
    expect(searchExa).not.toHaveBeenCalled();
  } finally { await ui.cleanup(); }
});

it.each<ExternalSearchProvider>(["tavily", "zhipu"])("keeps %s test errors and retry results isolated", async (provider) => {
  vi.mocked(searchExa).mockRejectedValueOnce(new Error("测试服务请求失败（HTTP 429），未自动重试。"));
  const ui = await mount();
  try {
    await ui.change("api-key", "synthetic-secret", provider);
    await ui.click("测试搜索", provider);
    expect(ui.card(provider).textContent).toContain("HTTP 429");
    expect(ui.card(provider === "tavily" ? "zhipu" : "tavily").textContent).not.toContain("HTTP 429");
    expect(saveSearchConfiguration).not.toHaveBeenCalled();
    expect(searchExa).toHaveBeenCalledOnce();
    await ui.click("测试搜索", provider);
    expect(ui.card(provider).textContent).toContain("已检索 · 1 个来源");
    expect(searchExa).toHaveBeenCalledTimes(2);
  } finally { await ui.cleanup(); }
});
