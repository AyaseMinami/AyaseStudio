import { useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";

import type { DiscoveredModel } from "./modelCatalog";
import { initialSearch, finishSearch, mergeSearch } from "./nativeSearch";
import { ContextBudgetError, planContextBudget,
  summarizeContextPlan, type ContextPlan } from "./contextBudget";
import { addDraftAttachments, attachmentCapabilityFailure, materializeDraftAttachment, prepareDraftAttachment,
  type DraftAttachment, type RequestAttachment, type SentAttachment } from "./attachments";
import { createTauriAttachmentStore } from "./attachmentResources";
import { AttachmentLifecycle } from "./attachmentLifecycle";
import { retryUser, withReplyLinks } from "./messageOperations";
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
import { includeThinkingSummary, withThinkingSettings, switchThinkingProtocol,
  type ThinkingSettings } from "./thinking";
import { useConversationWorkspace } from "./useConversationWorkspace";
import { validateRequestConfig } from "./requestMapping";
import { buildProtocolBody } from "./requestMapping";
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
const attachmentStore = createTauriAttachmentStore();
const attachmentLifecycle = new AttachmentLifecycle(attachmentStore, () => chatRepository.attachmentReferences());
async function cleanupAttachments(): Promise<void> {
  if (!isTauri()) return;
  await attachmentLifecycle.cleanup();
}

function completionStatus(protocol: ChatProtocol, reason?: string): StoredMessageStatus {
  if (protocol === "anthropic-native" && reason === "pause_turn") return "paused";
  if (!reason) return "complete";
  if (protocol === "openai-responses") return reason.startsWith("incomplete:") ? "incomplete" : "complete";
  if (protocol === "openai-chat") return reason === "stop" ? "complete" : "incomplete";
  if (protocol === "gemini-native") return reason === "STOP" ? "complete" : "incomplete";
  return reason === "end_turn" || reason === "stop_sequence" ? "complete" : "incomplete";
}

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
    message.id === id ? { ...message, content, status,
      search: status === "streaming" || status === "paused" ? message.search : finishSearch(message.search,
        status === "aborted" ? "aborted" : status === "failed" ? "failed" : "completed"),
      continuation: status === "streaming" || status === "paused" ? message.continuation : undefined } : message,
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
  const generatingId = useRef<string | null>(null);
  const workspace = useConversationWorkspace(chatRepository, connectionSettings.activeModelId,
    connectionSettings.providers.flatMap((provider) => provider.connections.flatMap((connection) => connection.models.map((model) => model.id))), generatingId, cleanupAttachments);
  const { messages, draft, draftAttachments, attachmentBusy, error, contextPlan, configErrors } = workspace.view;
  const sessionConfig = workspace.effective.config;
  const { setMessages, setDraft, setDraftAttachments, setAttachmentBusy, setError, setContextPlan, setConfigErrors } = workspace;
  const imports = useRef(new Map<string, number>());
  // This per-render binding is captured by a request; navigation never retargets it.
  const sessionStore = workspace.store;
  const [isGenerating, setIsGenerating] = useState(false);
  const isHydrated = workspace.isReady;
  const abortRef = useRef<AbortController>(null);
  const sendLockRef = useRef(false);
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
    () => getActiveTarget({ ...connectionSettings, activeModelId: workspace.effective.modelId }),
    [connectionSettings, workspace.effective.modelId],
  );
  const activeProvider = activeTarget?.provider;
  const activeConnection = activeTarget?.connection;
  const activeModel = activeTarget?.model;
  const protocolInfo = useMemo(
    () =>
      activeConnection ? getProtocolOption(activeConnection.protocol) : undefined,
    [activeConnection],
  );

  async function setThinking(settings: ThinkingSettings): Promise<boolean> {
    if (!workspace.conversation || !workspace.canSend()) return false;
    const protocol = activeConnection?.protocol;
    if (!protocol) return false;
    return workspace.execute({ type: "configure-conversation", id: workspace.conversation.id,
      settings: { modelId: workspace.effective.modelId, config: withThinkingSettings(sessionConfig, protocol, settings) } });
  }
  async function setWebSearch(enabled: boolean): Promise<boolean> {
    if (!workspace.conversation || !workspace.canSend()) return false;
    return workspace.execute({ type: "configure-conversation", id: workspace.conversation.id,
      settings: { modelId: workspace.effective.modelId, config: { ...sessionConfig, webSearch: enabled } } });
  }
  useEffect(() => {
    setConfigErrors(validateRequestConfig(
      sessionConfig,
      activeConnection?.protocol ?? "openai-chat",
      activeModel?.modelId ?? "",
    ));
  }, [sessionConfig, activeConnection?.protocol, activeModel?.modelId, workspace.conversation?.id]);

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
    const target = getActiveTarget(selectModel(connectionSettings, modelId));
    if (!workspace.assistant || !target) return;
    const previous = getActiveTarget({ ...connectionSettings, activeModelId: workspace.assistant.defaultModelId });
    void workspace.execute({ type: "edit-assistant", id: workspace.assistant.id, input: { ...workspace.assistant,
      defaultModelId: modelId, defaultConfig: switchThinkingProtocol(workspace.assistant.defaultConfig, previous?.connection.protocol, target.connection.protocol) } });
  }

  async function setConversationModel(modelId: string): Promise<boolean> {
    if (!workspace.conversation || !workspace.canSend()) return false;
    const target = getActiveTarget({ ...connectionSettings, activeModelId: modelId });
    if (!target) return false;
    return workspace.execute({ type: "configure-conversation", id: workspace.conversation.id,
      settings: { modelId, config: switchThinkingProtocol(sessionConfig, activeConnection?.protocol, target.connection.protocol) } });
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

  async function sendMessage(retryMessageId?: string, resumeMessageId?: string): Promise<void> {
    const resume = resumeMessageId ? messages.find((message) => message.id === resumeMessageId && message.status === "paused") : undefined;
    if (resumeMessageId && (!resume?.continuation || !resume.providerReplay || messages[messages.length - 1]?.id !== resume.id)) return;
    const targetUser = retryMessageId || resumeMessageId ? retryUser(messages, (retryMessageId ?? resumeMessageId)!) : undefined;
    const content = targetUser ? targetUser.content : draft.trim();
    const frozenAttachments = retryMessageId || resumeMessageId ? [] : [...draftAttachments];
    const existingAttachments = targetUser?.attachments ?? [];
    if (isGenerating || sendLockRef.current || !isHydrated || !workspace.canSend() || !sessionStore || imports.current.has(sessionStore.id)) {
      return;
    }
    if ((retryMessageId || resumeMessageId) && !targetUser) { setError("原用户消息已删除，无法重新请求此回复。"); return; }
    if (!content.trim() && !frozenAttachments.length && !existingAttachments.length) return;
    const history = withReplyLinks(targetUser ? messages.slice(0, messages.findIndex((message) => message.id === targetUser.id)) : messages);
    if (!activeTarget) {
      if (!connectionSettings.providers.some((provider) => provider.connections.some((connection) => connection.models.length))) onConfigurationRequired();
      setError("当前会话的模型未选择或已失效，请通过对话行的编辑按钮选择模型或恢复助手默认值。");
      return;
    }
    const requestConnection = structuredClone(activeTarget.connection);
    const replayScope = `${requestConnection.id}|${requestConnection.baseUrl}`;
    if (resume?.continuation && (resume.continuation.scope !== replayScope || resume.continuation.model !== activeTarget.model.modelId || requestConnection.protocol !== "anthropic-native")) {
      setError("请切回这条回复使用的连接和模型后继续生成。"); return;
    }
    const capabilityError = attachmentCapabilityFailure(requestConnection.protocol,
      activeTarget.model.modelId, [...frozenAttachments, ...existingAttachments]);
    if (capabilityError) { setError(capabilityError); return; }
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

    sendLockRef.current = true;
    const requestStore = sessionStore;

    const frozenConfig = structuredClone(resume?.continuation?.config ?? sessionConfig);
    const errors = validateRequestConfig(
      frozenConfig,
      requestConnection.protocol,
      activeTarget.model.modelId,
    );
    setConfigErrors(errors);
    if (Object.keys(errors).length) {
      setError(Object.values(errors)[0]);
      sendLockRef.current = false;
      return;
    }
    setIsGenerating(true);
    generatingId.current = sessionStore.id;
    const controller = new AbortController();
    abortRef.current = controller;
    function releaseBeforeNetwork(): void {
      setIsGenerating(false);
      generatingId.current = null;
      abortRef.current = null;
      sendLockRef.current = false;
    }
    let planned: ContextPlan;
    try {
      planned = resume?.continuation ? { messages: [...resume.continuation.messages,
        { role: "assistant", content: resume.content, providerReplay: resume.providerReplay }],
        keptTurns: 0, trimmedTurns: 0, excludedIncompleteTurns: 0, inputTokens: 0, countingLabel: "继续原请求", estimated: true } : await planContextBudget(
        history.map((message) => message.providerReplay?.scope === replayScope ? message : { ...message, providerReplay: undefined }), content, frozenConfig,
        requestConnection.protocol, activeTarget.model.modelId, undefined,
        [...frozenAttachments, ...existingAttachments].map((item) => ({ name: item.name, mimeType: item.mimeType, size: item.size, data: "" })),
      );
      if (controller.signal.aborted) {
        setIsGenerating(false);
        generatingId.current = null;
        abortRef.current = null;
        sendLockRef.current = false;
        return;
      }
    } catch (caught) {
      if (controller.signal.aborted) {
        setIsGenerating(false);
        generatingId.current = null;
        abortRef.current = null;
        sendLockRef.current = false;
        return;
      }
      if (caught instanceof ContextBudgetError) {
        setConfigErrors({ contextBudget: caught.message });
        setError(caught.message);
      } else {
        setError(caught instanceof Error ? caught.message : "无法计算上下文预算。");
      }
      setIsGenerating(false);
      generatingId.current = null;
      abortRef.current = null;
      sendLockRef.current = false;
      return;
    }

    let requestMessages = planned.messages;
    let sentAttachments: SentAttachment[] = [];
    async function discardUncommitted(): Promise<boolean> {
      try {
        await attachmentLifecycle.discard(sentAttachments);
        return true;
      } catch {
        setError("未发送附件的临时副本清理失败；下次启动将重试。");
        return false;
      }
    }
    function requireActiveSend(): void {
      if (controller.signal.aborted) throw new Error("附件读取已停止。");
    }
    try {
      const preparedAttachments: RequestAttachment[] = [];
      for (const draft of frozenAttachments) {
        requireActiveSend();
        preparedAttachments.push(await materializeDraftAttachment(draft));
        requireActiveSend();
      }
      for (const item of existingAttachments) {
        requireActiveSend();
        preparedAttachments.push(await attachmentStore.read(item));
        requireActiveSend();
      }
      const rebuiltMessages: typeof planned.messages = [];
      for (const [index, message] of planned.messages.entries()) {
        requireActiveSend();
        if (!resume && index === planned.messages.length - 1 && preparedAttachments.length) {
          rebuiltMessages.push({ ...message, attachments: preparedAttachments });
        } else if (message.attachments?.length) {
          const loaded: RequestAttachment[] = [];
          for (const item of message.attachments) {
            loaded.push("data" in item ? item : await attachmentStore.read(item));
            requireActiveSend();
          }
          rebuiltMessages.push({ ...message, attachments: loaded });
        } else {
          rebuiltMessages.push(message);
        }
      }
      requestMessages = rebuiltMessages;
      // Validate the frozen *final* body (including accumulated history) before
      // any new private copy or message write, independently from transport.
      buildProtocolBody(requestConnection.protocol, {
        baseUrl: requestConnection.baseUrl, apiKey: "", model: activeTarget.model.modelId,
        messages: requestMessages, config: frozenConfig,
        replayScope,
      });
      if (controller.signal.aborted) {
        await discardUncommitted();
        releaseBeforeNetwork();
        return;
      }
      for (const item of targetUser ? [] : preparedAttachments) {
        requireActiveSend();
        sentAttachments.push(await attachmentLifecycle.save(item));
        requireActiveSend();
      }
      if (controller.signal.aborted) {
        await discardUncommitted();
        releaseBeforeNetwork();
        return;
      }
    } catch (caught) {
      const discarded = await discardUncommitted();
      if (discarded && !controller.signal.aborted) setError(caught instanceof Error ? caught.message : "无法读取或保存附件；未发送请求。");
      releaseBeforeNetwork();
      return;
    }
    setContextPlan(summarizeContextPlan(planned));
    setError(undefined);
    const userMessage: StoredChatMessage = targetUser ?? {
      id: newId(),
      role: "user",
      content,
      status: "complete",
      ...(sentAttachments.length ? { attachments: sentAttachments } : {}),
    };
    const assistantId = resume?.id ?? newId();
    const assistantMessage: StoredChatMessage = {
      ...resume,
      id: assistantId,
      role: "assistant",
      replyToId: userMessage.id,
      content: resume?.content ?? "",
      status: "streaming",
      search: resume?.search ?? (frozenConfig.webSearch ? initialSearch(true) : undefined),
      ...(requestConnection.protocol === "anthropic-native" ? { continuation: resume?.continuation ?? {
        config: frozenConfig, model: activeTarget.model.modelId, baseUrl: requestConnection.baseUrl, scope: replayScope,
        messages: planned.messages.map((message, index) => index === planned.messages.length - 1
          ? { role: "user" as const, content, ...(userMessage.attachments?.length ? { attachments: userMessage.attachments } : {}) } : message),
      } } : {}),
    };
    let workingMessages = [...history, userMessage, assistantMessage];
    try {
      await requestStore.updateMessages(workingMessages);
    } catch {
      await requestStore.updateMessages(messages).catch(() => undefined);
      const discarded = await discardUncommitted();
      if (discarded) setError("附件或消息保存失败；未发送请求，草稿已保留。");
      releaseBeforeNetwork();
      return;
    }
    try {
      await attachmentLifecycle.commit(sentAttachments);
    } catch {
      // No provider call may proceed with an unreadable history reference.
      // Restore the old transcript before deleting copies that lack an owner.
      const rolledBack = await requestStore.updateMessages(messages).then(() => true, () => false);
      if (rolledBack) {
        const discarded = await discardUncommitted();
        if (discarded) setError("已保存的附件无法读取；请求未发送，草稿已保留。");
      } else {
        setMessages(workingMessages);
        setError("附件无法读取且消息记录回滚失败；请求未发送，请检查当前对话。");
      }
      releaseBeforeNetwork();
      return;
    }
    if (controller.signal.aborted) {
      workingMessages = [...history, userMessage, { ...assistantMessage, status: "aborted" }];
      await requestStore.updateMessages(workingMessages).catch(() => undefined);
      setMessages(workingMessages);
      if (!targetUser) { setDraft(""); setDraftAttachments([]); }
      if (targetUser) await cleanupAttachments().catch(() => setError("消息已保存，但附件副本整理失败；下次启动将重试。"));
      releaseBeforeNetwork();
      return;
    }
    setMessages(workingMessages);
    if (!targetUser) { setDraft(""); setDraftAttachments([]); }

    let persistChain = Promise.resolve();
    let persistenceFailed = false;
    function queuePersist(snapshotMessages: StoredChatMessage[]) {
      persistChain = persistChain
        .then(() =>
          requestStore.updateMessages(snapshotMessages),
        )
        .catch(() => {
          persistenceFailed = true;
        });
    }
    queuePersist(workingMessages);

    let assistantText = resume?.content ?? "";
    const resumeOffset = assistantText.length;
    let lastPaint = 0;
    let lastPersist = 0;
    let terminalSeen = false;
    try {
      const transport = await createRuntimeChatTransport(
        requestConnection.protocol,
      );
      for await (const event of transport.stream({
        baseUrl: requestConnection.baseUrl,
        apiKey: requestConnection.apiKey,
        model: activeTarget.model.modelId,
        messages: requestMessages,
        config: frozenConfig,
        signal: controller.signal,
        replayScope,
      })) {
        if (event.type === "search-update") {
          workingMessages = workingMessages.map((message) => message.id === assistantId
            ? { ...message, search: mergeSearch(resume?.search, event.search, resumeOffset) } : message);
          setMessages(workingMessages); queuePersist(workingMessages); continue;
        }
        if (event.type === "provider-replay") {
          const earlier = resume?.providerReplay;
          const replay = earlier ? { ...event.replay, content: [...earlier.content, ...event.replay.content],
            responses: [...(earlier.responses ?? [earlier.content]), event.replay.content] } : event.replay;
          workingMessages = workingMessages.map((message) => message.id === assistantId ? { ...message, providerReplay: replay } : message);
          continue;
        }
        if (event.type === "text-delta" || event.type === "thinking-delta") {
          if (event.type === "thinking-delta" && !includeThinkingSummary(frozenConfig, requestConnection.protocol)) continue;
          if (event.type === "text-delta") assistantText += event.text;
          else workingMessages = workingMessages.map((message) => message.id === assistantId
            ? { ...message, thinkingSummary: (message.thinkingSummary ?? "") + event.text } : message);
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
          terminalSeen = true;
          workingMessages = replaceAssistant(
            workingMessages,
            assistantId,
            assistantText,
            completionStatus(requestConnection.protocol, event.finishReason),
          );
        } else if (event.type === "aborted") {
          terminalSeen = true;
          workingMessages = replaceAssistant(
            workingMessages,
            assistantId,
            assistantText,
            "aborted",
          );
        } else {
          terminalSeen = true;
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
      if (!terminalSeen) {
        workingMessages = replaceAssistant(
          workingMessages, assistantId, assistantText,
          controller.signal.aborted ? "aborted" : "failed",
        );
        setMessages(workingMessages);
        queuePersist(workingMessages);
        if (!controller.signal.aborted) setError("请求结束前未收到终态事件。");
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
      if (targetUser) await cleanupAttachments().catch(() => setError((current) => current ?? "消息已保存，但附件副本整理失败；下次启动将重试。"));
      setIsGenerating(false);
      generatingId.current = null;
      abortRef.current = null;
      sendLockRef.current = false;
    }
  }

  function stopGeneration(): void {
    abortRef.current?.abort();
  }

  async function editMessage(id: string, content: string): Promise<boolean> {
    if (!workspace.canSend() || !sessionStore) return false;
    return workspace.execute({ type: "edit-message", conversationId: sessionStore.id, messageId: id, content });
  }

  async function deleteMessage(id: string): Promise<boolean> {
    if (!workspace.canSend() || !sessionStore) return false;
    return workspace.execute({ type: "delete-message", conversationId: sessionStore.id, messageId: id });
  }

  async function branchMessage(id: string): Promise<boolean> {
    if (!workspace.canSend() || !sessionStore) return false;
    return workspace.execute({ type: "fork-conversation", id: newId(), conversationId: sessionStore.id, messageId: id,
      creationConfig: { modelId: workspace.effective.modelId, config: structuredClone(sessionConfig) } });
  }

  function clearConversation(): void {
    if (sendLockRef.current || isGenerating || !workspace.canSend() || !sessionStore) return;
    abortRef.current?.abort();
    setMessages([]);
    setContextPlan(undefined);
    setError(undefined);
    void sessionStore.clearMessages().then(() => {
      void cleanupAttachments().catch(() => setError("消息已清空，但附件副本清理失败；下次启动将重试。"));
    }).catch(() => {
      setError("界面已清空，但保存本地记录失败。");
    });
  }

  async function addFiles(files: File[]): Promise<void> {
    if (!workspace.isReady || (isGenerating && generatingId.current === workspace.conversation?.id) || !workspace.conversation) return;
    const id = workspace.conversation.id;
    imports.current.set(id, (imports.current.get(id) ?? 0) + 1);
    setAttachmentBusy(true);
    try {
      const prepared: DraftAttachment[] = [];
      for (const file of files) prepared.push(await prepareDraftAttachment(file));
      setDraftAttachments((current) => addDraftAttachments(current, prepared));
      setError(undefined);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "无法读取附件。"); }
    finally {
      const remaining = (imports.current.get(id) ?? 1) - 1;
      if (remaining) imports.current.set(id, remaining); else imports.current.delete(id);
      setAttachmentBusy(remaining > 0);
    }
  }

  return {
    workspace,
    generatingConversationId: generatingId.current,
    activeConnection,
    activeModel,
    activeProvider,
    addConnection: addProviderConnection,
    addModel: addConfiguredModel,
    addProvider: addProviderFromTemplate,
    cancelModelCatalogRefresh,
    cancelModelTest,
    clearConversation,
    editMessage,
    deleteMessage,
    branchMessage,
    retryMessage: (id: string) => sendMessage(id),
    continueMessage: (id: string) => sendMessage(undefined, id),
    connectionSettings: { ...connectionSettings, activeModelId: workspace.assistant?.defaultModelId ?? null },
    configErrors,
    contextPlan,
    deleteConnection: removeConnection,
    deleteModel: removeModel,
    deleteProvider: removeProvider,
    draft,
    draftAttachments,
    attachmentBusy,
    addFiles,
    removeDraftAttachment: (id: string) => setDraftAttachments((items) => items.filter((item) => item.id !== id)),
    readAttachment: attachmentStore.read,
    error,
    isHydrated,
    isGenerating,
    messages,
    modelCatalogs,
    modelTests,
    protocolInfo,
    refreshModelCatalog,
    renameProvider: updateProviderName,
    runModelTest,
    sendMessage,
    setDraft,
    sessionConfig,
    setThinking,
    setWebSearch,
    setActiveModel,
    setConversationModel,
    stopGeneration,
    updateConnection: updateConnectionProfile,
    updateModel: updateConfiguredModel,
  };
}
