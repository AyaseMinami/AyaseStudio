import { describe, expect, it } from "vitest";
import { defaultSessionConfig } from "../chat/sessionConfig";
import { buildProtocolBody } from "../chat/requestMapping";
import { prepareSearchContext, projectSearchHistory } from "./context";
import { externalCitations, readableSearchAnswer } from "./citations";
import { resolveSearchMode, withSearchMode } from "./mode";
import type { SearchRecord } from "../chat/nativeSearch";
import type { ChatProtocol } from "../chat/types";

const source = { id: "s1", title: "资料", url: "https://example.test/", excerpt: "正文".repeat(700) };
const search: SearchRecord = { enabled: true, provider: "exa-mcp", status: "completed", sources: [source], citations: [], queries: ["问题"] };

describe("external search preparation and citations", () => {
  it("keeps old true native and corrupt choices closed", () => {
    expect(resolveSearchMode({ webSearch: true })).toBe("native");
    expect(resolveSearchMode({ webSearch: false, webSearchProvider: "exa-mcp" })).toBe("off");
    expect(resolveSearchMode({ webSearch: true, webSearchProvider: "unknown" as "native" })).toBe("off");
    expect(resolveSearchMode(withSearchMode(defaultSessionConfig(), "exa-mcp"))).toBe("exa-mcp");
    expect(resolveSearchMode(withSearchMode(defaultSessionConfig(), "exa-api"))).toBe("exa-api");
  });
  it.each<ChatProtocol>(["openai-chat", "openai-responses", "gemini-native", "anthropic-native"])("external mode never requests native tools: %s", protocol => {
    for (const provider of ["exa-mcp", "exa-api"] as const) {
      const body = buildProtocolBody(protocol, { baseUrl: "https://example.test", apiKey: "", model: "any", messages: [{ role: "user", content: "问" }], config: withSearchMode(defaultSessionConfig(), provider) });
      expect(body.tools).toBeUndefined(); expect(body.web_search_options).toBeUndefined();
      if (protocol === "openai-responses") expect(body.store).toBe(false);
    }
  });
  it("finds only verified complete text markers at raw UTF-16 positions", () => {
    const content = "中文😀\r\n正文[ayase-source:s1] 重复[ayase-source:s1] 未知[ayase-source:no] 尾[ayase-source:";
    const citations = externalCitations(content, [source]);
    expect(citations).toHaveLength(2);
    expect(citations.map(c => content.slice(c.start, c.end))).toEqual(["[ayase-source:s1]", "[ayase-source:s1]"]);
    const copy = readableSearchAnswer(content, search);
    expect(copy).toContain("正文[1](https://example.test/)");
    expect(copy).toContain("[ayase-source:no]");
  });
  it("leaves escaped markers, code, links, raw html and all math alone", () => {
    const marker = "[ayase-source:s1]";
    const content = `\\${marker} \`${marker}\`\n\n\`\`\`text\n${marker}\n\`\`\`\n\n$${marker}$ \\(${marker}\\)\n\n[${marker}](https://a.test)\n\n<div>${marker}</div>\n\n有效${marker}`;
    expect(externalCitations(content, [source])).toEqual([{ start: content.lastIndexOf(marker), end: content.length, sourceIds: ["s1"] }]);
  });
  it.each(["exa-mcp", "exa-api"] as const)("projects %s history without replay or old internal identifiers, preserves native replay", provider => {
    const replay = { protocol: "anthropic-native" as const, scope: "scope", content: [{ type: "text", text: "secret old injected request" }] };
    const messages = projectSearchHistory([{ id: "a", role: "assistant", status: "complete", content: "答案[ayase-source:s1]", search: { ...search, provider }, providerReplay: replay },
      { id: "b", role: "assistant", status: "complete", content: "native", providerReplay: replay }]);
    expect(messages[0].content).toBe("答案资料 (https://example.test/)");
    expect(messages[0].providerReplay).toBeUndefined(); expect(messages[1].providerReplay).toBe(replay);
  });
  it("records blockquote citations at original UTF-16 offsets", () => {
    const content = "> first\r\n> cite [ayase-source:s1]";
    expect(externalCitations(content, [source])).toEqual([{ start: content.indexOf("[ayase"), end: content.length, sourceIds: ["s1"] }]);
  });
  it("budgets data with mandatory original content without mutating sources", async () => {
    const config = { ...defaultSessionConfig(), systemInstruction: "系统", contextBudget: { mode: "custom" as const, value: "950" } };
    const prepared = await prepareSearchContext([], "用户正文", config, "gemini-native", "any", [source], []);
    expect(prepared.plan.inputTokens).toBeLessThanOrEqual(950);
    expect(prepared.plan.messages[0].content).toContain("用户正文");
    expect(prepared.sources[0].excerpt!.length).toBeLessThan(source.excerpt.length);
    expect(source.excerpt.length).toBe(1400);
  });
  it("blocks when even minimum data cannot fit", async () => {
    const config = { ...defaultSessionConfig(), contextBudget: { mode: "custom" as const, value: "20" } };
    await expect(prepareSearchContext([], "问", config, "gemini-native", "any", [source], [])).rejects.toThrow("最小检索资料");
  });
});
