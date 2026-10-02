// @vitest-environment happy-dom
import { act, StrictMode, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { centeredCrop } from "../../avatar/image";
import type { UserAvatar } from "../../avatar/repository";
import { AssistantAvatar } from "./AssistantAvatar";
import { avatarPreviewCache } from "../../avatar/previewCache";
import { readFileSync } from "node:fs";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); root = createRoot(host);
  let serial = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:avatar-${++serial}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLImageElement.prototype, "decode").mockResolvedValue();
  // Exact content keys with deterministic completion; real SHA is covered by cache tests.
  vi.spyOn(crypto.subtle, "digest").mockImplementation(async (_algorithm, bytes) => {
    if (!(bytes instanceof ArrayBuffer)) throw new Error("expected thumbnail bytes");
    return bytes.slice(0);
  });
});
afterEach(async () => { await act(async () => root.unmount()); avatarPreviewCache.clearUnused(); vi.restoreAllMocks(); });
const avatar = (content = "preview"): UserAvatar => ({ original: new Blob(["source"]), thumbnail: new Blob([content]), crop: centeredCrop });

it("retains bounded idle URLs on replacement/removal and uses defaults after image failure", async () => {
  await act(async () => root.render(<AssistantAvatar avatar={avatar()} defaultAvatar="green" legacyIcon="旧" />));
  expect(host.querySelector("img")?.src).toBe("blob:avatar-1");
  await act(async () => host.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(host.querySelector("img")).toBeNull();
  expect(host.querySelector(".assistant-avatar-green svg")).not.toBeNull();
  await act(async () => root.render(<AssistantAvatar avatar={avatar("changed")} defaultAvatar="blue" />));
  expect(host.querySelector("img")?.src).toBe("blob:avatar-2");
  await act(async () => root.render(<AssistantAvatar />));
  avatarPreviewCache.clearUnused();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:avatar-1");
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:avatar-2");
  expect(host.querySelector(".assistant-avatar-automatic svg")).not.toBeNull();
});

it("preserves legacy icons when no built-in default is provided and handles object URL failures", async () => {
  vi.mocked(URL.createObjectURL).mockImplementation(() => { throw new Error("invalid blob"); });
  await act(async () => root.render(<AssistantAvatar avatar={avatar()} defaultAvatar="unknown" legacyIcon="旧" />));
  expect(host.querySelector("img")).toBeNull();
  expect(host.querySelector(".assistant-avatar-legacy")?.textContent).toBe("旧");
});

it("releases the displayed lease on unmount so idle clearing can revoke it", async () => {
  await act(async () => root.render(<AssistantAvatar avatar={avatar()} />));
  await act(async () => root.render(null));
  avatarPreviewCache.clearUnused();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:avatar-1");
});

it("updates the automatic initial on rename while keeping identity color and a neutral empty fallback", async () => {
  await act(async () => root.render(<AssistantAvatar assistantName="alice" assistantId="a" />));
  expect(host.querySelector(".assistant-avatar-initial")?.textContent).toBe("A");
  const color = host.querySelector<HTMLElement>(".assistant-avatar")!.style.background;
  await act(async () => root.render(<AssistantAvatar assistantName="👩🏽‍💻开发" assistantId="a" />));
  expect(host.querySelector(".assistant-avatar-initial")?.textContent).toBe("👩🏽‍💻");
  expect(host.querySelector<HTMLElement>(".assistant-avatar")!.style.background).toBe(color);
  await act(async () => root.render(<AssistantAvatar assistantName="   " assistantId="a" />));
  expect(host.querySelector(".assistant-avatar-initial")).toBeNull();
  expect(host.querySelector("svg")).not.toBeNull();
  expect(host.querySelector<HTMLElement>(".assistant-avatar")!.style.background).toBe("");
});

it.each(["system", "blue", "green", "violet"])("preserves explicit legacy %s rendering instead of an automatic initial", async (defaultAvatar) => {
  await act(async () => root.render(<AssistantAvatar defaultAvatar={defaultAvatar} assistantName="alice" assistantId="a" legacyIcon="旧" />));
  expect(host.querySelector(`.assistant-avatar-${defaultAvatar} svg`)).not.toBeNull();
  expect(host.querySelector(".assistant-avatar-initial")).toBeNull();
  expect(host.querySelector(".assistant-avatar-legacy")).toBeNull();
});

it("falls back to automatic display after image failure without changing the image record", async () => {
  const image = avatar();
  const original = { ...image };
  await act(async () => root.render(<AssistantAvatar avatar={image} assistantName="晴" assistantId="a" />));
  expect(host.querySelector("img")).not.toBeNull();
  await act(async () => host.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(host.querySelector(".assistant-avatar-initial")?.textContent).toBe("晴");
  expect(image).toEqual(original);
});

it("does not commit an automatic initial while mounting or reloading a configured image", async () => {
  const initialCommits: Array<string | null> = [];
  function Observe({ image }: { image: UserAvatar }) {
    useLayoutEffect(() => { initialCommits.push(host.querySelector(".assistant-avatar-initial")?.textContent ?? null); });
    return <AssistantAvatar avatar={image} assistantName="新助手" assistantId="photo" />;
  }
  const image = avatar();
  await act(async () => root.render(<Observe image={image} />));
  // IndexedDB returns fresh Blob objects even when switching only the conversation.
  const reloaded = { ...image, thumbnail: image.thumbnail.slice() };
  await act(async () => root.render(<Observe image={reloaded} />));
  await act(async () => root.render(null));
  await act(async () => root.render(<Observe image={reloaded} />));
  expect(initialCommits).toEqual([null, null, null]);
  expect(host.querySelector("img")?.src).toBe("blob:avatar-1");
});

it("balances URL lifetime through StrictMode, replacement and removal", async () => {
  const first = avatar();
  await act(async () => root.render(<StrictMode><AssistantAvatar avatar={first} assistantName="图" /></StrictMode>));
  await act(async () => root.render(<StrictMode><AssistantAvatar avatar={avatar()} assistantName="图" /></StrictMode>));
  expect(host.querySelector(".assistant-avatar-initial")).toBeNull();
  await act(async () => root.render(<StrictMode><AssistantAvatar assistantName="图" /></StrictMode>));
  avatarPreviewCache.clearUnused();
  expect(host.querySelector(".assistant-avatar-initial")?.textContent).toBe("图");
  const created = vi.mocked(URL.createObjectURL).mock.results.map(result => result.value);
  const revoked = vi.mocked(URL.revokeObjectURL).mock.calls.map(([url]) => url);
  expect(revoked.sort()).toEqual(created.sort());
});

it("keeps the displayed image and URL through an identical Blob reload", async () => {
  const image = avatar();
  await act(async () => root.render(<AssistantAvatar avatar={image} assistantId="photo" />));
  const img = host.querySelector("img")!;
  const url = img.src;
  const commits: Array<string | null> = [];
  function Observe({ value }: { value: UserAvatar }) {
    useLayoutEffect(() => { commits.push(host.querySelector("img")?.src ?? null); });
    return <AssistantAvatar avatar={value} assistantId="photo" />;
  }
  await act(async () => root.render(<Observe value={image} />));
  const stableUrl = host.querySelector("img")!.src;
  await act(async () => root.render(<Observe value={{ ...image, thumbnail: image.thumbnail.slice() }} />));
  expect(commits[commits.length - 1]).toBe(stableUrl);
  expect(host.querySelector("img")!.src).toBe(stableUrl);
  expect(stableUrl).toBe(url);
});

it("keeps the current image until replacement decode completes and hides it for a different owner", async () => {
  await act(async () => root.render(<AssistantAvatar avatar={avatar()} assistantId="a" />));
  const previous = host.querySelector("img")!;
  let finish!: () => void;
  vi.mocked(HTMLImageElement.prototype.decode).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const next = avatar("replacement");
  await act(async () => root.render(<AssistantAvatar avatar={next} assistantId="a" />));
  expect(host.querySelector("img")).toBe(previous);
  expect(previous.src).toBe("blob:avatar-1");
  await act(async () => root.render(<AssistantAvatar avatar={next} assistantId="b" />));
  expect(host.querySelector("img")).toBeNull();
  expect(host.querySelector(".assistant-avatar-initial")).toBeNull();
  await act(async () => finish());
  expect(host.querySelector("img")?.src).toBe("blob:avatar-2");
});

it("ignores a late decode after removal and releases the cancelled lease", async () => {
  let finish!: () => void;
  vi.mocked(HTMLImageElement.prototype.decode).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await act(async () => root.render(<AssistantAvatar avatar={avatar()} assistantName="自动" />));
  await act(async () => root.render(<AssistantAvatar assistantName="自动" />));
  await act(async () => finish());
  expect(host.querySelector("img")).toBeNull();
  expect(host.querySelector(".assistant-avatar-initial")?.textContent).toBe("自");
  avatarPreviewCache.clearUnused();
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:avatar-1");
});

it("uses a fallback after a decode failure without rewriting the avatar", async () => {
  const value = avatar();
  vi.mocked(HTMLImageElement.prototype.decode).mockRejectedValueOnce(new Error("decode"));
  await act(async () => root.render(<AssistantAvatar avatar={value} assistantName="失败" />));
  expect(host.querySelector("img")).toBeNull();
  expect(host.querySelector(".assistant-avatar-initial")?.textContent).toBe("失");
  expect(value.thumbnail.size).toBe(7);
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:avatar-1");
});

it("keeps configured images transparent through decoding and restores legacy fallback colors on failure", async () => {
  const stylesheet = document.createElement("style"); stylesheet.textContent = readFileSync("src/ui/chat/AssistantAvatar.css", "utf8");
  document.head.append(stylesheet); document.body.append(host);
  let finish!: () => void;
  vi.mocked(HTMLImageElement.prototype.decode).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  try {
    await act(async () => root.render(<AssistantAvatar avatar={avatar("alpha-image")} defaultAvatar="green" assistantId="alpha" />));
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector(".assistant-avatar-image")).not.toBeNull();
    expect(getComputedStyle(host.firstElementChild!).background).toBe("transparent");
    await act(async () => finish());
    expect(host.querySelector("img")).not.toBeNull();
    expect(getComputedStyle(host.firstElementChild!).background).toBe("transparent");
    await act(async () => host.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(host.querySelector(".assistant-avatar-image")).toBeNull();
    expect(getComputedStyle(host.firstElementChild!).background).toBe("#dcfce7");
  } finally { stylesheet.remove(); host.remove(); }
});
