import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { ModelPicker, type ModelPickerProps } from "./ModelPicker";

export function ModelSelector({ label, fullLabel, ...picker }: Omit<ModelPickerProps, "onClose"> & {
  label: string;
  fullLabel: string;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <button className="chat-model-trigger" type="button" aria-label="切换模型"
      aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}
      disabled={picker.disabled} title={fullLabel}>
      <span>{label}</span><ChevronDown size={14} />
    </button>
    {open && <ModelPicker {...picker} onClose={() => setOpen(false)} />}
  </>;
}
