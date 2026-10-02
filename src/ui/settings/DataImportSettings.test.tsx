// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CherryBackup, CherryImportResult } from "../../import/cherryTypes";
import { createCherryImportPlan } from "../../import/cherryMapping";
import { DataImportSettings, type DataImportSettingsProps } from "./DataImportSettings";

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
function backup(token = "token"): CherryBackup {
  return { token, format: 6, source: "legacy-json", warnings: [], assistants: [{ id: "a", name: "第一个助手" }, { id: "b", name: "另一个助手" }],
    topics: [
      { id: "one", assistantId: "a", title: "完整的很长对话标题<script>private()</script>", createdAt: 1, updatedAt: 2,
        messages: [{ id: "u", role: "user", createdAt: 1, status: "complete", parts: [{ type: "text", text: "hello" }, { type: "file", fileKey: "f", name: "file.txt" }, { type: "unsupported" }] }] },
      { id: "empty", assistantId: "a", title: "空对话", createdAt: 1, updatedAt: 2, messages: [] },
      { id: "two", assistantId: "b", title: "第二个对话", createdAt: 1, updatedAt: 2,
        messages: [{ id: "v", role: "user", createdAt: 1, status: "complete", parts: [{ type: "text", text: "bye" }] }] },
    ] };
}
async function render(overrides: Partial<DataImportSettingsProps> = {}) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const props: DataImportSettingsProps = { selectBackup: vi.fn().mockResolvedValue(backup()),
    closeBackup: vi.fn().mockResolvedValue(undefined), existingSourceKeys: vi.fn().mockResolvedValue([]),
    importPlan: vi.fn().mockResolvedValue({ imported: 3, skipped: 0, warnings: [] }), ...overrides };
  await act(async () => root?.render(<DataImportSettings {...props} />));
  return props;
}
function button(label: string) {
  const found = [...host!.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label);
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}
function input(label: string) {
  const found = [...host!.querySelectorAll<HTMLInputElement>("input")].find((item) => item.getAttribute("aria-label") === label);
  if (!found) throw new Error(`Missing input ${label}`);
  return found;
}
async function click(label: string) { await act(async () => button(label).click()); }

