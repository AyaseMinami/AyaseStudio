import { useEffect, useMemo, useRef, useState } from "react";

import type { DiscoveredModel } from "./modelCatalog";
import {
  testModelAvailability,
  type ModelAvailabilityResult,
} from "./modelAvailability";
import { getProtocolOption } from "./protocolOptions";
import {
  createChatRepository,
  type StoredChatMessage,
  type StoredMessageStatus,
} from "./repository";
import {
  createRuntimeChatTransport,
  createRuntimeModelCatalogClient,
} from "./runtime";
import {
  addConnection,
  addModel,
  createProviderFromTemplate,
  deleteConnection,
  deleteModel,
  deleteProvider,
  getActiveTarget,
  getConnection,
  loadConnectionSettings,
  providerTemplates,
  renameProvider,
  saveConnectionSettings,
  selectModel,
  updateConnection,
  updateModel,
  type ConnectionField,
  type ModelField,
  type ProviderTemplateId,
} from "./settings";
import type { ChatProtocol } from "./types";
import {
  resolveGenerationEndpoint,
  resolveModelCatalogEndpoint,
  UrlResolutionError,
} from "./urlResolution";

const chatRepository = createChatRepository();
const currentChatId = "current";

export interface ModelCatalogViewState {
  status: "idle" | "loading" | "success" | "error";
  models: DiscoveredModel[];
  error?: string;
}

export type ModelTestViewState =
  | { status: "running" }
  | ModelAvailabilityResult;

function newId(): string {
  return crypto.randomUUID();
}

