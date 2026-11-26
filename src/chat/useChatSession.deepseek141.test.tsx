// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatSession } from "./useChatSession";
import { createChatRepository } from "./repository";
import { saveConnectionSettings } from "./settings";
import { buildProtocolBody } from "./requestMapping";
import { defaultSessionConfig } from "./sessionConfig";
import type { ChatEvent, ChatProtocol, ChatRequest, ChatTransport } from "./types";

const mocks = vi.hoisted(() => ({
  createRuntimeChatTransport: vi.fn(),
  createRuntimeModelCatalogClient: vi.fn(),
  read: vi.fn(),
  cleanup: vi.fn(),
  verify: vi.fn(),
  save: vi.fn(),
}));
vi.mock("./runtime", () => mocks);
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("./attachmentResources", () => ({
  createTauriAttachmentStore: () => ({
    read: mocks.read,
    cleanup: mocks.cleanup,
    verify: mocks.verify,
    save: mocks.save,
  }),
}));

describe("#141 DeepSeek server web tools in useChatSession", () => {
  const repo = createChatRepository();
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;
  let session: ReturnType<typeof useChatSession>;

  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.clear();
    await repo.load("current");
    const db = new Dexie("AyaseStudio");
    await db.open();
    await Promise.all(db.tables.map((table) => table.clear()));
    db.close();
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.cleanup.mockResolvedValue(undefined);
    mocks.verify.mockResolvedValue(undefined);
    mocks.read.mockImplementation(async (item) => ({ ...item, data: "aGk=" }));
    saveConnectionSettings({
      version: 3,
      activeModelId: "m-resp",
      providers: [{
        id: "p-ds",
        name: "DeepSeek",
        connections: [
          { id: "c-resp", name: "Responses", protocol: "openai-responses", baseUrl: "https://api.deepseek.com", apiKey: "synthetic-key", models: [{ id: "m-resp", modelId: "deepseek-flash" }] },
          { id: "c-anth", name: "Anthropic", protocol: "anthropic-native", baseUrl: "https://api.deepseek.com/anthropic", apiKey: "synthetic-key", models: [{ id: "m-anth", modelId: "deepseek-flash" }] },
          { id: "c-chat", name: "Chat", protocol: "openai-chat", baseUrl: "https://api.deepseek.com", apiKey: "synthetic-key", models: [{ id: "m-chat", modelId: "deepseek-flash" }] },
        ],
      }],
    });
    await repo.initializeWorkspace("m-resp", ["m-resp", "m-anth", "m-chat"]);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    function Probe() {
      session = useChatSession({ onConfigurationRequired: () => undefined });
      return null;
    }
    await act(async () => root.render(<Probe />));
    await wait(() => session.isHydrated && session.workspace.canSend());
    await act(async () => { await session.setSearchMode("deepseek-server"); });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function wait(predicate: () => boolean) {
    for (let i = 0; i < 150 && !predicate(); i += 1) {
      await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
    }
    expect(predicate()).toBe(true);
  }

  it("blocks openai-chat across send, retry, and editAndSend with zero network calls, and avoids false protocol error when unselected", async () => {
    // 1) Normal send on openai-chat blocked before transport
    await act(async () => { await session.setConversationModel("m-chat"); });
    expect(session.configErrors.webSearch).toContain("Chat Completions 不支持 DeepSeek 服务端联网工具");
    await act(async () => session.setDraft("hello"));
    await act(async () => { await session.sendMessage(); });
    expect(mocks.createRuntimeChatTransport).not.toHaveBeenCalled();
    expect(session.error).toContain("Chat Completions 不支持 DeepSeek 服务端联网工具");
    expect(session.messages).toHaveLength(0);

    // 2) Send on Responses succeeds and creates a complete round, then switching to openai-chat blocks editAndSend
    await act(async () => { await session.setConversationModel("m-resp"); });
    const captured: Array<{ protocol: ChatProtocol; request: ChatRequest }> = [];
    mocks.createRuntimeChatTransport.mockImplementation(async (protocol: ChatProtocol) => ({
      async *stream(request: ChatRequest) {
        captured.push({ protocol, request });
        yield { type: "text-delta", text: "ok" };
        yield { type: "completed" };
      },
    } satisfies ChatTransport));
    await act(async () => session.setDraft("first"));
    await act(async () => { await session.sendMessage(); });
    expect(session.messages).toHaveLength(2);
    const body = buildProtocolBody("openai-responses", captured[0].request);
    expect(body.tools).toEqual([{ type: "deepseek_web_search" }, { type: "deepseek_read_url" }]);

    // Switch to openai-chat -> editAndSend blocked with zero transport call
    mocks.createRuntimeChatTransport.mockClear();
    await act(async () => { await session.setConversationModel("m-chat"); });
    const editResult = await act(async () => session.editAndSendMessage(session.messages[0].id, "edited"));
    expect(editResult.status).toBe("notSaved");
    expect(editResult.error).toContain("Chat Completions 不支持 DeepSeek 服务端联网工具");
    expect(mocks.createRuntimeChatTransport).not.toHaveBeenCalled();

    // Unselected model does not misreport openai-chat protocol unsupported
    await act(async () => {
      await session.workspace.execute({
        type: "configure-conversation",
        id: session.workspace.conversation!.id,
        settings: { modelId: null, config: session.sessionConfig },
      });
    });
    expect(session.configErrors.webSearch).toBeUndefined();
  });

  it("persists only a safe placeholder during DeepSeek streaming, cleans up atomically on refusal, and permits explicit retry", async () => {
    let releaseStream!: () => void;
    const streamGate = new Promise<void>((resolve) => { releaseStream = resolve; });
    let callCount = 0;

    mocks.createRuntimeChatTransport.mockImplementation(async () => ({
      async *stream(request: ChatRequest): AsyncIterable<ChatEvent> {
        if (request.config?.webSearchProvider !== "deepseek-server") {
          yield { type: "text-delta", text: "Auto Title" };
          yield { type: "completed" };
          return;
        }
        callCount += 1;
        if (callCount === 1) {
          yield {
            type: "search-update",
            search: {
              enabled: true,
              status: "completed",
              queries: ["safe query"],
              sources: [{ id: "s1", url: "https://example.test/s1", title: "Source 1" }],
              citations: [{ start: 0, end: 5, sourceIds: ["s1"] }],
            },
          };
          yield { type: "thinking-delta", text: "Unreviewed thought" };
          yield { type: "text-delta", text: "Unreviewed sensitive draft" };
          yield {
            type: "provider-replay",
            replay: {
              protocol: "openai-responses",
              scope: "c-resp|https://api.deepseek.com",
              content: [{ type: "web_search_call", id: "ws_1", status: "completed", kind: "read_link", signature: "sig-1" }],
            },
          };
          await streamGate;
          yield {
            type: "completed",
            finishReason: "incomplete:content_filter",
            refusal: { reason: "content_filter", explanation: "Safety notice" },
          };
          return;
        }
        yield { type: "text-delta", text: "Clean retry reply" };
        yield { type: "completed" };
      },
    } satisfies ChatTransport));

    await act(async () => {
      await session.workspace.execute({
        type: "configure-conversation",
        id: session.workspace.conversation!.id,
        settings: {
          modelId: "m-resp",
          config: {
            ...session.sessionConfig,
            thinking: { "openai-responses": { choice: "high", budget: "", includeSummary: true } },
          },
        },
      });
    });

    await act(async () => session.setDraft("ask something"));
    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = session.sendMessage();
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    // While streaming, IndexedDB MUST ONLY hold the safe placeholder (empty content, no thinking/replay/citations)
    const midDb = await repo.load("current");
    const midAssistant = midDb?.messages[1];
    expect(midAssistant?.status).toBe("streaming");
    expect(midAssistant?.content).toBe("");
    expect(midAssistant?.thinkingSummary).toBeUndefined();
    expect(midAssistant?.providerReplay).toBeUndefined();
    expect(midAssistant?.search?.sources).toHaveLength(1);
    expect(midAssistant?.search?.citations).toEqual([]);

    // Finish with refusal -> atomic cleanup persisted
    await act(async () => {
      releaseStream();
      await sendPromise;
    });
    const finalDb = await repo.load("current");
    const finalAssistant = finalDb?.messages[1];
    expect(finalAssistant?.status).toBe("incomplete");
    expect(finalAssistant?.content).toBe("该回复因内容安全审核被拒答。\n\nSafety notice");
    expect(finalAssistant?.thinkingSummary).toBeUndefined();
    expect(finalAssistant?.providerReplay).toBeUndefined();
    expect(finalAssistant?.continuation).toBeUndefined();
    expect(finalAssistant?.search?.sources).toHaveLength(1);
    expect(finalAssistant?.search?.queries).toEqual(["safe query"]);
    expect(finalAssistant?.search?.citations).toEqual([]);
    expect(callCount).toBe(1); // never auto-retried

    // Explicit user retry works cleanly
    await act(async () => { await session.retryMessage(session.messages[0].id); });
    expect(callCount).toBe(2);
    expect(session.messages[1].status).toBe("complete");
    expect(session.messages[1].content).toBe("Clean retry reply");
  });

  it("never creates continuation for DeepSeek server turns, downgrades pause_turn to incomplete, and blocks resume entry", async () => {
    await act(async () => { await session.setConversationModel("m-anth"); });
    await act(async () => { await session.setDeepSeekWebTools({ search: true, readUrl: false }); });

    mocks.createRuntimeChatTransport.mockResolvedValue({
      async *stream(request: ChatRequest): AsyncIterable<ChatEvent> {
        const body = buildProtocolBody("anthropic-native", request);
        expect(body.tools).toEqual([{ type: "deepseek_web_search", name: "deepseek_web_search" }]);
        yield { type: "text-delta", text: "partial" };
        yield { type: "completed", finishReason: "pause_turn" };
      },
    } satisfies ChatTransport);

    await act(async () => session.setDraft("deep search"));
    await act(async () => { await session.sendMessage(); });
    expect(session.messages[1].status).toBe("incomplete");
    expect(session.messages[1].continuation).toBeUndefined();

    // Even if a paused record with DeepSeek config or tool blocks exists in storage, continueMessage rejects it with zero requests
    mocks.createRuntimeChatTransport.mockClear();
    const forgedConfig = {
      ...defaultSessionConfig(),
      webSearch: true,
      webSearchProvider: "deepseek-server" as const,
      deepseekWebTools: { search: true, readUrl: true },
    };
    await repo.save({
      id: "current",
      updatedAt: Date.now(),
      messages: [
        { id: "u-forged", role: "user", content: "q", status: "complete" },
        {
          id: "a-forged",
          role: "assistant",
          replyToId: "u-forged",
          content: "partial",
          status: "paused",
          providerReplay: {
            protocol: "anthropic-native",
            scope: "c-anth|https://api.deepseek.com/anthropic",
            content: [{ type: "server_tool_use", id: "t1", name: "deepseek_web_search", input: {} }],
          },
          continuation: {
            config: forgedConfig,
            model: "deepseek-flash",
            baseUrl: "https://api.deepseek.com/anthropic",
            scope: "c-anth|https://api.deepseek.com/anthropic",
            messages: [{ role: "user", content: "q" }],
          },
        },
      ],
    });
    // Remount session to hydrate the persisted forged paused message from IndexedDB
    function RemountProbe() {
      session = useChatSession({ onConfigurationRequired: () => undefined });
      return null;
    }
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<RemountProbe />));
    await wait(() => session.isHydrated && session.messages.some((m) => m.id === "a-forged"));
    await act(async () => { await session.continueMessage("a-forged"); });
    expect(mocks.createRuntimeChatTransport).not.toHaveBeenCalled();
    expect(session.error).toContain("DeepSeek 联网工具，不支持继续生成");
  });

  it("downgrades native Anthropic pause_turn carrying DeepSeek tool blocks to incomplete and clears continuation", async () => {
    await act(async () => { await session.setConversationModel("m-anth"); });
    await act(async () => { await session.setSearchMode("native"); });

    mocks.createRuntimeChatTransport.mockResolvedValue({
      async *stream(): AsyncIterable<ChatEvent> {
        yield { type: "text-delta", text: "partial native with deepseek block" };
        yield {
          type: "provider-replay",
          replay: {
            protocol: "anthropic-native",
            scope: "c-anth|https://api.deepseek.com/anthropic",
            content: [
              { type: "server_tool_use", id: "ds1", name: "deepseek_read_url", kind: "read_link", input: { url: "https://a.test" } },
              { type: "web_fetch_tool_result", tool_use_id: "ds1", kind: "read_link", signature: "sig-1", content: { type: "web_fetch_result", url: "https://a.test" } },
              { type: "text", text: "partial native with deepseek block" },
            ],
          },
        };
        yield { type: "completed", finishReason: "pause_turn" };
      },
    } satisfies ChatTransport);

    await act(async () => session.setDraft("test native deepseek pause"));
    await act(async () => { await session.sendMessage(); });
    expect(session.messages[1].status).toBe("incomplete");
    expect(session.messages[1].continuation).toBeUndefined();

    // P2-C (follow-up): resuming a valid native paused message whose second segment returns pause_turn with no new replay
    // (e.g. DeepSeek search-only pruned replay) must NOT reuse the stale segment-1 replay to stay paused
    let segment = 0;
    mocks.createRuntimeChatTransport.mockResolvedValue({
      async *stream(): AsyncIterable<ChatEvent> {
        segment += 1;
        if (segment === 1) {
          yield { type: "text-delta", text: "seg1" };
          yield {
            type: "provider-replay",
            replay: {
              protocol: "anthropic-native",
              scope: "c-anth|https://api.deepseek.com/anthropic",
              content: [{ type: "text", text: "seg1" }],
            },
          };
          yield { type: "completed", finishReason: "pause_turn" };
          return;
        }
        yield { type: "text-delta", text: "seg2" };
        yield { type: "completed", finishReason: "pause_turn" };
      },
    } satisfies ChatTransport);

    await act(async () => session.setDraft("resume stale replay check"));
    await act(async () => { await session.sendMessage(); });
    const pausedAssistant = session.messages[session.messages.length - 1];
    expect(pausedAssistant.status).toBe("paused");
    expect(pausedAssistant.continuation).toBeDefined();

    await act(async () => { await session.continueMessage(pausedAssistant.id); });
    const afterResume = session.messages[session.messages.length - 1];
    expect(afterResume.status).toBe("incomplete");
    expect(afterResume.continuation).toBeUndefined();
  });
});
