import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Search, X } from "lucide-react";
import { groupConfiguredModels } from "../../chat/modelGrouping";
import { getProtocolOption } from "../../chat/protocolOptions";
import { isChatConnection, type ConnectionProfile, type ConnectionSettingsState, type ProviderGroup } from "../../chat/settings";
import { ProviderAvatar } from "../avatar/ProviderAvatar";
import "./ModelPicker.css";

export interface ModelPickerProps {
  settings: ConnectionSettingsState;
  selectedModelId: string | null;
  disabled: boolean;
  error?: string;
  hint?: string;
  allowEmpty?: boolean;
  onSelect(modelId: string): Promise<boolean>;
  onClose(): void;
}

interface PickerModelItem {
  id: string;
  primaryLabel: string;
  secondaryId?: string;
  title: string;
  searchText: string;
  providerId: string;
}

interface PickerGroupNode {
  key: string;
  label: string;
  isCustom: boolean;
  models: PickerModelItem[];
}

interface PickerConnectionNode {
  id: string;
  name: string;
  protocolLabel: string;
  showProtocolBadge: boolean;
  groups: PickerGroupNode[];
}

interface PickerProviderNode {
  provider: ProviderGroup;
  totalCount: number;
  connections: PickerConnectionNode[];
}

function normalizeComparison(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function buildConnectionTitle(connection: ConnectionProfile, protocolLabel: string): { name: string; showProtocolBadge: boolean } {
  const trimmedName = connection.name.trim();
  if (!trimmedName) {
    return { name: protocolLabel, showProtocolBadge: false };
  }
  const sameAsProtocol = normalizeComparison(trimmedName) === normalizeComparison(protocolLabel);
  return { name: trimmedName, showProtocolBadge: !sameAsProtocol };
}

function buildModelHierarchy(settings: ConnectionSettingsState): {
  providers: PickerProviderNode[];
  allModelIds: Set<string>;
  optionIndexById: Map<string, number>;
} {
  const providers: PickerProviderNode[] = [];
  const allModelIds = new Set<string>();
  const optionIndexById = new Map<string, number>();

  for (const provider of settings.providers) {
    const connections: PickerConnectionNode[] = [];
    let totalCount = 0;

    for (const connection of provider.connections) {
      if (!isChatConnection(connection)) continue;
      const protocolLabel = getProtocolOption(connection.protocol).label;
      const { name: connectionLabel, showProtocolBadge } = buildConnectionTitle(connection, protocolLabel);
      const groups: PickerGroupNode[] = [];

      for (const group of groupConfiguredModels(connection.models, connection.modelGroups)) {
        if (group.models.length === 0) continue;
        const isCustom = group.groupId !== null;
        const items: PickerModelItem[] = group.models.map((model) => {
          const primaryLabel = model.displayName?.trim() || model.modelId;
          const secondaryId = primaryLabel !== model.modelId ? model.modelId : undefined;
          const connectionText = showProtocolBadge ? `${connectionLabel} (${protocolLabel})` : connectionLabel;
          const groupText = isCustom ? `${group.label}（自定义）` : group.label;
          const modelText = secondaryId ? `${primaryLabel} (${secondaryId})` : primaryLabel;
          const title = `${provider.name} / ${connectionText} · ${groupText} · ${modelText}`;
          const searchText = [
            provider.name,
            connection.name,
            protocolLabel,
            group.label,
            isCustom ? "自定义" : "",
            model.displayName ?? "",
            model.modelId,
          ]
            .join(" ")
            .toLocaleLowerCase();

          allModelIds.add(model.id);
          if (!optionIndexById.has(model.id)) {
            optionIndexById.set(model.id, optionIndexById.size);
          }

          return {
            id: model.id,
            primaryLabel,
            secondaryId,
            title,
            searchText,
            providerId: provider.id,
          };
        });

        totalCount += items.length;
        groups.push({ key: group.key, label: group.label, isCustom, models: items });
      }

      if (groups.length > 0) {
        connections.push({
          id: connection.id,
          name: connectionLabel,
          protocolLabel,
          showProtocolBadge,
          groups,
        });
      }
    }

    if (connections.length > 0) {
      providers.push({ provider, totalCount, connections });
    }
  }

  return { providers, allModelIds, optionIndexById };
}

function filterHierarchy(providers: readonly PickerProviderNode[], tokens: readonly string[]): {
  filtered: PickerProviderNode[];
  matchCount: number;
} {
  if (tokens.length === 0) {
    const matchCount = providers.reduce((sum, item) => sum + item.totalCount, 0);
    return { filtered: [...providers], matchCount };
  }

  const filtered: PickerProviderNode[] = [];
  let matchCount = 0;

  for (const providerNode of providers) {
    const connections: PickerConnectionNode[] = [];
    let providerMatches = 0;

    for (const connectionNode of providerNode.connections) {
      const groups: PickerGroupNode[] = [];

      for (const groupNode of connectionNode.groups) {
        const models = groupNode.models.filter((item) => tokens.every((token) => item.searchText.includes(token)));
        if (models.length > 0) {
          providerMatches += models.length;
          groups.push({ ...groupNode, models });
        }
      }

      if (groups.length > 0) {
        connections.push({ ...connectionNode, groups });
      }
    }

    if (connections.length > 0) {
      matchCount += providerMatches;
      filtered.push({ ...providerNode, totalCount: providerMatches, connections });
    }
  }

  return { filtered, matchCount };
}

function getTabbableControls(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>("input:not(:disabled), button:not(:disabled)")].filter(
    (element) => !element.closest("[hidden]") && !element.matches(":disabled") && element.tabIndex >= 0,
  );
}

