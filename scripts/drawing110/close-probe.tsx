import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useDrawingWorkspace } from "../../src/drawing/useDrawingWorkspace";

// Run only with close-probe.config.json: separate identifier, no user data or requests.
function Probe() {
  const state = useDrawingWorkspace();
  const started = useRef(false);
  useEffect(() => {
    if (!state.ready || started.current) return;
    started.current = true;
    void (async () => {
      const report = async (stage: string) => {
        const response = await fetch("/drawing110-report", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ environment: "close", stage, tasks: state.tasks.length,
            results: state.results.length, busy: state.busy, generatedAt: new Date().toISOString() }) });
        if (!response.ok) throw new Error("Probe report failed");
      };
      const settle = state.controller.settleForClose.bind(state.controller);
      state.controller.settleForClose = async () => {
        await report("guard-entered");
        await settle();
        await report("guard-settled");
      };
      // Synchronize with the native event system before asking the real hook to close.
      const release = await getCurrentWindow().listen("drawing-close-probe-ready", () => {});
      release();
      await report("ready-before-close");
      await getCurrentWindow().close();
    })();
  }, [state.ready]);
  return <p>{state.ready ? "Isolated idle close probe" : state.error ?? "Initializing isolated storage"}</p>;
}
createRoot(document.getElementById("root")!).render(<Probe />);
