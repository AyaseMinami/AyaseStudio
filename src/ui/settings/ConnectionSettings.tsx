import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Check,
  ChevronDown,
  Gauge,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  Square,
  Trash2,
  X,
} from "lucide-react";

import { groupDiscoveredModels } from "../../chat/modelGrouping";
import { getProtocolOption, protocolOptions } from "../../chat/protocolOptions";
import {
  getActiveTarget,
  providerTemplates,
  type ConfiguredModel,
  type ConnectionField,
  type ConnectionProfile,
  type ConnectionSettingsState,
  type ModelField,
  type ProviderTemplateId,
} from "../../chat/settings";
import type {
  ModelCatalogViewState,
  ModelTestViewState,
} from "../../chat/useChatSession";
import type { ChatProtocol } from "../../chat/types";
import {
  normalizeBaseUrl,
  resolveGenerationEndpoint,
  UrlResolutionError,
} from "../../chat/urlResolution";

export interface ConnectionSettingsProps {
  canSelectModel?: boolean;
  connectionSettings: ConnectionSettingsState;
  isStreaming: boolean;
  streamPreview?: boolean;
  modelCatalogs: Record<string, ModelCatalogViewState>;
  modelTests: Record<string, ModelTestViewState>;
  onAddConnection(
    providerId: string,
    name: string,
    protocol: ChatProtocol,
    copyFromConnectionId?: string,
  ): string;
  onAddModel(
    connectionId: string,
    modelId: string,
    displayName?: string,
  ): string;
  onAddProvider(templateId: ProviderTemplateId): string;
  onCancelModelCatalogRefresh(connectionId: string): void;
  onCancelModelTest(modelId: string): void;
  onConnectionChange(
    connectionId: string,
    field: ConnectionField,
    value: string,
  ): void;
  onDeleteConnection(connectionId: string): void;
  onDeleteModel(modelId: string): void;
  onDeleteProvider(providerId: string): void;
  onModelChange(modelId: string, field: ModelField, value: string): void;
  onProviderRename(providerId: string, name: string): void;
  onRefreshModelCatalog(connectionId: string): Promise<void>;
  onRunModelTest(connectionId: string, modelId: string): Promise<void>;
  onSelectModel(modelId: string): void;
}

const idleCatalog: ModelCatalogViewState = { status: "idle", models: [] };

type PendingFocus =
  | { kind: "provider"; id: string }
  | { kind: "connection"; id: string }
  | { kind: "model"; id: string };

function connectionHost(baseUrl: string): string {
  if (!baseUrl.trim()) {
    return "尚未填写 Base URL";
  }
  try {
    return new URL(baseUrl).host || baseUrl;
  } catch {
    return baseUrl;
  }
}

interface GenerationPreview {
  normalizedBaseUrl?: string;
  resolvedEndpoint?: string;
  note?: string;
  error?: string;
}

function generationPreview(
  connection: ConnectionProfile,
  modelId?: string,
  stream = true,
): GenerationPreview {
  if (!connection.baseUrl.trim()) {
    return { error: "请填写 Base URL 后预览请求端点。" };
  }
  try {
    if (connection.protocol === "gemini-native" && !modelId) {
      return {
        normalizedBaseUrl: normalizeBaseUrl(
          connection.protocol,
          connection.baseUrl,
        ),
        note: "添加并选择该连接的模型后可预览完整生成端点。",
      };
    }
    return resolveGenerationEndpoint(
      connection.protocol,
      connection.baseUrl,
      modelId,
      stream,
    );
  } catch (error) {
    return {
      error:
        error instanceof UrlResolutionError
          ? error.message
          : "无法解析请求端点。",
    };
  }
}

function modelTestSummary(test: ModelTestViewState | undefined): string | undefined {
  if (!test) return undefined;
  if (test.status === "running") return "正在测试…";
  if (test.status === "success") {
    return `可用 · 首段 ${test.firstResponseMs} ms · 总计 ${test.totalMs} ms`;
  }
  if (test.status === "timeout") return "测试超时";
  if (test.status === "cancelled") return "测试已取消";
  const status = test.error.status !== undefined ? ` (HTTP ${test.error.status})` : "";
  return `不可用${status} · ${test.error.message}`;
}

function configuredModelGroups(models: ConfiguredModel[]) {
  const byActualId = new Map(models.map((model) => [model.modelId, model]));
  return groupDiscoveredModels(
    models.map((model) => ({
      id: model.modelId,
      ...(model.displayName ? { displayName: model.displayName } : {}),
    })),
  ).map((group) => ({
    label: group.label,
    models: group.models.flatMap((model) => {
      const configured = byActualId.get(model.id);
      return configured ? [configured] : [];
    }),
  }));
}

