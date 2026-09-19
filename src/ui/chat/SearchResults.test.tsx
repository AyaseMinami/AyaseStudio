// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import { SafeMarkdown } from "../../chat/SafeMarkdown";
import { SearchResults } from "./SearchResults";

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
