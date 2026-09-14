import { useEffect, useMemo, useRef, useState } from "react";

import { getProtocolOption } from "./protocolOptions";
import {
  createChatRepository,
  type StoredChatMessage,
  type StoredMessageStatus,
} from "./repository";
import { createRuntimeChatTransport } from "./runtime";
import {
  loadProviderProfiles,
  saveProviderProfiles,
  type ProviderProfile,
  type ProviderProfiles,
} from "./settings";
import type { ChatProtocol } from "./types";

const chatRepository = createChatRepository();
const currentChatId = "current";

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

export function useChatSession({
  onConfigurationRequired,
}: {
  onConfigurationRequired(): void;
}) {
  const [protocol, setProtocol] = useState<ChatProtocol>("openai-chat");
  const [profiles, setProfiles] = useState<ProviderProfiles>(loadProviderProfiles);
  const [messages, setMessages] = useState<StoredChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [error, setError] = useState<string>();
  const abortRef = useRef<AbortController>(null);
  const activeProfile = profiles[protocol];
  const protocolInfo = useMemo(() => getProtocolOption(protocol), [protocol]);

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

  function updateProfile(field: keyof ProviderProfile, value: string): void {
    setProfiles((current) => ({
      ...current,
      [protocol]: { ...current[protocol], [field]: value },
    }));
  }

  async function sendMessage(): Promise<void> {
    const content = draft.trim();
    if (!content || isStreaming || !isHydrated) {
      return;
    }
    if (!activeProfile.baseUrl || !activeProfile.apiKey || !activeProfile.model) {
      onConfigurationRequired();
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

  function stopGeneration(): void {
    abortRef.current?.abort();
  }

  function clearConversation(): void {
    abortRef.current?.abort();
    setMessages([]);
    setError(undefined);
    void chatRepository.clear(currentChatId).catch(() => {
      setError("界面已清空，但删除本地记录失败。");
    });
  }

  return {
    activeProfile,
    clearConversation,
    draft,
    error,
    isHydrated,
    isStreaming,
    messages,
    protocol,
    protocolInfo,
    sendMessage,
    setDraft,
    setProtocol,
    stopGeneration,
    updateProfile,
  };
}
