import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import type { UpdateMetadata, UpdateRuntime } from "./controller";

export const updateRuntime: UpdateRuntime = {
  async available() { return isTauri() && (await invoke<{ enabled: boolean }>("update_status")).enabled; },
  async check() {
    const result = await invoke<(Omit<UpdateMetadata, "date"> & { date: string | null }) | null>("update_check");
    return result ? { session: result.session, version: result.version, notes: result.notes, ...(result.date ? { date: result.date } : {}) } : null;
  },
  async download(session, progress) {
    const channel = new Channel<{ downloaded: number; total: number | null }>();
    channel.onmessage = event => progress(event.downloaded, event.total ?? undefined);
    await invoke("update_download", { session, progress: channel });
  },
  cancel: session => invoke("update_cancel", { session }),
  install: session => invoke("update_install", { session }),
};