export function ConnectionSettings({
  canSelectModel = true,
  connectionSettings,
  isStreaming,
  streamPreview = true,
  modelCatalogs,
  modelTests,
  onAddConnection,
  onAddModel,
  onAddProvider,
  onCancelModelCatalogRefresh,
  onCancelModelTest,
  onConnectionChange,
  onDeleteConnection,
  onDeleteModel,
  onDeleteProvider,
  onModelChange,
  onProviderRename,
  onRefreshModelCatalog,
  onRunModelTest,
  onSelectModel,
}: ConnectionSettingsProps) {
  const activeTarget = getActiveTarget(connectionSettings);
  const initialProviderId =
    activeTarget?.provider.id ?? connectionSettings.providers[0]?.id ?? null;
  const [selectedProviderId, setSelectedProviderId] = useState(initialProviderId);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(
    activeTarget?.connection.id ??
      connectionSettings.providers[0]?.connections[0]?.id ??
      null,
  );
  const [isAddingConnection, setIsAddingConnection] = useState(false);
  const [isAddingModel, setIsAddingModel] = useState(false);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [modelSearch, setModelSearch] = useState("");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [pendingFocus, setPendingFocus] = useState<PendingFocus | null>(null);
  const catalogDialogRef = useRef<HTMLElement>(null);
  const catalogTriggerRef = useRef<HTMLButtonElement>(null);
  const providerRowRefs = useRef(new Map<string, HTMLButtonElement>());
  const connectionRowRefs = useRef(new Map<string, HTMLButtonElement>());
  const modelRowRefs = useRef(new Map<string, HTMLDivElement>());

  const selectedProvider = connectionSettings.providers.find(
    (provider) => provider.id === selectedProviderId,
  );
  const selectedConnection = selectedProvider?.connections.find(
    (connection) => connection.id === selectedConnectionId,
  );
  const catalog = selectedConnection
    ? (modelCatalogs[selectedConnection.id] ?? idleCatalog)
    : idleCatalog;

  useEffect(() => {
    if (
      selectedProviderId &&
      connectionSettings.providers.some(
        (provider) => provider.id === selectedProviderId,
      )
    ) {
      return;
    }
    const provider =
      connectionSettings.providers.find(
        (candidate) => candidate.id === activeTarget?.provider.id,
      ) ?? connectionSettings.providers[0];
    setSelectedProviderId(provider?.id ?? null);
    setSelectedConnectionId(
      provider?.connections.find(
        (connection) => connection.id === activeTarget?.connection.id,
      )?.id ?? provider?.connections[0]?.id ?? null,
    );
  }, [
    activeTarget?.connection.id,
    activeTarget?.provider.id,
    connectionSettings.providers,
    selectedProviderId,
  ]);

  useEffect(() => {
    if (
      selectedConnectionId &&
      selectedProvider?.connections.some(
        (connection) => connection.id === selectedConnectionId,
      )
    ) {
      return;
    }
    setSelectedConnectionId(selectedProvider?.connections[0]?.id ?? null);
  }, [selectedConnectionId, selectedProvider]);

  useEffect(() => {
    setModelSearch("");
    setCatalogSearch("");
    setCatalogOpen(false);
    setEditingModelId(null);
    setFormError(undefined);
  }, [selectedConnectionId]);

  useEffect(() => {
    if (!catalogOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeCatalog();
        return;
      }
      if (event.key === "Tab") {
        const focusable = Array.from(
          catalogDialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
          ) ?? [],
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [catalogOpen]);

  useEffect(() => {
    if (!pendingFocus) return;
    const target =
      pendingFocus.kind === "provider"
        ? providerRowRefs.current.get(pendingFocus.id)
        : pendingFocus.kind === "connection"
          ? connectionRowRefs.current.get(pendingFocus.id)
          : modelRowRefs.current.get(pendingFocus.id);
    if (!target) return;
    target.focus();
    setPendingFocus(null);
  }, [connectionSettings, pendingFocus]);

  function closeCatalog(): void {
    setCatalogOpen(false);
    queueMicrotask(() => catalogTriggerRef.current?.focus());
  }

  function confirmDiscardModelEdit(): boolean {
    if (!editingModelId) return true;
    return window.confirm("当前模型编辑尚未保存。切换后将放弃这些修改，是否继续？");
  }

  const visibleModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    return (selectedConnection?.models ?? []).filter((model) =>
      query
        ? `${model.displayName ?? ""} ${model.modelId}`
            .toLowerCase()
            .includes(query)
        : true,
    );
  }, [modelSearch, selectedConnection?.models]);
  const groupedModels = useMemo(
    () => configuredModelGroups(visibleModels),
    [visibleModels],
  );
  const visibleCatalogModels = useMemo(() => {
    const query = catalogSearch.trim().toLowerCase();
    return catalog.models.filter((model) =>
      query
        ? `${model.displayName ?? ""} ${model.id} ${model.ownedBy ?? ""}`
            .toLowerCase()
            .includes(query)
        : true,
    );
  }, [catalog.models, catalogSearch]);
  const catalogGroups = useMemo(
    () => groupDiscoveredModels(visibleCatalogModels),
    [visibleCatalogModels],
  );
  const addedActualIds = useMemo(
    () => new Set(selectedConnection?.models.map((model) => model.modelId)),
    [selectedConnection?.models],
  );

  function selectProvider(providerId: string): void {
    if (providerId !== selectedProviderId && !confirmDiscardModelEdit()) return;
    const provider = connectionSettings.providers.find(
      (candidate) => candidate.id === providerId,
    );
    setSelectedProviderId(providerId);
    setSelectedConnectionId(
      provider?.connections.find(
        (connection) => connection.id === activeTarget?.connection.id,
      )?.id ?? provider?.connections[0]?.id ?? null,
    );
    setIsAddingConnection(false);
  }

  function handleCreateProvider(templateId: ProviderTemplateId): void {
    if (!confirmDiscardModelEdit()) return;
    const providerId = onAddProvider(templateId);
    setSelectedProviderId(providerId);
    setSelectedConnectionId(null);
    setIsAddingConnection(false);
  }

  function handleRenameProvider(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!selectedProvider) return;
    const name = String(
      new FormData(event.currentTarget).get("providerName") ?? "",
    ).trim();
    if (name) onProviderRename(selectedProvider.id, name);
  }

  function handleDeleteProvider(): void {
    if (!selectedProvider) return;
    const modelCount = selectedProvider.connections.reduce(
      (total, connection) => total + connection.models.length,
      0,
    );
    if (
      window.confirm(
        `删除供应商“${selectedProvider.name}”以及其中 ${selectedProvider.connections.length} 条连接、${modelCount} 个模型？`,
      )
    ) {
      const providerIndex = connectionSettings.providers.findIndex(
        (provider) => provider.id === selectedProvider.id,
      );
      const adjacentProvider =
        connectionSettings.providers[providerIndex + 1] ??
        connectionSettings.providers[providerIndex - 1];
      onDeleteProvider(selectedProvider.id);
      setSelectedProviderId(adjacentProvider?.id ?? null);
      setSelectedConnectionId(adjacentProvider?.connections[0]?.id ?? null);
      if (adjacentProvider) {
        setPendingFocus({ kind: "provider", id: adjacentProvider.id });
      }
    }
  }

  function handleAddConnection(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!selectedProvider) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("connectionName") ?? "").trim();
    const protocol = data.get("protocol") as ChatProtocol | null;
    const copyFromConnectionId = String(data.get("copyFromConnectionId") ?? "");
    if (!name || !protocolOptions.some((option) => option.value === protocol)) {
      setFormError("请填写连接名称并选择协议。");
      return;
    }
    if (!confirmDiscardModelEdit()) return;
    const connectionId = onAddConnection(
      selectedProvider.id,
      name,
      protocol as ChatProtocol,
      copyFromConnectionId || undefined,
    );
    setSelectedConnectionId(connectionId);
    setIsAddingConnection(false);
    setFormError(undefined);
    form.reset();
  }

  function handleProtocolChange(protocol: ChatProtocol): void {
    if (!selectedConnection || protocol === selectedConnection.protocol) return;
    if (
      selectedConnection.models.length > 0 &&
      !window.confirm(
        `这会让“${selectedConnection.name}”下的 ${selectedConnection.models.length} 个模型改用 ${getProtocolOption(protocol).label}，是否继续？`,
      )
    ) {
      return;
    }
    onConnectionChange(selectedConnection.id, "protocol", protocol);
  }

  function handleDeleteConnection(): void {
    if (!selectedConnection) return;
    if (
      window.confirm(
        `删除连接“${selectedConnection.name}”以及其中 ${selectedConnection.models.length} 个模型？`,
      )
    ) {
      const connectionIndex = selectedProvider?.connections.findIndex(
        (connection) => connection.id === selectedConnection.id,
      );
      const adjacentConnection =
        connectionIndex === undefined
          ? undefined
          : (selectedProvider?.connections[connectionIndex + 1] ??
            selectedProvider?.connections[connectionIndex - 1]);
      onDeleteConnection(selectedConnection.id);
      setSelectedConnectionId(adjacentConnection?.id ?? null);
      if (adjacentConnection) {
        setPendingFocus({ kind: "connection", id: adjacentConnection.id });
      }
    }
  }

  function selectConnection(connectionId: string): void {
    if (
      connectionId !== selectedConnectionId &&
      !confirmDiscardModelEdit()
    ) {
      return;
    }
    setSelectedConnectionId(connectionId);
  }

  function handleAddModel(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!selectedConnection) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const modelId = String(data.get("modelId") ?? "").trim();
    const displayName = String(data.get("displayName") ?? "").trim();
    if (!modelId) {
      setFormError("请输入实际模型 ID。");
      return;
    }
    if (selectedConnection.models.some((model) => model.modelId === modelId)) {
      setFormError("该连接已经添加了这个模型 ID。");
      return;
    }
    onAddModel(selectedConnection.id, modelId, displayName || undefined);
    form.reset();
    setFormError(undefined);
    setIsAddingModel(false);
  }

  function handleEditModel(
    event: FormEvent<HTMLFormElement>,
    model: ConfiguredModel,
  ): void {
    event.preventDefault();
    if (!selectedConnection) return;
    const data = new FormData(event.currentTarget);
    const modelId = String(data.get("modelId") ?? "").trim();
    const displayName = String(data.get("displayName") ?? "").trim();
    if (!modelId) {
      setFormError("请输入实际模型 ID。");
      return;
    }
    if (
      selectedConnection.models.some(
        (candidate) => candidate.id !== model.id && candidate.modelId === modelId,
      )
    ) {
      setFormError("该连接已经添加了这个模型 ID。");
      return;
    }
    onModelChange(model.id, "modelId", modelId);
    onModelChange(model.id, "displayName", displayName);
    setEditingModelId(null);
    setFormError(undefined);
  }

  function handleDeleteModel(model: ConfiguredModel): void {
    if (
      window.confirm(
        `${model.id === connectionSettings.activeModelId ? "这是当前模型。" : ""}确定从“${selectedConnection?.name ?? "当前连接"}”删除 ${model.modelId}？`,
      )
    ) {
      const displayedModels = groupedModels.flatMap((group) => group.models);
      const modelIndex = displayedModels.findIndex(
        (candidate) => candidate.id === model.id,
      );
      const adjacentModel =
        modelIndex < 0
          ? undefined
          : (displayedModels[modelIndex + 1] ?? displayedModels[modelIndex - 1]);
      onDeleteModel(model.id);
      if (adjacentModel) {
        setPendingFocus({ kind: "model", id: adjacentModel.id });
      }
    }
  }

  function beginModelEdit(modelId: string): void {
    if (modelId !== editingModelId && !confirmDiscardModelEdit()) return;
    setEditingModelId(modelId);
  }

  function toggleModelCreation(): void {
    if (!isAddingModel && !confirmDiscardModelEdit()) return;
    if (!isAddingModel) setEditingModelId(null);
    setIsAddingModel((current) => !current);
  }

  async function handleRunModelTest(model: ConfiguredModel): Promise<void> {
    if (!selectedConnection) return;
    if (
      !window.confirm(
        `测试 ${model.modelId} 会发送一条极短请求，可能产生少量 Token 和中转站费用。是否继续？`,
      )
    ) {
      return;
    }
    await onRunModelTest(selectedConnection.id, model.id);
  }

  async function openAndRefreshCatalog(): Promise<void> {
    if (!selectedConnection) return;
    setCatalogOpen(true);
    await onRefreshModelCatalog(selectedConnection.id);
  }

  return (
    <section
      className="settings-page connection-settings-page"
      aria-labelledby="connection-title"
    >
      <div className="settings-page-heading connection-settings-heading">
        <div>
          <p className="settings-eyebrow">模型服务</p>
          <h2 id="connection-title">连接配置</h2>
          <p className="muted-text">
            供应商用于分组；每条连接独立保存协议、地址和密钥，模型归属于具体连接。
          </p>
          {!canSelectModel && <p role="status" className="muted-text">请先加载或选择助手，再设置助手使用的模型。</p>}
        </div>
        <details className="provider-create-menu">
          <summary className="settings-button settings-button-primary">
            <Plus size={16} />
            添加供应商
          </summary>
          <div className="provider-template-menu" aria-label="供应商模板">
            {providerTemplates.map((template) => (
              <button
                key={template.id}
                type="button"
                disabled={isStreaming}
                onClick={() => handleCreateProvider(template.id)}
              >
                {template.label}
              </button>
            ))}
          </div>
        </details>
      </div>

      {connectionSettings.providers.length === 0 ? (
        <div className="settings-card settings-empty-state">
          <div className="empty-state-mark">
            <Server size={22} />
          </div>
          <h3>还没有供应商</h3>
          <p className="muted-text">
            创建供应商后，可以添加多个连接渠道和模型。
          </p>
        </div>
      ) : (
        <div className="connection-settings-workbench">
          <section className="connection-pane provider-pane">
            <header className="connection-pane-header">
              <div>
                <span className="connection-pane-kicker">第一栏</span>
                <h3>供应商</h3>
              </div>
              <span className="count-badge">{connectionSettings.providers.length}</span>
            </header>
            <nav className="connection-pane-scroll" aria-label="供应商列表">
              {connectionSettings.providers.map((provider) => (
                <button
                  key={provider.id}
                  ref={(element) => {
                    if (element) providerRowRefs.current.set(provider.id, element);
                    else providerRowRefs.current.delete(provider.id);
                  }}
                  type="button"
                  className="provider-row"
                  aria-label={provider.name}
                  aria-current={
                    provider.id === selectedProviderId ? "page" : undefined
                  }
                  onClick={() => selectProvider(provider.id)}
                >
                  <span>{provider.name}</span>
                  <small>{provider.connections.length} 条连接</small>
                </button>
              ))}
            </nav>
            {selectedProvider ? (
              <footer className="connection-pane-footer provider-actions">
                <form onSubmit={handleRenameProvider}>
                  <label className="sr-only" htmlFor="provider-name">
                    供应商名称
                  </label>
                  <input
                    key={selectedProvider.id}
                    id="provider-name"
                    name="providerName"
                    className="compact-field"
                    defaultValue={selectedProvider.name}
                    disabled={isStreaming}
                    required
                    onBlur={(event) => {
                      const value = event.currentTarget.value.trim();
                      if (value) {
                        onProviderRename(selectedProvider.id, value);
                      } else {
                        event.currentTarget.value = selectedProvider.name;
                      }
                    }}
                  />
                  <button
                    className="icon-button"
                    type="submit"
                    aria-label="保存供应商名称"
                    disabled={isStreaming}
                  >
                    <Check size={15} />
                  </button>
                </form>
                <button
                  type="button"
                  className="icon-button danger-icon-button"
                  aria-label="删除供应商"
                  disabled={isStreaming}
                  onClick={handleDeleteProvider}
                >
                  <Trash2 size={15} />
                </button>
              </footer>
            ) : null}
          </section>

          <section className="connection-pane channel-pane">
            <header className="connection-pane-header">
              <div>
                <span className="connection-pane-kicker">第二栏</span>
                <h3>连接渠道</h3>
              </div>
              <button
                type="button"
                className="settings-button settings-button-secondary"
                disabled={isStreaming || !selectedProvider}
                onClick={() => setIsAddingConnection((current) => !current)}
              >
                <Plus size={15} />
                添加连接
              </button>
            </header>

            <div className="connection-pane-scroll" aria-label="连接渠道列表">
              {isAddingConnection && selectedProvider ? (
                <form className="connection-create-card" onSubmit={handleAddConnection}>
                  <strong>新连接</strong>
                  <label className="field-label" htmlFor="new-connection-name">
                    连接名称
                  </label>
                  <input
                    id="new-connection-name"
                    name="connectionName"
                    className="field"
                    placeholder="例如：Claude 专线"
                    disabled={isStreaming}
                    required
                    autoFocus
                  />
                  <label className="field-label" htmlFor="new-connection-protocol">
                    协议类型
                  </label>
                  <select
                    id="new-connection-protocol"
                    name="protocol"
                    className="field"
                    disabled={isStreaming}
                  >
                    {protocolOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <label className="field-label" htmlFor="copy-connection">
                    复制地址和密钥（可选）
                  </label>
                  <select
                    id="copy-connection"
                    name="copyFromConnectionId"
                    className="field"
                    disabled={isStreaming}
                  >
                    <option value="">不复制</option>
                    {selectedProvider.connections.map((connection) => (
                      <option key={connection.id} value={connection.id}>
                        {connection.name}
                      </option>
                    ))}
                  </select>
                  <div className="inline-actions">
                    <button
                      type="submit"
                      className="settings-button settings-button-primary"
                      disabled={isStreaming}
                    >
                      创建连接
                    </button>
                    <button
                      type="button"
                      className="settings-button"
                      onClick={() => setIsAddingConnection(false)}
                    >
                      取消
                    </button>
                  </div>
                </form>
              ) : null}

              {selectedProvider?.connections.length ? (
                selectedProvider.connections.map((connection) => {
                  const selected = connection.id === selectedConnectionId;
                  const protocol = getProtocolOption(connection.protocol);
                  const preview = selected
                    ? generationPreview(
                        connection,
                        activeTarget?.connection.id === connection.id
                          ? activeTarget.model.modelId
                          : undefined,
                        streamPreview,
                      )
                    : null;
                  return (
                    <article
                      key={connection.id}
                      className="connection-card"
                      data-selected={selected}
                    >
                      <button
                        ref={(element) => {
                          if (element) {
                            connectionRowRefs.current.set(connection.id, element);
                          } else {
                            connectionRowRefs.current.delete(connection.id);
                          }
                        }}
                        type="button"
                        className="connection-card-selector"
                        aria-label={`查看连接 ${connection.name}`}
                        aria-current={selected ? "true" : undefined}
                        onClick={() => selectConnection(connection.id)}
                      >
                        <span className="connection-card-title-row">
                          <strong>{connection.name}</strong>
                          <ChevronDown size={15} />
                        </span>
                        <span className="protocol-badge">{protocol.label}</span>
                        <small>{connectionHost(connection.baseUrl)}</small>
                        <small>{connection.models.length} 个模型</small>
                      </button>

                      {selected ? (
                        <div className="connection-card-editor">
                          <label className="field-label" htmlFor="connection-name">
                            连接名称
                          </label>
                          <input
                            key={`${connection.id}-name`}
                            id="connection-name"
                            className="field"
                            defaultValue={connection.name}
                            disabled={isStreaming}
                            onBlur={(event) => {
                              const value = event.currentTarget.value.trim();
                              if (value) {
                                onConnectionChange(connection.id, "name", value);
                              } else {
                                event.currentTarget.value = connection.name;
                              }
                            }}
                          />
                          <label className="field-label" htmlFor="connection-protocol">
                            协议类型
                          </label>
                          <select
                            id="connection-protocol"
                            className="field"
                            value={connection.protocol}
                            disabled={isStreaming}
                            onChange={(event) =>
                              handleProtocolChange(event.target.value as ChatProtocol)
                            }
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
                            value={connection.baseUrl}
                            aria-invalid={preview?.error ? true : undefined}
                            aria-describedby={`base-url-preview-${connection.id}`}
                            disabled={isStreaming}
                            onChange={(event) =>
                              onConnectionChange(
                                connection.id,
                                "baseUrl",
                                event.target.value,
                              )
                            }
                            placeholder="https://relay.example.com/v1"
                            spellCheck={false}
                          />
                          <p className="field-hint">{protocol.hint}</p>
                          <div
                            id={`base-url-preview-${connection.id}`}
                            className="endpoint-preview"
                            aria-live="polite"
                          >
                            {preview?.error ? (
                              <p className="endpoint-preview-error">
                                {preview.error}
                              </p>
                            ) : (
                              <>
                                <p>
                                  <strong>归一化 Base URL</strong>
                                  <code>{preview?.normalizedBaseUrl}</code>
                                </p>
                                {preview?.resolvedEndpoint ? (
                                  <p>
                                    <strong>最终生成端点</strong>
                                    <code>{preview.resolvedEndpoint}</code>
                                  </p>
                                ) : (
                                  <p>{preview?.note}</p>
                                )}
                              </>
                            )}
                          </div>
                          <label className="field-label" htmlFor="api-key">
                            API Key
                          </label>
                          <input
                            id="api-key"
                            className="field"
                            type="password"
                            value={connection.apiKey}
                            disabled={isStreaming}
                            onChange={(event) =>
                              onConnectionChange(
                                connection.id,
                                "apiKey",
                                event.target.value,
                              )
                            }
                            placeholder="仅保存在本机 WebView"
                            autoComplete="off"
                            spellCheck={false}
                          />
                          <button
                            type="button"
                            className="settings-button settings-button-danger"
                            disabled={isStreaming}
                            onClick={handleDeleteConnection}
                          >
                            <Trash2 size={15} />
                            删除连接
                          </button>
                        </div>
                      ) : null}
                    </article>
                  );
                })
              ) : (
                <div className="pane-empty-state">
                  <strong>还没有连接渠道</strong>
                  <span>点击“添加连接”配置一条 URL 和协议线路。</span>
                </div>
              )}
            </div>
          </section>

          <section className="connection-pane model-pane">
            <header className="connection-pane-header model-pane-header">
              <div>
                <span className="connection-pane-kicker">第三栏</span>
                <h3>模型</h3>
                {selectedProvider && selectedConnection ? (
                  <p>
                    {selectedProvider.name} / {selectedConnection.name} /{" "}
                    {getProtocolOption(selectedConnection.protocol).label}
                  </p>
                ) : null}
              </div>
              <span className="count-badge">
                {selectedConnection?.models.length ?? 0}
              </span>
            </header>

            {selectedConnection ? (
              <>
                <div className="model-toolbar">
                  <label className="search-field">
                    <Search size={15} />
                    <span className="sr-only">搜索已添加模型</span>
                    <input
                      value={modelSearch}
                      onChange={(event) => setModelSearch(event.target.value)}
                      placeholder="搜索模型 ID 或名称"
                    />
                  </label>
                  <button
                    ref={catalogTriggerRef}
                    type="button"
                    className="settings-button"
                    disabled={isStreaming}
                    onClick={() => void openAndRefreshCatalog()}
                  >
                    <RefreshCw size={15} />
                    获取模型列表
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="手动添加模型"
                    disabled={isStreaming}
                    onClick={toggleModelCreation}
                  >
                    <Plus size={16} />
                  </button>
                </div>

                {isAddingModel ? (
                  <form className="model-create-form" onSubmit={handleAddModel}>
                    <input
                      className="compact-field"
                      name="modelId"
                      placeholder="实际模型 ID"
                      disabled={isStreaming}
                      required
                      autoFocus
                    />
                    <input
                      className="compact-field"
                      name="displayName"
                      placeholder="显示名称（可选）"
                      disabled={isStreaming}
                    />
                    <button
                      type="submit"
                      className="settings-button settings-button-primary"
                      disabled={isStreaming}
                    >
                      添加
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="取消添加模型"
                      onClick={() => setIsAddingModel(false)}
                    >
                      <X size={15} />
                    </button>
                  </form>
                ) : null}

                {formError ? (
                  <p className="inline-error" role="alert">
                    {formError}
                  </p>
                ) : null}

                <div className="connection-pane-scroll model-list" aria-label="模型列表">
                  {groupedModels.length ? (
                    groupedModels.map((group) => (
                      <section key={group.label} className="model-group">
                        <header>
                          <strong>{group.label}</strong>
                          <span>{group.models.length}</span>
                        </header>
                        {group.models.map((model) => {
                          const current = model.id === connectionSettings.activeModelId;
                          const test = modelTests[model.id];
                          const testSummary = modelTestSummary(test);
                          return (
                            <div
                              key={model.id}
                              ref={(element) => {
                                if (element) modelRowRefs.current.set(model.id, element);
                                else modelRowRefs.current.delete(model.id);
                              }}
                              className="model-row"
                              data-active={current}
                              tabIndex={-1}
                            >
                              {editingModelId === model.id ? (
                                <form
                                  className="model-edit-form"
                                  onSubmit={(event) => handleEditModel(event, model)}
                                >
                                  <input
                                    className="compact-field"
                                    name="modelId"
                                    defaultValue={model.modelId}
                                    disabled={isStreaming}
                                    required
                                  />
                                  <input
                                    className="compact-field"
                                    name="displayName"
                                    defaultValue={model.displayName ?? ""}
                                    placeholder="显示名称（可选）"
                                    disabled={isStreaming}
                                  />
                                  <button
                                    type="submit"
                                    className="icon-button"
                                    aria-label={`保存模型 ${model.modelId}`}
                                    disabled={isStreaming}
                                  >
                                    <Check size={15} />
                                  </button>
                                  <button
                                    type="button"
                                    className="icon-button"
                                    aria-label={`取消编辑模型 ${model.modelId}`}
                                    onClick={() => setEditingModelId(null)}
                                  >
                                    <X size={15} />
                                  </button>
                                </form>
                              ) : (
                                <>
                                  <div className="model-row-copy">
                                    <strong>{model.displayName || model.modelId}</strong>
                                    {model.displayName ? <small>{model.modelId}</small> : null}
                                    {current ? <span className="active-badge">当前模型</span> : null}
                                    {testSummary ? (
                                      <small
                                        className={`model-test-summary model-test-${test?.status}`}
                                      >
                                        {testSummary}
                                      </small>
                                    ) : null}
                                  </div>
                                  <div className="model-row-actions">
                                    <button
                                      type="button"
                                      className="icon-button"
                                      aria-label={`设为当前模型 ${model.modelId}`}
                                      title="设为当前模型"
                                      disabled={isStreaming || current || !canSelectModel}
                                      onClick={() => onSelectModel(model.id)}
                                    >
                                      {current ? <Check size={15} /> : <Square size={14} />}
                                    </button>
                                    <button
                                      type="button"
                                      className="icon-button"
                                      aria-label={`${test?.status === "running" ? "取消测试" : "测试模型"} ${model.modelId}`}
                                      title={test?.status === "running" ? "取消测试" : "测试模型"}
                                      disabled={isStreaming}
                                      onClick={() =>
                                        test?.status === "running"
                                          ? onCancelModelTest(model.id)
                                          : void handleRunModelTest(model)
                                      }
                                    >
                                      {test?.status === "running" ? (
                                        <X size={15} />
                                      ) : (
                                        <Gauge size={15} />
                                      )}
                                    </button>
                                    <button
                                      type="button"
                                      className="icon-button"
                                      aria-label={`编辑模型 ${model.modelId}`}
                                      title="编辑模型"
                                      disabled={isStreaming}
                                      onClick={() => beginModelEdit(model.id)}
                                    >
                                      <Pencil size={14} />
                                    </button>
                                    <button
                                      type="button"
                                      className="icon-button danger-icon-button"
                                      aria-label={`删除模型 ${model.modelId}`}
                                      title="删除模型"
                                      disabled={isStreaming}
                                      onClick={() => handleDeleteModel(model)}
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </section>
                    ))
                  ) : (
                    <div className="pane-empty-state">
                      <strong>
                        {selectedConnection.models.length
                          ? "没有匹配的模型"
                          : "还没有模型"}
                      </strong>
                      <span>
                        手动添加模型 ID，或从该连接的远端目录中选择。
                      </span>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="pane-empty-state pane-empty-fill">
                <strong>请选择连接渠道</strong>
                <span>右侧模型列表会跟随中栏选中的连接切换。</span>
              </div>
            )}
          </section>
        </div>
      )}

      <div className="notice notice-warning connection-secret-notice">
        Alpha 版凭据以明文保存在本机。不要输入与你无关或不可信的中转站密钥。
      </div>

      {catalogOpen && selectedConnection ? (
        <div
          className="model-catalog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeCatalog();
          }}
        >
          <section
            ref={catalogDialogRef}
            className="model-catalog-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="model-catalog-title"
          >
            <header className="model-catalog-header">
              <div>
                <p className="settings-eyebrow">远端模型目录</p>
                <h3 id="model-catalog-title">
                  {selectedConnection.name} 模型
                </h3>
                <p className="muted-text">
                  候选目录不会自动覆盖该连接已经添加的模型。
                </p>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="关闭模型目录"
                onClick={closeCatalog}
              >
                <X size={18} />
              </button>
            </header>
            <div className="model-catalog-toolbar">
              <label className="search-field">
                <Search size={16} />
                <span className="sr-only">搜索远端模型</span>
                <input
                  value={catalogSearch}
                  onChange={(event) => setCatalogSearch(event.target.value)}
                  placeholder="搜索模型 ID 或名称"
                  autoFocus
                />
              </label>
              {catalog.status === "loading" ? (
                <button
                  type="button"
                  className="settings-button"
                  onClick={() => onCancelModelCatalogRefresh(selectedConnection.id)}
                >
                  <X size={15} />
                  取消
                </button>
              ) : (
                <button
                  type="button"
                  className="settings-button"
                  onClick={() => void onRefreshModelCatalog(selectedConnection.id)}
                >
                  <RefreshCw size={15} />
                  刷新
                </button>
              )}
            </div>
            {catalog.error ? (
              <p className="inline-error" role="alert">
                {catalog.error}
              </p>
            ) : null}
            <div className="model-catalog-list">
              {catalog.status === "loading" && catalog.models.length === 0 ? (
                <div className="pane-empty-state pane-empty-fill">
                  <RefreshCw className="spin" size={20} />
                  <strong>正在获取模型列表</strong>
                </div>
              ) : catalogGroups.length ? (
                catalogGroups.map((group) => (
                  <section key={group.label} className="catalog-group">
                    <header>
                      <strong>{group.label}</strong>
                      <span>{group.models.length}</span>
                    </header>
                    {group.models.map((model) => {
                      const added = addedActualIds.has(model.id);
                      return (
                        <div key={model.id} className="catalog-model-row">
                          <div>
                            <strong>{model.displayName || model.id}</strong>
                            {model.displayName ? <small>{model.id}</small> : null}
                          </div>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={
                              added ? `已添加 ${model.id}` : `添加模型 ${model.id}`
                            }
                            disabled={added || isStreaming}
                            onClick={() =>
                              onAddModel(
                                selectedConnection.id,
                                model.id,
                                model.displayName,
                              )
                            }
                          >
                            {added ? <Check size={15} /> : <Plus size={16} />}
                          </button>
                        </div>
                      );
                    })}
                  </section>
                ))
              ) : (
                <div className="pane-empty-state pane-empty-fill">
                  <strong>
                    {catalog.status === "idle" ? "尚未获取模型" : "没有可显示的模型"}
                  </strong>
                  <span>可以刷新目录，也可以关闭后手动添加模型 ID。</span>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
