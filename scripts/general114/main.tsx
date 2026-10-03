import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emitTo } from "@tauri-apps/api/event";
import { BackupApp } from "../../src/backup/BackupApp";
import "../../src/App.css";

// This origin / native identifier is private to the fixture; never reads user credentials or sends generation requests.
function Acceptance() {
  useEffect(() => {
    if (!isTauri() || !location.search.includes("probe=")) return;
    let alive = true;
    const waitFor = async (test: () => boolean | Promise<boolean>) => {
      for (let attempt = 0; attempt < 300; attempt++) {
        if (!alive) throw Error("disposed");
        if (await test()) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw Error("Probe condition timed out");
    };
    const report = async (stage: string, details: unknown = {}) => {
      await fetch("/general114-report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage, details, timestamp: new Date().toISOString() }) });
    };
    void (async () => {
      await waitFor(() => !!document.querySelector('[aria-label="设置"]'));
      if (!alive) return;
      const current = getCurrentWindow();
      const sync = await current.listen("general114-ready", () => {}); sync();
      await report("ready");
      if (location.search.includes("probe=settings")) {
        await waitFor(() => document.querySelector<HTMLTextAreaElement>("textarea")?.disabled === false);
        const draft = document.querySelector<HTMLTextAreaElement>("textarea")!;
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(draft, "synthetic tray draft");
        draft.dispatchEvent(new Event("input", { bubbles: true }));
        await current.close();
        await waitFor(async () => !await current.isVisible());
        await report("tray-settings-hidden");
        // A second instance restores via production Rust, then the SDK simulates the menu's frontend event.
        await waitFor(async () => await current.isVisible());
        await emitTo("main", "ayase-open-settings");
        await waitFor(() => !!document.querySelector("#general-background-resident"));
        await report("tray-settings-opened", { visible: await current.isVisible() });
        document.querySelector<HTMLButtonElement>('[aria-label="聊天"]')!.click();
        await waitFor(() => !!document.querySelector("textarea"));
        const preserved = document.querySelector<HTMLTextAreaElement>("textarea")!.value === "synthetic tray draft";
        if (!preserved) throw Error("Tray navigation lost the draft");
        await emitTo("main", "ayase-open-settings");
        await waitFor(() => !!document.querySelector("#general-background-resident"));
        await report("tray-settings-repeated", { draftPreserved: preserved });
        await emitTo("main", "ayase-request-exit");
        await waitFor(() => !!document.querySelector(".confirmation-dialog"));
        document.querySelector<HTMLButtonElement>(".confirmation-accept")!.click();
        return;
      }
      if (location.search.includes("probe=disabled")) {
        document.querySelector<HTMLButtonElement>('[aria-label="设置"]')!.click();
        await waitFor(() => !!document.querySelector("#general-background-resident"));
        const resident = document.querySelector<HTMLInputElement>("#general-background-resident")!;
        const reminder = document.querySelector<HTMLInputElement>("#general-confirm-exit")!;
        if (resident.checked) resident.click();
        await waitFor(() => !document.querySelector<HTMLInputElement>("#general-background-resident")!.disabled);
        if (!reminder.checked) reminder.click();
        await waitFor(() => JSON.parse(localStorage.getItem("ayase-studio.general.v1")!).confirmBeforeExit === true);
        await current.close();
        await waitFor(() => !!document.querySelector(".confirmation-dialog"));
        document.querySelector<HTMLInputElement>(".confirmation-dialog input")!.click();
        document.querySelector<HTMLButtonElement>(".confirmation-button:not(.confirmation-accept)")!.click();
        await waitFor(() => !document.querySelector(".confirmation-dialog"));
        await report("disabled-close-cancelled", { visible: await current.isVisible(),
          preferences: JSON.parse(localStorage.getItem("ayase-studio.general.v1")!) });
        await current.close();
        await waitFor(() => !!document.querySelector(".confirmation-dialog"));
        document.querySelector<HTMLInputElement>(".confirmation-dialog input")!.click();
        await report("disabled-close-confirmed");
        document.querySelector<HTMLButtonElement>(".confirmation-accept")!.click();
        return;
      }
      if (location.search.includes("probe=restart")) {
        await report("restart-preferences", { preferences: JSON.parse(localStorage.getItem("ayase-studio.general.v1") ?? "null") });
        await emitTo("main", "ayase-request-exit");
        return;
      }
      await current.close();
      await waitFor(async () => !await current.isVisible());
      await report("hidden-alive");
      // The harness waits for the shell to launch a second instance, exercising production restoration.
      await waitFor(async () => await current.isVisible());
      await report("restored-by-second-instance");
      await emitTo("main", "ayase-request-exit");
      await waitFor(() => !!document.querySelector(".confirmation-dialog"));
      const checkbox = document.querySelector<HTMLInputElement>(".confirmation-dialog input[type=checkbox]")!;
      checkbox.click();
      const confirm = document.querySelector<HTMLButtonElement>(".confirmation-accept")!;
      await report("confirming-explicit-exit", { checkboxPresent: !!checkbox });
      confirm.click();
    })().catch(error => { if (alive) void report("failed", { message: String(error) }); });
    return () => { alive = false; };
  }, []);
  return <BackupApp />;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Acceptance /></StrictMode>);
