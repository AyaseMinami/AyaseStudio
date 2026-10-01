// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { EventCallback } from "@tauri-apps/api/event";
import capability from "../../src-tauri/capabilities/default.json";

afterEach(() => { vi.restoreAllMocks(); clearMocks(); });

it("allows the real SDK close listener to destroy main only after the application approves closing", async () => {
  mockWindows("main");
  const commands: string[] = [];
  mockIPC(command => {
    commands.push(command);
    if (command === "plugin:window|destroy" && !capability.permissions.includes("core:window:allow-destroy"))
      throw new Error("window.destroy not allowed. Permissions: core:window:allow-destroy");
  });
  const current = getCurrentWindow();
  let dispatch: EventCallback<unknown> | undefined;
  vi.spyOn(current, "listen").mockImplementation(async (_name, callback) => {
    dispatch = callback; return () => {};
  });
  let approved = false;
  await current.onCloseRequested(event => { if (!approved) event.preventDefault(); });
  const event = { event: "tauri://close-requested", id: 1, payload: null };
  await dispatch!(event);
  expect(commands).toEqual([]);
  approved = true;
  await dispatch!(event);
  expect(commands).toEqual(["plugin:window|destroy"]);
  expect(capability.windows).toEqual(["main"]);
});
