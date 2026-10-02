// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SafeMarkdown } from "./SafeMarkdown";
import { openExternal } from "./externalLinks";
import type { SearchRecord } from "./nativeSearch";
import { useConversationNavigation, useConversationNavigationSnapshot } from "../ui/chat/useConversationNavigation";

const { parsed } = vi.hoisted(() => ({ parsed: vi.fn() }));

// Count completed transforms in the real Markdown pipeline, retaining GFM,
// citations, code, math and the production renderer rather than mocking output.
vi.mock("react-markdown", async importOriginal => {
  const actual = await importOriginal<typeof import("react-markdown")>();
  return { ...actual, default: (props: Parameters<typeof actual.default>[0]) => createElement(actual.default, {
    ...props,
    remarkPlugins: [...(props.remarkPlugins ?? []), () => () => { parsed(props.children); }],
  }) };
});

vi.mock("./externalLinks", async importOriginal => ({
  ...await importOriginal<typeof import("./externalLinks")>(),
  openExternal: vi.fn(async () => {}),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mounted: Array<{ root: ReturnType<typeof createRoot>; host: HTMLDivElement }> = [];
const originalWidth = window.innerWidth;

afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
  parsed.mockClear();
  vi.mocked(openExternal).mockClear();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
});

function mountRoot() {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); mounted.push({ root, host });
  return { root, host };
}

const countContent = (content: string) => parsed.mock.calls.filter(([value]) => value === content).length;

function nativeSearch(content: string): SearchRecord {
  return { enabled: true, status: "completed", queries: ["fixture question"],
    sources: [{ id: "source-one", title: "原始来源", url: "https://example.test/original" }],
    citations: [{ start: 0, end: content.length, sourceIds: ["source-one"] }],
  };
}

