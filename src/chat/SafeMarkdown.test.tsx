import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SafeMarkdown } from "./SafeMarkdown";

describe("SafeMarkdown", () => {
  it("renders model-provided raw HTML as inert text", () => {
    const html = renderToStaticMarkup(
      <SafeMarkdown>{'Hello <script>window.stealKey()</script>'}</SafeMarkdown>,
    );

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;window.stealKey()&lt;/script&gt;");
  });
});
