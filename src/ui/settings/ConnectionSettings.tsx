import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent } from "react";
import {
  Check,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  GripVertical,
  ListChecks,
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

import { groupConfiguredModels, groupDiscoveredModels } from "../../chat/modelGrouping";
import { useConfirmation } from "../useConfirmation";
import { BatchDeleteDialog, BatchManagementBar } from "../BatchManagement";
import { getProtocolOption, isDrawingProtocol, protocolOptions } from "../../chat/protocolOptions";
import {
  getActiveTarget,
  providerTemplates,
  type ConfiguredModel,
  type ConnectionField,
  type ConnectionProfile,
  type ConnectionSettingsState,
  type ModelField,
  type ModelGroupCommand,
  type ProviderTemplateId,
  type ProviderGroup,
} from "../../chat/settings";
import type {
  ModelCatalogViewState,
  ModelTestViewState,
} from "../../chat/useChatSession";
import type { ServiceProtocol } from "../../chat/protocolOptions";
import {
  normalizeBaseUrl,
  resolveGenerationEndpoint,
  resolveImageGenerationEndpoint,
  resolveOpenAIImagesEndpoint,
  resolveGrokImagesEndpoint,
  resolveSeedreamImagesEndpoint,
  UrlResolutionError,
} from "../../chat/urlResolution";
import "./ConnectionSettings.css";
import { SettingsHelp } from "./SettingsHelp";
import { ActionMenu, isContextMenuKey, isEditableContextTarget, useActionMenu, type ActionMenuItem } from "../ActionMenu";
import { useConnectionTreeDrag } from "./useConnectionTreeDrag";
import { getConnectionTemplate, presetCatalogOptions } from "../../chat/providerPresets";
import type { ProviderAvatarSelection } from "../../avatar/brandIds";
import type { UserAvatar } from "../../avatar/repository";
import { ProviderAvatar } from "../avatar/ProviderAvatar";
import { BrandAvatar } from "../avatar/BrandAvatar";
import { AvatarModal, AvatarLibraryPanel } from "../avatar/AvatarLibrary";
import { SelectField } from "../SelectField";
import { SearchSelectField } from "../SearchSelectField";
import { ModelGroupManagement } from "./ModelGroupManagement";

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
    protocol: ServiceProtocol,
    copyFromConnectionId?: string,
  ): string;
  onAddModel(
    connectionId: string,
    modelId: string,
    displayName?: string,
  ): string;
  onAddProvider(templateId: ProviderTemplateId, name?: string): string;
  onProviderAvatarChange?(providerId: string, avatar: ProviderAvatarSelection | UserAvatar | undefined): Promise<boolean>;
  onResetConnection?(connectionId: string): void;
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
  onDeleteProviders?(providers: readonly ProviderGroup[]): boolean;
  onDeleteConnections?(providerId: string, connections: readonly ConnectionProfile[]): boolean;
  onModelChange(modelId: string, field: ModelField, value: string): void;
  onModelGroupCommand?(connectionId: string, command: ModelGroupCommand): boolean;
  onProviderRename(providerId: string, name: string): void;
  onProviderMove(providerId: string, targetId: string, placement: "before" | "after"): void;
  onConnectionMove(connectionId: string, targetId: string, placement: "before" | "after"): void;
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

function ConnectionCreateOptions({ provider, disabled }: { provider: ProviderGroup; disabled: boolean }) {
  const [protocol, setProtocol] = useState<string>(protocolOptions[0].value);
  const [copyFromConnectionId, setCopyFromConnectionId] = useState("");
  return <>
    <label className="field-label" htmlFor="new-connection-protocol">协议类型</label>
    <SelectField id="new-connection-protocol" label="协议类型" disabled={disabled}
      value={protocol} options={protocolOptions.map(({ value, label }) => ({ value, label }))} onChange={setProtocol} />
    <input type="hidden" name="protocol" value={protocol} disabled={disabled} />
    <label className="field-label" htmlFor="copy-connection">复制地址和密钥（可选）</label>
    <SearchSelectField id="copy-connection" label="复制地址和密钥（可选）" title="选择要复制的连接" disabled={disabled}
      value={copyFromConnectionId} options={[{ value: "", label: "不复制" }, ...provider.connections.map(connection => ({
        value: connection.id, label: connection.name, description: getProtocolOption(connection.protocol).label,
      }))]} onChange={setCopyFromConnectionId} />
    <input type="hidden" name="copyFromConnectionId" value={copyFromConnectionId} disabled={disabled} />
  </>;
}

type SettingsMenuTarget = (
  | { kind: "provider"; id: string }
  | { kind: "connection"; id: string; providerId: string }
) & { renaming?: boolean };

type PendingBatchDelete = {
  scope: { selectedProviderId: string | null; selectedConnectionId: string | null };
  management: "providers" | "connections" | null;
} & (
  | { kind: "providers"; targets: readonly ProviderGroup[] }
  | { kind: "connections"; provider: ProviderGroup; targets: readonly ConnectionProfile[] }
);

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
  editEndpoint?: string;
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
    if (isDrawingProtocol(connection.protocol)) {
      const normalizedBaseUrl = normalizeBaseUrl(connection.protocol, connection.baseUrl);
      if (!modelId) return { normalizedBaseUrl, note: "添加模型后可预览绘图生成端点；请在绘图页生成图片验证。" };
      if (connection.protocol === "grok-images") return { normalizedBaseUrl,
        resolvedEndpoint: resolveGrokImagesEndpoint(connection.baseUrl, modelId),
        editEndpoint: resolveGrokImagesEndpoint(connection.baseUrl, modelId, "edits") };
      if (connection.protocol === "seedream-images") return { normalizedBaseUrl,
        resolvedEndpoint: resolveSeedreamImagesEndpoint(connection.baseUrl, modelId),
        editEndpoint: resolveSeedreamImagesEndpoint(connection.baseUrl, modelId) };
      return { normalizedBaseUrl, resolvedEndpoint: connection.protocol === "openai-images"
        ? resolveOpenAIImagesEndpoint(connection.baseUrl, modelId) : resolveImageGenerationEndpoint(connection.baseUrl, modelId) };
    }
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

