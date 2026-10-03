import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { isChatConnection } from "../../chat/settings";
import { ModelPicker, type ModelPickerProps } from "./ModelPicker";
import "../SelectField.css";

/** Draft model selector: the owning form decides when to save. */
export function ModelSelectField({ id, label, ...props }: Omit<ModelPickerProps, "onClose" | "allowEmpty"> & { id: string; label: string }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const target = props.settings.providers.flatMap(provider => provider.connections.filter(isChatConnection).flatMap(connection => connection.models.map(model => ({
    id: model.id, label: `${provider.name} / ${connection.name} / ${model.displayName || model.modelId}`,
  })))).find(model => model.id === props.selectedModelId);
  const text = target?.label ?? (props.selectedModelId ? "原模型已失效，请重新选择" : "未选择模型");
  useEffect(() => { if (props.disabled) setOpen(false); }, [props.disabled]);
  return <>
    <button ref={trigger} id={id} type="button" className="select-field" aria-label={label} aria-haspopup="dialog"
      aria-expanded={open && !props.disabled} disabled={props.disabled} title={text}
      onClick={() => { if (!trigger.current?.matches(":disabled")) setOpen(true); }}>
      <span>{text}</span><ChevronDown size={16} aria-hidden="true" />
    </button>
    {open && !props.disabled && <ModelPicker {...props} allowEmpty onClose={() => setOpen(false)} />}
  </>;
}
