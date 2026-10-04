import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { UpdateController, type PrepareUpdateInstall, type UpdateActions } from "./controller";
import { updateRuntime } from "./runtime";

export function useApplicationUpdate(prepare: PrepareUpdateInstall, startup?: { enabled: boolean; ready: boolean }): UpdateActions & { dismissNotice(): void } {
  const current = useRef(prepare); current.current = prepare;
  const [controller] = useState(() => new UpdateController(updateRuntime, install => current.current(install)));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => { void controller.start(); return () => controller.dispose(); }, [controller]);
  useEffect(() => { controller.configureStartupCheck(startup?.enabled ?? false, startup?.ready ?? false); }, [controller, startup?.enabled, startup?.ready]);
  return { state, check: controller.check, download: controller.download, cancel: controller.cancel, install: controller.install, dismissNotice: controller.dismissNotice };
}
