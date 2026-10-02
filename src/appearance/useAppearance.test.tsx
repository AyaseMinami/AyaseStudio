// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { createAppearanceController } from "./appearance";
import { getBrowserAppearanceController } from "./browser";
import { useAppearance } from "./useAppearance";

vi.mock("./browser", () => ({ getBrowserAppearanceController: vi.fn() }));

it("keeps native library callbacks stable across unrelated appearance updates and parent renders", async () => {
  const controller = createAppearanceController({ storage: { getItem: () => null, setItem() {} },
    systemTheme: { isDark: () => false, subscribe: () => () => {} }, target: document.documentElement });
  await controller.ready;
  vi.mocked(getBrowserAppearanceController).mockReturnValue(controller);
  const callbacks: unknown[] = [];
  function Probe() { const appearance = useAppearance(); callbacks.push(appearance.resolveLibraryBackground); return null; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<Probe />));
    await act(async () => controller.setAccentColor("#abcdef"));
    await act(async () => root.render(<Probe />));
    expect(callbacks.length).toBeGreaterThanOrEqual(3);
    expect(new Set(callbacks).size).toBe(1);
  } finally { await act(async () => root.unmount()); host.remove(); controller.destroy(); }
});
