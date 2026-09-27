import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Check,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  GripVertical,
  ChevronDown,
  Eye,
  EyeOff,
  Gauge,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
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
  type ProviderGroup,
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
import "./ConnectionSettings.css";
import { SettingsHelp } from "./SettingsHelp";

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
  onProviderMove(providerId: string, targetId: string, placement: "before" | "after"): void;
  onRefreshModelCatalog(connectionId: string): Promise<void>;
  onRunModelTest(connectionId: string, modelId: string): Promise<void>;
  onSelectModel(modelId: string): void;
}

const idleCatalog: ModelCatalogViewState = { status: "idle", models: [] };

function ApiKeyInput({ value, disabled, onChange }: {
  value: string;
  disabled: boolean;
  onChange(value: string): void;
}) {
  const [visible, setVisible] = useState(false);
  const label = visible ? "隐藏 API Key" : "显示 API Key";

  return <div className="api-key-input">
    <input id="api-key" className="field" type={visible ? "text" : "password"}
      value={value} readOnly={disabled} onChange={(event) => onChange(event.target.value)}
      placeholder="输入密钥" autoComplete="off" spellCheck={false} />
    <button type="button" className="icon-button" aria-label={label} title={label}
      aria-controls="api-key" onClick={() => setVisible((current) => !current)}>
      {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
    </button>
  </div>;
}

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

function EntityActions({ kind, name, disabled, onRename, onDelete, onMove, canMoveUp, canMoveDown }: {
  kind: "供应商" | "连接";
  name: string;
  disabled: boolean;
  onRename(name: string): void;
  onDelete(): void;
  onMove?(direction: -1 | 1): void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const container = useRef<HTMLDetailsElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  function close() { setOpen(false); setRenaming(false); }
  function saveName() {
    const value = input.current?.value.trim();
    if (value && value !== name) onRename(value);
    else if (input.current) input.current.value = name;
  }
  function dismiss() {
    input.current?.blur();
    close();
    container.current?.querySelector("summary")?.focus({ preventScroll: true });
  }
  useLayoutEffect(() => {
    if (!open || !menu.current) return;
    const anchor = container.current?.querySelector("summary")?.getBoundingClientRect();
    if (!anchor) return;
    const popup = menu.current;
    popup.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - popup.offsetWidth - 8))}px`;
    popup.style.top = `${Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - popup.offsetHeight - 8))}px`;
    popup.querySelector<HTMLElement>("input:not(:disabled), button:not(:disabled)")?.focus();
  }, [open, renaming]);
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) {
        input.current?.blur();
        close();
      }
    }
    function scrolled(event: Event) {
      if (!menu.current?.contains(event.target as Node)) dismiss();
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", close);
    };
  }, [open]);
  return <details ref={container} className="connection-entity-actions" open={open}
    onBlur={(event) => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) close();
    }}
    onKeyDown={(event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    }}>
    <summary className="icon-button" aria-label={`管理${kind} ${name}`} aria-expanded={open} aria-haspopup={renaming ? "dialog" : "menu"}
      aria-disabled={disabled} onClick={(event) => {
        event.preventDefault();
        if (!disabled) { setOpen(!open); setRenaming(false); }
      }}><MoreHorizontal size={16} /></summary>
    {open && <div ref={menu} className="assistant-menu connection-entity-menu" role={renaming ? "dialog" : "menu"}
      aria-label={`${name}的管理菜单`} onKeyDown={(event) => {
        if (renaming) return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const target = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
          : event.key === "ArrowDown" ? (index + 1) % buttons.length
          : event.key === "ArrowUp" ? (index - 1 + buttons.length) % buttons.length : undefined;
        if (target !== undefined) { event.preventDefault(); buttons[target]?.focus(); }
      }}>
      {renaming ? <form onSubmit={(event) => {
        event.preventDefault(); saveName(); close(); container.current?.querySelector("summary")?.focus();
      }}>
        <label className="field-label">重命名{kind}
          <input ref={input} className="compact-field" defaultValue={name} autoFocus required
            disabled={disabled} />
        </label>
        <div className="connection-rename-footer">
          <button type="button" className="settings-button" onClick={dismiss}>取消</button>
          <button type="submit" className="settings-button" disabled={disabled}>完成</button>
        </div>
      </form> : <button type="button" role="menuitem" disabled={disabled} onClick={() => setRenaming(true)}><Pencil size={15} />重命名</button>}
      {!renaming && onMove && <>
        <button type="button" role="menuitem" disabled={disabled || !canMoveUp} aria-label={`上移供应商 ${name}`}
          onClick={() => { dismiss(); onMove(-1); }}><ArrowUp size={15} />上移</button>
        <button type="button" role="menuitem" disabled={disabled || !canMoveDown} aria-label={`下移供应商 ${name}`}
          onClick={() => { dismiss(); onMove(1); }}><ArrowDown size={15} />下移</button>
      </>}
      {!renaming && <button type="button" role="menuitem" className="danger-icon-button" disabled={disabled}
        aria-label={`删除${kind} ${name}`} onClick={() => { close(); onDelete(); }}><Trash2 size={14} />删除</button>}
    </div>}
  </details>;
}

function AddModelDialog({ disabled, error, onSubmit, onClose }: {
  disabled: boolean;
  error?: string;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return <dialog ref={dialog} className="model-create-dialog" aria-labelledby="add-model-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <form onSubmit={onSubmit}>
      <h3 id="add-model-title">添加模型</h3>
      <label>实际模型 ID<input className="compact-field" name="modelId" placeholder="例如：gpt-4.1" disabled={disabled} required autoFocus /></label>
      <label>显示名称（可选）<input className="compact-field" name="displayName" disabled={disabled} /></label>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="model-create-dialog-actions">
        <button type="button" className="settings-button" onClick={onClose}>取消</button>
        <button type="submit" className="settings-button settings-button-primary" disabled={disabled}>添加</button>
      </div>
    </form>
  </dialog>;
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
  onProviderMove,
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
  const [collapsedProviders, setCollapsedProviders] = useState<Set<string>>(() => new Set());
  const [draggedProviderId, setDraggedProviderId] = useState<string | null>(null);
  const [providerDrop, setProviderDrop] = useState<{ id: string; placement: "before" | "after" } | null>(null);
  const [isAddingModel, setIsAddingModel] = useState(false);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [modelSearch, setModelSearch] = useState("");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [pendingFocus, setPendingFocus] = useState<PendingFocus | null>(null);
  const catalogDialogRef = useRef<HTMLElement>(null);
  const catalogTriggerRef = useRef<HTMLButtonElement>(null);
  const providerAddConnectionRef = useRef<HTMLButtonElement>(null);
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
    setSelectedConnectionId(null);
  }, [
    activeTarget?.connection.id,
    activeTarget?.provider.id,
    connectionSettings.providers,
    selectedProviderId,
  ]);

  useEffect(() => {
    if (!selectedConnectionId) return;
    if (selectedProvider?.connections.some((connection) => connection.id === selectedConnectionId)) return;
    setSelectedConnectionId(null);
  }, [selectedConnectionId, selectedProvider]);


  useEffect(() => {
    setModelSearch("");
    setCatalogSearch("");
    setCatalogOpen(false);
    setEditingModelId(null);
    setIsAddingModel(false);
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

  function selectProvider(providerId: string): boolean {
    if (!confirmDiscardModelEdit()) return false;
    setSelectedProviderId(providerId);
    setSelectedConnectionId(null);
    setIsAddingConnection(false);
    return true;
  }

  function handleCreateProvider(templateId: ProviderTemplateId): void {
    if (!confirmDiscardModelEdit()) return;
    const providerId = onAddProvider(templateId);
    setSelectedProviderId(providerId);
    setSelectedConnectionId(null);
    setIsAddingConnection(false);
  }

  function handleDeleteProvider(provider: ProviderGroup): void {
    const modelCount = provider.connections.reduce((total, connection) => total + connection.models.length, 0);
    if (!window.confirm(`删除供应商“${provider.name}”以及其中 ${provider.connections.length} 条连接、${modelCount} 个模型？`)) return;
    onDeleteProvider(provider.id);
    if (provider.id !== selectedProviderId) return;
    const index = connectionSettings.providers.findIndex((candidate) => candidate.id === provider.id);
    const adjacent = connectionSettings.providers[index + 1] ?? connectionSettings.providers[index - 1];
    setSelectedProviderId(adjacent?.id ?? null);
    setSelectedConnectionId(adjacent?.connections[0]?.id ?? null);
    setIsAddingConnection(false);
    if (adjacent) setPendingFocus({ kind: "provider", id: adjacent.id });
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

  function handleDeleteConnection(provider: ProviderGroup, connection: ConnectionProfile): void {
    if (!window.confirm(`删除连接“${connection.name}”以及其中 ${connection.models.length} 个模型？\n${getProtocolOption(connection.protocol).label} · ${connection.baseUrl || "未设置 Base URL"}`)) return;
    onDeleteConnection(connection.id);
    if (connection.id !== selectedConnectionId) {
      if (provider.id === selectedProviderId && !selectedConnectionId) {
        providerAddConnectionRef.current?.focus();
      }
      return;
    }
    const index = provider.connections.findIndex((candidate) => candidate.id === connection.id);
    const adjacent = provider.connections[index + 1] ?? provider.connections[index - 1];
    setSelectedConnectionId(adjacent?.id ?? null);
    setPendingFocus(adjacent ? { kind: "connection", id: adjacent.id } : { kind: "provider", id: provider.id });
  }

  function selectConnection(providerId: string, connectionId: string): void {
    if (connectionId !== selectedConnectionId && !confirmDiscardModelEdit()) return;
    setSelectedProviderId(providerId);
    setSelectedConnectionId(connectionId);
    setIsAddingConnection(false);
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
        `${model.id === connectionSettings.activeModelId ? "这是助手默认模型。" : ""}确定从“${selectedConnection?.name ?? "当前连接"}”删除 ${model.modelId}？`,
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
      } else if (selectedConnection) {
        setPendingFocus({ kind: "connection", id: selectedConnection.id });
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

  function renderModelRow(model: ConfiguredModel) {
    const current = model.id === connectionSettings.activeModelId;
    const test = modelTests[model.id];
    const testSummary = modelTestSummary(test);
    return (
      <div key={model.id} ref={(element) => {
        if (element) modelRowRefs.current.set(model.id, element);
        else modelRowRefs.current.delete(model.id);
      }} className="model-row" data-active={current} tabIndex={-1}>
        {editingModelId === model.id ? (
          <form className="model-edit-form" onSubmit={(event) => handleEditModel(event, model)}>
            <input className="compact-field" name="modelId" defaultValue={model.modelId} disabled={isStreaming} required />
            <input className="compact-field" name="displayName" defaultValue={model.displayName ?? ""} placeholder="显示名称（可选）" disabled={isStreaming} />
            <button type="submit" className="icon-button" aria-label={`保存模型 ${model.modelId}`} disabled={isStreaming}><Check size={15} /></button>
            <button type="button" className="icon-button" aria-label={`取消编辑模型 ${model.modelId}`} onClick={() => setEditingModelId(null)}><X size={15} /></button>
          </form>
        ) : <>
          <div className="model-row-copy">
            <strong>{model.displayName || model.modelId}</strong>
            {model.displayName ? <small>{model.modelId}</small> : null}
            {current ? <span className="active-badge">助手默认模型</span> : null}
            {testSummary ? <small className={`model-test-summary model-test-${test?.status}`}>{testSummary}</small> : null}
          </div>
          <div className="model-row-actions">
            <button type="button" className="icon-button" aria-label={`设为助手默认模型 ${model.modelId}`} title="设为助手默认模型（用于新建对话）" disabled={isStreaming || current || !canSelectModel} onClick={() => onSelectModel(model.id)}>
              {current ? <Check size={15} /> : <Square size={14} />}
            </button>
            <button type="button" className="icon-button" aria-label={`${test?.status === "running" ? "取消测试" : "测试模型"} ${model.modelId}`} title={test?.status === "running" ? "取消测试" : "测试模型"} disabled={isStreaming} onClick={() => test?.status === "running" ? onCancelModelTest(model.id) : void handleRunModelTest(model)}>
              {test?.status === "running" ? <X size={15} /> : <Gauge size={15} />}
            </button>
            <button type="button" className="icon-button" aria-label={`编辑模型 ${model.modelId}`} title="编辑模型" disabled={isStreaming} onClick={() => beginModelEdit(model.id)}><Pencil size={14} /></button>
            <button type="button" className="icon-button danger-icon-button" aria-label={`删除模型 ${model.modelId}`} title="删除模型" disabled={isStreaming} onClick={() => handleDeleteModel(model)}><Trash2 size={14} /></button>
          </div>
        </>}
      </div>
    );
  }

  return (
    <section
      className="settings-page settings-workspace-page connection-settings-page"
      aria-labelledby="connection-title"
    >
      <div className="settings-page-heading connection-settings-heading">
          <h2 id="connection-title">连接配置</h2>
          <p className="muted-text">管理连接与模型，设置助手的新对话默认模型。</p>
      </div>
        <div className="connection-settings-workbench">
          <nav className="connection-tree" aria-label="供应商列表">
            <div className="connection-tree-heading">
              <h3>供应商</h3>
              <details className="provider-create-menu">
                <summary className="icon-button" aria-label="添加供应商" title="添加供应商"><Plus size={18} /></summary>
                <div className="provider-template-menu" aria-label="供应商模板">
                  {providerTemplates.map((template) => <button key={template.id} type="button" disabled={isStreaming}
                    onClick={(event) => { handleCreateProvider(template.id); event.currentTarget.closest("details")?.removeAttribute("open"); }}>
                    {template.label}
                  </button>)}
                </div>
              </details>
            </div>
            {connectionSettings.providers.length === 0 && (
              <div className="pane-empty-state connection-tree-empty">
                <span>还没有供应商，点击右上角加号添加。</span>
              </div>
            )}
            {connectionSettings.providers.map((provider, index) => {
              const expanded = !collapsedProviders.has(provider.id);
              return <section key={provider.id} className="connection-tree-group"
                data-dragging={draggedProviderId === provider.id || undefined}
                data-drop={providerDrop?.id === provider.id ? providerDrop.placement : undefined}
                onDragOver={(event) => {
                  if (!draggedProviderId || draggedProviderId === provider.id || isStreaming) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  const bounds = event.currentTarget.getBoundingClientRect();
                  setProviderDrop({ id: provider.id, placement: event.clientY < bounds.top + bounds.height / 2 ? "before" : "after" });
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setProviderDrop(null);
                }}
                onDrop={(event) => {
                  if (!draggedProviderId || isStreaming) return;
                  event.preventDefault();
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const placement = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
                  onProviderMove(draggedProviderId, provider.id, placement);
                  setDraggedProviderId(null);
                  setProviderDrop(null);
                }}>
                <div className="connection-tree-row connection-provider-row">
                  <button type="button" className="provider-drag-handle" draggable={!isStreaming} disabled={isStreaming}
                    aria-label={`拖动排序 ${provider.name}`} title="拖动排序，也可在菜单中上移或下移"
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("application/x-ayase-provider", provider.id);
                      const group = event.currentTarget.closest(".connection-tree-group");
                      if (group) event.dataTransfer.setDragImage(group, 12, 12);
                      setDraggedProviderId(provider.id);
                    }}
                    onDragEnd={() => { setDraggedProviderId(null); setProviderDrop(null); }}>
                    <GripVertical size={14} />
                  </button>
                  <button type="button" className="connection-tree-disclosure" aria-label={`${expanded ? "收起" : "展开"}供应商 ${provider.name}`}
                    aria-expanded={expanded} aria-controls={`provider-connections-${provider.id}`}
                    onClick={() => setCollapsedProviders((current) => {
                      const updated = new Set(current);
                      if (expanded) updated.add(provider.id); else updated.delete(provider.id);
                      return updated;
                    })}>
                    <ChevronDown size={15} />
                  </button>
                  <button type="button" className="connection-tree-provider" aria-label={provider.name}
                    ref={(element) => { if (element) providerRowRefs.current.set(provider.id, element); else providerRowRefs.current.delete(provider.id); }}
                    aria-current={selectedProviderId === provider.id && !selectedConnectionId ? "true" : undefined}
                    onClick={() => { void selectProvider(provider.id); }}>
                    <span title={provider.name}>{provider.name}</span><small>{provider.connections.length}</small>
                  </button>
                  <EntityActions kind="供应商" name={provider.name} disabled={isStreaming}
                    canMoveUp={index > 0} canMoveDown={index < connectionSettings.providers.length - 1}
                    onMove={(direction) => {
                      const target = connectionSettings.providers[index + direction];
                      if (target) onProviderMove(provider.id, target.id, direction === -1 ? "before" : "after");
                    }}
                    onRename={(name) => onProviderRename(provider.id, name)} onDelete={() => handleDeleteProvider(provider)} />
                </div>
                <div id={`provider-connections-${provider.id}`} className="connection-tree-children" hidden={!expanded}
                  role="group" aria-label={`${provider.name}的连接渠道列表`}>
                  {provider.connections.map((connection) => {
                    return <div className="connection-tree-connection" key={connection.id}>
                      <div className="connection-tree-row">
                        <button type="button" className="connection-tree-link" aria-label={`查看连接 ${connection.name}`}
                          aria-current={selectedConnectionId === connection.id ? "true" : undefined}
                          ref={(element) => { if (element) connectionRowRefs.current.set(connection.id, element); else connectionRowRefs.current.delete(connection.id); }}
                          onClick={() => selectConnection(provider.id, connection.id)}>
                          <span title={connection.name}>{connection.name}</span>
                        </button>
                        <EntityActions kind="连接" name={connection.name} disabled={isStreaming}
                          onRename={(name) => onConnectionChange(connection.id, "name", name)}
                          onDelete={() => handleDeleteConnection(provider, connection)} />
                      </div>
                    </div>;
                  })}
                  <button className="connection-tree-add" type="button" disabled={isStreaming}
                    aria-label={`为 ${provider.name} 添加连接`} onClick={() => {
                      if (selectProvider(provider.id)) setIsAddingConnection(true);
                    }}><Plus size={14} />添加连接</button>
                </div>
              </section>;
            })}
          </nav>
          <section className="connection-detail" aria-label="连接详情">
            {formError && <p className="inline-error" role="alert">{formError}</p>}
            {isAddingConnection && selectedProvider ? (
                <form className="connection-create-card" onSubmit={handleAddConnection}>
                  <strong>为 {selectedProvider.name} 添加连接</strong>
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
            {selectedConnection && selectedProvider ? (() => {
              const connection = selectedConnection;
              const protocol = getProtocolOption(connection.protocol);
              const preview = generationPreview(connection,
                activeTarget?.connection.id === connection.id ? activeTarget.model.modelId : undefined, streamPreview);
              return <div key={connection.id} className="connection-detail-body">
                <header className="connection-detail-heading">
                  <button className="connection-back-button" type="button"
                    aria-label="返回供应商连接列表" title="返回供应商连接列表"
                    onClick={() => selectProvider(selectedProvider.id)}>
                    <ArrowLeft size={18} aria-hidden="true" />
                  </button>
                  <h3 title={connection.name}>{connection.name}</h3>
                  <p className="muted-text" title={selectedProvider.name}>{selectedProvider.name}</p>
                </header>
                <details className="connection-interface" open>
                  <summary><strong>接口配置</strong><span className="connection-interface-summary">{protocol.label} · {connectionHost(connection.baseUrl)}</span><ChevronDown size={16} /></summary>
                  <div className="connection-interface-fields">
                    <div className="connection-identity-fields">
                      <label className="field-label">连接名称
                        <input id="connection-name" className="field" key={connection.name} defaultValue={connection.name} disabled={isStreaming}
                          onBlur={(event) => {
                            const value = event.currentTarget.value.trim();
                            if (value) onConnectionChange(connection.id, "name", value);
                            else event.currentTarget.value = connection.name;
                          }} />
                      </label>
                      <label className="field-label">协议类型
                        <select id="connection-protocol" className="field" value={connection.protocol} disabled={isStreaming}
                          onChange={(event) => handleProtocolChange(event.target.value as ChatProtocol)}>
                          {protocolOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </label>
                    </div>
                    <div className="connection-field-group">
                    <div className="settings-label-help"><label className="field-label" htmlFor="base-url">Base URL</label><SettingsHelp label="Base URL">{protocol.hint}</SettingsHelp></div>
                    <input id="base-url" className="field" value={connection.baseUrl} disabled={isStreaming}
                      aria-invalid={preview.error ? true : undefined} aria-describedby={preview.error ? "base-url-hint" : undefined}
                      onChange={(event) => onConnectionChange(connection.id, "baseUrl", event.target.value)}
                      placeholder="https://relay.example.com/v1" spellCheck={false} />
                    {preview.error && <p id="base-url-hint" className="endpoint-preview-error" role="alert">{preview.error}</p>}
                    <details className="connection-request-details">
                      <summary><ChevronDown size={14} />请求地址详情</summary>
                      <div className="endpoint-preview">
                        {preview.normalizedBaseUrl && <p><strong>归一化 Base URL</strong><code>{preview.normalizedBaseUrl}</code></p>}
                        {preview.resolvedEndpoint ? <p><strong>最终生成端点</strong><code>{preview.resolvedEndpoint}</code></p>
                          : <p>{preview.note ?? "填写有效地址后显示请求地址。"}</p>}
                      </div>
                    </details>
                    </div>
                    <div className="connection-field-group">
                    <div className="settings-label-help"><label className="field-label" htmlFor="api-key">API Key</label><SettingsHelp label="API Key">密钥以明文保存在本机，请仅使用可信服务的密钥。</SettingsHelp></div>
                    <ApiKeyInput value={connection.apiKey} disabled={isStreaming}
                      onChange={(value) => onConnectionChange(connection.id, "apiKey", value)} />
                    </div>
                  </div>
                </details>
                <section className="connection-models" aria-label="模型管理">
                  <header className="connection-model-heading"><h3>模型管理</h3><span className="count-badge">{connection.models.length}</span><SettingsHelp label="模型管理">{canSelectModel
                    ? "选择模型用于助手的新对话。已有对话可在聊天顶部或对话设置中更换。"
                    : "请先加载或选择助手，再设置默认模型。"}</SettingsHelp></header>

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



                <div className="model-list" aria-label="模型列表">
                  {groupedModels.length ? (
                    groupedModels.map((group) => (
                      <section key={group.label} className="model-group">
                        <header>
                          <strong>{group.label}</strong>
                          <span>{group.models.length}</span>
                        </header>
                        {group.models.map(renderModelRow)}
                      </section>
                    ))
                  ) : (
                    <div className="pane-empty-state">
                      <strong>{selectedConnection.models.length ? "没有匹配的模型" : "还没有模型"}</strong>
                      <span>手动添加模型 ID，或从远端目录中选择。</span>
                    </div>
                  )}
                </div>
                </section>
              </div>;
            })() : selectedProvider && !isAddingConnection ? (
              <div className="connection-provider-detail">
                <p className="muted-text">供应商</p>
                <h3>{selectedProvider.name}</h3>
                <p className="muted-text">管理此供应商下的连接渠道。连接独立拥有协议、地址、密钥和模型。</p>
                <button ref={providerAddConnectionRef} className="settings-button settings-button-primary" type="button" disabled={isStreaming}
                  onClick={() => setIsAddingConnection(true)}><Plus size={15} />添加连接</button>
                {selectedProvider.connections.length > 0 ? (
                  <div className="provider-connection-list">
                    <div className="provider-connection-header" aria-hidden="true">
                      <div className="provider-connection-info">
                        <strong>连接名称</strong>
                        <strong>协议类型</strong>
                        <strong className="provider-connection-url">Base URL</strong>
                      </div>
                      <strong className="provider-connection-actions-label">操作</strong>
                    </div>
                    <ul className="provider-connection-rows" aria-label={`${selectedProvider.name}的连接渠道`}>
                    {selectedProvider.connections.map((connection) => (
                      <li key={connection.id} className="provider-connection-row">
                        <button className="provider-connection-link" type="button"
                          title={`编辑连接 ${connection.name}`}
                          onClick={() => selectConnection(selectedProvider.id, connection.id)}>
                          <span className="provider-connection-info">
                            <strong className="provider-connection-name" title={connection.name}>{connection.name}</strong>
                            <span className="provider-connection-protocol">{getProtocolOption(connection.protocol).label}</span>
                            <span className="provider-connection-url" title={connection.baseUrl}>{connection.baseUrl || "未设置 Base URL"}</span>
                          </span>
                          <Pencil size={15} aria-hidden="true" />
                        </button>
                        <button className="icon-button danger-icon-button" type="button"
                          aria-label={`删除连接 ${connection.name}`} title={`删除连接 ${connection.name}`}
                          disabled={isStreaming} onClick={() => handleDeleteConnection(selectedProvider, connection)}>
                          <Trash2 size={15} />
                        </button>
                      </li>
                    ))}
                    </ul>
                  </div>
                ) : (
                  <div className="pane-empty-state provider-connections-empty">
                    <strong>还没有连接</strong>
                    <span>添加连接后，在这里查看和管理协议与地址。</span>
                  </div>
                )}
              </div>
            ) : !isAddingConnection && (
              <div className="pane-empty-state pane-empty-fill"><strong>{connectionSettings.providers.length ? "选择供应商" : "先添加供应商"}</strong><span>在供应商下添加连接，配置地址、密钥和模型。</span></div>
            )}
          </section>
        </div>
      {isAddingModel && selectedConnection && <AddModelDialog disabled={isStreaming} error={formError} onSubmit={handleAddModel}
        onClose={() => { setIsAddingModel(false); setFormError(undefined); }} />}
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