function EntityActions({ kind, name, disabled, open, onOpen }: {
  kind: "供应商" | "连接";
  name: string;
  disabled: boolean;
  open: boolean;
  onOpen(opener: HTMLElement): void;
}) {
  return <button type="button" className="icon-button connection-entity-actions"
    aria-label={`管理${kind} ${name}`} aria-expanded={open} aria-haspopup="menu"
    disabled={disabled} onClick={(event) => onOpen(event.currentTarget)}>
    <MoreHorizontal size={16} />
  </button>;
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
      <header className="model-create-dialog-heading">
        <h3 id="add-model-title">添加模型</h3>
        <p className="muted-text">将模型添加到当前连接。</p>
      </header>
      <div className="model-create-dialog-field">
        <label>实际模型 ID<input className="compact-field" name="modelId" placeholder="例如：gpt-4.1" aria-describedby="add-model-id-hint" disabled={disabled} required autoFocus /></label>
        <p id="add-model-id-hint" className="muted-text">用于接口请求，请填写服务商提供的完整 ID。</p>
      </div>
      <div className="model-create-dialog-field">
        <label>显示名称（可选）<input className="compact-field" name="displayName" placeholder="留空则显示模型 ID" aria-describedby="add-model-name-hint" disabled={disabled} /></label>
        <p id="add-model-name-hint" className="muted-text">仅用于界面显示，不影响实际请求。</p>
      </div>
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
  onProviderAvatarChange,
  onResetConnection,
  onCancelModelCatalogRefresh,
  onCancelModelTest,
  onConnectionChange,
  onDeleteConnection,
  onDeleteModel,
  onDeleteProvider,
  onDeleteProviders,
  onDeleteConnections,
  onModelChange,
  onModelGroupCommand,
  onProviderRename,
  onProviderMove,
  onConnectionMove,
  onRefreshModelCatalog,
  onRunModelTest,
  onSelectModel,
}: ConnectionSettingsProps) {
  const activeTarget = getActiveTarget(connectionSettings);
  const initialProviderId =
    activeTarget?.provider.id ?? connectionSettings.providers[0]?.id ?? null;
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(initialProviderId);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(
    activeTarget?.connection.id ??
      connectionSettings.providers[0]?.connections[0]?.id ??
      null,
  );
  const [isAddingConnection, setIsAddingConnection] = useState(false);
  const [isAddingProvider, setIsAddingProvider] = useState(false);
  const [providerDraftError, setProviderDraftError] = useState<string>();
  const [collapsedProviders, setCollapsedProviders] = useState<Set<string>>(() => new Set(
    connectionSettings.providers.filter(provider => provider.presetId && provider.id !== initialProviderId).map(provider => provider.id)));
  const [avatarProviderId, setAvatarProviderId] = useState<string>();
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarPanelBusy, setAvatarPanelBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string>();
  const [management, setManagement] = useState<"providers" | "connections" | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [batchDelete, setBatchDelete] = useState<PendingBatchDelete | null>(null);
  const [batchStatus, setBatchStatus] = useState("");
  const managementRef = useRef(management);
  managementRef.current = management;
  const avatarLock = useRef(false);
  const mounted = useRef(false);
  const currentScope = useRef({ connectionSettings, selectedProviderId, selectedConnectionId, isStreaming, modelTests, modelCatalogs });
  currentScope.current = { connectionSettings, selectedProviderId, selectedConnectionId, isStreaming, modelTests, modelCatalogs };
  const [isAddingModel, setIsAddingModel] = useState(false);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const { confirm, dialog: confirmationDialog } = useConfirmation();
  const editScope = useRef({ editingModelId, isAddingModel });
  editScope.current = { editingModelId, isAddingModel };
  const modelTestLock = useRef(new Set<string>());
  const [modelSearch, setModelSearch] = useState("");
  const [groupManagementConnectionId, setGroupManagementConnectionId] = useState<string | null>(null);
  useEffect(() => { setGroupManagementConnectionId(null); }, [selectedProviderId, selectedConnectionId, management]);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [pendingFocus, setPendingFocus] = useState<PendingFocus | null>(null);
  const entityMenu = useActionMenu<SettingsMenuTarget>();
  const treeDrag = useConnectionTreeDrag({
    disabled: isStreaming || management !== null || batchDelete !== null,
    onStart: entityMenu.close,
    onMove: (item, targetId, placement) => {
      if (item.kind === "provider") onProviderMove(item.id, targetId, placement);
      else onConnectionMove(item.id, targetId, placement);
    },
  });
  const providerCreateRef = useRef<HTMLDetailsElement>(null);
  const providerDraftRef = useRef<HTMLInputElement>(null);
  const providerCreateButtonRef = useRef<HTMLButtonElement>(null);
  const catalogDialogRef = useRef<HTMLElement>(null);
  const catalogTriggerRef = useRef<HTMLButtonElement>(null);
  const providerAddConnectionRef = useRef<HTMLButtonElement>(null);
  const managementCompletionRef = useRef<HTMLButtonElement>(null);
  const providerManagementEntryRef = useRef<HTMLButtonElement>(null);
  const connectionManagementEntryRef = useRef<HTMLButtonElement>(null);
  const previousManagement = useRef(management);
  useEffect(() => {
    if (management) managementCompletionRef.current?.focus({ preventScroll: true });
    else if (previousManagement.current) {
      const entry = previousManagement.current === "providers" ? providerManagementEntryRef.current : connectionManagementEntryRef.current;
      (entry ?? providerManagementEntryRef.current ?? providerCreateButtonRef.current)?.focus({ preventScroll: true });
    }
    previousManagement.current = management;
  }, [management]);
  const providerRowRefs = useRef(new Map<string, HTMLButtonElement>());
  const connectionRowRefs = useRef(new Map<string, HTMLButtonElement>());
  const overviewRowRefs = useRef(new Map<string, HTMLButtonElement>());
  const modelRowRefs = useRef(new Map<string, HTMLDivElement>());

  const selectedProvider = connectionSettings.providers.find(
    (provider) => provider.id === selectedProviderId,
  );
  const selectedConnection = selectedProvider?.connections.find(
    (connection) => connection.id === selectedConnectionId,
  );
  const catalogOptions = presetCatalogOptions(selectedProvider, selectedConnection);
  const avatarProvider = connectionSettings.providers.find(provider => provider.id === avatarProviderId);

  useEffect(() => {
    if (!batchStatus) return;
    const timer = window.setTimeout(() => setBatchStatus(""), 3500);
    return () => window.clearTimeout(timer);
  }, [batchStatus]);

  useEffect(() => {
    if (management === "connections") {
      setSelectedIds(new Set());
      setBatchDelete(null);
    }
  }, [selectedProviderId, management]);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (isAddingProvider) providerDraftRef.current?.focus(); }, [isAddingProvider]);
  useEffect(() => { setAvatarProviderId(undefined); setAvatarError(undefined); }, [selectedProviderId, selectedConnectionId]);
  useEffect(() => { if (isStreaming || !avatarProvider) setAvatarProviderId(undefined); }, [isStreaming, avatarProvider]);
  const catalog = selectedConnection
    ? (modelCatalogs[selectedConnection.id] ?? idleCatalog)
    : idleCatalog;

  const menuTarget = entityMenu.state?.target;
  const menuProvider = connectionSettings.providers.find((provider) =>
    provider.id === (menuTarget?.kind === "connection" ? menuTarget.providerId : menuTarget?.id));
  const menuConnection = menuTarget?.kind === "connection"
    ? menuProvider?.connections.find((connection) => connection.id === menuTarget.id) : undefined;
  const menuEntity = menuTarget?.kind === "provider" ? menuProvider : menuConnection;

  useEffect(() => {
    entityMenu.close();
  }, [selectedProviderId, selectedConnectionId, collapsedProviders, isAddingConnection, isAddingModel,
    editingModelId, catalogOpen, entityMenu.close]);

  useEffect(() => {
    if (entityMenu.state && (!menuEntity || !entityMenu.state.opener.isConnected ||
      entityMenu.state.opener.closest('[hidden], [inert], [aria-hidden="true"]'))) entityMenu.close();
  }, [connectionSettings, entityMenu.state, menuEntity, entityMenu.close]);

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
    if (selectedConnection?.protocol === "seedream-images" || catalogOptions?.manualCatalog) setCatalogOpen(false);
  }, [selectedConnection?.protocol, catalogOptions?.manualCatalog]);

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

  function scopeIsCurrent(scope: typeof currentScope.current, edit?: typeof editScope.current): boolean {
    const current = currentScope.current;
    return mounted.current && current.selectedProviderId === scope.selectedProviderId
      && current.selectedConnectionId === scope.selectedConnectionId
      && (!edit || editScope.current.editingModelId === edit.editingModelId
        && editScope.current.isAddingModel === edit.isAddingModel);
  }

  async function confirmDiscardModelEdit(): Promise<boolean> {
    if (!editingModelId) return true;
    const scope = currentScope.current;
    const edit = editScope.current;
    return await confirm({ title: "放弃模型修改", message: "当前模型编辑尚未保存。切换后将放弃这些修改，是否继续？", confirmLabel: "放弃修改", danger: true })
      && scopeIsCurrent(scope, edit);
  }

  const groupedModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    return groupConfiguredModels(selectedConnection?.models ?? [], selectedConnection?.modelGroups)
      .map(group => ({ ...group, models: group.models.filter(model => !query
        || `${group.label} ${model.displayName ?? ""} ${model.modelId}`.toLowerCase().includes(query)) }))
      .filter(group => group.models.length || group.groupId && (!query || group.label.toLowerCase().includes(query)));
  }, [modelSearch, selectedConnection?.models, selectedConnection?.modelGroups]);
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

  async function selectProvider(providerId: string): Promise<boolean> {
    if (management === "providers") return false;
    if (!await confirmDiscardModelEdit()
      || !currentScope.current.connectionSettings.providers.some(provider => provider.id === providerId)) return false;
    entityMenu.close();
    setSelectedProviderId(providerId);
    setSelectedConnectionId(null);
    setIsAddingConnection(false);
    return true;
  }

  async function handleCreateProvider(templateId: ProviderTemplateId, name?: string): Promise<void> {
    if (currentScope.current.isStreaming || !await confirmDiscardModelEdit() || currentScope.current.isStreaming) return;
    if (templateId !== "custom" && currentScope.current.connectionSettings.providers.some(provider => provider.presetId === templateId)) return;
    const providerId = onAddProvider(templateId, name);
    setSelectedProviderId(providerId);
    setSelectedConnectionId(null);
    setIsAddingConnection(false);
    setIsAddingProvider(false);
    setProviderDraftError(undefined);
    setPendingFocus({ kind: "provider", id: providerId });
  }

  function cancelProviderDraft() {
    setIsAddingProvider(false); setProviderDraftError(undefined);
    queueMicrotask(() => providerCreateButtonRef.current?.focus());
  }

  async function applyProviderAvatar(providerId: string, value: ProviderAvatarSelection | UserAvatar | undefined) {
    if (avatarLock.current || !onProviderAvatarChange || currentScope.current.isStreaming
      || !currentScope.current.connectionSettings.providers.some(provider => provider.id === providerId)) return;
    const scope = currentScope.current;
    avatarLock.current = true; setAvatarSaving(true); setAvatarError(undefined);
    try {
      const saved = await onProviderAvatarChange(providerId, value);
      if (!mounted.current || currentScope.current.selectedProviderId !== scope.selectedProviderId
        || currentScope.current.selectedConnectionId !== scope.selectedConnectionId) return;
      if (saved) setAvatarProviderId(undefined);
      else setAvatarError("头像未保存，请重试。");
    } catch (error) {
      if (mounted.current && currentScope.current.selectedProviderId === scope.selectedProviderId
        && currentScope.current.selectedConnectionId === scope.selectedConnectionId)
        setAvatarError(error instanceof Error ? error.message : "头像保存失败，请重试。");
    } finally {
      avatarLock.current = false;
      if (mounted.current) setAvatarSaving(false);
    }
  }

  async function resetConnection(connection: ConnectionProfile) {
    const defaults = getConnectionTemplate(selectedProvider?.presetId, connection.presetProtocol);
    if (isStreaming || !defaults || !onResetConnection) return;
    const scope = currentScope.current;
    if (await confirm({ title: "恢复内置默认值", message: `将连接“${connection.name}”恢复为内置默认值？\n名称：${defaults.name}\n协议：${getProtocolOption(defaults.protocol).label}\nBase URL：${defaults.baseUrl}\n保留 API Key 和已添加模型。`, confirmLabel: "恢复默认值" })
      && scopeIsCurrent(scope) && !currentScope.current.isStreaming
      && currentConnection(connection.id) === connection) onResetConnection(connection.id);
  }

  function currentConnection(connectionId: string): ConnectionProfile | undefined {
    return currentScope.current.connectionSettings.providers.flatMap(provider => provider.connections).find(connection => connection.id === connectionId);
  }

  async function handleDeleteProvider(provider: ProviderGroup): Promise<void> {
    if (isStreaming) return;
    const scope = currentScope.current;
    const modelCount = provider.connections.reduce((total, connection) => total + connection.models.length, 0);
    if (!await confirm({ title: "删除供应商", message: `删除供应商“${provider.name}”以及其中 ${provider.connections.length} 条连接、${modelCount} 个模型？`, confirmLabel: "删除", danger: true })
      || !scopeIsCurrent(scope) || currentScope.current.isStreaming
      || !currentScope.current.connectionSettings.providers.includes(provider)) return;
    onDeleteProvider(provider.id);
    if (provider.id !== selectedProviderId) return;
    const providers = currentScope.current.connectionSettings.providers;
    const index = providers.findIndex((candidate) => candidate.id === provider.id);
    const adjacent = providers[index + 1] ?? providers[index - 1];
    setSelectedProviderId(adjacent?.id ?? null);
    setSelectedConnectionId(adjacent?.connections[0]?.id ?? null);
    setIsAddingConnection(false);
    if (adjacent) setPendingFocus({ kind: "provider", id: adjacent.id });
  }

  async function enterManagement(kind: "providers" | "connections"): Promise<void> {
    if (currentScope.current.isStreaming || batchDelete || !await confirmDiscardModelEdit()
      || currentScope.current.isStreaming) return;
    entityMenu.close();
    if (providerCreateRef.current) providerCreateRef.current.open = false;
    setEditingModelId(null);
    setIsAddingModel(false);
    setIsAddingProvider(false);
    setIsAddingConnection(false);
    setCatalogOpen(false);
    setSelectedIds(new Set());
    setBatchStatus("");
    setManagement(kind);
  }

  function toggleBatchItem(id: string, checked: boolean): void {
    setSelectedIds(current => {
      const next = new Set(current);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }

  function openBatchDelete(): void {
    if (isStreaming || batchDelete) return;
    const common = { scope: currentScope.current, management };
    if (management === "providers") {
      setBatchDelete({ ...common, kind: "providers", targets: connectionSettings.providers.filter(provider => selectedIds.has(provider.id)) });
    } else if (management === "connections" && selectedProvider) {
      setBatchDelete({ ...common, kind: "connections", provider: selectedProvider,
        targets: selectedProvider.connections.filter(connection => selectedIds.has(connection.id)) });
    }
  }

  function batchBlockedReason(pending: PendingBatchDelete): string | undefined {
    const current = currentScope.current;
    if (current.isStreaming) return "生成期间无法删除连接配置。";
    if (managementRef.current !== pending.management
      || current.selectedProviderId !== pending.scope.selectedProviderId
      || current.selectedConnectionId !== pending.scope.selectedConnectionId) return "管理范围已改变，请取消后重新确认。";
    if (pending.kind === "providers"
      ? pending.targets.some(provider => !current.connectionSettings.providers.includes(provider))
      : !current.connectionSettings.providers.includes(pending.provider)
        || pending.targets.some(connection => !pending.provider.connections.includes(connection))) {
      return "所选配置已改变或移除，请取消后重新确认。";
    }
    if (!pending.targets.length) return "没有选择要删除的项目。";
    return undefined;
  }

  function submitBatchDelete(pending: PendingBatchDelete): boolean {
    if (batchBlockedReason(pending)) return false;
    let saved: boolean;
    if (pending.kind === "providers") {
      if (!onDeleteProviders) return false;
      saved = onDeleteProviders(pending.targets);
    } else {
      if (!onDeleteConnections) return false;
      saved = onDeleteConnections(pending.provider.id, pending.targets);
    }
    if (!saved) return false;
    setBatchDelete(null);
    setSelectedIds(new Set());
    setBatchStatus(`已删除 ${pending.targets.length} ${pending.kind === "providers" ? "个供应商" : "条连接"}。`);
    setIsAddingConnection(false);
    if (pending.kind === "providers" && pending.targets.some(provider => provider.id === selectedProviderId)) {
      const next = currentScope.current.connectionSettings.providers.find(provider => !pending.targets.some(target => target.id === provider.id));
      setSelectedProviderId(next?.id ?? null);
      setSelectedConnectionId(null);
    } else if (pending.kind === "connections" && pending.targets.some(connection => connection.id === selectedConnectionId)) {
      const next = pending.provider.connections.find(connection => !pending.targets.some(target => target.id === connection.id));
      setSelectedConnectionId(next?.id ?? null);
    }
    return true;
  }

  async function handleAddConnection(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedProvider) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("connectionName") ?? "").trim();
    const protocol = data.get("protocol") as ServiceProtocol | null;
    const copyFromConnectionId = String(data.get("copyFromConnectionId") ?? "");
    if (!name || !protocolOptions.some((option) => option.value === protocol)) {
      setFormError("请填写连接名称并选择协议。");
      return;
    }
    if (!await confirmDiscardModelEdit() || currentScope.current.isStreaming
      || !currentScope.current.connectionSettings.providers.includes(selectedProvider) || !form.isConnected) return;
    const connectionId = onAddConnection(
      selectedProvider.id,
      name,
      protocol as ServiceProtocol,
      copyFromConnectionId || undefined,
    );
    setSelectedConnectionId(connectionId);
    setIsAddingConnection(false);
    setFormError(undefined);
    form.reset();
  }

  async function handleProtocolChange(protocol: ServiceProtocol): Promise<void> {
    if (!selectedConnection || isStreaming || protocol === selectedConnection.protocol) return;
    const scope = currentScope.current;
    if (
      selectedConnection.models.length > 0 &&
      !await confirm({ title: "更换连接协议", message: `这会让“${selectedConnection.name}”下的 ${selectedConnection.models.length} 个模型改用 ${getProtocolOption(protocol).label}，是否继续？`, confirmLabel: "更换协议" })
    ) {
      return;
    }
    if (scopeIsCurrent(scope) && !currentScope.current.isStreaming
      && currentConnection(selectedConnection.id) === selectedConnection) onConnectionChange(selectedConnection.id, "protocol", protocol);
  }

  async function handleDeleteConnection(provider: ProviderGroup, connection: ConnectionProfile): Promise<void> {
    if (isStreaming) return;
    const scope = currentScope.current;
    if (!await confirm({ title: "删除连接", message: `删除连接“${connection.name}”以及其中 ${connection.models.length} 个模型？\n${getProtocolOption(connection.protocol).label} · ${connection.baseUrl || "未设置 Base URL"}`, confirmLabel: "删除", danger: true })
      || !scopeIsCurrent(scope) || currentScope.current.isStreaming
      || currentConnection(connection.id) !== connection) return;
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

  async function selectConnection(providerId: string, connectionId: string): Promise<void> {
    if (connectionId !== selectedConnectionId && !await confirmDiscardModelEdit()) return;
    if (!currentScope.current.connectionSettings.providers.some(provider => provider.id === providerId
      && provider.connections.some(connection => connection.id === connectionId))) return;
    entityMenu.close();
    setSelectedProviderId(providerId);
    setSelectedConnectionId(connectionId);
    setIsAddingConnection(false);
  }

  function openRowMenu(event: MouseEvent<HTMLElement>, target: SettingsMenuTarget, opener: HTMLElement | undefined): void {
    if (isEditableContextTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    openEntityMenu(target, opener ?? event.currentTarget, { x: event.clientX, y: event.clientY });
  }

  function openKeyboardMenu(event: ReactKeyboardEvent<HTMLElement>, target: SettingsMenuTarget): void {
    if (!isContextMenuKey(event) || isEditableContextTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    openEntityMenu(target, event.target instanceof HTMLElement ? event.target : event.currentTarget);
  }

  function openEntityMenu(target: SettingsMenuTarget, opener: HTMLElement, point?: { x: number; y: number }): void {
    if (management || batchDelete) return;
    if (providerCreateRef.current) providerCreateRef.current.open = false;
    entityMenu.open(target, opener, point);
  }

  function toggleEntityMenu(target: SettingsMenuTarget, opener: HTMLElement): void {
    if (entityMenu.state?.opener === opener) entityMenu.close(true);
    else openEntityMenu(target, opener);
  }

  const entityItems: ActionMenuItem[] = [];
  if (menuTarget && menuEntity && menuProvider && entityMenu.state) {
    const state = entityMenu.state;
    const kind = menuTarget.kind === "provider" ? "供应商" : "连接";
    if (menuConnection) entityItems.push({ id: "edit", label: "编辑", icon: <Pencil size={15} />,
      accessibleLabel: `编辑连接 ${menuConnection.name}`, disabled: isStreaming,
      onSelect: () => { if (!isStreaming) selectConnection(menuProvider.id, menuConnection.id); } });
    if (!menuConnection && onProviderAvatarChange) {
      entityItems.push({ id: "avatar", label: "选择头像", disabled: isStreaming || avatarSaving,
        onSelect: () => { if (!isStreaming && !avatarSaving) { setAvatarError(undefined); setAvatarProviderId(menuProvider.id); } } });
      entityItems.push({ id: "reset-avatar", label: "恢复默认头像", disabled: isStreaming || avatarSaving || !menuProvider.avatar,
        onSelect: () => { void applyProviderAvatar(menuProvider.id, undefined); } });
    }
    entityItems.push({ id: "rename", label: "重命名", icon: <Pencil size={15} />, disabled: isStreaming,
      onSelect: () => {
        if (!isStreaming) entityMenu.open({ ...menuTarget, renaming: true }, state.opener, { x: state.left, y: state.top });
      } });
    {
      const items = menuConnection ? menuProvider.connections : connectionSettings.providers;
      const index = items.findIndex((item) => item.id === menuTarget.id);
      for (const direction of [-1, 1] as const) {
        const adjacent = items[index + direction];
        const label = direction === -1 ? "上移" : "下移";
        entityItems.push({ id: direction === -1 ? "move-up" : "move-down", label,
          accessibleLabel: `${label}${kind} ${menuEntity.name}`,
          icon: direction === -1 ? <ArrowUp size={15} /> : <ArrowDown size={15} />,
          disabled: isStreaming || !adjacent,
          onSelect: () => {
            if (isStreaming || !adjacent) return;
            const move = menuConnection ? onConnectionMove : onProviderMove;
            move(menuEntity.id, adjacent.id, direction === -1 ? "before" : "after");
          } });
      }
    }
    entityItems.push({ id: "delete", label: "删除", icon: <Trash2 size={14} />,
      accessibleLabel: `删除${kind} ${menuEntity.name}`, disabled: isStreaming, danger: true, separatorBefore: true,
      onSelect: () => { void (menuConnection ? handleDeleteConnection(menuProvider, menuConnection) : handleDeleteProvider(menuProvider)); } });
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

  async function handleDeleteModel(model: ConfiguredModel): Promise<void> {
    if (!selectedConnection || isStreaming) return;
    const scope = currentScope.current;
    if (await confirm({ title: "删除模型", message: `${model.id === connectionSettings.activeModelId ? "这是助手默认模型。" : ""}确定从“${selectedConnection.name}”删除 ${model.modelId}？`, confirmLabel: "删除", danger: true })
      && scopeIsCurrent(scope) && !currentScope.current.isStreaming
      && currentScope.current.connectionSettings.activeModelId === connectionSettings.activeModelId
      && currentConnection(selectedConnection.id)?.models.includes(model)) {
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

  async function beginModelEdit(modelId: string): Promise<void> {
    if (isStreaming || modelId !== editingModelId && !await confirmDiscardModelEdit()
      || currentScope.current.isStreaming || !selectedConnection
      || !currentConnection(selectedConnection.id)?.models.some(model => model.id === modelId)) return;
    setEditingModelId(modelId);
  }

  async function toggleModelCreation(): Promise<void> {
    if (isStreaming || !isAddingModel && !await confirmDiscardModelEdit() || currentScope.current.isStreaming) return;
    if (!isAddingModel) setEditingModelId(null);
    setIsAddingModel((current) => !current);
  }

  async function handleRunModelTest(model: ConfiguredModel): Promise<void> {
    if (!selectedConnection || isStreaming || isDrawingProtocol(selectedConnection.protocol)
      || modelTests[model.id]?.status === "running" || modelTestLock.current.has(model.id)) return;
    const scope = currentScope.current;
    modelTestLock.current.add(model.id);
    try {
      if (!await confirm({ title: "测试模型", message: `测试 ${model.modelId} 会发送一条极短请求，可能产生少量 Token 和中转站费用。是否继续？`, confirmLabel: "发送测试请求" })
        || !scopeIsCurrent(scope) || currentScope.current.isStreaming
        || currentScope.current.modelTests[model.id]?.status === "running"
        || currentConnection(selectedConnection.id) !== selectedConnection
        || !selectedConnection.models.includes(model)) return;
      await onRunModelTest(selectedConnection.id, model.id);
    } finally {
      modelTestLock.current.delete(model.id);
    }
  }

  async function openAndRefreshCatalog(): Promise<void> {
    if (!selectedConnection || isStreaming || selectedConnection.protocol === "seedream-images" || catalogOptions?.manualCatalog) return;
    setCatalogOpen(true);
    await onRefreshModelCatalog(selectedConnection.id);
  }

  function renderModelRow(model: ConfiguredModel) {
    const drawing = isDrawingProtocol(selectedConnection?.protocol);
    const current = !drawing && model.id === connectionSettings.activeModelId;
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
            {!drawing && <button type="button" className="icon-button" aria-label={`设为助手默认模型 ${model.modelId}`} title="设为助手默认模型（用于新建对话）" disabled={isStreaming || current || !canSelectModel} onClick={() => onSelectModel(model.id)}>
              {current ? <Check size={15} /> : <Square size={14} />}
            </button>}
            {!drawing && <button type="button" className="icon-button" aria-label={`${test?.status === "running" ? "取消测试" : "测试模型"} ${model.modelId}`} title={test?.status === "running" ? "取消测试" : "测试模型"} disabled={isStreaming} onClick={() => test?.status === "running" ? onCancelModelTest(model.id) : void handleRunModelTest(model)}>
              {test?.status === "running" ? <X size={15} /> : <Gauge size={15} />}
            </button>}
            <button type="button" className="icon-button" aria-label={`编辑模型 ${model.modelId}`} title="编辑模型" disabled={isStreaming} onClick={() => beginModelEdit(model.id)}><Pencil size={14} /></button>
            <button type="button" className="icon-button danger-icon-button" aria-label={`删除模型 ${model.modelId}`} title="删除模型" disabled={isStreaming} onClick={() => handleDeleteModel(model)}><Trash2 size={14} /></button>
          </div>
        </>}
      </div>
    );
  }

  const batchConnections = batchDelete?.kind === "providers"
    ? batchDelete.targets.flatMap(provider => provider.connections) : batchDelete?.targets ?? [];
  const batchModelCount = batchConnections.reduce((total, connection) => total + connection.models.length, 0);
  const batchEmpty = batchDelete?.kind === "providers" ? batchConnections.length === 0 : batchModelCount === 0;
  const batchAction = batchDelete ? `删除 ${batchDelete.targets.length} ${batchDelete.kind === "providers" ? "个供应商" : "条连接"}` : "";
  const batchImpact = batchDelete?.kind === "providers"
    ? batchEmpty ? "所选供应商均无连接。" : `同时删除 ${batchConnections.length} 条连接、${batchModelCount} 个配置模型。`
    : batchEmpty ? "所选连接均无配置模型。" : `同时删除 ${batchModelCount} 个配置模型。`;
  const connectionManagementButton = selectedProvider && onDeleteConnections && <button ref={connectionManagementEntryRef} type="button" className="batch-manage-trigger connection-manage-trigger"
    disabled={isStreaming} onClick={() => void enterManagement("connections")}><ListChecks size={15} aria-hidden="true" /><span>管理连接</span></button>;
  const finishManagement = () => { setManagement(null); setSelectedIds(new Set()); setBatchDelete(null); };
  const managedProviders = connectionSettings.providers.filter(provider => selectedIds.has(provider.id));

  return (
    <section
      className="settings-page settings-workspace-page connection-settings-page"
      aria-labelledby="connection-title"
    >
      <div className="settings-page-heading connection-settings-heading">
          <h2 id="connection-title">连接配置</h2>
          <p className="muted-text">配置模型服务，管理可用的连接与模型。</p>
      </div>
        <div className="connection-settings-workbench">
          <nav className="connection-tree" aria-label="供应商列表" onClickCapture={treeDrag.suppressClick}
            data-managing={management || undefined}
            data-sorting={treeDrag.drag ? "true" : undefined}>
            <span className="sr-only" role="status" aria-live="polite">{treeDrag.announcement}</span>
            <div className="connection-tree-heading">
              <h3>供应商</h3>
              {management === "providers" && <button ref={managementCompletionRef} type="button" className="batch-manage-trigger" data-active onClick={finishManagement}>
                <Check size={15} aria-hidden="true" /><span>完成管理</span></button>}
              <div className="provider-heading-actions" hidden={management !== null}>
                {onDeleteProviders && <button ref={providerManagementEntryRef} type="button" className="batch-manage-trigger" disabled={isStreaming}
                  onClick={() => void enterManagement("providers")}><ListChecks size={15} aria-hidden="true" /><span>管理供应商</span></button>}
                <button ref={providerCreateButtonRef} type="button" className="icon-button" aria-label="添加供应商" title="添加供应商" disabled={isStreaming}
                  onClick={() => { if (!isStreaming) { entityMenu.close(); setIsAddingProvider(true); setProviderDraftError(undefined); if (providerCreateRef.current) providerCreateRef.current.open = false; providerDraftRef.current?.focus(); } }}><Plus size={18} /></button>
                <details ref={providerCreateRef} className="provider-create-menu" onToggle={(event) => { if (event.currentTarget.open) entityMenu.close(); }}
                  onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.currentTarget.open = false; event.currentTarget.querySelector<HTMLElement>("summary")?.focus(); } }}>
                  <summary className="icon-button" aria-label="管理内置供应商" title="管理内置供应商"><MoreHorizontal size={18} /></summary>
                  <div className="provider-template-menu" aria-label="内置供应商">
                    {providerTemplates.filter(template => template.id !== "custom").map((template) => {
                      const exists = connectionSettings.providers.some(provider => provider.presetId === template.id);
                      return <button key={template.id} type="button" disabled={isStreaming || exists} aria-label={`${exists ? "已添加" : "添加"} ${template.label}`}
                        onClick={(event) => { handleCreateProvider(template.id); event.currentTarget.closest("details")?.removeAttribute("open"); }}>
                        {template.id !== "custom" && <BrandAvatar id={template.id} />}{template.label}{exists && <Check size={14} aria-hidden="true" />}
                      </button>;
                    })}
                  </div>
                </details>
              </div>
            </div>
            {isAddingProvider && <form className="provider-inline-create" onSubmit={(event) => {
              event.preventDefault(); if (isStreaming) return;
              const name = String(new FormData(event.currentTarget).get("providerName") ?? "").trim();
              if (!name) { setProviderDraftError("请输入供应商名称。"); providerDraftRef.current?.focus(); return; }
              handleCreateProvider("custom", name);
            }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelProviderDraft(); } }}>
              <input ref={providerDraftRef} name="providerName" className="compact-field" aria-label="新供应商名称" placeholder="输入供应商名称" required disabled={isStreaming} />
              <button type="submit" className="icon-button" aria-label="保存新供应商" disabled={isStreaming}><Check size={16} /></button>
              <button type="button" className="icon-button" aria-label="取消新供应商" onClick={cancelProviderDraft}><X size={16} /></button>
              {providerDraftError && <p className="inline-error" role="alert">{providerDraftError}</p>}
            </form>}
            {management === "providers" && <BatchManagementBar label="供应商" total={connectionSettings.providers.length}
              selected={connectionSettings.providers.filter(provider => selectedIds.has(provider.id)).length} disabled={isStreaming}
              onSelectAll={checked => setSelectedIds(new Set(checked ? connectionSettings.providers.map(provider => provider.id) : []))}
              onDelete={openBatchDelete} />}
            {connectionSettings.providers.length === 0 && (
              <div className="pane-empty-state connection-tree-empty">
                <span>还没有供应商，点击右上角加号添加。</span>
              </div>
            )}
            {connectionSettings.providers.map((provider) => {
              const expanded = !collapsedProviders.has(provider.id);
              const providerDrag = treeDrag.drag?.item.kind === "provider" ? treeDrag.drag : null;
              return <section key={provider.id} className="connection-tree-group" data-sort-provider={provider.id}
                data-dragging={providerDrag?.item.id === provider.id || undefined}
                data-drop={providerDrag?.drop?.id === provider.id ? providerDrag.drop.placement : undefined}>
                <div className="connection-tree-row connection-provider-row"
                  onContextMenu={(event) => openRowMenu(event, { kind: "provider", id: provider.id }, providerRowRefs.current.get(provider.id))}
                  onKeyDown={(event) => openKeyboardMenu(event, { kind: "provider", id: provider.id })}>
                  {management === "providers" ? <label className="connection-provider-select" data-selected={selectedIds.has(provider.id) || undefined}>
                    <input className="ui-checkbox" type="checkbox"
                    aria-label={`选择供应商 ${provider.name}`} checked={selectedIds.has(provider.id)} disabled={isStreaming}
                    onChange={event => toggleBatchItem(provider.id, event.target.checked)} />
                    <ProviderAvatar provider={provider} className="provider-tree-avatar" /><span title={provider.name}>{provider.name}</span><small>{provider.connections.length} 条连接</small>
                  </label> : <>
                  <button type="button" className="provider-drag-handle" disabled={isStreaming}
                    aria-label={`拖动排序 ${provider.name}`} title="拖动排序，也可在菜单中上移或下移"
                    onPointerDown={(event) => treeDrag.begin(event, { kind: "provider", id: provider.id }, provider.name)}>
                    <GripVertical size={14} aria-hidden="true" />
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
                    title="单击查看供应商，按住移动可拖动排序"
                    ref={(element) => { if (element) providerRowRefs.current.set(provider.id, element); else providerRowRefs.current.delete(provider.id); }}
                    aria-current={selectedProviderId === provider.id && !selectedConnectionId ? "true" : undefined}
                    onPointerDown={(event) => treeDrag.begin(event, { kind: "provider", id: provider.id }, provider.name)}
                    onDragStart={(event) => event.preventDefault()}
                    onClick={() => { void selectProvider(provider.id); }}>
                    <ProviderAvatar provider={provider} className="provider-tree-avatar" /><span title={provider.name}>{provider.name}</span><small>{provider.connections.length}</small>
                  </button>
                  <EntityActions kind="供应商" name={provider.name} disabled={isStreaming}
                    open={menuTarget?.kind === "provider" && menuTarget.id === provider.id}
                    onOpen={(opener) => toggleEntityMenu({ kind: "provider", id: provider.id }, opener)} /></>}
                </div>
                <div id={`provider-connections-${provider.id}`} className="connection-tree-children" hidden={!expanded || management !== null}
                  role="group" aria-label={`${provider.name}的连接渠道列表`}>
                  {provider.connections.map((connection) => {
                    const connectionDrag = treeDrag.drag?.item.kind === "connection" ? treeDrag.drag : null;
                    return <div className="connection-tree-connection" key={connection.id}
                      data-sort-connection={connection.id} data-sort-scope={provider.id}
                      data-dragging={connectionDrag?.item.id === connection.id || undefined}
                      data-drop={connectionDrag?.drop?.id === connection.id ? connectionDrag.drop.placement : undefined}>
                      <div className="connection-tree-row"
                        onContextMenu={(event) => openRowMenu(event, { kind: "connection", providerId: provider.id, id: connection.id }, connectionRowRefs.current.get(connection.id))}
                        onKeyDown={(event) => openKeyboardMenu(event, { kind: "connection", providerId: provider.id, id: connection.id })}>
                        <button type="button" className="provider-drag-handle connection-drag-handle" disabled={isStreaming}
                          aria-label={`拖动排序连接 ${connection.name}`} title="在当前供应商内拖动排序，也可在菜单中上移或下移"
                          onPointerDown={(event) => treeDrag.begin(event, { kind: "connection", id: connection.id, providerId: provider.id }, connection.name)}>
                          <GripVertical size={14} aria-hidden="true" />
                        </button>
                        <button type="button" className="connection-tree-link" aria-label={`查看连接 ${connection.name}`}
                          title="单击查看连接，按住移动可在当前供应商内拖动排序"
                          aria-current={selectedConnectionId === connection.id ? "true" : undefined}
                          ref={(element) => { if (element) connectionRowRefs.current.set(connection.id, element); else connectionRowRefs.current.delete(connection.id); }}
                          onPointerDown={(event) => treeDrag.begin(event, { kind: "connection", id: connection.id, providerId: provider.id }, connection.name)}
                          onDragStart={(event) => event.preventDefault()}
                          onClick={() => selectConnection(provider.id, connection.id)}>
                          <span title={connection.name}>{connection.name}</span>
                        </button>
                        <EntityActions kind="连接" name={connection.name} disabled={isStreaming}
                          open={menuTarget?.kind === "connection" && menuTarget.id === connection.id}
                          onOpen={(opener) => toggleEntityMenu({ kind: "connection", providerId: provider.id, id: connection.id }, opener)} />
                      </div>
                    </div>;
                  })}
                  <button className="connection-tree-add" type="button" disabled={isStreaming}
                    aria-label={`为 ${provider.name} 添加连接`} onClick={async () => {
                      if (await selectProvider(provider.id) && !currentScope.current.isStreaming) setIsAddingConnection(true);
                    }}><Plus size={14} />添加连接</button>
                </div>
              </section>;
            })}
          </nav>
          <section className="connection-detail" aria-label="连接详情">
            {management ? <section className="connection-batch-panel" aria-label={management === "providers" ? "供应商批量管理" : "连接批量管理"}>
              <header className="connection-batch-heading"><h3>{management === "providers" ? "所选供应商" : `${selectedProvider?.name ?? "当前供应商"}的连接`}</h3>
                {management === "connections" && <button ref={managementCompletionRef} type="button" className="batch-manage-trigger" data-active onClick={finishManagement}>
                  <Check size={15} aria-hidden="true" /><span>完成管理</span></button>}
              </header>
              {management === "providers" ? <>
                <p className="muted-text connection-batch-hint">{managedProviders.length ? "删除供应商时，其连接和配置模型会一并移除。" : "在供应商列表中勾选要管理的项目。"}</p>
                <ul className="connection-batch-summary">{managedProviders.map(provider => <li key={provider.id}>
                  <ProviderAvatar provider={provider} className="provider-tree-avatar" /><span title={provider.name}>{provider.name}</span>
                  <small>{provider.connections.length} 条连接 · {provider.connections.reduce((total, connection) => total + connection.models.length, 0)} 个模型</small>
                </li>)}</ul>
              </>
                : selectedProvider && <>
                  <BatchManagementBar label={`${selectedProvider.name}的连接`} total={selectedProvider.connections.length}
                    selected={selectedProvider.connections.filter(connection => selectedIds.has(connection.id)).length} disabled={isStreaming}
                    onSelectAll={checked => setSelectedIds(new Set(checked ? selectedProvider.connections.map(connection => connection.id) : []))}
                    onDelete={openBatchDelete} />
                  <ul className="connection-batch-list">
                    {selectedProvider.connections.map(connection => <li key={connection.id}>
                      <label data-selected={selectedIds.has(connection.id) || undefined}><input type="checkbox" className="ui-checkbox" aria-label={`选择连接 ${connection.name}`}
                        checked={selectedIds.has(connection.id)} disabled={isStreaming}
                        onChange={event => toggleBatchItem(connection.id, event.target.checked)} />
                        <span><strong title={connection.name}>{connection.name}</strong><small>{getProtocolOption(connection.protocol).label}</small></span>
                        <small className="connection-batch-model-count">{connection.models.length} 个模型</small>
                      </label>
                    </li>)}
                  </ul>
                  {!selectedProvider.connections.length && <p className="muted-text">此供应商还没有连接。</p>}
                </>}
            </section> : <>
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
                  <ConnectionCreateOptions key={selectedProvider.id} provider={selectedProvider} disabled={isStreaming} />
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
                isDrawingProtocol(connection.protocol) ? connection.models[0]?.modelId :
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
                  {connectionManagementButton}
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
                        <SelectField id="connection-protocol" label="协议类型" value={connection.protocol} disabled={isStreaming}
                          options={protocolOptions.map(({ value, label }) => ({ value, label }))}
                          onChange={(value) => void handleProtocolChange(value as ServiceProtocol)} />
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
                        {preview.editEndpoint && <p><strong>参考图编辑端点</strong><code>{preview.editEndpoint}</code></p>}
                      </div>
                    </details>
                    </div>
                    <div className="connection-field-group">
                    <div className="settings-label-help"><label className="field-label" htmlFor="api-key">API Key</label><SettingsHelp label="API Key">密钥以明文保存在本机，请仅使用可信服务的密钥。</SettingsHelp></div>
                    <ApiKeyInput value={connection.apiKey} disabled={isStreaming}
                      onChange={(value) => onConnectionChange(connection.id, "apiKey", value)} />
                    </div>
                    {onResetConnection && getConnectionTemplate(selectedProvider.presetId, connection.presetProtocol) && <button type="button"
                      className="settings-button connection-reset-default" disabled={isStreaming} onClick={() => resetConnection(connection)}>恢复内置默认值</button>}
                  </div>
                </details>
                <section className="connection-models" aria-label="模型管理">
                  <header className="connection-model-heading"><h3>模型管理</h3><span className="count-badge">{connection.models.length}</span><SettingsHelp label="模型管理">{isDrawingProtocol(connection.protocol) ? "绘图模型仅用于绘图页，请生成图片验证；不会设为助手默认模型。" : canSelectModel
                    ? "选择模型用于助手的新对话。已有对话可在聊天顶部或对话设置中更换。"
                    : "请先加载或选择助手，再设置默认模型。"}</SettingsHelp>
                  {onModelGroupCommand && <button type="button" className="settings-button model-group-management-toggle"
                    aria-expanded={groupManagementConnectionId === connection.id}
                    disabled={groupManagementConnectionId !== connection.id && (isStreaming || catalog.status === "loading")}
                    onClick={async () => {
                      if (groupManagementConnectionId === connection.id) { setGroupManagementConnectionId(null); return; }
                      const scope = currentScope.current;
                      if (scope.isStreaming || scope.modelCatalogs[connection.id]?.status === "loading"
                        || !await confirmDiscardModelEdit() || !scopeIsCurrent(scope)
                        || currentScope.current.isStreaming || currentScope.current.modelCatalogs[connection.id]?.status === "loading") return;
                      setEditingModelId(null);
                      setGroupManagementConnectionId(connection.id);
                    }}>{groupManagementConnectionId === connection.id ? "完成分组" : "管理分组"}</button>}
                </header>
                {isDrawingProtocol(connection.protocol) && <p className="muted-text">绘图模型仅用于绘图页，请生成图片验证。</p>}
                <div className="model-toolbar">
                  <label className="search-field">
                    <Search size={15} />
                    <span className="sr-only">搜索已添加模型</span>
                    <input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="搜索模型 ID、名称或分组" />
                  </label>
                <div className="connection-model-actions">
                  <button
                    ref={catalogTriggerRef}
                    type="button"
                    className="settings-button"
                    disabled={isStreaming || groupManagementConnectionId === connection.id || connection.protocol === "seedream-images" || catalogOptions?.manualCatalog}
                    aria-describedby={connection.protocol === "seedream-images" ? "seedream-catalog-hint" : catalogOptions?.catalogHint ? "preset-catalog-hint" : undefined}
                    onClick={() => void openAndRefreshCatalog()}
                  >
                    <RefreshCw size={15} />
                    获取模型列表
                  </button>
                  <button
                    type="button"
                    className="settings-button connection-add-model"
                    aria-label="手动添加模型"
                    disabled={isStreaming || groupManagementConnectionId === connection.id}
                    onClick={toggleModelCreation}
                  >
                    <Plus size={16} />手动添加
                  </button>
                </div>
                </div>
                {connection.protocol === "seedream-images" && <p id="seedream-catalog-hint" className="muted-text">Seedream 绘图未提供模型目录，请手动添加模型 ID。</p>}
                {connection.protocol !== "seedream-images" && catalogOptions?.catalogHint && <p id="preset-catalog-hint" className="muted-text">{catalogOptions.catalogHint}</p>}
                {groupManagementConnectionId === connection.id && onModelGroupCommand ? <ModelGroupManagement
                  key={connection.id} connection={connection} search={modelSearch}
                  disabled={isStreaming || catalog.status === "loading"} onCommand={onModelGroupCommand} /> : <div className="model-list" aria-label="模型列表">
                  {groupedModels.length ? (
                    groupedModels.map((group) => (
                      <section key={group.key} className="model-group">
                        <header>
                          <strong>{group.label}</strong>
                          <span>{group.models.length}</span>
                        </header>
                        {group.models.map(renderModelRow)}
                        {!group.models.length && <p className="model-group-empty muted-text">此分组暂无模型</p>}
                      </section>
                    ))
                  ) : (
                    <div className="pane-empty-state">
                      <strong>{selectedConnection.models.length ? "没有匹配的模型" : "还没有模型"}</strong>
                      <span>手动添加模型 ID，或从远端目录中选择。</span>
                    </div>
                  )}
                </div>}
                </section>
              </div>;
            })() : selectedProvider && !isAddingConnection ? (
              <div className="connection-provider-detail">
                <header className="provider-overview-heading">
                <div className="provider-overview-identity"><ProviderAvatar provider={selectedProvider} /><h3>{selectedProvider.name}</h3>
                  <EntityActions kind="供应商" name={selectedProvider.name} disabled={isStreaming}
                    open={menuTarget?.kind === "provider" && menuTarget.id === selectedProvider.id}
                    onOpen={(opener) => toggleEntityMenu({ kind: "provider", id: selectedProvider.id }, opener)} /></div>
                <div className="provider-overview-actions">{connectionManagementButton}
                  <button ref={providerAddConnectionRef} className="settings-button settings-button-primary" type="button" disabled={isStreaming}
                    onClick={() => setIsAddingConnection(true)}><Plus size={15} />添加连接</button></div>
                </header>
                <p className="muted-text">管理此供应商下的连接渠道。连接独立拥有协议、地址、密钥和模型。</p>
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
                      <li key={connection.id} className="provider-connection-row"
                        onContextMenu={(event) => openRowMenu(event, { kind: "connection", providerId: selectedProvider.id, id: connection.id }, overviewRowRefs.current.get(connection.id))}
                        onKeyDown={(event) => openKeyboardMenu(event, { kind: "connection", providerId: selectedProvider.id, id: connection.id })}>
                        <button className="provider-connection-link" type="button"
                          ref={(element) => { if (element) overviewRowRefs.current.set(connection.id, element); else overviewRowRefs.current.delete(connection.id); }}
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
            </>}
          </section>
        </div>
      {confirmationDialog}
      {batchDelete && <BatchDeleteDialog title={`${batchAction}？`}
        names={batchDelete.targets.map(target => target.name)} confirmLabel={batchAction} busy={isStreaming}
        blockedReason={batchBlockedReason(batchDelete)}
        impact={batchImpact}
        warning={batchEmpty ? "此操作无法撤销。" : "此操作无法撤销。聊天历史和绘图成果会保留；受影响的模型需重新选择。"}
        returnFocus={() => managementRef.current ? managementCompletionRef.current : null}
        onConfirm={() => submitBatchDelete(batchDelete)} onCancel={() => setBatchDelete(null)} />}
      {batchStatus && <div role="status" className="batch-result-notice">{batchStatus}</div>}
      {avatarError && !avatarProvider && <p className="inline-error" role="alert">{avatarError}</p>}
      {avatarProvider && <AvatarModal title={`为 ${avatarProvider.name} 选择头像`} busy={avatarSaving || avatarPanelBusy || isStreaming}
        onClose={() => { if (!avatarLock.current && !avatarPanelBusy) { setAvatarProviderId(undefined); setAvatarError(undefined); } }}>
        {avatarError && <p className="inline-error" role="alert">{avatarError}</p>}
        <div inert={avatarSaving || isStreaming}>
          <AvatarLibraryPanel inline assistantName={avatarProvider.name} assistantId={avatarProvider.id}
            automaticChoice={{ label: "默认头像", preview: <ProviderAvatar provider={{ ...avatarProvider, avatar: undefined }} />, isCurrent: !avatarProvider.avatar }}
            onBuiltinApply={(id) => { void applyProviderAvatar(avatarProvider.id, { kind: "builtin", id }); }}
            onApply={(image) => { void applyProviderAvatar(avatarProvider.id, image); }}
            onBusyChange={setAvatarPanelBusy} onClose={() => { if (!avatarLock.current) setAvatarProviderId(undefined); }} />
        </div>
      </AvatarModal>}
      {entityMenu.state && menuTarget && menuEntity && <ActionMenu state={entityMenu.state}
        label={`${menuEntity.name}的管理菜单`} role={menuTarget.renaming ? "dialog" : "menu"}
        items={menuTarget.renaming ? [] : entityItems} onClose={entityMenu.close}
        note={isStreaming ? "生成期间无法修改连接配置。" : undefined}>
        {menuTarget.renaming && <form className="connection-rename-form" onSubmit={(event) => {
          event.preventDefault();
          if (isStreaming) return;
          const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
          if (name && name !== menuEntity.name) {
            if (menuTarget.kind === "provider") onProviderRename(menuTarget.id, name);
            else onConnectionChange(menuTarget.id, "name", name);
          }
          entityMenu.close(true);
        }}>
          <label className="field-label">重命名{menuTarget.kind === "provider" ? "供应商" : "连接"}
            <input name="name" className="compact-field" defaultValue={menuEntity.name} required disabled={isStreaming} />
          </label>
          <div className="connection-rename-footer">
            <button type="button" className="settings-button" onClick={() => entityMenu.close(true)}>取消</button>
            <button type="submit" className="settings-button" disabled={isStreaming}>完成</button>
          </div>
        </form>}
      </ActionMenu>}
      {isAddingModel && selectedConnection && <AddModelDialog disabled={isStreaming} error={formError} onSubmit={handleAddModel}
        onClose={() => { setIsAddingModel(false); setFormError(undefined); }} />}
      {catalogOpen && selectedConnection && selectedConnection.protocol !== "seedream-images" ? (
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
                  disabled={isStreaming}
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
                        <div key={model.id} className="catalog-model-row" data-added={added}>
                          <div className="catalog-model-copy">
                            <strong>{model.displayName || model.id}</strong>
                            {model.displayName ? <small>{model.id}</small> : null}
                          </div>
                          <button
                            type="button"
                            className="settings-button catalog-model-add"
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
                            <span>{added ? "已添加" : "添加"}</span>
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
