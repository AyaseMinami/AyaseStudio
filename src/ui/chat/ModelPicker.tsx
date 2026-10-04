import { isChatConnection, type ConnectionSettingsState } from "../../chat/settings";
import { getProtocolOption } from "../../chat/protocolOptions";
import { SearchChoiceDialog, type SearchSelectOption } from "../SearchSelectField";
import { groupConfiguredModels } from "../../chat/modelGrouping";

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

export function ModelPicker({ settings, selectedModelId, disabled, error, hint = "仅当前对话 · 自动保存，下次请求生效", allowEmpty = false, onSelect, onClose }: ModelPickerProps) {
  const options: SearchSelectOption[] = settings.providers.flatMap(provider => provider.connections.filter(isChatConnection).flatMap(connection => groupConfiguredModels(connection.models, connection.modelGroups).flatMap(group => group.models.map(model => ({
    value: model.id, label: model.displayName || model.modelId,
    description: model.displayName ? model.modelId : undefined,
    group: `${provider.name} · ${connection.name} · ${getProtocolOption(connection.protocol).label} · ${group.label}${group.groupId ? "（自定义）" : ""}`,
  })))));
  const invalid = selectedModelId && !options.some(option => option.value === selectedModelId);
  if (allowEmpty) options.unshift({ value: "", label: "未选择模型" });
  return <SearchChoiceDialog options={options} value={selectedModelId ?? ""} label="选择模型"
    searchLabel="搜索模型" closeLabel="关闭模型选择"
    hint={hint} error={error || (invalid ? "当前模型已失效，请重新选择。" : undefined)} disabled={disabled}
    onSelect={onSelect} onClose={onClose} />;
}