describe("SafeMarkdown parsing under workspace updates", () => {
  it("does not parse unchanged history for navigation, layout or draft updates, but still parses each streamed body", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
    const historical = "历史 **正文**\n\n| 项目 | 值 |\n| --- | --- |\n| 公式 | $x^2$ |";
    const secondHistorical = "第二条历史\n\n```typescript\nconst unchanged = true;\n```";
    const search: SearchRecord = { ...nativeSearch(historical), citations: [{ start: 0, end: 2, sourceIds: ["source-one"] }] };
    const ownerRender = vi.fn();
    let navigation!: ReturnType<typeof useConversationNavigation>;
    let changeStream!: (content: string) => void;
    let changeDraft!: (content: string) => void;
    function NavigationConsumer() {
      const state = useConversationNavigationSnapshot(navigation);
      return <output>{`${state.open}/${state.assistantExpanded}/${state.conversationsOpen}`}</output>;
    }
    function Workspace() {
      ownerRender();
      navigation = useConversationNavigation();
      const [layout, setLayout] = useState("narrow");
      const [stream, setStream] = useState("新回答");
      const [draft, setDraft] = useState("");
      changeStream = setStream;
      changeDraft = setDraft;
      return <section data-layout={layout}>
        <NavigationConsumer />
        <button onClick={() => setLayout(layout === "narrow" ? "wide" : "narrow")}>切换宽度</button>
        <article data-history><SafeMarkdown search={search}>{historical}</SafeMarkdown></article>
        <article data-second-history><SafeMarkdown>{secondHistorical}</SafeMarkdown></article>
        <article data-stream><SafeMarkdown>{stream}</SafeMarkdown></article>
        <textarea value={draft} readOnly />
      </section>;
    }
    const { root, host } = mountRoot();
    await act(async () => root.render(<Workspace />));
    const originalHistory = host.querySelector("[data-history]")!.innerHTML;
    expect(host.querySelector("[data-history] table")).not.toBeNull();
    expect(host.querySelector("[data-history] .katex")).not.toBeNull();
    expect(host.querySelector("[data-history] .citation-badge")).not.toBeNull();
    expect(host.querySelector("[data-second-history] code")?.textContent).toContain("const unchanged = true;");
    expect(countContent(historical)).toBe(1);
    expect(countContent(secondHistorical)).toBe(1);
    const initialOwnerRenders = ownerRender.mock.calls.length;
    await act(async () => navigation.expandAssistant());
    await act(async () => navigation.activateDraft());
    await act(async () => navigation.closeConversations());
    await act(async () => navigation.setOpen(false));
    await act(async () => navigation.setOpen(true));
    expect(ownerRender).toHaveBeenCalledTimes(initialOwnerRenders);
    expect(countContent(historical)).toBe(1);
    expect(countContent(secondHistorical)).toBe(1);
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
    await act(async () => changeDraft("尚未发送的草稿"));
    expect(ownerRender.mock.calls.length).toBeGreaterThan(initialOwnerRenders);
    expect(countContent(historical)).toBe(1);
    expect(countContent(secondHistorical)).toBe(1);
    expect(countContent("新回答")).toBe(1);
    for (const content of ["新回答 **", "新回答 **实时", "新回答 **实时更新**", "新回答 **实时更新** $x^2$"]) {
      await act(async () => changeStream(content));
      expect(countContent(content)).toBe(1);
      expect(countContent(historical)).toBe(1);
      expect(countContent(secondHistorical)).toBe(1);
    }
    expect(host.querySelector("[data-stream] strong")?.textContent).toBe("实时更新");
    expect(host.querySelector("[data-stream] .katex")).not.toBeNull();
    expect(host.querySelector("[data-history]")!.innerHTML).toBe(originalHistory);
  });

  it("reuses stable search props but renders changed source titles, URLs, citation groups, addition and removal", async () => {
    const content = "引用答案";
    let search: SearchRecord | undefined = nativeSearch(content);
    const { root, host } = mountRoot();
    const render = () => act(async () => root.render(<SafeMarkdown search={search}>{content}</SafeMarkdown>));
    await render();
    expect(countContent(content)).toBe(1);
    await render();
    expect(countContent(content)).toBe(1);
    search = { ...search, sources: [{ ...search.sources[0], title: "更新的来源标题" }] };
    await render();
    expect(countContent(content)).toBe(2);
    expect(host.querySelector(".citation-badge")?.getAttribute("aria-label")).toBe("打开来源 1: 更新的来源标题");
    search = { ...search, sources: [{ ...search.sources[0], url: "https://example.test/updated" }] };
    await render();
    expect(countContent(content)).toBe(3);
    expect(host.querySelector(".citation-badge")?.getAttribute("title")).toBe("更新的来源标题\nhttps://example.test/updated");
    await act(async () => host.querySelector<HTMLButtonElement>(".citation-badge")!.click());
    expect(openExternal).toHaveBeenCalledWith("https://example.test/updated");
    search = { ...search, sources: [...search.sources, { id: "source-two", title: "第二来源", url: "https://example.test/two" }],
      citations: [{ start: 0, end: content.length, sourceIds: ["source-one", "source-two"] }] };
    await render();
    expect(countContent(content)).toBe(4);
    expect(host.querySelectorAll(".citation-badge")).toHaveLength(2);
    search = { ...search, sources: search.sources.slice(1) };
    await render();
    expect(countContent(content)).toBe(5);
    expect(host.querySelectorAll(".citation-badge")).toHaveLength(1);
    expect(host.querySelector(".citation-badge")?.getAttribute("aria-label")).toBe("打开来源 1: 第二来源");
    search = { ...search, citations: [] };
    await render();
    expect(countContent(content)).toBe(6);
    expect(host.querySelector(".citation-badge")).toBeNull();
    search = nativeSearch(content);
    await render();
    expect(host.querySelector(".citation-badge")).not.toBeNull();
    search = undefined;
    await render();
    expect(countContent(content)).toBe(8);
    expect(host.querySelector(".citation-badge")).toBeNull();
    search = nativeSearch(content);
    await render();
    expect(countContent(content)).toBe(9);
    expect(host.querySelector(".citation-badge")).not.toBeNull();
    // An updated SearchRecord is a complete new prop even when it shares all
    // nested fields: the renderer must not silently compare a selected subset.
    search = { ...search };
    await render();
    expect(countContent(content)).toBe(10);
    await render();
    expect(countContent(content)).toBe(10);
  });

  it("updates the citation interpretation when only the search provider changes", async () => {
    const content = "答案[ayase-source:source-one]";
    const sources: SearchRecord["sources"] = [{ id: "source-one", title: "搜索来源", url: "https://example.test/source" }];
    const record: SearchRecord = { enabled: true, status: "completed", queries: [], sources, citations: [] };
    const { root, host } = mountRoot();
    const render = (search: SearchRecord) => act(async () => root.render(<SafeMarkdown search={search}>{content}</SafeMarkdown>));
    await render(record);
    expect(host.querySelector(".citation-badge")).toBeNull();
    expect(host.textContent).toContain("ayase-source:");
    await render({ ...record, provider: "exa-mcp" });
    expect(host.querySelectorAll(".citation-badge")).toHaveLength(1);
    expect(host.textContent).toBe("答案[1]");
    expect(countContent(content)).toBe(2);
    await render({ ...record, provider: "exa-api" });
    expect(host.querySelectorAll(".citation-badge")).toHaveLength(1);
    expect(countContent(content)).toBe(3);
    await render(record);
    expect(host.querySelector(".citation-badge")).toBeNull();
    expect(host.textContent).toContain("ayase-source:");
    expect(countContent(content)).toBe(4);
  });
});
