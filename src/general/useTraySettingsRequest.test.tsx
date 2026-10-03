// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ native: vi.fn(() => true), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.native }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
import { useTraySettingsRequest } from "./useTraySettingsRequest";

afterEach(() => { vi.restoreAllMocks(); mocks.listen.mockReset(); mocks.native.mockReturnValue(true); });

it("keeps only the live StrictMode listener, handles repeated requests and releases late registrations", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const registrations: { handler: () => void; release: ReturnType<typeof vi.fn>; resolve: () => void }[] = [];
  mocks.listen.mockImplementation((event: string, handler: () => void) => {
    expect(event).toBe("ayase-open-settings");
    const release = vi.fn();
    return new Promise<() => void>(resolve => registrations.push({ handler, release, resolve: () => resolve(release) }));
  });
  function Fixture() { return <span>{useTraySettingsRequest()}</span>; }
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<StrictMode><Fixture /></StrictMode>));
    expect(registrations).toHaveLength(2);
    await act(async () => { registrations[0].handler(); registrations[0].resolve(); registrations[1].handler(); registrations[1].handler(); });
    expect(host.textContent).toBe("2"); expect(registrations[0].release).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    await act(async () => { registrations[1].resolve(); registrations[1].handler(); });
    expect(registrations[1].release).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); }
});

it("does not subscribe in the browser", async () => {
  mocks.native.mockReturnValue(false);
  const root = createRoot(document.createElement("div"));
  function Fixture() { useTraySettingsRequest(); return null; }
  try { await act(async () => root.render(<Fixture />)); expect(mocks.listen).not.toHaveBeenCalled(); }
  finally { await act(async () => root.unmount()); }
});
