// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createProviderFromTemplate, deleteProvider, renameProvider, type ConnectionSettingsState } from "../../chat/settings";
import { avatarLibrary } from "../../avatar/library";
import { materializeBrandAvatar } from "../../avatar/brandCatalog";
import { ConnectionSettings, type ConnectionSettingsProps } from "./ConnectionSettings";

vi.mock("../../avatar/library", () => ({ avatarLibrary: { list: vi.fn(), usages: vi.fn(), select: vi.fn() } }));
vi.mock("../../avatar/brandCatalog", async (original) => ({ ...await original<typeof import("../../avatar/brandCatalog")>(), materializeBrandAvatar: vi.fn() }));
vi.mock("../../avatar/providerAvatars", () => ({ providerAvatarRepository: { get: vi.fn() } }));
let root: Root, host: HTMLDivElement, props: ConnectionSettingsProps;
const initial: ConnectionSettingsState = { version: 3, activeModelId: "model", providers: [
  { id: "builtin", name: "已改名", presetId: "openai", avatar: { kind: "builtin", id: "gemini" }, connections: [
    { id: "builtin-connection", name: "改过的连接", protocol: "openai-chat", presetProtocol: "openai-chat", baseUrl: "https://relay.example.invalid/v1", apiKey: "synthetic", models: [{ id: "model", modelId: "test-model" }] },
  ] },
  { id: "custom", name: "OpenAI", connections: [] },
  { id: "qwen", name: "千问", presetId: "qwen", connections: [
    { id: "qwen-connection", name: "千问 Anthropic", protocol: "anthropic-native", presetProtocol: "anthropic-native", baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic", apiKey: "", models: [] },
  ] },
] };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.clearAllMocks();
  Object.defineProperty(window, "confirm", { configurable: true, value: vi.fn(() => true) });
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) { this.open = false; });
  vi.mocked(avatarLibrary.list).mockResolvedValue([]); vi.mocked(avatarLibrary.usages).mockResolvedValue([]);
  props = {
    connectionSettings: structuredClone(initial), isStreaming: false, modelCatalogs: {}, modelTests: {},
    onAddConnection: vi.fn(() => "new-connection"), onAddModel: vi.fn(() => "new-model"),
    onAddProvider: vi.fn((id, name) => {
      const providerId = `new-${id}`;
      props.connectionSettings = createProviderFromTemplate(props.connectionSettings, id, { providerId, name, prepend: id === "custom", connectionIds: Object.fromEntries(["openai-chat", "openai-responses", "openai-images", "anthropic-native", "gemini-native", "gemini-image", "grok-images", "seedream-images"].map(protocol => [protocol, `new-${id}-${protocol}`])) });
      root.render(<ConnectionSettings {...props} />); return providerId;
    }),
    onCancelModelCatalogRefresh: vi.fn(), onCancelModelTest: vi.fn(), onConnectionChange: vi.fn(), onDeleteConnection: vi.fn(), onDeleteModel: vi.fn(),
    onDeleteProvider: vi.fn(id => { props.connectionSettings = deleteProvider(props.connectionSettings, id); root.render(<ConnectionSettings {...props} />); }),
    onModelChange: vi.fn(), onProviderRename: vi.fn((id, name) => { props.connectionSettings = renameProvider(props.connectionSettings, id, name); root.render(<ConnectionSettings {...props} />); }),
    onProviderMove: vi.fn(), onConnectionMove: vi.fn(), onRefreshModelCatalog: vi.fn(async () => {}), onRunModelTest: vi.fn(async () => {}), onSelectModel: vi.fn(),
    onProviderAvatarChange: vi.fn(async () => true), onResetConnection: vi.fn(),
  };
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
async function render() { await act(async () => root.render(<ConnectionSettings {...props} />)); }
function button(label: string) {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")];
  const result = buttons.find(button => button.getAttribute("aria-label") === label) ?? buttons.find(button => button.textContent === label);
  expect(result, label).toBeTruthy(); return result!;
}
async function click(label: string) { await act(async () => button(label).click()); }
async function submitName(name: string) {
  const input = host.querySelector<HTMLInputElement>('[name="providerName"]')!;
  await act(async () => { input.value = name; input.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
}

it("creates only a focused ephemeral draft and saves a required custom name at the top", async () => {
  await render(); await click("添加供应商");
  const input = host.querySelector<HTMLInputElement>('[name="providerName"]')!;
  expect(document.activeElement).toBe(input); expect(input.value).toBe(""); expect(input.required).toBe(true);
  expect(input.placeholder).toBe("输入供应商名称"); expect(props.onAddProvider).not.toHaveBeenCalled();
  await submitName("   "); expect(props.onAddProvider).not.toHaveBeenCalled();
  expect(host.textContent).toContain("请输入供应商名称");
  await submitName("  新供应商  ");
  expect(props.onAddProvider).toHaveBeenCalledWith("custom", "新供应商");
  expect(props.connectionSettings.providers[0].name).toBe("新供应商");
  expect(props.connectionSettings.providers[0].connections).toHaveLength(0);
  expect(host.querySelector(".connection-provider-detail h3")?.textContent).toBe("新供应商");
  expect(host.querySelector('[name="providerName"]')).toBeNull();
});

it.each(["Escape", "取消新供应商"])("discards the draft with %s without a durable provider", async (method) => {
  await render(); await click("添加供应商");
  if (method === "Escape") await act(async () => host.querySelector("input[name=providerName]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  else await click(method);
  expect(props.onAddProvider).not.toHaveBeenCalled(); expect(props.connectionSettings.providers).toHaveLength(3);
  expect(host.querySelector('[name="providerName"]')).toBeNull(); expect(document.activeElement).toBe(button("添加供应商"));
});

it("identifies builtins by preset ID, permits deletion and readdition, and preserves same-name customs", async () => {
  await render();
  expect(button("已添加 OpenAI").disabled).toBe(true);
  expect(button("添加 Anthropic").disabled).toBe(false);
  await click("管理供应商 已改名"); await click("删除供应商 已改名");
  expect(props.onDeleteProvider).toHaveBeenCalledWith("builtin");
  expect(button("添加 OpenAI").disabled).toBe(false);
  await click("添加 OpenAI");
  expect(props.onAddProvider).toHaveBeenCalledWith("openai", undefined);
  expect(props.connectionSettings.providers.find(provider => provider.id === "custom")?.name).toBe("OpenAI");
  expect(button("已添加 OpenAI").disabled).toBe(true);
});

it("shows shared avatars and awaits a builtin stable-ID save before closing the chooser", async () => {
  let resolve!: (saved: boolean) => void;
  vi.mocked(props.onProviderAvatarChange!).mockImplementation(() => new Promise(done => { resolve = done; }));
  await render();
  expect(button("已改名").querySelector(".brand-avatar")).not.toBeNull();
  await click("管理供应商 已改名"); await click("选择头像"); await click("选择 Anthropic");
  expect(props.onProviderAvatarChange).not.toHaveBeenCalled();
  await click("使用此头像");
  expect(props.onProviderAvatarChange).toHaveBeenCalledWith("builtin", { kind: "builtin", id: "anthropic" });
  expect(materializeBrandAvatar).not.toHaveBeenCalled();
  expect(host.querySelector("dialog")).not.toBeNull(); expect(host.querySelector("[inert]")).not.toBeNull();
  await act(async () => resolve(false)); expect(host.textContent).toContain("头像未保存");
  expect(host.querySelector("dialog")).not.toBeNull();
  await click("使用此头像"); await act(async () => resolve(true)); expect(host.querySelector("dialog")).toBeNull();
  await click("管理供应商 已改名"); await click("恢复默认头像");
  expect(props.onProviderAvatarChange).toHaveBeenLastCalledWith("builtin", undefined);
  await act(async () => resolve(true));
});

it("applies library image snapshots and contains asynchronous avatar errors", async () => {
  const image = { original: new Blob(["original"], { type: "image/png" }), thumbnail: new Blob(["thumbnail"], { type: "image/png" }), crop: { x: .5, y: .5, zoom: 1 } };
  vi.mocked(avatarLibrary.list).mockResolvedValue([{ id: "picture", name: "本地图片", version: "v1", avatar: image }]);
  vi.mocked(avatarLibrary.select).mockResolvedValue(image);
  vi.mocked(props.onProviderAvatarChange!).mockRejectedValueOnce(new Error("本地保存失败"));
  await render(); await click("管理供应商 已改名"); await click("选择头像"); await click("选择 本地图片"); await click("使用此头像");
  expect(props.onProviderAvatarChange).toHaveBeenCalledWith("builtin", image);
  expect(host.querySelector("dialog")?.textContent).toContain("本地保存失败");
});

it("closes stale chooser scope after provider selection changes and ignores late UI completion", async () => {
  let resolve!: (saved: boolean) => void;
  vi.mocked(props.onProviderAvatarChange!).mockImplementation(() => new Promise(done => { resolve = done; }));
  await render(); await click("管理供应商 已改名"); await click("选择头像"); await click("选择 Anthropic"); await click("使用此头像");
  await click("OpenAI"); expect(host.querySelector("dialog")).toBeNull();
  await act(async () => resolve(false));
  expect(host.textContent).not.toContain("头像未保存");
  expect(host.querySelector(".connection-provider-detail h3")?.textContent).toBe("OpenAI");
});

it("confirms exact preset defaults and keeps reset absent for arbitrary connections", async () => {
  await render();
  vi.mocked(window.confirm).mockReturnValueOnce(false); await click("恢复内置默认值");
  expect(props.onResetConnection).not.toHaveBeenCalled();
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("名称：OpenAI Chat"));
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("https://api.openai.com/v1"));
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("保留 API Key 和已添加模型"));
  await click("恢复内置默认值"); expect(props.onResetConnection).toHaveBeenCalledWith("builtin-connection");
  delete props.connectionSettings.providers[0].connections[0].presetProtocol;
  await render(); expect([...host.querySelectorAll("button")].some(button => button.textContent === "恢复内置默认值")).toBe(false);
});

it("uses catalog hints only for unchanged preset protocol and URL", async () => {
  await render(); expect(button("展开供应商 千问").getAttribute("aria-expanded")).toBe("false");
  await click("展开供应商 千问"); await click("查看连接 千问 Anthropic");
  const catalogButton = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes("获取模型列表"))!;
  expect(catalogButton.disabled).toBe(true); expect(host.textContent).toContain("官方 Anthropic 兼容接口没有模型目录");
  props.connectionSettings.providers[2].connections[0].baseUrl = "https://custom.example.invalid";
  await render(); expect(catalogButton.disabled).toBe(false); expect(host.querySelector("#preset-catalog-hint")).toBeNull();
});

it("renaming preserves provider order and generation blocks create, reset and avatar changes", async () => {
  await render(); await click("管理供应商 已改名"); await click("重命名");
  const form = document.querySelector<HTMLFormElement>(".connection-rename-form")!;
  await act(async () => { form.querySelector<HTMLInputElement>("input")!.value = "新名称"; form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(props.connectionSettings.providers.map(provider => provider.id)).toEqual(["builtin", "custom", "qwen"]);
  expect(props.onProviderMove).not.toHaveBeenCalled();
  await click("添加供应商"); props.isStreaming = true; await render();
  await submitName("生成中草稿"); expect(props.onAddProvider).not.toHaveBeenCalled();
  expect(button("添加供应商").disabled).toBe(true); expect(button("恢复内置默认值").disabled).toBe(true);
  expect(button("管理供应商 新名称").disabled).toBe(true); expect(props.onProviderAvatarChange).not.toHaveBeenCalled();
});
