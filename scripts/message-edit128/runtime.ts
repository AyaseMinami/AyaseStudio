import type { ChatTransport } from "../../src/chat/types";
import { fixture } from "./files";
export async function createRuntimeChatTransport(): Promise<ChatTransport> {
  return { async *stream(request) {
    fixture.requests++;
    if (request.signal?.aborted) { yield { type: "aborted" }; return; }
    if (fixture.failProvider) { yield { type: "failed", error: { kind: "server", message: "合成供应商拒绝；已保存的编辑保留。", retryable: false } }; return; }
    yield { type: "text-delta", text: "合成回复：附件顺序与编辑版本已确认。" }; yield { type: "completed", finishReason: "stop" };
  } };
}
export async function createRuntimeModelCatalogClient() { throw Error("隔离验收不读取远端目录。"); }
