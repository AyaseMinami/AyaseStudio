// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import { SafeMarkdown } from "../../chat/SafeMarkdown";
import { resizeSuggestionFrame, SearchResults } from "./SearchResults";

it("shows external status, inert excerpts, warnings, and missing valid citations", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); const root = createRoot(host);
  const external = { ...search, provider: "exa-mcp" as const, citations: [], warning: "部分来源已忽略", sources: [{ id: "one", title: "Example", url: "javascript:alert(1)", excerpt: "<script>unsafe</script>" }] };
  try {
    await act(async () => root.render(<SearchResults search={external} />));
    expect(host.querySelector("summary")?.textContent).toBe("已检索 · 1 个来源");
    expect(host.querySelector("button")!.disabled).toBe(true);
    expect(host.querySelector("script")).toBeNull();
    expect(host.querySelector(".search-source-excerpt")?.textContent).toBe("<script>unsafe</script>");
    expect(host.textContent).toContain("部分来源已忽略"); expect(host.textContent).toContain("正文未提供有效引用");
    await act(async () => root.render(<SearchResults search={{ ...external, citations: [{ start: 0, end: 2, sourceIds: ["one"] }] }} />));
    expect(host.querySelector(".search-citation-notice")).toBeNull();
    await act(async () => root.render(<SearchResults search={{ ...external, status: "searching", sources: [] }} />));
    expect(host.textContent).toContain("正在搜索 · Exa MCP");
    await act(async () => root.render(<SearchResults search={{ ...external, status: "failed", sources: [] }} />));
    expect(host.textContent).toContain("搜索失败");
  } finally { await act(async () => root.unmount()); }
});

it("labels API searches and preserves the same sources and citation notice", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<SearchResults search={{ ...search, provider: "exa-api", status: "searching", sources: [] }} />));
    expect(host.textContent).toContain("正在搜索 · Exa API");
    await act(async () => root.render(<SearchResults search={{ ...search, provider: "exa-api", citations: [] }} />));
    expect(host.querySelector("summary")?.textContent).toBe("已检索 · 1 个来源");
    expect(host.textContent).toContain("正文未提供有效引用");
  } finally { await act(async () => root.unmount()); }
});

const search = { enabled: true, status: "completed" as const, sources: [{ id: "one", title: "Example", url: "https://example.com/source" }], citations: [{ start: 0, end: 6, sourceIds: ["one"] }], queries: ["example query"] };

it("renders citation badges and a source footer", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<><SafeMarkdown search={search}>Answer text</SafeMarkdown><SearchResults search={search} /></>));
    expect(host.querySelector(".citation-badge")?.textContent).toBe("[1]");
    expect(host.querySelector("p")?.textContent).toBe("Answer[1] text");
    expect(host.querySelector("summary")?.textContent).toBe("已联网搜索·1 个来源");
    expect(host.querySelector(".search-queries")?.textContent).toContain("example query");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("uses a scriptless sandboxed suggestion document", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<SearchResults search={{ ...search, suggestionHtml: "<script>alert(1)</script><base href='https://bad.example'><a href='https://example.com'>Read</a>" }} />));
    const frame = host.querySelector("iframe")!;
    expect(host.querySelector(".search-queries")).toBeNull();
    expect(frame.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(frame.srcdoc).toContain("default-src 'none'");
    expect(frame.srcdoc).not.toContain("<script");
    expect(frame.srcdoc).not.toContain("<base");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("binds and removes the global context policy in the suggestion iframe without disabling editing", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  let unmounted = false;
  try {
    await act(async () => root.render(<SearchResults search={{ ...search, suggestionHtml: "<p>Suggestion</p>" }} />));
    const frame = host.querySelector("iframe")!, document = frame.contentDocument!;
    const text = document.createElement("p"), editable = document.createElement("textarea");
    document.body.append(text, editable);
    await act(async () => frame.dispatchEvent(new Event("load")));
    for (const [target, prevented] of [[text, true], [editable, false]] as const) {
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      target.dispatchEvent(event); expect(event.defaultPrevented).toBe(prevented);
    }
    await act(async () => root.unmount()); unmounted = true;
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    text.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
  } finally { if (!unmounted) await act(async () => root.unmount()); host.remove(); }
});

it("sizes a suggestion iframe to its content instead of its current viewport", () => {
  const frame = document.createElement("iframe");
  frame.style.height = "150px";
  const viewportHeight = () => {
    const height = Number.parseFloat(frame.style.height);
    return Number.isNaN(height) ? 150 : height;
  };
  const contentDocument = {
    body: { get scrollHeight() { return Math.max(72, viewportHeight()); } },
    documentElement: { get scrollHeight() { return Math.max(72, viewportHeight()); } },
  } as Document;

  resizeSuggestionFrame(frame, contentDocument);

  expect(frame.style.height).toBe("72px");
});

it("keeps escaped and entity Markdown intact with unordered citation offsets", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const content = "A &amp; B\\*C";
  const unordered = { ...search, sources: [{ id: "plain", title: "Plain", url: "https://example.com/plain" }, { id: "comma,id", title: "Comma", url: "https://example.com/comma" }],
    citations: [{ start: 2, end: content.length, sourceIds: ["comma,id"] }, { start: 0, end: 1, sourceIds: ["plain"] }] };
  try {
    await act(async () => root.render(<SafeMarkdown search={unordered}>{content}</SafeMarkdown>));
    expect(host.textContent).toContain("A & B*C");
    expect([...host.querySelectorAll(".citation-badge")].map((item) => item.textContent)).toEqual(["[1]", "[2]"]);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
