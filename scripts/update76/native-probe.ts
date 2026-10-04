import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

// Isolated host probe: no app storage, provider calls, checks, downloads or installs.
async function probe() {
  if (!isTauri()) return;
  let result: unknown;
  try { result = { ok: true, status: await invoke("update_status") }; }
  catch { result = { ok: false }; }
  document.getElementById("result")!.textContent = JSON.stringify(result);
  await fetch("/native-probe-result", { method: "POST", body: JSON.stringify(result) });
  await getCurrentWindow().destroy();
}
void probe();
