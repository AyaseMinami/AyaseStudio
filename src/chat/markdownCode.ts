import type { Root, RootContent, Code } from "mdast";
import type { Plugin } from "unified";

// mdast owns indentation/container parsing. Recover the original line endings
// and final newline that its code value omits, without copying fence markers.
function copyText(node: Code, source: string): string {
  const raw = source.slice(node.position!.start.offset, node.position!.end.offset);
  const lines = raw.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)!.filter((line, index, all) => line !== "" || index < all.length - 1);
  if (!/^ {0,3}(`{3,}|~{3,})/.test(lines[0] ?? "")) return node.value;
  const body = lines.slice(1);
  if (!body.length) return "";
  return node.value.split("\n").map((line, index) => line + (/\r\n$|\r$|\n$/.exec(body[index] ?? "")?.[0] ?? "")).join("");
}

export const remarkCodeBlocks: Plugin<[], Root> = () => (tree, file) => {
  const source = String(file);
  function visit(node: Root | RootContent) {
    if (node.type === "code") {
      node.data = { ...node.data, hProperties: { ...node.data?.hProperties,
        "data-code-text": copyText(node, source), "data-code-language": node.lang ?? "",
      } };
    }
    if ("children" in node) node.children.forEach(visit);
  }
  visit(tree);
};