export function ModelPicker({
  settings,
  selectedModelId,
  disabled,
  error,
  hint = "仅当前对话 · 自动保存，下次请求生效",
  allowEmpty = false,
  onSelect,
  onClose,
}: ModelPickerProps) {
  const titleId = useId();
  const listboxId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef(document.activeElement as HTMLElement | null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const initialScrollDoneRef = useRef(false);

  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [activeOptionId, setActiveOptionId] = useState<string | null>(null);
  const [comboboxFocused, setComboboxFocused] = useState(false);
  const [failure, setFailure] = useState("");

  const { providers, allModelIds, optionIndexById } = useMemo(() => buildModelHierarchy(settings), [settings]);
  const totalChatModels = allModelIds.size;
  const showProviderPills = providers.length >= 2;
  const effectiveProviderId =
    showProviderPills && selectedProviderId && providers.some((item) => item.provider.id === selectedProviderId)
      ? selectedProviderId
      : null;

  useEffect(() => {
    if (selectedProviderId !== null && (!showProviderPills || !providers.some((item) => item.provider.id === selectedProviderId))) {
      setSelectedProviderId(null);
    }
  }, [providers, selectedProviderId, showProviderPills]);

  const tokens = useMemo(() => query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean), [query]);

  const { filtered: allMatchingProviders, matchCount: totalMatchCount } = useMemo(
    () => filterHierarchy(providers, tokens),
    [providers, tokens],
  );

  const visibleProviders = useMemo(
    () => (effectiveProviderId ? allMatchingProviders.filter((item) => item.provider.id === effectiveProviderId) : allMatchingProviders),
    [allMatchingProviders, effectiveProviderId],
  );

  const visibleModels = useMemo(
    () =>
      visibleProviders.flatMap((providerNode) =>
        providerNode.connections.flatMap((connectionNode) => connectionNode.groups.flatMap((groupNode) => groupNode.models)),
      ),
    [visibleProviders],
  );

  const otherProviderMatchCount = effectiveProviderId ? Math.max(0, totalMatchCount - visibleModels.length) : 0;
  const invalidSelection = Boolean(selectedModelId && !allModelIds.has(selectedModelId));
  const locked = disabled || saving;
  const normalizedSelected = selectedModelId ?? "";

  const resolvedActiveId = useMemo(() => {
    if (activeOptionId && visibleModels.some((item) => item.id === activeOptionId)) {
      return activeOptionId;
    }
    if (tokens.length > 0 && visibleModels.length > 0) {
      return visibleModels[0].id;
    }
    return null;
  }, [activeOptionId, tokens.length, visibleModels]);

  const activeDomId = resolvedActiveId !== null ? `${listboxId}-opt-${optionIndexById.get(resolvedActiveId)}` : undefined;

  useEffect(() => {
    mountedRef.current = true;
    const backdrop = panelRef.current?.parentElement;
    const siblings = Array.from(backdrop?.parentElement?.children ?? []).filter(
      (element): element is HTMLElement => element !== backdrop && element instanceof HTMLElement,
    );
    const previousInert = siblings.map((element) => element.inert);
    siblings.forEach((element) => {
      element.inert = true;
    });
    searchInputRef.current?.focus();

    function handleWindowKeyDown(event: KeyboardEvent) {
      if (event.isComposing || event.keyCode === 229) {
        if (event.key === "Escape") {
          event.stopPropagation();
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!pendingRef.current) onCloseRef.current();
        return;
      }
      if (event.key === "Tab") {
        const panel = panelRef.current;
        if (!panel) return;
        const active = document.activeElement as HTMLElement | null;
        if (active && panel.contains(active)) return;
        const items = getTabbableControls(panel);
        if (!items.length) return;
        event.preventDefault();
        event.stopPropagation();
        (event.shiftKey ? items[items.length - 1] : items[0])?.focus();
      }
    }

    window.addEventListener("keydown", handleWindowKeyDown, true);

    return () => {
      mountedRef.current = false;
      window.removeEventListener("keydown", handleWindowKeyDown, true);
      siblings.forEach((element, index) => {
        element.inert = previousInert[index];
      });
      if (openerRef.current?.isConnected) {
        openerRef.current.focus({ preventScroll: true });
      }
    };
  }, []);

  useEffect(() => {
    if (initialScrollDoneRef.current) return;
    initialScrollDoneRef.current = true;
    if (!selectedModelId || !allModelIds.has(selectedModelId)) return;
    const selectedElement = optionRefs.current.get(selectedModelId);
    if (selectedElement && typeof selectedElement.scrollIntoView === "function") {
      selectedElement.scrollIntoView({ block: "center" });
    }
  }, [allModelIds, selectedModelId]);

  useEffect(() => {
    if (!resolvedActiveId) return;
    const activeElement = optionRefs.current.get(resolvedActiveId);
    if (activeElement && typeof activeElement.scrollIntoView === "function") {
      activeElement.scrollIntoView({ block: "nearest" });
    }
  }, [resolvedActiveId, query, effectiveProviderId]);

  function scrollOptionIntoView(modelId: string) {
    const element = optionRefs.current.get(modelId);
    if (element && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest" });
    }
  }

  async function commitSelection(nextModelId: string) {
    if (locked || pendingRef.current) return;
    if (nextModelId !== "" && !allModelIds.has(nextModelId)) return;
    if (nextModelId === normalizedSelected) {
      onClose();
      return;
    }
    pendingRef.current = true;
    setSaving(true);
    setFailure("");
    try {
      const ok = await onSelect(nextModelId);
      if (!mountedRef.current) return;
      if (ok) {
        onClose();
      } else {
        setFailure("未能切换模型，请重试。");
      }
    } catch {
      if (mountedRef.current) setFailure("未能切换模型，请重试。");
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }

  function handleProviderFilter(nextProviderId: string | null) {
    setSelectedProviderId(nextProviderId);
    setActiveOptionId(null);
    if (resultsRef.current) {
      resultsRef.current.scrollTop = 0;
    }
  }

  function handleClearQuery() {
    setQuery("");
    setActiveOptionId(null);
    if (resultsRef.current) {
      resultsRef.current.scrollTop = 0;
    }
    searchInputRef.current?.focus();
  }

  function handleViewAllProviders() {
    handleProviderFilter(null);
    searchInputRef.current?.focus();
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
      event.stopPropagation();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      if (visibleModels.length === 0) return;

      const delta = event.key === "ArrowUp" ? -1 : 1;
      const activeIndex = resolvedActiveId ? visibleModels.findIndex((item) => item.id === resolvedActiveId) : -1;
      let nextIndex: number;

      if (activeIndex >= 0) {
        nextIndex = (activeIndex + delta + visibleModels.length) % visibleModels.length;
      } else {
        const selectedIndex = selectedModelId ? visibleModels.findIndex((item) => item.id === selectedModelId) : -1;
        if (selectedIndex >= 0) {
          nextIndex = (selectedIndex + delta + visibleModels.length) % visibleModels.length;
        } else {
          nextIndex = delta > 0 ? 0 : visibleModels.length - 1;
        }
      }

      const nextModel = visibleModels[nextIndex];
      if (nextModel) {
        setActiveOptionId(nextModel.id);
        setComboboxFocused(true);
        scrollOptionIntoView(nextModel.id);
      }
      return;
    }

    if (event.key === "Enter") {
      if (resolvedActiveId && !locked) {
        event.preventDefault();
        event.stopPropagation();
        void commitSelection(resolvedActiveId);
      }
    }
  }

  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
      event.stopPropagation();
      return;
    }

    if (event.key === "Tab") {
      event.stopPropagation();
      const items = getTabbableControls(panelRef.current);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!active || !items.includes(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  const alertMessage = error || failure;
  const showFooter = allowEmpty || Boolean(hint);
  const hasVisibleModels = visibleModels.length > 0;

  return createPortal(
    <div
      className="model-picker-backdrop chat-model-picker-backdrop"
      onPaste={(event) => event.stopPropagation()}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseDown={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget && !pendingRef.current) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="model-picker chat-model-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-combobox-focused={comboboxFocused ? "true" : undefined}
        onKeyDown={handleDialogKeyDown}
      >
        <header className="chat-model-picker-header">
          <div className="chat-model-picker-title-row">
            <h2 id={titleId}>选择模型</h2>
            <button
              type="button"
              className="chat-model-picker-close"
              aria-label="关闭模型选择"
              title="关闭"
              disabled={saving}
              onClick={onClose}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <div className="model-picker-search chat-model-picker-search">
            <Search size={16} aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="text"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={hasVisibleModels}
              aria-controls={hasVisibleModels ? listboxId : undefined}
              aria-activedescendant={hasVisibleModels ? activeDomId : undefined}
              aria-label="搜索模型"
              placeholder="搜索模型、分组、连接或供应商…"
              value={query}
              onFocus={() => setComboboxFocused(true)}
              onBlur={() => setComboboxFocused(false)}
              onKeyDown={handleSearchKeyDown}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveOptionId(null);
                if (resultsRef.current) {
                  resultsRef.current.scrollTop = 0;
                }
              }}
            />
            {query.length > 0 && (
              <button
                type="button"
                className="chat-model-picker-clear"
                aria-label="清空搜索"
                title="清空搜索"
                onClick={handleClearQuery}
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </div>

          {showProviderPills && (
            <div className="chat-model-picker-pills" role="group" aria-label="按供应商筛选">
              <button
                type="button"
                className="chat-model-picker-pill"
                aria-pressed={effectiveProviderId === null}
                disabled={saving}
                onClick={() => handleProviderFilter(null)}
              >
                <span>全部</span>
                <span className="chat-model-picker-pill-count">{totalChatModels}</span>
              </button>
              {providers.map(({ provider, totalCount }) => (
                <button
                  key={provider.id}
                  type="button"
                  className="chat-model-picker-pill"
                  aria-pressed={effectiveProviderId === provider.id}
                  disabled={saving}
                  title={provider.name}
                  onClick={() => handleProviderFilter(provider.id)}
                >
                  <ProviderAvatar provider={provider} className="chat-model-picker-pill-avatar" />
                  <span className="chat-model-picker-pill-name">{provider.name}</span>
                  <span className="chat-model-picker-pill-count">{totalCount}</span>
                </button>
              ))}
            </div>
          )}

          {alertMessage && (
            <p className="chat-model-picker-status is-error" role="alert">
              {alertMessage}
            </p>
          )}
          {!error && invalidSelection && (
            <p className="chat-model-picker-status is-warning" role="status">
              当前模型已失效，请重新选择。
            </p>
          )}
        </header>

        <div ref={resultsRef} className="model-picker-results chat-model-picker-results">
          {hasVisibleModels ? (
            <div id={listboxId} role="listbox" aria-label="可选聊天模型">
              {visibleProviders.map((providerNode) => (
                <section
                  key={providerNode.provider.id}
                  className="chat-model-picker-provider-section"
                  aria-label={providerNode.provider.name}
                >
                  {effectiveProviderId === null && (
                    <div className="chat-model-picker-provider-heading">
                      <ProviderAvatar provider={providerNode.provider} className="chat-model-picker-provider-avatar" />
                      <span className="chat-model-picker-provider-name">{providerNode.provider.name}</span>
                    </div>
                  )}

                  {providerNode.connections.map((connectionNode) => (
                    <div key={connectionNode.id} className="chat-model-picker-connection-section">
                      <div className="chat-model-picker-connection-heading">
                        <span className="chat-model-picker-connection-name">{connectionNode.name}</span>
                        {connectionNode.showProtocolBadge && (
                          <span className="chat-model-picker-protocol-badge">{connectionNode.protocolLabel}</span>
                        )}
                      </div>

                      {connectionNode.groups.map((groupNode) => (
                        <div
                          key={groupNode.key}
                          role="group"
                          aria-label={groupNode.isCustom ? `${groupNode.label}（自定义）` : groupNode.label}
                          className="chat-model-picker-group-section"
                        >
                          <div className="chat-model-picker-group-heading">
                            <span>{groupNode.label}</span>
                            {groupNode.isCustom && <span className="chat-model-picker-custom-badge">自定义</span>}
                          </div>

                          <div className="chat-model-picker-group-items">
                            {groupNode.models.map((item) => {
                              const isSelected = item.id === normalizedSelected;
                              const isActive = item.id === resolvedActiveId;
                              const optionDomId = `${listboxId}-opt-${optionIndexById.get(item.id)}`;
                              return (
                                <button
                                  key={item.id}
                                  ref={(node) => {
                                    if (node) optionRefs.current.set(item.id, node);
                                    else optionRefs.current.delete(item.id);
                                  }}
                                  id={optionDomId}
                                  type="button"
                                  role="option"
                                  tabIndex={-1}
                                  className="model-picker-option"
                                  data-value={item.id}
                                  data-active={isActive ? "true" : undefined}
                                  aria-selected={isSelected}
                                  disabled={locked}
                                  title={item.title}
                                  onClick={() => void commitSelection(item.id)}
                                >
                                  <span className="chat-model-picker-option-main">
                                    <strong>{item.primaryLabel}</strong>
                                    {item.secondaryId && <small>{item.secondaryId}</small>}
                                  </span>
                                  {isSelected && <Check size={16} aria-hidden="true" />}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </section>
              ))}
            </div>
          ) : (
            <div className="chat-model-picker-empty-box" role="status">
              {totalChatModels === 0 ? (
                <p className="muted-text model-picker-empty">暂无可用聊天模型。</p>
              ) : otherProviderMatchCount > 0 ? (
                <>
                  <p className="muted-text model-picker-empty">
                    当前供应商下没有匹配的选项，其他供应商有 {otherProviderMatchCount} 个匹配。
                  </p>
                  <button
                    type="button"
                    className="chat-model-picker-empty-action"
                    disabled={saving}
                    onClick={handleViewAllProviders}
                  >
                    在全部供应商中查看
                  </button>
                </>
              ) : (
                <p className="muted-text model-picker-empty">没有匹配的选项。</p>
              )}
            </div>
          )}
        </div>

        {showFooter && (
          <footer className="chat-model-picker-footer">
            {allowEmpty && (
              <button
                type="button"
                className="chat-model-picker-unset"
                disabled={locked}
                onClick={() => void commitSelection("")}
              >
                设为未选择
              </button>
            )}
            {hint && <p className="chat-model-picker-hint">{hint}</p>}
          </footer>
        )}
      </div>
    </div>,
    openerRef.current?.closest("dialog") ?? document.body,
  );
}
