// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useApplicationUpdate } from "./useApplicationUpdate";
import { STARTUP_UPDATE_DELAY_MS } from "./controller";

const runtime = vi.hoisted(() => ({ available: vi.fn(), check: vi.fn(), download: vi.fn(), cancel: vi.fn(), install: vi.fn() }));
vi.mock("./runtime", () => ({ updateRuntime: runtime }));
it("waits for readiness and avoids duplicate startup requests across StrictMode replay and rerenders", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers(); runtime.available.mockResolvedValue(true); runtime.check.mockResolvedValue(null);
  const host = document.createElement("div"), root = createRoot(host);
  function Preview({ ready }: { ready: boolean }) {
    const update = useApplicationUpdate(async () => false, { enabled: true, ready });
    return <span>{update.state.phase}</span>;
  }
  try {
    await act(async () => root.render(<StrictMode><Preview ready={false} /></StrictMode>));
    await act(async () => vi.advanceTimersByTimeAsync(20_000)); expect(runtime.check).not.toHaveBeenCalled();
    await act(async () => root.render(<StrictMode><Preview ready /></StrictMode>));
    await act(async () => vi.advanceTimersByTimeAsync(STARTUP_UPDATE_DELAY_MS));
    expect(runtime.check).toHaveBeenCalledOnce(); expect(host.textContent).toBe("current");
    await act(async () => root.render(<StrictMode><Preview ready /></StrictMode>));
    await act(async () => vi.advanceTimersByTimeAsync(60_000)); expect(runtime.check).toHaveBeenCalledOnce();
    expect(runtime.download).not.toHaveBeenCalled(); expect(runtime.install).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); vi.useRealTimers(); }
});
