import type { ChatProtocol, ChatTransport, FetchLike } from "./types";

export async function createRuntimeChatTransport(
  protocol: ChatProtocol,
): Promise<ChatTransport> {
  const [{ fetch: tauriFetch }, { createChatTransport }] = await Promise.all([
    import("@tauri-apps/plugin-http"),
    import("./transport"),
  ]);
  const runtimeFetch: FetchLike = (input, init) => tauriFetch(input, init);
  return createChatTransport(protocol, { fetch: runtimeFetch });
}
