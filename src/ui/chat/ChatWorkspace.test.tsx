import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ChatWorkspace, type ChatWorkspaceProps } from "./ChatWorkspace";

const props: ChatWorkspaceProps = {
  title: "Test", draft: "", isHydrated: true, isGenerating: false, messages: [], protocolLabel: "Synthetic model",
  onClear: () => {}, onDraftChange: () => {}, onSend: () => {}, onStop: () => {}, onSearchModeChange: () => {},
};

it("shows the external mode in the existing composer globe while a request is running", () => {
  const html = renderToStaticMarkup(<ChatWorkspace {...props} searchMode="exa-mcp" isGenerating />);
  expect(html).toContain('aria-label="联网搜索：Exa MCP"');
  expect(html).toContain('aria-haspopup="menu"');
  expect(html).toContain("当前会话下次请求");
  expect(html).toContain('aria-label="停止生成"');
  expect(html).not.toMatch(/aria-label="联网搜索：Exa MCP"[^>]*disabled/);
});

it("defaults the composer search mode to off and disables it before hydration", () => {
  const html = renderToStaticMarkup(<ChatWorkspace {...props} isHydrated={false} />);
  expect(html).toMatch(/aria-label="联网搜索：关闭"[^>]*disabled/);
});