describe("local Cherry import settings", () => {
  it("opens one local-only entry, previews grouped counts and names, then imports once", async () => {
    const props = await render();
    expect(host!.textContent).toContain("格式 5（1.9.13 手机版）、6（1.9.13）和 7（2.1.3）");
    expect(host!.textContent).toContain("不导入 API Key");
    expect(button("导入 Cherry Studio 聊天")).toBeDefined();
    await click("导入 Cherry Studio 聊天");
    expect(host!.textContent).toContain("2 个助手 · 3 个对话");
    expect(host!.textContent).toContain("已选 3 个对话 · 2 条消息 · 1 个附件");
    expect(input("选择对话 空对话").checked).toBe(true);
    const longTitle = backup().topics[0]!.title;
    expect(input(`选择对话 ${longTitle}`).parentElement!.title).toBe(longTitle);
    expect(host!.querySelector("script")).toBeNull();
    expect(host!.querySelector('[aria-label="备份内容提示"]')?.textContent).toContain("未支持的消息内容");
    const commitButton = button("导入所选对话");
    await act(async () => { commitButton.click(); commitButton.click(); });
    expect(props.importPlan).toHaveBeenCalledTimes(1);
    expect(props.importPlan).toHaveBeenCalledWith(createCherryImportPlan(backup()), "skip");
    expect(props.closeBackup).toHaveBeenCalledWith("token");
    expect(host!.textContent).toContain("已导入 3 个对话，跳过 0 个已导入对话");
    expect(host!.querySelector('[aria-label="备份预览"]')).toBeNull();
  });

  it("handles all/none, groups, partial group state and empty conversations", async () => {
    const props = await render(); await click("导入 Cherry Studio 聊天");
    await click("取消全选"); expect(button("导入所选对话").disabled).toBe(true);
    await click("全选"); expect(host!.textContent).toContain("已选 3 个对话");
    await click("取消全选");
    await act(async () => input("选择助手 第一个助手").click());
    expect(host!.textContent).toContain("已选 2 个对话 · 1 条消息 · 1 个附件");
    await act(async () => input(`选择对话 ${backup().topics[0]!.title}`).click());
    expect(input("选择助手 第一个助手").indeterminate).toBe(true);
    await click("导入所选对话");
    const submitted = vi.mocked(props.importPlan).mock.calls[0]![0];
    expect(submitted.conversations.map((conversation) => conversation.topicId)).toEqual(["empty"]);
    expect(submitted.assistants.map((assistant) => assistant.id)).toEqual(["a"]);
  });

  it("shows duplicate counts and explicitly submits copy mode", async () => {
    const firstKey = createCherryImportPlan(backup()).conversations[0]!.sourceKey;
    const props = await render({ existingSourceKeys: vi.fn().mockResolvedValue([firstKey]), importPlan: vi.fn().mockResolvedValue({ imported: 3, skipped: 0, warnings: ["部分附件缺失或格式不受支持，已保留消息和文件信息。"] }) });
    await click("导入 Cherry Studio 聊天");
    expect(host!.textContent).toContain("已识别 1 个已导入对话");
    expect(host!.textContent).toContain("将跳过 1 个已导入对话");
    await act(async () => host!.querySelector<HTMLInputElement>('input[value="copy"]')!.click());
    expect(host!.textContent).toContain("将另存 1 个已导入对话");
    await click("导入所选对话");
    expect(props.importPlan).toHaveBeenCalledWith(expect.anything(), "copy");
    expect(host!.querySelector('[aria-label="导入提示"]')?.textContent).toContain("部分附件缺失");
  });

  it("preserves failed preview and selection, sanitizes error, and permits retry", async () => {
    const props = await render({ importPlan: vi.fn().mockRejectedValueOnce(new Error("PRIVATE TOKEN / FILE / TEXT")).mockResolvedValueOnce({ imported: 3, skipped: 0, warnings: [] }) });
    await click("导入 Cherry Studio 聊天"); await click("导入所选对话");
    expect(host!.textContent).toContain("预览和选择已保留");
    expect(host!.textContent).not.toContain("PRIVATE TOKEN");
    expect(host!.querySelector('[aria-label="备份预览"]')).not.toBeNull();
    expect(input("选择对话 空对话").checked).toBe(true);
    expect(props.closeBackup).not.toHaveBeenCalled();
    await click("导入所选对话");
    expect(props.importPlan).toHaveBeenCalledTimes(2);
    expect(props.closeBackup).toHaveBeenCalledTimes(1);
  });

  it("blocks all mutable controls during commit and disabled workspace", async () => {
    const pending = deferred<CherryImportResult & { warnings: string[] }>();
    const props = await render({ importPlan: vi.fn().mockReturnValue(pending.promise) });
    await click("导入 Cherry Studio 聊天"); await click("导入所选对话");
    expect(button("导入 Cherry Studio 聊天").disabled).toBe(true);
    expect(button("全选").disabled).toBe(true);
    expect(input("选择对话 空对话").disabled).toBe(true);
    expect(host!.querySelector<HTMLFieldSetElement>("fieldset")!.disabled).toBe(true);
    await act(async () => pending.resolve({ imported: 3, skipped: 0, warnings: [] }));
    await act(async () => root?.render(<DataImportSettings {...props} disabled />));
    expect(button("导入 Cherry Studio 聊天").disabled).toBe(true);
    expect(host!.textContent).toContain("工作区准备就绪");
  });

  it("retains preview on picker cancellation and closes old session on replacement", async () => {
    const props = await render({ selectBackup: vi.fn().mockResolvedValueOnce(backup("first")).mockResolvedValueOnce(null).mockResolvedValueOnce(backup("next")) });
    await click("导入 Cherry Studio 聊天"); await click("导入 Cherry Studio 聊天");
    expect(host!.querySelector('[aria-label="备份预览"]')).not.toBeNull();
    expect(props.closeBackup).not.toHaveBeenCalled();
    await click("导入 Cherry Studio 聊天");
    expect(props.closeBackup).toHaveBeenCalledWith("first");
    await act(async () => root?.unmount()); root = undefined;
    expect(props.closeBackup).toHaveBeenCalledWith("next");
    expect(props.closeBackup).toHaveBeenCalledTimes(2);
  });

  it("closes a selected token that resolves after unmount without querying duplicates", async () => {
    const pending = deferred<CherryBackup | null>();
    const props = await render({ selectBackup: vi.fn().mockReturnValue(pending.promise) });
    await click("导入 Cherry Studio 聊天");
    await act(async () => root?.unmount()); root = undefined;
    await act(async () => pending.resolve(backup("late")));
    expect(props.closeBackup).toHaveBeenCalledWith("late");
    expect(props.existingSourceKeys).not.toHaveBeenCalled();
  });

  it.each(["success", "failure"])("defers cleanup until unmounted active import settles: %s", async (outcome) => {
    const pending = deferred<CherryImportResult & { warnings: string[] }>();
    const props = await render({ importPlan: vi.fn().mockReturnValue(pending.promise) });
    await click("导入 Cherry Studio 聊天"); await click("导入所选对话");
    await act(async () => root?.unmount()); root = undefined;
    expect(props.closeBackup).not.toHaveBeenCalled();
    await act(async () => { if (outcome === "success") pending.resolve({ imported: 3, skipped: 0, warnings: [] }); else pending.reject(new Error("PRIVATE")); });
    expect(props.closeBackup).toHaveBeenCalledExactlyOnceWith("token");
  });

  it("closes newly opened resources on preview failure without exposing native details", async () => {
    const props = await render({ existingSourceKeys: vi.fn().mockRejectedValue(new Error("PRIVATE PATH")) });
    await click("导入 Cherry Studio 聊天");
    expect(host!.textContent).toContain("无法读取此 Cherry 备份");
    expect(host!.textContent).not.toContain("PRIVATE PATH");
    expect(props.closeBackup).toHaveBeenCalledExactlyOnceWith("token");
  });

  it("reports cleanup failure after successful import as success with a generic warning", async () => {
    const props = await render({ closeBackup: vi.fn().mockRejectedValue(new Error("PRIVATE")) });
    await click("导入 Cherry Studio 聊天"); await click("导入所选对话");
    expect(host!.textContent).toContain("已导入 3 个对话");
    expect(host!.textContent).toContain("备份临时资源未能释放");
    expect(host!.textContent).not.toContain("PRIVATE");
    expect(props.importPlan).toHaveBeenCalledTimes(1);
  });

  it("describes expanded branches and makes each route selectable", async () => {
    const data = backup();
    data.topics[0]!.messages.push({ id: "answer1", role: "assistant", createdAt: 2, status: "complete", askId: "u", parts: [{ type: "text", text: "one" }] },
      { id: "answer2", role: "assistant", createdAt: 2, status: "complete", askId: "u", parts: [{ type: "text", text: "two" }] });
    await render({ selectBackup: vi.fn().mockResolvedValue(data) });
    await click("导入 Cherry Studio 聊天");
    expect(host!.textContent).toContain("已将 1 个主题的平行回答或树形分支展开为独立对话");
    expect(input(`选择对话 ${data.topics[0]!.title} · 分支 1`).checked).toBe(true);
    expect(input(`选择对话 ${data.topics[0]!.title} · 分支 2`).checked).toBe(true);
  });

  it("closes the preview resource immediately when unmounted during duplicate lookup", async () => {
    const pending = deferred<string[]>();
    const props = await render({ existingSourceKeys: vi.fn().mockReturnValue(pending.promise) });
    await click("导入 Cherry Studio 聊天");
    await act(async () => root?.unmount()); root = undefined;
    expect(props.closeBackup).toHaveBeenCalledExactlyOnceWith("token");
    await act(async () => pending.resolve([]));
    expect(props.closeBackup).toHaveBeenCalledExactlyOnceWith("token");
  });

  it("counts unavailable source descriptors only within selected conversations", async () => {
    const data = backup();
    data.topics[0]!.messages[0]!.parts[1]!.available = false;
    await render({ selectBackup: vi.fn().mockResolvedValue(data) });
    await click("导入 Cherry Studio 聊天");
    expect(host!.querySelector(".data-import-confirm p")!.textContent).toContain("1 个附件缺失或不受支持");
    await act(async () => input(`选择对话 ${data.topics[0]!.title}`).click());
    expect(host!.querySelector(".data-import-confirm p")!.textContent).not.toContain("附件缺失或不受支持");
    await click("全选");
    expect(host!.querySelector(".data-import-confirm p")!.textContent).toContain("1 个附件缺失或不受支持");
  });
});
