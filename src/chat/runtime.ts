import type { ChatProtocol, ChatTransport, FetchLike } from "./types";
import type { ModelCatalogClient } from "./modelCatalog";

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

export async function createRuntimeModelCatalogClient(
  protocol: ChatProtocol,
): Promise<ModelCatalogClient> {
  const [{ fetch: tauriFetch }, { createModelCatalogClient }] =
    await Promise.all([
      import("@tauri-apps/plugin-http"),
      import("./modelCatalog"),
    ]);
  const runtimeFetch: FetchLike = (input, init) => tauriFetch(input, init);
  return createModelCatalogClient(protocol, { fetch: runtimeFetch });
}
