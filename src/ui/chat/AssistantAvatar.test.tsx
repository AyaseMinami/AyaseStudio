// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { centeredCrop } from "../../avatar/image";
import type { UserAvatar } from "../../avatar/repository";
import { AssistantAvatar } from "./AssistantAvatar";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); root = createRoot(host);
  let serial = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:avatar-${++serial}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); });
const avatar = (): UserAvatar => ({ original: new Blob(["source"]), thumbnail: new Blob(["preview"]), crop: centeredCrop });

it("revokes thumbnail URLs on replacement and removal, and uses defaults after image failure", async () => {
  await act(async () => root.render(<AssistantAvatar avatar={avatar()} defaultAvatar="green" legacyIcon="旧" />));
  expect(host.querySelector("img")?.src).toBe("blob:avatar-1");
  await act(async () => host.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(host.querySelector("img")).toBeNull();
  expect(host.querySelector(".assistant-avatar-green svg")).not.toBeNull();
  await act(async () => root.render(<AssistantAvatar avatar={avatar()} defaultAvatar="blue" />));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:avatar-1");
  expect(host.querySelector("img")?.src).toBe("blob:avatar-2");
  await act(async () => root.render(<AssistantAvatar />));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:avatar-2");
  expect(host.querySelector(".assistant-avatar-system svg")).not.toBeNull();
});

it("preserves legacy icons when no built-in default is provided and handles object URL failures", async () => {
  vi.mocked(URL.createObjectURL).mockImplementation(() => { throw new Error("invalid blob"); });
  await act(async () => root.render(<AssistantAvatar avatar={avatar()} defaultAvatar="unknown" legacyIcon="旧" />));
  expect(host.querySelector("img")).toBeNull();
  expect(host.querySelector(".assistant-avatar-legacy")?.textContent).toBe("旧");
});

it("releases the displayed URL when the component unmounts", async () => {
  await act(async () => root.render(<AssistantAvatar avatar={avatar()} />));
  await act(async () => root.render(null));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:avatar-1");
});
