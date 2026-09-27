// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { SafeMarkdown } from "./SafeMarkdown";

it.each([
  ["```js\n  const x = 1;\n\n```", "  const x = 1;\n\n"],
  ["```python\r\n\tprint('你好')  \r\n```", "\tprint('你好')  \r\n"],
  ["~~~unknown\n<script>alert(1)</script>\n~~~", "<script>alert(1)</script>\n"],
  ["```\n```", ""],
  ["```\n\n```", "\n"],
  ["```js\nconst x =", "const x ="],
  ["```js\nconst x = 1;\n", "const x = 1;\n"],
  ["> ```js\n>   const x = 1;\n> ```", "  const x = 1;\n"],
  ["- code\n\n  ```js\n  const x = 1;\n  ```", "const x = 1;\n"],
])("copies exact code text: %s", async (source, expected) => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  try {
    await act(async () => root.render(<SafeMarkdown>{source}</SafeMarkdown>));
    expect(host.querySelector("pre code")?.textContent).toBe(expected);
    expect(host.querySelector("script")).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>("[aria-label='复制代码']")!.click());
    expect(writeText).toHaveBeenCalledWith(expected);
    expect(host.textContent).toContain("已复制");
  } finally { await act(async () => root.unmount()); }
});

it("highlights known languages, leaves unknown and inline code literal, and keeps math fenced", () => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<SafeMarkdown>{"```js\nconst answer = 42;\n```\n\n```unknown\nconst answer = 42;\n```\n\n```math\n$$x$$\n```\n\n`const x = 1`\n\n$x^2$"}</SafeMarkdown>);
  const blocks = host.querySelectorAll(".code-block");
  expect(blocks).toHaveLength(3);
  expect(blocks[0].querySelector(".hljs-keyword")?.textContent).toBe("const");
  expect(blocks[1].querySelector("span[class^='hljs']")).toBeNull();
  expect(blocks[2].querySelector(".katex")).toBeNull();
  expect(host.querySelector("p code")?.textContent).toBe("const x = 1");
  expect(host.querySelectorAll(".katex")).toHaveLength(1);
});

it("keeps the block mounted during streaming and reports clipboard failures", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async () => { throw new Error("denied"); }) } });
  const source = "```js\nconst x = '<script>';\n```";
  try {
    let previous: Element | null = null;
    for (let end = 1; end <= source.length; end++) {
      await act(async () => root.render(<SafeMarkdown>{source.slice(0, end)}</SafeMarkdown>));
      const block = host.querySelector(".code-block");
      if (previous) expect(block).toBe(previous);
      previous = block;
    }
    expect(host.querySelector("pre")?.textContent).toBe("const x = '<script>';\n");
    await act(async () => host.querySelector<HTMLButtonElement>("[aria-label='复制代码']")!.click());
    expect(host.textContent).toContain("复制失败");
    expect(host.querySelector("script")).toBeNull();
  } finally { await act(async () => root.unmount()); }
});

it("keeps wrap mode local and stable during streaming, and copies original text in both modes", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const first = "```text\n| a | b |\n```\n\n";
  const code = "\tconst url = 'https://example.test/" + "long".repeat(60) + "';\r\n";
  try {
    await act(async () => root.render(<SafeMarkdown>{first + "```js\n" + code.slice(0, 50)}</SafeMarkdown>));
    const blocks = host.querySelectorAll(".code-block");
    const block = blocks[1];
    const toggle = block.querySelector<HTMLButtonElement>("[aria-label='自动换行']")!;
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    await act(async () => toggle.click());
    expect(block.getAttribute("data-wrap")).toBe("false");
    expect(blocks[0].getAttribute("data-wrap")).toBe("true");
    for (const suffix of ["", "```"]) {
      await act(async () => root.render(<SafeMarkdown>{first + "```js\n" + code + suffix}</SafeMarkdown>));
      expect(host.querySelectorAll(".code-block")[1]).toBe(block);
      expect(toggle.getAttribute("aria-pressed")).toBe("false");
    }
    const copy = block.querySelector<HTMLButtonElement>("[aria-label='复制代码']")!;
    await act(async () => copy.click());
    expect(writeText).toHaveBeenLastCalledWith(code);
    await act(async () => toggle.click());
    expect(block.getAttribute("data-wrap")).toBe("true");
    expect(block.querySelector("pre code")?.textContent).toBe(code);
    expect(block.querySelector(".hljs-keyword")).not.toBeNull();
    await act(async () => copy.click());
    expect(writeText).toHaveBeenLastCalledWith(code);
  } finally { await act(async () => root.unmount()); }
});
