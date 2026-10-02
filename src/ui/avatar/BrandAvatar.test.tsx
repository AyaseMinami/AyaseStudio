// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { automaticAvatar } from "../../avatar/automaticAvatar";
import { BrandAvatar } from "./BrandAvatar";
import { readFileSync } from "node:fs";
import { brandIds } from "../../avatar/brandIds";

vi.mock("../../avatar/brandCatalog", () => ({ brandAvatars: [
  { id: "openai", label: "OpenAI", src: "/bundled/openai.svg" },
  { id: "anthropic", label: "Anthropic", src: "/bundled/anthropic.svg" },
  { id: "xai", label: "xAI", src: "/bundled/xai.svg" },
  { id: "zhipu", label: "智谱", src: "/bundled/zhipu.png" },
  { id: "moonshot", label: "月之暗面", src: "/bundled/moonshot.png" },
  { id: "gemini", label: "Google Gemini", src: "/bundled/gemini.png" },
  { id: "openrouter", label: "OpenRouter", src: "/bundled/openrouter.svg" },
  { id: "deepseek", label: "DeepSeek", src: "/bundled/deepseek.png" },
  { id: "qwen", label: "千问", src: "/bundled/qwen.png" },
  { id: "doubao", label: "豆包", src: "/bundled/doubao.png" },
  { id: "minimax", label: "MiniMax", src: "/bundled/minimax.png" },
] }));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("renders decorative bundled artwork and uses a local initial after display failure", async () => {
  await act(async () => root.render(<BrandAvatar id="openai" className="test-brand" />));
  expect(host.querySelector(".test-brand")?.getAttribute("aria-hidden")).toBe("true");
  expect(host.querySelector("img")?.getAttribute("src")).toBe("/bundled/openai.svg");
  expect(host.querySelector("img")?.alt).toBe("");
  await act(async () => host.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(host.querySelector("img")).toBeNull();
  expect(host.textContent).toBe(automaticAvatar("OpenAI", "openai").initial);
  await act(async () => root.render(<BrandAvatar id="anthropic" />));
  expect(host.querySelector("img")?.getAttribute("src")).toBe("/bundled/anthropic.svg");
});

it("shows the automatic brand initial immediately when an asset is absent", async () => {
  const { brandAvatars } = await import("../../avatar/brandCatalog");
  const brand = brandAvatars.find(brand => brand.id === "zhipu")!;
  const originalSrc = brand.src; brand.src = undefined;
  try { await act(async () => root.render(<BrandAvatar id="zhipu" />)); }
  finally { brand.src = originalSrc; }
  expect(host.querySelector("img")).toBeNull();
  expect(host.textContent).toBe("智");
});

it.each(["light", "dark"])("adapts only the five built-in monochrome marks in the %s root theme", async theme => {
  const previousTheme = document.documentElement.getAttribute("data-theme");
  const stylesheet = document.createElement("style"); stylesheet.textContent = readFileSync("src/ui/avatar/BrandAvatar.css", "utf8");
  document.head.append(stylesheet); document.documentElement.setAttribute("data-theme", theme);
  try {
    await act(async () => root.render(<>{brandIds.map(id => <BrandAvatar key={id} id={id} />)}
      <span className="assistant-avatar assistant-avatar-image"><img src="/synthetic/user-snapshot.png" alt="" /></span></>));
    for (const id of brandIds) {
      const container = host.querySelector(`[data-brand="${id}"]`)!;
      const image = container.querySelector("img")!;
      expect(image, id).not.toBeNull();
      const invert = theme === "dark" ? ["openai", "anthropic", "xai"].includes(id) : ["zhipu", "moonshot"].includes(id);
      expect(getComputedStyle(image).filter || "none", id).toBe(invert ? "invert(1)" : "none");
      expect(getComputedStyle(container).background, id).toBe("transparent");
    }
    expect(getComputedStyle(host.querySelector(".assistant-avatar-image img")!).filter || "none").toBe("none");
  } finally {
    stylesheet.remove();
    if (previousTheme === null) document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", previousTheme);
  }
});

it("contains enlarged brand images on transparent containers while retaining colored initial fallbacks", async () => {
  const stylesheet = document.createElement("style"); stylesheet.textContent = readFileSync("src/ui/chat/AssistantAvatar.css", "utf8") + readFileSync("src/ui/avatar/BrandAvatar.css", "utf8");
  document.head.append(stylesheet);
  try {
    await act(async () => root.render(<BrandAvatar id="openai" />));
    expect(getComputedStyle(host.firstElementChild!).background).toBe("transparent");
    const imageStyle = getComputedStyle(host.querySelector("img")!);
    expect(imageStyle.objectFit).toBe("contain"); expect(imageStyle.padding).toBe("7.8125%");
    await act(async () => host.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(host.querySelector<HTMLElement>(".brand-avatar")!.style.background).toBe(automaticAvatar("OpenAI", "openai").background);
  } finally { stylesheet.remove(); }
});
