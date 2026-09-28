// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { BackgroundFocusDialog } from "./BackgroundFocusDialog";

it("shows a persistence failure inside the still-open focus editor so the draft can be retried or cancelled", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const show = vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  const close = vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) { this.open = false; });
  const cancel = vi.fn();
  try {
    await act(async () => root.render(<BackgroundFocusDialog url="asset://example" focus={{ x: .3, y: .6 }} fit="cover" error="无法保存背景设置，原图片和配置保持不变，请重试。" onConfirm={() => {}} onCancel={cancel} />));
    expect(host.querySelector('dialog[open] [role="alert"]')?.textContent).toContain("无法保存");
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "取消")!.click());
    expect(cancel).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); host.remove(); show.mockRestore(); close.mockRestore(); }
});
