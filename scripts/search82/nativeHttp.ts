// This acceptance fixture cannot call a real provider. Only synthetic requests are recorded.
export const requests: string[] = [];
export async function fetch(input: string | URL | Request, init?: RequestInit) {
  const url = String(input);
  const provider = url.startsWith("https://api.tavily.com/") ? "tavily" : url.startsWith("https://open.bigmodel.cn/") ? "zhipu" : undefined;
  if (!provider) throw new Error("Synthetic fixture rejects unknown network destinations");
  if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  requests.push(provider);
  const source = { title: "合成搜索来源", url: "https://example.invalid/search82", content: "用于离线验收的合成摘要，不代表真实服务结果。" };
  return new Response(JSON.stringify(provider === "tavily" ? { results: [source] } : { search_result: [{ ...source, link: source.url }] }),
    { status: 200, headers: { "Content-Type": "application/json" } });
}
