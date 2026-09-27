// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SafeMarkdown } from "./SafeMarkdown";

function render(content: string) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<SafeMarkdown>{content}</SafeMarkdown>);
  return host;
}

describe("SafeMarkdown", () => {
  it("preserves tilde number ranges while supporting double-tilde strikethrough", () => {
    const host = render("通常建议**男性从 10~12 磅、女性从 8~10 磅**开始适应。~~删除线~~");

    expect(host.querySelector("strong")?.textContent).toBe("男性从 10~12 磅、女性从 8~10 磅");
    expect(host.querySelector("strong del")).toBeNull();
    expect(host.querySelectorAll("del")).toHaveLength(1);
    expect(host.querySelector("del")?.textContent).toBe("删除线");
  });

  it("renders model-provided raw HTML as inert text", () => {
    const html = renderToStaticMarkup(
      <SafeMarkdown>{'Hello <script>window.stealKey()</script>'}</SafeMarkdown>,
    );

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;window.stealKey()&lt;/script&gt;");
  });

  it("mixes Chinese, emphasis, lists, tables and inline/block mathematics", () => {
    const host = render(String.raw`设 **矩阵** $A \in M_n(\mathbb{R})$：

$$
\begin{pmatrix}1 & 2 \\ 3 & 4\end{pmatrix}
$$

- 分式 $\frac{x_1^2}{2}$

| 量 | 值 |
| --- | --- |
| 平方 | $x^2$ |

$$
\begin{aligned}a &= b+c \\ d &= e\end{aligned}
$$`);
    expect(host.querySelector("strong")?.textContent).toBe("矩阵");
    expect(host.querySelectorAll(".katex")).toHaveLength(5);
    expect(host.querySelectorAll(".katex-display")).toHaveLength(2);
    expect(host.querySelector("li .katex")).not.toBeNull();
    expect(host.querySelector("td .katex")).not.toBeNull();
    expect(host.querySelector(".katex-error")).toBeNull();
  });

  it.each([
    [String.raw`行内 \(x_1^2\) 完成`, 0],
    [String.raw`\[\begin{aligned}a &= b \\ c &= d\end{aligned}\]`, 1],
    ["$$x^2$$", 1],
    ["$2$", 0],
    [String.raw`$\text{价格 \$10}$`, 0],
  ])("supports math delimiters: %s", (source, blocks) => {
    const host = render(source);
    expect(host.querySelectorAll(".katex")).toHaveLength(1);
    expect(host.querySelectorAll(".katex-display")).toHaveLength(blocks);
    expect(host.querySelector(".katex-error")).toBeNull();
  });

  it.each([
    "$10 和 $20", "$10.50, $20.00", String.raw`\$x\$`, String.raw`\\(x\\)`,
    "`$x$`", "`\\(x\\)`", "```latex\n$$x$$\n```", "```math\n\\[x\\]\n```",
    "    $x$",
  ])("leaves currency, escaping and code literal: %s", (source) => {
    expect(render(source).querySelector(".katex")).toBeNull();
  });

  it("does not let currency swallow later math", () => {
    const host = render("花费 $10 和 $20，计算 $x^2$。");
    expect(host.querySelectorAll(".katex")).toHaveLength(1);
    expect(host.textContent).toContain("花费 $10 和 $20，计算 ");
    const code = render("费用 $10 和 $20；代码：`$x$`。");
    expect(code.querySelector(".katex")).toBeNull();
    expect(code.querySelector("code")?.textContent).toBe("$x$");
  });

  it("renders adjacent dollar and bracket formulas without rewriting offsets", () => {
    expect(render(String.raw`$a$\(b\)`).querySelectorAll(".katex")).toHaveLength(2);
    expect(render(String.raw`\$$x$`).querySelectorAll(".katex")).toHaveLength(1);
  });

  it("keeps ordinary single line breaks visible without changing Markdown blocks", () => {
    const host = render("第一行\r\n第二行\n\n- 列表一\n- 列表二\n\n```text\n代码一\n代码二\n```\n\n$$\nx\n+ y\n$$");
    expect(host.querySelectorAll("br")).toHaveLength(1);
    expect(host.querySelectorAll("li")).toHaveLength(2);
    expect(host.querySelector("pre")?.textContent).toContain("代码一\n代码二");
    expect(host.querySelector(".katex-display")).not.toBeNull();

    const hardBreak = render("第一行  \n第二行");
    expect(hardBreak.querySelectorAll("br")).toHaveLength(1);
  });

  it("handles every streamed prefix and renders correctly on closing", () => {
    for (const source of [String.raw`答案 $\frac{x_1}{2}$。`, String.raw`\[\begin{pmatrix}1 & 2 \\ 3 & 4\end{pmatrix}\]`, "$$\nx^2\n$$"]) {
      for (let end = 0; end <= source.length; end++) {
        expect(() => render(source.slice(0, end))).not.toThrow();
      }
      expect(render(source).querySelector(".katex")).not.toBeNull();
      expect(render(source).querySelector(".katex-error")).toBeNull();
    }
  });

  it("keeps unfinished display formulas readable when a stream stops", () => {
    for (const source of ["$$x$$", "$$\nx^2\n$$", "$$x\ny\n$$"]) {
      for (let end = 1; end < source.length; end++) {
        const prefix = source.slice(0, end);
        const host = render(prefix);
        expect(host.querySelector(".katex")).toBeNull();
        expect(host.textContent?.trim()).toBe(prefix.trim());
      }
      expect(render(source).querySelector(".katex-display")).not.toBeNull();
    }
  });

  it.each([["$$", "$$"], [String.raw`\[`, String.raw`\]`]])("keeps multiline %s math out of Markdown block parsing", (open, close) => {
    const source = `${open}\n\\begin{aligned}\na &= b \\\\\n- c &= d\n\\end{aligned}\n${close}`;
    const host = render(source);
    expect(host.querySelectorAll(".katex-display")).toHaveLength(1);
    expect(host.querySelector(".katex-error, ul")).toBeNull();
  });

  it("falls back readably for malformed math", () => {
    const host = render(String.raw`$\frac{$`);
    expect(host.querySelector(".katex-error")?.textContent).toBe(String.raw`\frac{`);
  });

  it("does not trust formula HTML, links or external images", () => {
    const host = render(String.raw`$\href{javascript:alert(1)}{click}$

$\includegraphics{https://example.com/tracker.png}$

$\htmlClass{injected}{x}$

<script>alert(1)</script><img src=x onerror=alert(1)>`);
    expect(host.querySelector("a, img, script, .injected, [onerror]")).toBeNull();
    expect(host.textContent).toContain("<script>alert(1)</script>");
  });

  it("keeps citation offsets after backslash math and inside a formula", () => {
    const content = String.raw`先 \(x^2\)，再 $y_1$。结束`;
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<SafeMarkdown search={{ enabled: true, status: "completed", queries: [],
      sources: [{ id: "one", title: "Source", url: "https://example.com" }],
      citations: [{ start: 0, end: content.indexOf("，"), sourceIds: ["one"] },
        { start: content.indexOf("$"), end: content.indexOf("_"), sourceIds: ["one"] },
        { start: content.indexOf("结束"), end: content.length, sourceIds: ["one"] }],
    }}>{content}</SafeMarkdown>);
    expect(host.querySelectorAll(".katex")).toHaveLength(2);
    expect(host.querySelectorAll(".citation-badge")).toHaveLength(3);
    expect(host.querySelectorAll(".katex .citation-badge")).toHaveLength(0);
    expect(host.textContent).toContain("[1]，再");
    expect(host.textContent).toContain("[1]。结束[1]");
  });

  it("keeps citation positions meaningful across soft CRLF line breaks", () => {
    const content = "第一行\r\n第二行\n第三行";
    const citationEnd = "第一行\r\n第二行".length;
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<SafeMarkdown search={{ enabled: true, status: "completed", queries: [],
      sources: [{ id: "one", title: "Source", url: "https://example.com" }],
      citations: [{ start: 0, end: citationEnd, sourceIds: ["one"] }],
    }}>{content}</SafeMarkdown>);
    expect(host.querySelectorAll("br")).toHaveLength(2);
    const badge = host.querySelector<HTMLButtonElement>(".citation-badge");
    expect(badge?.previousSibling?.textContent?.trim()).toBe("第二行");
    expect(badge?.nextSibling?.nodeName).toBe("BR");
  });
});