function uniqueProviderName(existingNames: string[], desiredName: string): string {
  if (!existingNames.includes(desiredName)) {
    return desiredName;
  }
  let suffix = 2;
  while (existingNames.includes(`${desiredName} ${suffix}`)) {
    suffix += 1;
  }
  return `${desiredName} ${suffix}`;
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
  const [connectionSettings, setConnectionSettings] = useState(
    loadConnectionSettings,
  );
  const [messages, setMessages] = useState<StoredChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [error, setError] = useState<string>();
  const abortRef = useRef<AbortController>(null);
  const catalogAbortControllers = useRef(
    new Map<string, AbortController>(),
  );
  const testAbortControllers = useRef(new Map<string, AbortController>());
  const [modelCatalogs, setModelCatalogs] = useState<
    Record<string, ModelCatalogViewState>
  >({});
  const [modelTests, setModelTests] = useState<
    Record<string, ModelTestViewState>
  >({});

  function invalidateCatalogRequest(connectionId: string): void {
    const controller = catalogAbortControllers.current.get(connectionId);
    catalogAbortControllers.current.delete(connectionId);
    controller?.abort();
  }

  function invalidateModelTestRequest(modelId: string): void {
    const controller = testAbortControllers.current.get(modelId);
    testAbortControllers.current.delete(modelId);
    controller?.abort();
  }
  const activeTarget = useMemo(
    () => getActiveTarget(connectionSettings),
    [connectionSettings],
  );
  const activeProvider = activeTarget?.provider;
  const activeConnection = activeTarget?.connection;
  const activeModel = activeTarget?.model;
  const protocolInfo = useMemo(
    () =>
      activeConnection ? getProtocolOption(activeConnection.protocol) : undefined,
    [activeConnection],
  );

  useEffect(() => {
    saveConnectionSettings(connectionSettings);
  }, [connectionSettings]);

  useEffect(() => {
    const validConnectionIds = new Set(
      connectionSettings.providers.flatMap((provider) =>
        provider.connections.map((connection) => connection.id),
      ),
    );
    const validModelIds = new Set(
      connectionSettings.providers.flatMap((provider) =>
        provider.connections.flatMap((connection) =>
          connection.models.map((model) => model.id),
        ),
      ),
    );
    setModelCatalogs((current) => {
      const entries = Object.entries(current).filter(([connectionId]) =>
        validConnectionIds.has(connectionId),
      );
      return entries.length === Object.keys(current).length
        ? current
        : Object.fromEntries(entries);
    });
    setModelTests((current) => {
      const entries = Object.entries(current).filter(([modelId]) =>
        validModelIds.has(modelId),
      );
      return entries.length === Object.keys(current).length
        ? current
        : Object.fromEntries(entries);
    });
  }, [connectionSettings]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      for (const controller of catalogAbortControllers.current.values()) {
        controller.abort();
      }
      for (const controller of testAbortControllers.current.values()) {
        controller.abort();
      }
    },
    [],
  );

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

  function addProviderFromTemplate(templateId: ProviderTemplateId): string {
    const providerId = newId();
    const template = providerTemplates.find(
      (candidate) => candidate.id === templateId,
    )!;
    const connectionIds = Object.fromEntries(
      template.connections.map(({ protocol }) => [protocol, newId()]),
    ) as Partial<Record<ChatProtocol, string>>;
    setConnectionSettings((current) =>
      createProviderFromTemplate(current, templateId, {
        providerId,
        connectionIds,
        name: uniqueProviderName(
          current.providers.map((provider) => provider.name),
          template.providerName,
        ),
      }),
    );
    return providerId;
  }

  function addProviderConnection(
    providerId: string,
    name: string,
    protocol: ChatProtocol,
    copyFromConnectionId?: string,
  ): string {
    const connectionId = newId();
    setConnectionSettings((current) =>
      addConnection(current, providerId, {
        id: connectionId,
        name,
        protocol,
        copyFromConnectionId,
      }),
    );
    return connectionId;
  }

  function updateConnectionProfile(
    connectionId: string,
    field: ConnectionField,
    value: string,
  ): void {
    if (field === "protocol" || field === "baseUrl" || field === "apiKey") {
      invalidateCatalogRequest(connectionId);
      setModelCatalogs((current) => {
        if (!(connectionId in current)) {
          return current;
        }
        const { [connectionId]: _removed, ...remaining } = current;
        return remaining;
      });
      const affectedModelIds = new Set(
        getConnection(connectionSettings, connectionId)?.models.map(
          (model) => model.id,
        ) ?? [],
      );
      for (const modelId of affectedModelIds) {
        invalidateModelTestRequest(modelId);
      }
      setModelTests((current) => {
        const entries = Object.entries(current).filter(
          ([modelId]) => !affectedModelIds.has(modelId),
        );
        return entries.length === Object.keys(current).length
          ? current
          : Object.fromEntries(entries);
      });
    }
    setConnectionSettings((current) =>
      updateConnection(current, connectionId, field, value),
    );
  }

  function addConfiguredModel(
    connectionId: string,
    modelId: string,
    displayName?: string,
  ): string {
    const id = newId();
    setConnectionSettings((current) =>
      addModel(current, connectionId, { id, modelId, displayName }),
    );
    return id;
  }

  function updateConfiguredModel(
    modelId: string,
    field: ModelField,
    value: string,
  ): void {
    if (field === "modelId") {
      invalidateModelTestRequest(modelId);
      setModelTests((current) => {
        if (!(modelId in current)) {
          return current;
        }
        const { [modelId]: _removed, ...remaining } = current;
        return remaining;
      });
    }
    setConnectionSettings((current) =>
      updateModel(current, modelId, field, value),
    );
  }

  function setActiveModel(modelId: string): void {
    setConnectionSettings((current) => selectModel(current, modelId));
  }

  function removeModel(modelId: string): void {
    invalidateModelTestRequest(modelId);
    setModelTests((current) => {
      if (!(modelId in current)) {
        return current;
      }
      const { [modelId]: _removed, ...remaining } = current;
      return remaining;
    });
    setConnectionSettings((current) => deleteModel(current, modelId));
  }

  function removeConnection(connectionId: string): void {
    invalidateCatalogRequest(connectionId);
    const affectedModelIds = new Set(
      getConnection(connectionSettings, connectionId)?.models.map(
        (model) => model.id,
      ) ?? [],
    );
    for (const modelId of affectedModelIds) {
      invalidateModelTestRequest(modelId);
    }
    setConnectionSettings((current) =>
      deleteConnection(current, connectionId),
    );
  }

  function removeProvider(providerId: string): void {
    const provider = connectionSettings.providers.find(
      (candidate) => candidate.id === providerId,
    );
    for (const connection of provider?.connections ?? []) {
      invalidateCatalogRequest(connection.id);
      for (const model of connection.models) {
        invalidateModelTestRequest(model.id);
      }
    }
    setConnectionSettings((current) => deleteProvider(current, providerId));
  }

  function updateProviderName(providerId: string, name: string): void {
    setConnectionSettings((current) =>
      renameProvider(current, providerId, name),
    );
  }

  async function refreshModelCatalog(connectionId: string): Promise<void> {
    const connection = getConnection(connectionSettings, connectionId);
    const existing = modelCatalogs[connectionId];
    if (!connection?.baseUrl.trim() || !connection.apiKey.trim()) {
      setModelCatalogs((current) => ({
        ...current,
        [connectionId]: {
          status: "error",
          models: current[connectionId]?.models ?? [],
          error: "请先填写该连接的 Base URL 和 API Key。",
        },
      }));
      return;
    }
    try {
      resolveModelCatalogEndpoint(connection.protocol, connection.baseUrl);
    } catch (error) {
      if (!(error instanceof UrlResolutionError)) throw error;
      setModelCatalogs((current) => ({
        ...current,
        [connectionId]: {
          status: "error",
          models: current[connectionId]?.models ?? [],
          error: error.message,
        },
      }));
      return;
    }

    catalogAbortControllers.current.get(connectionId)?.abort();
    const controller = new AbortController();
    catalogAbortControllers.current.set(connectionId, controller);
    setModelCatalogs((current) => ({
      ...current,
      [connectionId]: {
        status: "loading",
        models: current[connectionId]?.models ?? [],
      },
    }));
    try {
      const client = await createRuntimeModelCatalogClient(connection.protocol);
      const models = await client.list({
        baseUrl: connection.baseUrl,
        apiKey: connection.apiKey,
        signal: controller.signal,
      });
      if (catalogAbortControllers.current.get(connectionId) !== controller) {
        return;
      }
      const nextModels =
        models.length > 0 ? models : (existing?.models ?? models);
      setModelCatalogs((current) => ({
        ...current,
        [connectionId]: { status: "success", models: nextModels },
      }));
    } catch (caught) {
      if (catalogAbortControllers.current.get(connectionId) !== controller) {
        return;
      }
      if (controller.signal.aborted) {
        setModelCatalogs((current) => ({
          ...current,
          [connectionId]: current[connectionId]?.models.length
            ? { status: "success", models: current[connectionId].models }
            : { status: "idle", models: [] },
        }));
        return;
      }
      setModelCatalogs((current) => ({
        ...current,
        [connectionId]: {
          status: "error",
          models: current[connectionId]?.models ?? existing?.models ?? [],
          error:
            caught instanceof Error ? caught.message : "无法获取模型列表。",
        },
      }));
    } finally {
      if (catalogAbortControllers.current.get(connectionId) === controller) {
        catalogAbortControllers.current.delete(connectionId);
      }
    }
  }

  function cancelModelCatalogRefresh(connectionId: string): void {
    catalogAbortControllers.current.get(connectionId)?.abort();
  }

  async function runModelTest(
    connectionId: string,
    configuredModelId: string,
  ): Promise<void> {
    const connection = getConnection(connectionSettings, connectionId);
    const model = connection?.models.find(
      (candidate) => candidate.id === configuredModelId,
    );
    if (!connection || !model || !connection.baseUrl || !connection.apiKey) {
      setModelTests((current) => ({
        ...current,
        [configuredModelId]: {
          status: "failed",
          totalMs: 0,
          error: {
            kind: "http",
            message: "请先填写连接的 Base URL、API Key 和模型 ID。",
            retryable: false,
          },
        },
      }));
      return;
    }
    try {
      resolveGenerationEndpoint(
        connection.protocol,
        connection.baseUrl,
        model.modelId,
      );
    } catch (error) {
      if (!(error instanceof UrlResolutionError)) throw error;
      setModelTests((current) => ({
        ...current,
        [configuredModelId]: {
          status: "failed",
          totalMs: 0,
          error: { kind: "protocol", message: error.message, retryable: false },
        },
      }));
      return;
    }

    for (const runningModelId of [
      ...testAbortControllers.current.keys(),
    ]) {
      invalidateModelTestRequest(runningModelId);
    }
    setModelTests((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([, test]) => test.status !== "running"),
      ),
    );
    const controller = new AbortController();
    testAbortControllers.current.set(configuredModelId, controller);
    setModelTests((current) => ({
      ...current,
      [configuredModelId]: { status: "running" },
    }));
    try {
      const transport = await createRuntimeChatTransport(connection.protocol);
      const result = await testModelAvailability(
        transport,
        {
          baseUrl: connection.baseUrl,
          apiKey: connection.apiKey,
          model: model.modelId,
        },
        { signal: controller.signal },
      );
      if (testAbortControllers.current.get(configuredModelId) !== controller) {
        return;
      }
      setModelTests((current) => ({
        ...current,
        [configuredModelId]: result,
      }));
    } catch (caught) {
      if (testAbortControllers.current.get(configuredModelId) !== controller) {
        return;
      }
      const result: ModelTestViewState = controller.signal.aborted
        ? { status: "cancelled", totalMs: 0 }
        : {
            status: "failed",
            totalMs: 0,
            error: {
              kind: "network",
              message:
                caught instanceof Error ? caught.message : "无法启动模型测试。",
              retryable: true,
            },
          };
      setModelTests((current) => ({
        ...current,
        [configuredModelId]: result,
      }));
    } finally {
      if (testAbortControllers.current.get(configuredModelId) === controller) {
        testAbortControllers.current.delete(configuredModelId);
      }
    }
  }

  function cancelModelTest(modelId: string): void {
    testAbortControllers.current.get(modelId)?.abort();
  }

  async function sendMessage(): Promise<void> {
    const content = draft.trim();
    if (!content || isStreaming || !isHydrated) {
      return;
    }
    if (!activeTarget) {
      onConfigurationRequired();
      setError("请先添加并选择一个模型。");
      return;
    }
    const requestConnection = activeTarget.connection;
    if (!requestConnection.baseUrl || !requestConnection.apiKey) {
      onConfigurationRequired();
      setError("请先填写当前模型所属连接的 Base URL 和 API Key。");
      return;
    }
    try {
      resolveGenerationEndpoint(
        requestConnection.protocol,
        requestConnection.baseUrl,
        activeTarget.model.modelId,
      );
    } catch (error) {
      if (!(error instanceof UrlResolutionError)) throw error;
      onConfigurationRequired();
      setError(error.message);
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
      const transport = await createRuntimeChatTransport(
        requestConnection.protocol,
      );
      for await (const event of transport.stream({
        baseUrl: requestConnection.baseUrl,
        apiKey: requestConnection.apiKey,
        model: activeTarget.model.modelId,
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
    activeConnection,
    activeModel,
    activeProvider,
    addConnection: addProviderConnection,
    addModel: addConfiguredModel,
    addProvider: addProviderFromTemplate,
    cancelModelCatalogRefresh,
    cancelModelTest,
    clearConversation,
    connectionSettings,
    deleteConnection: removeConnection,
    deleteModel: removeModel,
    deleteProvider: removeProvider,
    draft,
    error,
    isHydrated,
    isStreaming,
    messages,
    modelCatalogs,
    modelTests,
    protocolInfo,
    refreshModelCatalog,
    renameProvider: updateProviderName,
    runModelTest,
    sendMessage,
    setDraft,
    setActiveModel,
    stopGeneration,
    updateConnection: updateConnectionProfile,
    updateModel: updateConfiguredModel,
  };
}
