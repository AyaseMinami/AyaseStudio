// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { automaticAvatar } from "../../avatar/automaticAvatar";
import { AppearanceChatPreview } from "./AppearanceChatPreview";

it("uses name and stable sample identity for the assistant sidebar preview", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<AppearanceChatPreview url={null} focus={null} fit="cover" mask={0} blur={0} />));
    const avatars = [...host.querySelectorAll<HTMLElement>('[aria-label="助手侧栏预览"] .assistant-avatar')];
    expect(avatars.map((avatar) => avatar.textContent)).toEqual(["默", "写"]);
    const color = document.createElement("span");
    color.style.background = automaticAvatar("默认助手", "appearance-default").background;
    expect(avatars[0].style.background).toBe(color.style.background);
    await act(async () => root.render(<AppearanceChatPreview url={null} focus={null} fit="contain" mask={30} blur={4} />));
    expect(host.querySelector<HTMLElement>(".assistant-avatar")?.style.background).toBe(color.style.background);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
