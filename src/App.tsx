import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, PanelLeftClose, PanelLeftOpen, Send, Square } from "lucide-react";

import "./App.css";
import {
  createChatRepository,
  type StoredChatMessage,
  type StoredMessageStatus,
} from "./chat/repository";
import { createRuntimeChatTransport } from "./chat/runtime";
import { SafeMarkdown } from "./chat/SafeMarkdown";
import {
  loadProviderProfiles,
  saveProviderProfiles,
  type ProviderProfiles,
} from "./chat/settings";
import type { ChatProtocol } from "./chat/types";

const chatRepository = createChatRepository();
const currentChatId = "current";

const protocolOptions: Array<{ value: ChatProtocol; label: string; hint: string }> = [
  {
    value: "openai-chat",
    label: "OpenAI Chat",
    hint: "Base URL 通常以 /v1 结尾",
  },
  {
    value: "openai-responses",
    label: "OpenAI Responses",
    hint: "Base URL 通常以 /v1 结尾",
  },
  {
    value: "gemini-native",
    label: "Gemini Native",
    hint: "填写路由根地址，不包含 /v1beta/models/...",
  },
  {
    value: "anthropic-native",
    label: "Anthropic Native",
    hint: "填写路由根地址，不包含 /v1/messages",
  },
];

function newId(): string {
  return crypto.randomUUID();
}

function replaceAssistant(
  messages: StoredChatMessage[],
  id: string,
  content: string,
  status: StoredMessageStatus,
): StoredChatMessage[] {
  return messages.map((message) =>
    message.id === id ? { ...message, content, status } : message,
  );
}

