// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackupPreview } from "../../backup/types";
import { BackupWorkspace, type BackupWorkspaceApi } from "./BackupWorkspace";

let host: HTMLDivElement | undefined;
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  host?.remove(); root = undefined; host = undefined;
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function preview(credentials = false, connections = true): BackupPreview {
  return { encrypted: credentials, counts: { assistants: 2, conversations: 3, messages: 4, avatars: 5, files: 6, connections: connections ? 1 : 0 },
    document: { format: "ayase-studio-backup", version: 1, createdAt: "2026-09-30T00:00:00.000Z", options: { connections, credentials },
      rows: { assistants: [], conversations: [], chats: [], workspace: [], avatarLibrary: [], userAvatar: [], cherryImports: [], legacyConversationConfigs: [] },
      preferences: { "ayase-studio.appearance.v1": null, "ayase-studio.chat-layout.v1": null, "ayase-studio.assistant-default-avatar": null }, assets: [],
      connections: connections ? { providers: [{ connections: [{ ...(credentials ? { apiKey: "SECRET-DO-NOT-RENDER" } : {}) }] }] } : null } };
}
function envelope(encrypted = false) { return JSON.stringify({ format: "ayase-studio-envelope", version: 1, encrypted, payload: "local-only" }); }
async function render(overrides: Partial<BackupWorkspaceApi> = {}) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const api: BackupWorkspaceApi = { exportBackup: vi.fn().mockResolvedValue({ saved: true, preview: preview() }), selectBackup: vi.fn().mockResolvedValue(envelope()),
    inspect: vi.fn().mockResolvedValue(preview()), conflicts: vi.fn().mockResolvedValue({ conflicts: 2, warnings: [] }), restore: vi.fn().mockResolvedValue([]), ...overrides };
  const onExit = vi.fn();
  await act(async () => root?.render(<BackupWorkspace api={api} onExit={onExit} />));
  return { api, onExit };
}
function button(text: string) {
  const found = [...host!.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === text);
  if (!found) throw new Error(`Missing button ${text}`);
  return found;
}
function input(text: string) {
  const label = [...host!.querySelectorAll("label")].find(item => item.textContent?.startsWith(text));
  const found = label?.querySelector<HTMLInputElement>("input");
  if (!found) throw new Error(`Missing input ${text}`);
  return found;
}
async function click(text: string) { await act(async () => button(text).click()); }
async function toggle(text: string) {
  if (text === "加密备份") await act(async () => host!.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  else await act(async () => input(text).click());
}
async function type(text: string, value: string) {
  await act(async () => {
    const field = input(text);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("BackupWorkspace", () => {
  it("counts a search-only credential and requires replacement key confirmation", async () => {
    const valid = preview(true, false);
    valid.document.version = 2;
    valid.document.searchSettings = { version: 1, baseUrl: "https://mcp.exa.ai/mcp", apiKey: "SEARCH-SECRET-DO-NOT-RENDER", numResults: 5 };
    const { api } = await render({ inspect: vi.fn().mockResolvedValue(valid) });
    await click("选择备份文件");
    const summary = host!.querySelector('[aria-label="已校验的备份预览"]')!;
    expect(summary.textContent).toContain("网络搜索配置包含 · Exa MCP（旧配置）");
    expect(summary.textContent).toContain("API Key包含 · 1 个");
    expect(summary.textContent).not.toContain("SEARCH-SECRET");
    await toggle("替换"); await toggle("我已确认导入策略");
    expect(button("确认导入").disabled).toBe(true);
    await click("确认导入"); expect(api.restore).not.toHaveBeenCalled();
    await toggle("我同意覆盖当前连接配置和 API Key"); await click("确认导入");
    expect(api.restore).toHaveBeenCalledWith(valid, "replace");
  });

  it("explains that an old backup keeps local search settings and credentials", async () => {
    await render(); await click("选择备份文件");
    expect(host!.textContent).toContain("不包含（旧备份），保留本机搜索设置与 Key");
  });

  it("counts both API and MCP credentials in a v3 backup without displaying either", async () => {
    const valid = preview(true, false); valid.document.version = 3;
    valid.document.searchSettings = { version: 2,
      exaMcp: { version: 1, baseUrl: "https://mcp.exa.ai/mcp", apiKey: "PRIVATE-MCP-SECRET", numResults: 5 },
      exaApi: { version: 1, baseUrl: "https://api.exa.ai", apiKey: "PRIVATE-API-SECRET", numResults: 5 } };
    const { api } = await render({ inspect: vi.fn().mockResolvedValue(valid) });
    await click("选择备份文件");
    const summary = host!.querySelector('[aria-label="已校验的备份预览"]')!;
    expect(summary.textContent).toContain("网络搜索配置包含 · Exa API 与 Exa MCP");
    expect(summary.textContent).toContain("API Key包含 · 2 个");
    expect(summary.textContent).not.toContain("PRIVATE-");
    await toggle("替换"); await toggle("我已确认导入策略");
    expect(button("确认导入").disabled).toBe(true);
    await toggle("我同意覆盖当前连接配置和 API Key"); await click("确认导入");
    expect(api.restore).toHaveBeenCalledWith(valid, "replace");
  });
  it("shows one default-off switch without export checkboxes and always exports a full backup", async () => {
    const { api, onExit } = await render();
    expect(host!.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(host!.querySelectorAll('[role="switch"]')).toHaveLength(1);
    expect(host!.querySelector('[role="switch"]')!.getAttribute("aria-checked")).toBe("false");
    expect(host!.textContent).toContain("不上传备份");
    expect(host!.textContent).toContain("不包含运行时草稿、缓存或派生背景缩略图");
    expect(host!.textContent).toContain("连接配置和 API Key");
    await click("导出备份");
    expect(api.exportBackup).toHaveBeenCalledWith({ encrypted: false }, "", "");
    expect(host!.textContent).toContain("备份已保存");
    await click("返回设置"); expect(onExit).toHaveBeenCalledOnce();
  });

  it("only checks password equality and clears both fields when switching encryption off", async () => {
    const { api } = await render();
    expect(button("导出备份").disabled).toBe(false);
    expect(host!.textContent).toContain("明文保存 API Key");
    await toggle("加密备份");
    expect(button("导出备份").disabled).toBe(false);
    expect(input("备份密码").type).toBe("password");
    expect(input("确认备份密码").autocomplete).toBe("off");
    await type("备份密码", "short"); await type("确认备份密码", "short");
    expect(button("导出备份").disabled).toBe(false);
    await type("备份密码", "twelve-chars-password"); await type("确认备份密码", "does-not-match");
    await click("导出备份"); expect(api.exportBackup).not.toHaveBeenCalled();
    await type("确认备份密码", "twelve-chars-password");
    expect(button("导出备份").disabled).toBe(false);
    await toggle("加密备份");
    expect(host!.querySelector('input[type="password"]')).toBeNull();
    expect(button("导出备份").disabled).toBe(false);
    await toggle("加密备份");
    expect(input("备份密码").value).toBe(""); expect(input("确认备份密码").value).toBe("");
    expect(input("备份密码").hasAttribute("maxlength")).toBe(false);
    expect(input("确认备份密码").hasAttribute("maxlength")).toBe(false);
  });

  it("exports encrypted options only after password confirmation and clears passwords afterwards", async () => {
    const { api } = await render({ exportBackup: vi.fn().mockResolvedValue({ saved: true, preview: preview(true) }) });
    await toggle("加密备份"); await type("备份密码", "中"); await type("确认备份密码", "中");
    await click("导出备份");
    expect(api.exportBackup).toHaveBeenCalledExactlyOnceWith({ encrypted: true }, "中", "中");
    expect(input("备份密码").value).toBe("");
    const summary = host!.querySelector('[aria-label="导出结果"]')!;
    expect(summary.textContent).toContain("包含 · 1 个"); expect(summary.textContent).toContain("已加密");
    expect(summary.textContent).not.toContain("SECRET");
  });

  it("exports keys as plaintext without a password or extra confirmation when encryption is off", async () => {
    const valid = preview(true); valid.encrypted = false;
    const { api } = await render({ exportBackup: vi.fn().mockResolvedValue({ saved: true, preview: valid }) });
    await click("导出备份");
    expect(api.exportBackup).toHaveBeenCalledExactlyOnceWith({ encrypted: false }, "", "");
    expect(host!.querySelector('[aria-label="导出结果"]')!.textContent).toContain("未加密");
    expect(host!.textContent).not.toContain("SECRET-DO-NOT-RENDER");
  });

  it.each(["", "1", "中文🙂 空格!", "长".repeat(2048)])("accepts arbitrary matching passwords: %s", async password => {
    const { api } = await render();
    await toggle("加密备份");
    await type("备份密码", password); await type("确认备份密码", password);
    await click("导出备份");
    expect(api.exportBackup).toHaveBeenCalledExactlyOnceWith({ encrypted: true }, password, password);
  });

  it("previews and restores plaintext keys without a decryption prompt, retaining replacement confirmation", async () => {
    const valid = preview(true); valid.encrypted = false;
    const { api } = await render({ inspect: vi.fn().mockResolvedValue(valid) });
    await click("选择备份文件");
    expect(host!.textContent).toContain("包含明文 API Key");
    expect(host!.querySelector('input[type="password"]')).toBeNull();
    await toggle("替换"); await toggle("我已确认导入策略");
    expect(button("确认导入").disabled).toBe(true);
    await toggle("我同意覆盖当前连接配置和 API Key"); await click("确认导入");
    expect(api.restore).toHaveBeenCalledWith(valid, "replace");
  });

  it("reports save cancellation honestly", async () => {
    await render({ exportBackup: vi.fn().mockResolvedValue({ saved: false, preview: preview() }) });
    await click("导出备份");
    expect(host!.textContent).toContain("已取消保存，未保存备份文件");
    expect(host!.textContent).not.toContain("备份已保存");
  });

  it("inspects plaintext without writes and requires strategy confirmation before restoring", async () => {
    const valid = preview();
    const { api } = await render({ inspect: vi.fn().mockResolvedValue(valid) });
    await click("选择备份文件");
    expect(api.inspect).toHaveBeenCalledExactlyOnceWith(envelope(), "");
    expect(api.conflicts).toHaveBeenCalledWith(valid, "merge");
    expect(host!.querySelector('[aria-label="已校验的备份预览"]')).not.toBeNull();
    expect(host!.textContent).toContain("检测到 2 个冲突");
    expect(button("确认导入").disabled).toBe(true);
    await click("确认导入"); expect(api.restore).not.toHaveBeenCalled();
    await toggle("我已确认导入策略"); await click("确认导入");
    expect(api.restore).toHaveBeenCalledExactlyOnceWith(valid, "merge");
    expect(host!.querySelector('[aria-label="已校验的备份预览"]')).toBeNull();
    expect(host!.textContent).toContain("返回设置后将刷新并加载恢复的数据");
  });

  it("requires explicit decryption, retains retry after wrong password, and never renders secrets", async () => {
    const { api } = await render({ selectBackup: vi.fn().mockResolvedValue(envelope(true)), inspect: vi.fn().mockRejectedValueOnce(new Error("PRIVATE PAYLOAD")).mockResolvedValueOnce(preview(true)) });
    await click("选择备份文件");
    expect(api.inspect).not.toHaveBeenCalled(); expect(button("解密并校验").disabled).toBe(false);
    expect(host!.querySelector('[aria-label="已校验的备份预览"]')).toBeNull();
    await type("解密密码", "wrong"); await click("解密并校验");
    expect(host!.textContent).toContain("密码错误"); expect(host!.textContent).not.toContain("PRIVATE");
    expect(api.restore).not.toHaveBeenCalled();
    await type("解密密码", "correct"); await click("解密并校验");
    expect(api.inspect).toHaveBeenLastCalledWith(envelope(true), "correct");
    expect(host!.textContent).not.toContain("SECRET"); expect(host!.querySelector('input[type="password"]')).toBeNull();
  });

  it.each(["not JSON", JSON.stringify({ format: "unexpected", encrypted: false }), JSON.stringify({ format: "ayase-studio-envelope", version: 9, encrypted: false })])("rejects malformed or unsupported headers safely: %s", async serialized => {
    const { api } = await render({ selectBackup: vi.fn().mockResolvedValue(serialized) });
    await click("选择备份文件");
    expect(host!.querySelector('[role="alert"]')!.textContent).toContain("无法读取或校验");
    expect(api.inspect).not.toHaveBeenCalled(); expect(api.restore).not.toHaveBeenCalled();
  });

  it("renders no preview for invalid content and keeps error details private", async () => {
    const { api } = await render({ inspect: vi.fn().mockRejectedValue(new Error("PRIVATE DATA")) });
    await click("选择备份文件");
    expect(host!.querySelector('[aria-label="已校验的备份预览"]')).toBeNull();
    expect(host!.textContent).not.toContain("PRIVATE DATA"); expect(api.conflicts).not.toHaveBeenCalled();
  });

  it("refreshes conflicts for changed modes, resets confirmations, and disables every control while pending", async () => {
    const pending = deferred<{ conflicts: number; warnings: string[] }>();
    const conflictApi = vi.fn().mockResolvedValueOnce({ conflicts: 1, warnings: [] }).mockReturnValueOnce(pending.promise).mockResolvedValue({ conflicts: 0, warnings: [] });
    const { api, onExit } = await render({ conflicts: conflictApi });
    await click("选择备份文件"); await toggle("我已确认导入策略"); await toggle("另存副本");
    expect(input("我已确认导入策略").checked).toBe(false);
    expect(host!.querySelector('[aria-label="冲突检查"]')).toBeNull();
    expect(button("确认导入").disabled).toBe(true);
    // A fieldset conveys disabled semantics even if its descendants' own disabled property is false.
    for (const control of host!.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")) {
      expect(control.disabled || Boolean(control.closest("fieldset[disabled]"))).toBe(true);
    }
    await click("返回设置"); expect(onExit).not.toHaveBeenCalled();
    await act(async () => pending.resolve({ conflicts: 0, warnings: ["部分模型不可用，请重新选择模型。"] }));
    expect(host!.textContent).toContain("部分模型不可用");
    await toggle("我已确认导入策略"); await click("确认导入");
    expect(api.restore).toHaveBeenCalledWith(expect.anything(), "copy");
    expect(conflictApi.mock.calls.map(call => call[1])).toEqual(["merge", "copy"]);
  });

  it("requires a separate confirmation to replace keys and explains excluded connection references", async () => {
    const { api } = await render({ inspect: vi.fn().mockResolvedValue(preview(true)) });
    await click("选择备份文件"); await toggle("替换");
    expect(host!.textContent).toContain("无法通过此页面撤销");
    await toggle("我已确认导入策略"); expect(button("确认导入").disabled).toBe(true);
    await click("确认导入"); expect(api.restore).not.toHaveBeenCalled();
    await toggle("我同意覆盖当前连接配置和 API Key"); await click("确认导入");
    expect(api.restore).toHaveBeenCalledWith(expect.anything(), "replace");
    vi.mocked(api.inspect).mockResolvedValue(preview(false, false));
    await click("选择备份文件");
    expect(host!.textContent).toContain("导入聊天中的模型引用会取消选择");
  });

  it("preserves the preview on picker cancellation but resets modes and secrets for a new encrypted file", async () => {
    const { api } = await render();
    await click("选择备份文件"); await toggle("另存副本"); await toggle("我已确认导入策略");
    vi.mocked(api.selectBackup).mockResolvedValueOnce(null).mockResolvedValueOnce(envelope(true));
    await click("更换备份文件");
    expect(input("另存副本").checked).toBe(true); expect(input("我已确认导入策略").checked).toBe(true);
    await click("更换备份文件");
    expect(host!.querySelector('[aria-label="已校验的备份预览"]')).toBeNull();
    await type("解密密码", "correct"); await click("解密并校验");
    expect(input("合并（默认）").checked).toBe(true); expect(input("我已确认导入策略").checked).toBe(false);
  });

  it("guards synchronous duplicate export and restore clicks and removes a completed preview", async () => {
    const exported = deferred<{ saved: boolean; preview: BackupPreview }>();
    const restored = deferred<string[]>();
    const { api } = await render({ exportBackup: vi.fn().mockReturnValue(exported.promise), restore: vi.fn().mockReturnValue(restored.promise) });
    const exportButton = button("导出备份");
    await act(async () => { exportButton.click(); exportButton.click(); });
    expect(api.exportBackup).toHaveBeenCalledOnce();
    await act(async () => exported.resolve({ saved: true, preview: preview() }));
    await click("选择备份文件"); await toggle("我已确认导入策略");
    const restoreButton = button("确认导入");
    await act(async () => { restoreButton.click(); restoreButton.click(); });
    expect(api.restore).toHaveBeenCalledOnce();
    await act(async () => restored.resolve(["新连接未包含 API Key，请在连接配置中填写。"]));
    expect(host!.textContent).toContain("数据恢复成功"); expect(host!.textContent).toContain("新连接未包含 API Key");
    await act(async () => restoreButton.click());
    expect(api.restore).toHaveBeenCalledOnce();
  });

  it("blocks restore when conflict inspection fails and supports a strategy retry", async () => {
    const { api } = await render({ conflicts: vi.fn().mockRejectedValueOnce(new Error("PRIVATE")).mockResolvedValue({ conflicts: 0, warnings: [] }) });
    await click("选择备份文件");
    expect(button("确认导入").disabled).toBe(true); expect(host!.textContent).not.toContain("PRIVATE");
    await toggle("另存副本"); await toggle("我已确认导入策略"); await click("确认导入");
    expect(api.restore).toHaveBeenCalledOnce();
  });

  it("keeps the validated preview after a failed restore without claiming success or exposing details", async () => {
    const { api } = await render({ restore: vi.fn().mockRejectedValue(new Error("PRIVATE PATH AND KEY")) });
    await click("选择备份文件"); await toggle("我已确认导入策略"); await click("确认导入");
    expect(api.restore).toHaveBeenCalledOnce();
    expect(host!.querySelector('[aria-label="已校验的备份预览"]')).not.toBeNull();
    expect(host!.querySelector('[aria-label="恢复结果"]')).toBeNull();
    expect(host!.textContent).toContain("恢复失败"); expect(host!.textContent).not.toContain("PRIVATE PATH AND KEY");
    expect(button("返回设置").disabled).toBe(false);
  });

  it("does not inspect a selection that resolves after unmount", async () => {
    const pending = deferred<string | null>();
    const { api } = await render({ selectBackup: vi.fn().mockReturnValue(pending.promise) });
    await click("选择备份文件");
    await act(async () => root?.unmount()); root = undefined;
    await act(async () => pending.resolve(envelope()));
    expect(api.inspect).not.toHaveBeenCalled(); expect(api.conflicts).not.toHaveBeenCalled();
  });

  it("does not request conflicts for an inspection that resolves after unmount", async () => {
    const pending = deferred<BackupPreview>();
    const { api } = await render({ inspect: vi.fn().mockReturnValue(pending.promise) });
    await click("选择备份文件");
    await act(async () => root?.unmount()); root = undefined;
    await act(async () => pending.resolve(preview()));
    expect(api.conflicts).not.toHaveBeenCalled(); expect(api.restore).not.toHaveBeenCalled();
  });

  it("does not restore or exit when a pending conflict check resolves after unmount", async () => {
    const pending = deferred<{ conflicts: number; warnings: string[] }>();
    const { api, onExit } = await render({ conflicts: vi.fn().mockReturnValue(pending.promise) });
    await click("选择备份文件");
    await act(async () => root?.unmount()); root = undefined;
    await act(async () => pending.resolve({ conflicts: 0, warnings: [] }));
    expect(api.restore).not.toHaveBeenCalled(); expect(onExit).not.toHaveBeenCalled();
  });
});
