import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { GenerationTasks } from "./generationTasks";
import type { UserAvatar } from "../avatar/repository";
import type { ProviderAvatarSelection } from "../avatar/brandIds";
import { providerAvatarRepository } from "../avatar/providerAvatars";
import { getConnectionTemplate, presetCatalogOptions } from "./providerPresets";
import { GenerationMeasurement } from "./generationMetrics";
import { appendRoundVersion, withoutVersions } from "./roundVersions";
import { summarizeConversationTitle } from "./conversationTitle";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { createCherryImportRepository } from "../import/cherryRepository";
import { commitCherryImport } from "../import/cherryImport";
import type { CherryBackup, CherryImportPlan } from "../import/cherryTypes";

import type { DiscoveredModel } from "./modelCatalog";
import { initialSearch, finishSearch, mergeSearch } from "./nativeSearch";
import { isExternalSearch, resolveSearchMode, withSearchMode, type SearchMode } from "../search/mode";
import { assertSearchEnabled, loadSearchSettings, validateSearchQuery, type SearchProfile, type ExternalSearchProvider } from "../search/settings";
import { searchExa } from "../search/runtime";
import { validateExaApiSettings } from "../search/exaApi";
import { validateTavilyApiSettings } from "../search/tavily";
import { validateZhipuApiSettings, validateZhipuSearchQuery } from "../search/zhipu";
import { prepareSearchContext, projectSearchHistory } from "../search/context";
import { externalCitations } from "../search/citations";
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
  initializeProviderPresets,
  setProviderAvatar,
  resetPresetConnection,
  deleteConnection,
  deleteModel,
  deleteProvider,
  getActiveTarget,
  getConnection,
  isChatConnection,
  loadConnectionSettings,
  providerTemplates,
  renameProvider,
  moveProvider,
  moveConnection,
  saveConnectionSettings,
  updateConnection,
  updateModel,
  type ConnectionField,
  type ModelField,
  type ProviderTemplateId,
  type ServiceProtocol,
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
const cherryRepository = createCherryImportRepository();
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
  externalBusy = false,
  externalMaintenanceBusy,
}: {
  onConfigurationRequired(): void;
  externalBusy?: boolean;
  externalMaintenanceBusy?: () => boolean;
}) {
  const [connectionSettings, setConnectionSettings] = useState(
    () => initializeProviderPresets(loadConnectionSettings()),
  );
  const connectionSettingsRef = useRef(connectionSettings);
  connectionSettingsRef.current = connectionSettings;
  const providerAvatarPending = useRef(false);
  const [providerAvatarBusy, setProviderAvatarBusy] = useState(false);
  const sessionActive = useRef(true);
  useEffect(() => { sessionActive.current = true; return () => { sessionActive.current = false; }; }, []);
  const [generationTasks] = useState(() => new GenerationTasks());
  const [cherryBusy, setCherryBusy] = useState(false);
  const [backupPreparing, setBackupPreparing] = useState(false);
  const [titleBusy, setTitleBusy] = useState(false);
  const backupPreparingRef = useRef(false);
  const [backupPreparationError, setBackupPreparationError] = useState<string>();
  const cherryBusyRef = useRef(false);
  const cherryToken = useRef<string | undefined>(undefined);
  const generatingConversationIds = useSyncExternalStore(generationTasks.subscribe, generationTasks.getSnapshot);
  const externalBusyRef = useRef(externalBusy);
  externalBusyRef.current = externalBusy;
  const sharedSettingsBusy = () => providerAvatarPending.current || backupPreparingRef.current || externalBusyRef.current || generationTasks.getSnapshot().size > 0;
  const externalMaintenanceBusyRef = useRef(externalMaintenanceBusy);
  externalMaintenanceBusyRef.current = externalMaintenanceBusy;
  const maintenanceExternalBusy = () => externalMaintenanceBusyRef.current?.() ?? externalBusyRef.current;
  const workspace = useConversationWorkspace(chatRepository, connectionSettings.activeModelId,
    connectionSettings.providers.flatMap((provider) => provider.connections.filter(isChatConnection).flatMap((connection) => connection.models.map((model) => model.id))), generationTasks.has, cleanupAttachments, () => backupPreparingRef.current);
  const { messages, draft, draftAttachments, attachmentBusy, error, contextPlan, configErrors } = workspace.view;
  const sessionConfig = workspace.effective.config;
  const { setMessages, setDraft, setDraftAttachments, setAttachmentBusy, setError, setContextPlan, setConfigErrors } = workspace;
  const imports = useRef(new Map<string, number>());
  // This per-render binding is captured by a request; navigation never retargets it.
  const sessionStore = workspace.store;
  const isGenerating = !!sessionStore && generatingConversationIds.has(sessionStore.id);
  const isHydrated = workspace.isReady;
  const catalogAbortControllers = useRef(
    new Map<string, AbortController>(),
  );
  const testAbortControllers = useRef(new Map<string, AbortController>());
  const titleAbortControllers = useRef(new Set<AbortController>());
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
    return setSearchMode(enabled ? "native" : "off");
  }
  async function setSearchMode(mode: SearchMode): Promise<boolean> {
    if (!workspace.conversation || !workspace.canSend()) return false;
    return workspace.execute({ type: "configure-conversation", id: workspace.conversation.id,
      settings: { modelId: workspace.effective.modelId, config: withSearchMode(sessionConfig, mode) } });
  }
  useEffect(() => {
    setConfigErrors(validateRequestConfig(
      sessionConfig,
      activeConnection?.protocol ?? "openai-chat",
      activeModel?.modelId ?? "",
    ));
  }, [sessionConfig, activeConnection?.protocol, activeModel?.modelId, workspace.conversation?.id]);

  useEffect(() => {
    if (connectionSettingsRef.current === connectionSettings) saveConnectionSettings(connectionSettings);
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
    () => {
      generationTasks.activate();
      return () => {
        generationTasks.dispose();
        for (const controller of titleAbortControllers.current) controller.abort();
        for (const controller of catalogAbortControllers.current.values()) {
          controller.abort();
        }
        for (const controller of testAbortControllers.current.values()) {
          controller.abort();
        }
      };
    },
    [],
  );

  function addProviderFromTemplate(templateId: ProviderTemplateId, name?: string): string {
    if (sharedSettingsBusy()) return "";
    const providerId = newId();
    const template = providerTemplates.find(
      (candidate) => candidate.id === templateId,
    )!;
    const connectionIds = Object.fromEntries(
      template.connections.map(({ protocol }) => [protocol, newId()]),
    ) as Partial<Record<ServiceProtocol, string>>;
    setConnectionSettings((current) =>
      createProviderFromTemplate(current, templateId, {
        providerId,
        connectionIds,
        name: name?.trim() || uniqueProviderName(
          current.providers.map((provider) => provider.name),
          template.providerName,
        ),
        prepend: templateId === "custom",
      }),
    );
    return providerId;
  }

  async function changeProviderAvatar(providerId: string, selection: ProviderAvatarSelection | UserAvatar | undefined): Promise<boolean> {
    if (sharedSettingsBusy() || !connectionSettingsRef.current.providers.some(p => p.id === providerId)) return false;
    providerAvatarPending.current = true; setProviderAvatarBusy(true);
    try {
      const avatar = selection && "original" in selection
        ? { kind: "image" as const, id: await providerAvatarRepository.save(selection) } : selection;
      if (!sessionActive.current || backupPreparingRef.current || externalBusyRef.current || generationTasks.getSnapshot().size > 0) return false;
      const current = connectionSettingsRef.current;
      if (!current.providers.some(p => p.id === providerId)) return false;
      const next = setProviderAvatar(current, providerId, avatar);
      // Confirm both durable halves before reporting success or releasing maintenance.
      saveConnectionSettings(next);
      connectionSettingsRef.current = next;
      setConnectionSettings(next);
      return true;
    } finally {
      providerAvatarPending.current = false;
      if (sessionActive.current) setProviderAvatarBusy(false);
    }
  }

  function restorePresetConnection(connectionId: string): void {
    if (sharedSettingsBusy()) return;
    const provider = connectionSettings.providers.find(p => p.connections.some(c => c.id === connectionId));
    const connection = provider?.connections.find(c => c.id === connectionId);
    const defaults = getConnectionTemplate(provider?.presetId, connection?.presetProtocol);
    if (!defaults) return;
    // Reuse protocol mutation cleanup, then atomically apply the remaining defaults.
    updateConnectionProfile(connectionId, "protocol", defaults.protocol);
    setConnectionSettings(current => resetPresetConnection(current, connectionId));
  }

  function addProviderConnection(
    providerId: string,
    name: string,
    protocol: ServiceProtocol,
    copyFromConnectionId?: string,
  ): string {
    if (sharedSettingsBusy()) return "";
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
    if (sharedSettingsBusy()) return;
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
    if (sharedSettingsBusy()) return "";
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
    if (sharedSettingsBusy()) return;
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
    const target = getActiveTarget({ ...connectionSettings, activeModelId: modelId });
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
    if (sharedSettingsBusy()) return;
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
    if (sharedSettingsBusy()) return;
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
    if (sharedSettingsBusy()) return;
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
    if (sharedSettingsBusy()) return;
    setConnectionSettings((current) =>
      renameProvider(current, providerId, name),
    );
  }

  function moveProviderGroup(providerId: string, targetId: string, placement: "before" | "after"): void {
    if (sharedSettingsBusy()) return;
    setConnectionSettings((current) => moveProvider(current, providerId, targetId, placement));
  }

  function moveConnectionChannel(connectionId: string, targetId: string, placement: "before" | "after"): void {
    if (sharedSettingsBusy()) return;
    setConnectionSettings((current) => moveConnection(current, connectionId, targetId, placement));
  }

  async function refreshModelCatalog(connectionId: string): Promise<void> {
    if (sharedSettingsBusy()) return;
    const connection = getConnection(connectionSettings, connectionId);
    const existing = modelCatalogs[connectionId];
    const provider = connectionSettings.providers.find(p => p.connections.some(c => c.id === connectionId));
    const catalogDefaults = presetCatalogOptions(provider, connection);
    if (catalogDefaults?.manualCatalog) {
      setModelCatalogs(current => ({ ...current, [connectionId]: { status: "error", models: current[connectionId]?.models ?? [], error: catalogDefaults.catalogHint ?? "请手动添加模型 ID。" } }));
      return;
    }
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
      // Validate drawing HTTPS before reusing a matching read-only model catalog client.
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
      if (connection.protocol === "seedream-images") throw new Error("Seedream 绘图请手动添加模型，尚未接入模型目录接口。");
      const client = await createRuntimeModelCatalogClient(connection.protocol === "gemini-image" ? "gemini-native"
        : connection.protocol === "openai-images" || connection.protocol === "grok-images" ? "openai-chat" : connection.protocol);
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
    if (sharedSettingsBusy()) return;
    const connection = getConnection(connectionSettings, connectionId);
    if (connection && !isChatConnection(connection)) {
      setModelTests((current) => ({ ...current, [configuredModelId]: {
        status: "failed", totalMs: 0,
        error: { kind: "protocol", message: "绘图模型请在绘图页生成图片验证。", retryable: false },
      } }));
      return;
    }
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

  async function sendMessage(retryMessageId?: string, resumeMessageId?: string, editedContent?: string): Promise<true | undefined> {
    if (cherryBusyRef.current) return;
    const resume = resumeMessageId ? messages.find((message) => message.id === resumeMessageId && message.status === "paused") : undefined;
    if (resumeMessageId && (!resume?.continuation || !resume.providerReplay || messages[messages.length - 1]?.id !== resume.id)) return;
    const originalUser = retryMessageId || resumeMessageId ? retryUser(messages, (retryMessageId ?? resumeMessageId)!) : undefined;
    if (editedContent !== undefined && originalUser?.id !== retryMessageId) return;
    const targetUser = originalUser && editedContent !== undefined
      ? { ...originalUser, content: editedContent, editedAt: Date.now() } : originalUser;
    const content = targetUser ? targetUser.content : draft.trim();
    const frozenAttachments = retryMessageId || resumeMessageId ? [] : [...draftAttachments];
    const existingAttachments = targetUser?.attachments ?? [];
    const sentDraftRevision = workspace.view.draftRevision;
    function consumeSentDraft(): void {
      if (targetUser) return;
      // Preparation may finish after the user has started editing the next draft.
      workspace.clearDraftIfUnchanged(sentDraftRevision);
      const sentIds = new Set(frozenAttachments.map((item) => item.id));
      setDraftAttachments((current) => current.filter((item) => !sentIds.has(item.id)));
    }
    if (!isHydrated || !workspace.canSend() || !sessionStore || generationTasks.has(sessionStore.id) || imports.current.has(sessionStore.id)) {
      return;
    }
    if ((retryMessageId || resumeMessageId) && !targetUser) { setError("原用户消息已删除，无法重新请求此回复。"); return; }
    if (!content.trim() && !frozenAttachments.length && !existingAttachments.length) return;
    const history = withReplyLinks(targetUser ? messages.slice(0, messages.findIndex((message) => message.id === targetUser.id)) : messages).map(withoutVersions);
    if (!activeTarget) {
      if (!connectionSettings.providers.some((provider) => provider.connections.some((connection) => connection.models.length))) onConfigurationRequired();
      setError("当前会话的模型未选择或已失效，请通过对话行的编辑按钮选择模型或恢复助手默认值。");
      return;
    }
    const requestConnection = structuredClone(activeTarget.connection);
    const requestModelId = activeTarget.model.modelId;
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

    const requestStore = sessionStore;

    const frozenConfig = structuredClone(resume?.continuation?.config ?? sessionConfig);
    const searchMode = isExternalSearch(resume?.search?.provider) ? resume.search.provider : resolveSearchMode(frozenConfig);
    const externalSearch = isExternalSearch(searchMode);
    // Keep transport configuration native-only; external data is prepared by the session.
    frozenConfig.webSearch = searchMode === "native";
    let searchSettings: SearchProfile | undefined;
    let searchQuery: string | undefined;
    if (externalSearch && !resume) {
      try {
        searchSettings = structuredClone(loadSearchSettings(undefined, searchMode as ExternalSearchProvider));
        assertSearchEnabled(searchMode as ExternalSearchProvider, searchSettings);
        if (searchMode === "exa-api") searchSettings = validateExaApiSettings(searchSettings);
        if (searchMode === "tavily") searchSettings = validateTavilyApiSettings(searchSettings as import("../search/settings").TavilySearchSettings);
        if (searchMode === "zhipu") searchSettings = validateZhipuApiSettings(searchSettings as import("../search/settings").ZhipuSearchSettings);
        searchQuery = searchMode === "zhipu" ? validateZhipuSearchQuery(content) : validateSearchQuery(content);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "外部搜索配置无效。");
        return;
      }
    }
    const requestHistory = projectSearchHistory(history).map(message => message.providerReplay?.scope === replayScope
      ? message : { ...message, providerReplay: undefined });
    const errors = validateRequestConfig(
      frozenConfig,
      requestConnection.protocol,
      activeTarget.model.modelId,
    );
    setConfigErrors(errors);
    if (Object.keys(errors).length) {
      setError(Object.values(errors)[0]);
      return;
    }
    const task = generationTasks.begin(requestStore.id);
    if (!task) return;
    const { controller } = task;
    try {
      let planned: ContextPlan;
      try {
        planned = resume?.continuation ? { messages: [...resume.continuation.messages,
          { role: "assistant", content: resume.content, providerReplay: resume.providerReplay }],
          keptTurns: 0, trimmedTurns: 0, excludedIncompleteTurns: 0, inputTokens: 0, countingLabel: "继续原请求", estimated: true } : await planContextBudget(
          requestHistory, content, frozenConfig,
          requestConnection.protocol, activeTarget.model.modelId, undefined,
          [...frozenAttachments, ...existingAttachments].map((item) => ({ name: item.name, mimeType: item.mimeType, size: item.size, data: "" })),
        );
        if (controller.signal.aborted) {
          return;
        }
      } catch (caught) {
        if (controller.signal.aborted) {
          return;
        }
        if (caught instanceof ContextBudgetError) {
          setConfigErrors({ contextBudget: caught.message });
          setError(caught.message);
        } else {
          setError(caught instanceof Error ? caught.message : "无法计算上下文预算。");
        }
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
          return;
        }
        for (const item of targetUser ? [] : preparedAttachments) {
          requireActiveSend();
          sentAttachments.push(await attachmentLifecycle.save(item));
          requireActiveSend();
        }
        if (controller.signal.aborted) {
          await discardUncommitted();
          return;
        }
      } catch (caught) {
        const discarded = await discardUncommitted();
        if (discarded && !controller.signal.aborted) setError(caught instanceof Error ? caught.message : "无法读取或保存附件；未发送请求。");
        return;
      }
      setContextPlan(summarizeContextPlan(planned));
      setError(undefined);
      let userMessage: StoredChatMessage = targetUser ?? {
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
        ...(!resume ? { generationModel: requestModelId } : {}),
        content: resume?.content ?? "",
        status: "streaming",
        search: resume?.search ?? (externalSearch ? { ...initialSearch(true), provider: searchMode as ExternalSearchProvider, status: "searching", queries: [searchQuery!] }
          : frozenConfig.webSearch ? initialSearch(true) : undefined),
        ...(requestConnection.protocol === "anthropic-native" ? { continuation: resume?.continuation ?? {
          config: frozenConfig, model: activeTarget.model.modelId, baseUrl: requestConnection.baseUrl, scope: replayScope,
          messages: planned.messages.map((message, index) => index === planned.messages.length - 1
            ? { role: "user" as const, content, ...(userMessage.attachments?.length ? { attachments: userMessage.attachments } : {}) } : message),
        } } : {}),
      };
      if (!resume) userMessage = appendRoundVersion(withReplyLinks(messages), userMessage, assistantMessage);
      let workingMessages = [...history, userMessage, assistantMessage];
      try {
        await requestStore.updateMessages(workingMessages);
      } catch {
        await requestStore.updateMessages(messages).catch(() => undefined);
        const discarded = await discardUncommitted();
        if (discarded) setError("附件或消息保存失败；未发送请求，草稿已保留。");
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
        return;
      }
      if (!externalSearch) startTitleNaming();
      if (controller.signal.aborted) {
        workingMessages = replaceAssistant(workingMessages, assistantId, assistantMessage.content, "aborted");
        await requestStore.updateMessages(workingMessages).catch(() => undefined);
        setMessages(workingMessages);
        consumeSentDraft();
        await cleanupAttachments().catch(() => setError("消息已保存，但附件副本整理失败；下次启动将重试。"));
        return true;
      }
      setMessages(workingMessages);
      consumeSentDraft();

      function startTitleNaming(): void {
        if (targetUser || messages.some((message) => message.role === "user")) return;
        const titleController = new AbortController();
        titleAbortControllers.current.add(titleController);
        setTitleBusy(true);
        const timeout = setTimeout(() => titleController.abort(), 60_000);
        void (async () => {
          try {
            const conversation = await workspace.updateAutomaticTitle({ type: "start-conversation-title",
              id: requestStore.id, messageId: userMessage.id });
            const naming = conversation?.titleNaming;
            if (!naming || naming === "manual" || naming.status !== "pending" ||
              naming.sourceMessageId !== userMessage.id || titleController.signal.aborted) return;
            let title: string | undefined;
            try {
              const transport = await createRuntimeChatTransport(requestConnection.protocol);
              if (!titleController.signal.aborted) title = await summarizeConversationTitle(transport, {
                baseUrl: requestConnection.baseUrl, apiKey: requestConnection.apiKey,
                model: requestModelId, signal: titleController.signal,
              }, naming.source);
            } catch { /* Naming failure keeps the first-message title. */ }
            await workspace.updateAutomaticTitle({ type: "finish-conversation-title", id: requestStore.id,
              messageId: userMessage.id, title: titleController.signal.aborted ? undefined : title });
          } catch { /* Optional metadata must not affect message sending. */ }
          finally {
            clearTimeout(timeout);
            titleAbortControllers.current.delete(titleController);
            setTitleBusy(titleAbortControllers.current.size > 0);
          }
        })();
      }

      let persistChain = Promise.resolve();
      let persistenceFailed = false;
      let measurement: GenerationMeasurement | undefined;
      const earlierMetrics = resume?.generationMetrics ?? [];
      function updateGenerationMetrics(status: StoredMessageStatus): void {
        if (!measurement) return;
        const metrics = measurement.snapshot(status);
        workingMessages = workingMessages.map(message => message.id === assistantId
          ? { ...message, generationMetrics: [...earlierMetrics, metrics] } : message);
      }
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
        if (externalSearch && !resume) {
          const result = await searchExa(searchSettings!, searchQuery!, controller.signal, searchMode as ExternalSearchProvider);
          if (controller.signal.aborted) throw new Error("检索已停止。");
          // Preserve successful retrieval independently of budget/model failures.
          workingMessages = workingMessages.map(message => message.id === assistantId ? { ...message,
            search: { ...initialSearch(true), provider: searchMode as ExternalSearchProvider, status: "completed", sources: result.sources,
              queries: [searchQuery!], ...(result.warning ? { warning: result.warning } : {}) } } : message);
          setMessages(workingMessages); queuePersist(workingMessages);
          const latestAttachments = requestMessages[requestMessages.length - 1]?.attachments ?? [];
          const prepared = await prepareSearchContext(requestHistory, content, frozenConfig, requestConnection.protocol,
            requestModelId, result.sources, latestAttachments as RequestAttachment[]);
          if (controller.signal.aborted) throw new Error("检索已停止。");
          planned = prepared.plan;
          // Materialize any historical attachment newly retained after data budgeting.
          requestMessages = [];
          for (const message of planned.messages) {
            const loaded: RequestAttachment[] = [];
            for (const attachment of message.attachments ?? []) {
              if (controller.signal.aborted) throw new Error("检索已停止。");
              loaded.push("data" in attachment ? attachment : await attachmentStore.read(attachment));
            }
            requestMessages.push({ ...message, ...(loaded.length ? { attachments: loaded } : {}) });
          }
          buildProtocolBody(requestConnection.protocol, { baseUrl: requestConnection.baseUrl, apiKey: "", model: requestModelId,
            messages: requestMessages, config: frozenConfig, replayScope });
          if (controller.signal.aborted) throw new Error("检索已停止。");
          workingMessages = workingMessages.map(message => message.id === assistantId ? { ...message,
            search: { ...message.search!, sources: prepared.sources },
            ...(message.continuation ? { continuation: { ...message.continuation,
              messages: planned.messages.map((item, index) => index === planned.messages.length - 1
                ? { ...item, attachments: userMessage.attachments } : item) } } : {}) } : message);
          setContextPlan(summarizeContextPlan(planned));
          setMessages(workingMessages); queuePersist(workingMessages);
          startTitleNaming();
        }
        if (controller.signal.aborted) throw new Error("生成已停止。");
        const transport = await createRuntimeChatTransport(
          requestConnection.protocol,
        );
        if (controller.signal.aborted) throw new Error("生成已停止。");
        measurement = new GenerationMeasurement(requestConnection.protocol, frozenConfig.stream);
        updateGenerationMetrics("streaming");
        setMessages(workingMessages); queuePersist(workingMessages);
        for await (const event of transport.stream({
          baseUrl: requestConnection.baseUrl,
          apiKey: requestConnection.apiKey,
          model: requestModelId,
          messages: requestMessages,
          config: frozenConfig,
          signal: controller.signal,
          replayScope,
        })) {
          if (event.type === "thinking-delta" && !includeThinkingSummary(frozenConfig, requestConnection.protocol)) continue;
          measurement.observe(event);
          if (event.type === "usage-update") {
            updateGenerationMetrics("streaming");
            setMessages(workingMessages); queuePersist(workingMessages); continue;
          }
          if (event.type === "search-update") {
            if (externalSearch) continue;
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
            if (event.type === "text-delta") assistantText += event.text;
            else workingMessages = workingMessages.map((message) => message.id === assistantId
              ? { ...message, thinkingSummary: (message.thinkingSummary ?? "") + event.text } : message);
            workingMessages = replaceAssistant(
              workingMessages,
              assistantId,
              assistantText,
              "streaming",
            );
            if (externalSearch && event.type === "text-delta") workingMessages = workingMessages.map(message => message.id === assistantId
              ? { ...message, search: { ...message.search!, citations: externalCitations(assistantText, message.search!.sources) } } : message);
            updateGenerationMetrics("streaming");
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
          updateGenerationMetrics(workingMessages.find(message => message.id === assistantId)!.status);
          setMessages(workingMessages);
          queuePersist(workingMessages);
        }
        if (!terminalSeen) {
          workingMessages = replaceAssistant(
            workingMessages, assistantId, assistantText,
            controller.signal.aborted ? "aborted" : "failed",
          );
          updateGenerationMetrics(controller.signal.aborted ? "aborted" : "failed");
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
        updateGenerationMetrics(controller.signal.aborted ? "aborted" : "failed");
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
        await cleanupAttachments().catch(() => setError((current) => current ?? "消息已保存，但附件副本整理失败；下次启动将重试。"));
      }
      return true;
    } finally {
      generationTasks.finish(task);
    }
  }

  function stopGeneration(): void {
    if (sessionStore) generationTasks.stop(sessionStore.id);
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
    if (!workspace.canSend() || !sessionStore || generationTasks.has(sessionStore.id)) return;
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
    if (!workspace.isReady || !workspace.conversation) return;
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

  async function prepareBackup(): Promise<boolean> {
    if (backupPreparingRef.current) return false;
    const canPrepare = () => !maintenanceExternalBusy() && workspace.isSettled() && generationTasks.getSnapshot().size === 0 &&
      !providerAvatarPending.current && !cherryBusyRef.current && imports.current.size === 0 && testAbortControllers.current.size === 0 && catalogAbortControllers.current.size === 0 && titleAbortControllers.current.size === 0;
    if (!canPrepare()) {
      setBackupPreparationError("请等待当前对话操作完成后再进入备份。");
      return false;
    }
    backupPreparingRef.current = true;
    setBackupPreparing(true);
    setBackupPreparationError(undefined);
    try {
      saveConnectionSettings(connectionSettingsRef.current);
      await workspace.flushSessionWrites();
      if (!canPrepare()) throw new Error("对话操作仍在进行。");
      return true;
    } catch {
      setBackupPreparationError("无法保存待写入的对话记录，备份尚未开始。请重试。");
      cancelBackupPreparation();
      return false;
    }
  }
  function cancelBackupPreparation(): void { backupPreparingRef.current = false; setBackupPreparing(false); }

  return {
    maintenanceBusy: backupPreparing || cherryBusy || workspace.busy || providerAvatarBusy,
    backupPreparing,
    backupDisabled: providerAvatarBusy || maintenanceExternalBusy() || !workspace.snapshot || workspace.busy || generatingConversationIds.size > 0 || cherryBusy || imports.current.size > 0 || backupPreparing || titleBusy,
    backupPreparationError,
    prepareBackup,
    cancelBackupPreparation,
    dataImport: {
      disabled: providerAvatarBusy || externalBusy || !workspace.isReady || generatingConversationIds.size > 0 || cherryBusy || backupPreparing,
      async selectBackup(): Promise<CherryBackup | null> {
        if (!isTauri() || providerAvatarPending.current || externalBusyRef.current || generationTasks.getSnapshot().size > 0 || cherryBusyRef.current || backupPreparingRef.current) throw new Error("请在桌面应用中导入。请先等待当前操作完成。");
        const backup = await invoke<CherryBackup | null>("select_cherry_backup");
        if (backup) cherryToken.current = backup.token;
        return backup;
      },
      async closeBackup(token: string): Promise<void> {
        await invoke("close_cherry_backup", { token });
        if (cherryToken.current === token) cherryToken.current = undefined;
      },
      existingSourceKeys: (keys: string[]) => cherryRepository.existingSourceKeys(keys),
      async importPlan(plan: CherryImportPlan, mode: "skip" | "copy") {
        if (providerAvatarPending.current || externalBusyRef.current || cherryBusyRef.current || backupPreparingRef.current || !workspace.canSend() || generationTasks.getSnapshot().size || !cherryToken.current) {
          throw new Error("请先等待当前操作完成，再导入聊天。");
        }
        cherryBusyRef.current = true; setCherryBusy(true);
        const token = cherryToken.current;
        try {
          const result = await commitCherryImport(plan, mode, cherryRepository, {
            lifecycle: attachmentLifecycle, verify: attachmentStore.verify,
            readFile: (key) => invoke<RequestAttachment | null>("read_cherry_file", { token, key }),
          });
          workspace.retry();
          return result;
        } finally { cherryBusyRef.current = false; setCherryBusy(false); }
      },
    },
    workspace,
    generatingConversationIds,
    isAnyGenerating: generatingConversationIds.size > 0,
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
    selectRoundVersion: async (index: number): Promise<boolean> => {
      if (!workspace.canSend() || !sessionStore) return false;
      return workspace.execute({ type: "select-round-version", conversationId: sessionStore.id, index });
    },
    retryMessage: async (id: string): Promise<void> => { await sendMessage(id); },
    editAndSendMessage: async (id: string, content: string): Promise<boolean> => !!(await sendMessage(id, undefined, content)),
    continueMessage: async (id: string): Promise<void> => { await sendMessage(undefined, id); },
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
    changeProviderAvatar,
    resetPresetConnection: restorePresetConnection,
    moveProvider: moveProviderGroup,
    moveConnection: moveConnectionChannel,
    runModelTest,
    sendMessage: async (): Promise<void> => { await sendMessage(); },
    setDraft,
    sessionConfig,
    setThinking,
    setWebSearch,
    searchMode: resolveSearchMode(sessionConfig),
    setSearchMode,
    setActiveModel,
    setConversationModel,
    stopGeneration,
    updateConnection: updateConnectionProfile,
    updateModel: updateConfiguredModel,
  };
}