function App() {
  const [protocol, setProtocol] = useState<ChatProtocol>("openai-chat");
  const [profiles, setProfiles] = useState<ProviderProfiles>(loadProviderProfiles);
  const [messages, setMessages] = useState<StoredChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [error, setError] = useState<string>();
  const abortRef = useRef<AbortController>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const activeProfile = profiles[protocol];
  const protocolInfo = useMemo(
    () => protocolOptions.find((option) => option.value === protocol)!,
    [protocol],
  );

  useEffect(() => {
    saveProviderProfiles(profiles);
  }, [profiles]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const snapshot = await chatRepository.load(currentChatId);
        if (snapshot && !cancelled) {
          const recovered = snapshot.messages.map((message) =>
            message.status === "streaming"
              ? { ...message, status: "aborted" as const }
              : message,
          );
          setMessages(recovered);
          if (
            recovered.some(
              (message, index) => message !== snapshot.messages[index],
            )
          ) {
            await chatRepository.save({
              id: currentChatId,
              updatedAt: Date.now(),
              messages: recovered,
            });
          }
        }
      } catch {
        if (!cancelled) {
          setError("无法读取本地对话记录；本次对话仍可继续。");
        }
      } finally {
        if (!cancelled) {
          setIsHydrated(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function updateProfile(field: keyof typeof activeProfile, value: string) {
    setProfiles((current) => ({
      ...current,
      [protocol]: { ...current[protocol], [field]: value },
    }));
  }

  async function sendMessage() {
    const content = draft.trim();
    if (!content || isStreaming || !isHydrated) {
      return;
    }
    if (!activeProfile.baseUrl || !activeProfile.apiKey || !activeProfile.model) {
      setSettingsOpen(true);
      setError("请先填写当前协议的 Base URL、API Key 和 Model。");
      return;
    }

    setError(undefined);
    setDraft("");
    setIsStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const userMessage: StoredChatMessage = {
      id: newId(),
      role: "user",
      content,
      status: "complete",
    };
    const assistantId = newId();
    const assistantMessage: StoredChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      status: "streaming",
    };
    const requestMessages = [...messages, userMessage]
      .filter((message) => message.content.trim() !== "")
      .map(({ role, content: messageContent }) => ({
        role,
        content: messageContent,
      }));
    let workingMessages = [...messages, userMessage, assistantMessage];
    setMessages(workingMessages);

    let persistChain = Promise.resolve();
    let persistenceFailed = false;
    function queuePersist(snapshotMessages: StoredChatMessage[]) {
      persistChain = persistChain
        .then(() =>
          chatRepository.save({
            id: currentChatId,
            updatedAt: Date.now(),
            messages: snapshotMessages,
          }),
        )
        .catch(() => {
          persistenceFailed = true;
        });
    }
    queuePersist(workingMessages);

    let assistantText = "";
    let lastPaint = 0;
    let lastPersist = 0;
    try {
      const transport = await createRuntimeChatTransport(protocol);
      for await (const event of transport.stream({
        ...activeProfile,
        messages: requestMessages,
        signal: controller.signal,
      })) {
        if (event.type === "text-delta") {
          assistantText += event.text;
          workingMessages = replaceAssistant(
            workingMessages,
            assistantId,
            assistantText,
            "streaming",
          );
          const now = performance.now();
          if (now - lastPaint >= 32) {
            setMessages(workingMessages);
            lastPaint = now;
          }
          if (now - lastPersist >= 500) {
            queuePersist(workingMessages);
            lastPersist = now;
          }
          continue;
        }

        if (event.type === "completed") {
          workingMessages = replaceAssistant(
            workingMessages,
            assistantId,
            assistantText,
            "complete",
          );
        } else if (event.type === "aborted") {
          workingMessages = replaceAssistant(
            workingMessages,
            assistantId,
            assistantText,
            "aborted",
          );
        } else {
          workingMessages = replaceAssistant(
            workingMessages,
            assistantId,
            assistantText,
            "failed",
          );
          const status = event.error.status ? ` (${event.error.status})` : "";
          setError(`${event.error.message}${status}`);
        }
        setMessages(workingMessages);
        queuePersist(workingMessages);
      }
    } catch (caught) {
      workingMessages = replaceAssistant(
        workingMessages,
        assistantId,
        assistantText,
        controller.signal.aborted ? "aborted" : "failed",
      );
      setMessages(workingMessages);
      queuePersist(workingMessages);
      if (!controller.signal.aborted) {
        setError(caught instanceof Error ? caught.message : "无法启动请求");
      }
    } finally {
      await persistChain;
      if (persistenceFailed) {
        setError((current) => current ?? "回复已生成，但保存本地记录失败。");
      }
      setIsStreaming(false);
      abortRef.current = null;
    }
  }

  function clearConversation() {
    abortRef.current?.abort();
    setMessages([]);
    setError(undefined);
    void chatRepository.clear(currentChatId).catch(() => {
      setError("界面已清空，但删除本地记录失败。");
    });
  }

  return (
    <main className="flex h-screen min-h-0 bg-stone-950 text-stone-100">
      {settingsOpen && (
        <aside className="w-80 shrink-0 border-r border-stone-800 bg-stone-900 p-5">
          <div className="mb-8 flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-xl bg-violet-500 text-white">
              <Bot size={20} />
            </div>
            <div>
              <h1 className="font-semibold tracking-tight">Ayase Studio</h1>
              <p className="text-xs text-stone-500">轻量本地对话</p>
            </div>
          </div>

          <label className="field-label" htmlFor="protocol">
            协议
          </label>
          <select
            id="protocol"
            className="field"
            value={protocol}
            disabled={isStreaming}
            onChange={(event) => setProtocol(event.target.value as ChatProtocol)}
          >
            {protocolOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <label className="field-label" htmlFor="base-url">
            Base URL
          </label>
          <input
            id="base-url"
            className="field"
            value={activeProfile.baseUrl}
            onChange={(event) => updateProfile("baseUrl", event.target.value)}
            placeholder="https://relay.example.com/v1"
            spellCheck={false}
          />
          <p className="mb-4 text-xs leading-5 text-stone-500">{protocolInfo.hint}</p>

          <label className="field-label" htmlFor="api-key">
            API Key
          </label>
          <input
            id="api-key"
            className="field"
            type="password"
            value={activeProfile.apiKey}
            onChange={(event) => updateProfile("apiKey", event.target.value)}
            placeholder="仅保存在本机 WebView"
            autoComplete="off"
            spellCheck={false}
          />

          <label className="field-label" htmlFor="model">
            Model
          </label>
          <input
            id="model"
            className="field"
            value={activeProfile.model}
            onChange={(event) => updateProfile("model", event.target.value)}
            placeholder="模型 ID"
            spellCheck={false}
          />

          <div className="mt-6 rounded-xl border border-amber-900/60 bg-amber-950/30 p-3 text-xs leading-5 text-amber-200/70">
            Alpha 版凭据以明文保存在本机。不要输入与你无关或不可信的中转站密钥。
          </div>
        </aside>
      )}

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-stone-800 px-5">
          <button
            className="icon-button"
            onClick={() => setSettingsOpen((open) => !open)}
            aria-label={settingsOpen ? "收起设置" : "展开设置"}
          >
            {settingsOpen ? <PanelLeftClose size={19} /> : <PanelLeftOpen size={19} />}
          </button>
          <div className="text-center">
            <p className="text-sm font-medium">新对话</p>
            <p className="text-xs text-stone-500">{protocolInfo.label}</p>
          </div>
          <button
            className="rounded-lg px-3 py-2 text-xs text-stone-400 transition hover:bg-stone-800 hover:text-stone-100"
            onClick={clearConversation}
            disabled={isStreaming || !isHydrated}
          >
            清空
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-10">
            {messages.length === 0 ? (
              <div className="m-auto max-w-md text-center">
                <div className="mx-auto mb-5 grid size-12 place-items-center rounded-2xl bg-stone-900 text-violet-400">
                  <Bot size={24} />
                </div>
                <h2 className="text-lg font-medium">只保留聊天本身</h2>
                <p className="mt-2 text-sm leading-6 text-stone-500">
                  配置一个协议后开始对话。没有 Agent、知识库或插件系统。
                </p>
              </div>
            ) : (
              <div className="space-y-7">
                {messages.map((message) => (
                  <article
                    key={message.id}
                    className={message.role === "user" ? "flex justify-end" : "flex justify-start"}
                  >
                    <div
                      className={
                        message.role === "user"
                          ? "max-w-[85%] rounded-2xl rounded-br-md bg-violet-600 px-4 py-3 text-sm leading-6 text-white"
                          : "markdown min-w-0 max-w-full text-sm leading-7 text-stone-200"
                      }
                    >
                      {message.role === "assistant" ? (
                        message.content ? (
                          <SafeMarkdown>{message.content}</SafeMarkdown>
                        ) : message.status === "streaming" ? (
                          <span className="inline-flex gap-1 text-stone-500">
                            <i className="typing-dot" />
                            <i className="typing-dot" />
                            <i className="typing-dot" />
                          </span>
                        ) : (
                          <span className="text-stone-600">（无文本输出）</span>
                        )
                      ) : (
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      )}
                      {message.status === "aborted" && (
                        <p className="mt-2 text-xs text-amber-400/80">已停止</p>
                      )}
                      {message.status === "failed" && (
                        <p className="mt-2 text-xs text-red-400/80">生成失败</p>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
            <div ref={transcriptEndRef} />
          </div>
        </div>

        <footer className="shrink-0 px-5 pb-5">
          <div className="mx-auto max-w-3xl">
            {error && (
              <div className="mb-3 rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}
            <div className="rounded-2xl border border-stone-700 bg-stone-900 p-2 shadow-2xl shadow-black/30 focus-within:border-stone-500">
              <textarea
                className="min-h-14 max-h-48 w-full resize-none bg-transparent px-3 py-2 text-sm leading-6 outline-none placeholder:text-stone-600"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder="输入消息，Enter 发送，Shift+Enter 换行"
                disabled={isStreaming || !isHydrated}
              />
              <div className="flex justify-end px-1 pb-1">
                {isStreaming ? (
                  <button
                    className="send-button"
                    onClick={() => abortRef.current?.abort()}
                    aria-label="停止生成"
                  >
                    <Square size={15} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    className="send-button"
                    onClick={() => void sendMessage()}
                    disabled={!draft.trim() || !isHydrated}
                    aria-label="发送"
                  >
                    <Send size={17} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </footer>
      </section>
    </main>
  );
}

export default App;
