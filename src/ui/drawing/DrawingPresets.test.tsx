// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DrawingPromptPreset } from "../../drawing/presets";
import { DrawingPresets } from "./DrawingPresets";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const preset: DrawingPromptPreset = {
  id: "preset-one", name: "山谷", content: "已保存的提示词", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
function props() {
  return { presets: [preset], prompt: "当前草稿", onApply: vi.fn(), onCreate: vi.fn(async () => true),
    onUpdate: vi.fn(async () => true), onDelete: vi.fn(async () => true), onDialogChange: vi.fn() };
}
function button(label: string) {
  const item = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find(button => button.textContent === label || button.getAttribute("aria-label") === label);
  if (!item) throw new Error(`Missing button: ${label}`);
  return item;
}
function dialog() { return document.querySelector<HTMLFormElement>('[role="dialog"]'); }
async function choose(id = preset.id) {
  await act(async () => { const select = host.querySelector("select")!; select.value = id; select.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function fill(selector: "input" | "textarea", value: string) {
  const input = dialog()!.querySelector(selector)!;
  const proto = selector === "input" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(label: string) { await act(async () => button(label).click()); }

it("loads the exact ID immediately even when names repeat and never auto binds draft changes", async () => {
  const options = props();
  const duplicate = { ...preset, id: "preset-two", content: "另一条提示词" };
  await act(async () => root.render(<DrawingPresets {...options} presets={[preset, duplicate]} />));
  await choose(duplicate.id);
  expect(options.onApply).toHaveBeenCalledExactlyOnceWith(duplicate.id);
  expect(dialog()).toBeNull();
  await act(async () => root.render(<DrawingPresets {...options} presets={[duplicate, preset]} prompt="修改后的草稿" />));
  expect(host.querySelector("select")!.value).toBe(duplicate.id);
  expect(options.onApply).toHaveBeenCalledTimes(1);
  expect(options.onUpdate).not.toHaveBeenCalled();
  await act(async () => root.render(<DrawingPresets {...options} presets={[preset]} />));
  expect(host.querySelector("select")!.value).toBe("");
  expect(button("更新预设").disabled).toBe(true);
  expect(options.onApply).toHaveBeenCalledTimes(1);
});

it("prefills a new preset from the current prompt, validates name and saves only explicit edited input", async () => {
  const options = props();
  await act(async () => root.render(<DrawingPresets {...options} />));
  await click("新建预设");
  expect(dialog()!.querySelector("textarea")!.value).toBe(options.prompt);
  expect(button("保存预设").disabled).toBe(true);
  expect(document.activeElement).toBe(dialog()!.querySelector("input"));
  await fill("input", " 新画面 ");
  await fill("textarea", "修改内容\n第二行");
  expect(options.onCreate).not.toHaveBeenCalled();
  await click("保存预设");
  expect(options.onCreate).toHaveBeenCalledExactlyOnceWith({ name: "新画面", content: "修改内容\n第二行" });
  expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(button("新建预设"));
});

it("discards new, save-as, update, edit and delete dialogs on cancel, Escape or close", async () => {
  const options = props();
  await act(async () => root.render(<DrawingPresets {...options} />));
  await choose();
  for (const entry of ["新建预设", "另存预设", "更新预设", "编辑预设", "删除预设"]) {
    await click(entry);
    await click("取消");
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(button(entry));
  }
  await click("编辑预设");
  await fill("input", "未保存");
  const outer = vi.fn(); document.addEventListener("keydown", outer);
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  document.removeEventListener("keydown", outer);
  expect(outer).not.toHaveBeenCalled();
  await click("新建预设"); await click("关闭预设弹窗");
  await click("新建预设");
  await act(async () => document.querySelector(".drawing-preset-backdrop")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
  expect(dialog()).toBeNull();
  expect(options.onCreate).not.toHaveBeenCalled(); expect(options.onUpdate).not.toHaveBeenCalled(); expect(options.onDelete).not.toHaveBeenCalled();
});

it("uses current draft for save-as and update, but saved content for edit, without writing until save", async () => {
  const options = props();
  await act(async () => root.render(<DrawingPresets {...options} />)); await choose();
  await click("另存预设");
  expect(dialog()!.querySelector("input")!.value).toBe("山谷 副本");
  expect(dialog()!.querySelector("textarea")!.value).toBe(options.prompt);
  await click("保存预设");
  expect(options.onCreate).toHaveBeenCalledExactlyOnceWith({ name: "山谷 副本", content: options.prompt });
  expect(options.onUpdate).not.toHaveBeenCalled();
  await click("更新预设");
  expect(dialog()!.querySelector("textarea")!.value).toBe(options.prompt);
  await fill("input", "重命名");
  expect(options.onUpdate).not.toHaveBeenCalled();
  await click("保存预设");
  expect(options.onUpdate).toHaveBeenCalledExactlyOnceWith(preset.id, { name: "重命名", content: options.prompt });
  await click("编辑预设");
  expect(dialog()!.querySelector("textarea")!.value).toBe(preset.content);
  await fill("textarea", "编辑后的存储内容"); await click("保存预设");
  expect(options.onUpdate).toHaveBeenLastCalledWith(preset.id, { name: preset.name, content: "编辑后的存储内容" });
  expect(options.onApply).toHaveBeenCalledTimes(1);
});

it("requires deletion confirmation and retains it on failed deletion", async () => {
  const options = props(); options.onDelete.mockResolvedValueOnce(false);
  await act(async () => root.render(<DrawingPresets {...options} />)); await choose(); await click("删除预设");
  expect(document.activeElement).toBe(button("取消"));
  expect(options.onDelete).not.toHaveBeenCalled();
  await click("确认删除预设");
  expect(dialog()!.querySelector('[role="alert"]')!.textContent).toContain("删除失败");
  await click("确认删除预设");
  expect(options.onDelete).toHaveBeenCalledTimes(2); expect(options.onDelete).toHaveBeenLastCalledWith(preset.id);
  expect(dialog()).toBeNull(); expect(options.onApply).toHaveBeenCalledTimes(1);
});

it("keeps edited fields after false or rejected saves and closes only after success", async () => {
  const options = props();
  options.onCreate.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("private internal reason"));
  await act(async () => root.render(<DrawingPresets {...options} />)); await click("新建预设"); await fill("input", "新名称");
  for (let i = 0; i < 2; i++) {
    await click("保存预设");
    expect(dialog()!.querySelector("input")!.value).toBe("新名称");
    expect(dialog()!.querySelector("textarea")!.value).toBe(options.prompt);
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toContain("保存失败");
    expect(dialog()!.textContent).not.toContain("private internal reason");
  }
  await click("保存预设"); expect(dialog()).toBeNull(); expect(options.onCreate).toHaveBeenCalledTimes(3);
});

it("prevents repeated submissions and dismissal while a save is pending", async () => {
  const options = props(); let resolve!: (success: boolean) => void;
  options.onCreate.mockImplementation(() => new Promise<boolean>(done => { resolve = done; }));
  await act(async () => root.render(<DrawingPresets {...options} />)); await click("新建预设"); await fill("input", "名称");
  const form = dialog()!;
  await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(options.onCreate).toHaveBeenCalledTimes(1);
  expect(button("取消").disabled).toBe(true); expect(button("关闭预设弹窗").disabled).toBe(true);
  await act(async () => form.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(dialog()).toBe(form);
  await act(async () => resolve(true)); expect(dialog()).toBeNull();
});

it.each(["false", "rejection"])("keeps focus and values inside a pending save after %s until normal cancellation", async outcome => {
  const options = props();
  let resolve!: (success: boolean) => void;
  let reject!: (reason: Error) => void;
  options.onCreate.mockImplementation(() => new Promise<boolean>((done, fail) => { resolve = done; reject = fail; }));
  await act(async () => root.render(<DrawingPresets {...options} />));
  await click("新建预设"); await fill("input", "保留名称"); await fill("textarea", "保留内容\n第二行");
  const form = dialog()!;
  await click("保存预设");
  expect(form.tabIndex).toBe(-1);
  expect(document.activeElement).toBe(form);
  for (const shiftKey of [false, true]) {
    const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
    await act(async () => document.activeElement!.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(form);
  }
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(dialog()).toBe(form);
  await act(async () => { if (outcome === "false") resolve(false); else reject(new Error("synthetic failure")); });
  expect(dialog()).toBe(form);
  expect(form.querySelector("input")!.value).toBe("保留名称");
  expect(form.querySelector("textarea")!.value).toBe("保留内容\n第二行");
  expect(form.querySelector('[role="alert"]')!.textContent).toContain("保存失败");
  expect(button("取消").disabled).toBe(false);
  const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  await act(async () => form.dispatchEvent(event));
  expect(document.activeElement).toBe(button("关闭预设弹窗"));
  await click("取消");
  expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(button("新建预设"));
  expect(options.onCreate).toHaveBeenCalledTimes(1);
});

it("blocks writes when disabled or the selected preset is deleted, and traps keyboard focus", async () => {
  const options = props();
  await act(async () => root.render(<DrawingPresets {...options} />)); await choose(); await click("编辑预设");
  const first = button("关闭预设弹窗"), last = button("保存预设");
  first.focus();
  await act(async () => first.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(last);
  await act(async () => last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(first);
  await act(async () => root.render(<DrawingPresets {...options} disabled />));
  expect(button("保存预设").disabled).toBe(true);
  await act(async () => dialog()!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(options.onUpdate).not.toHaveBeenCalled();
  await act(async () => root.render(<DrawingPresets {...options} presets={[]} />));
  expect(button("保存预设").disabled).toBe(true);
  expect(dialog()!.textContent).toContain("原预设已删除");
  await click("取消");
  await act(async () => root.render(<DrawingPresets {...options} disabled />));
  expect([...host.querySelectorAll<HTMLButtonElement>("button")].every(button => button.disabled)).toBe(true);
  expect(host.querySelector("select")!.disabled).toBe(true);
});
