import { X } from "lucide-react";
import "./UpdateNotice.css";

export function UpdateNotice({ version, onOpen, onDismiss }: {
  version: string;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  return <aside className="update-notice" aria-label="应用更新提示">
    <p role="status">发现新版本 v{version}</p>
    <button type="button" className="update-notice-open" onClick={onOpen}>查看更新</button>
    <button type="button" className="update-notice-dismiss" aria-label="关闭更新提示" onClick={onDismiss}><X size={16} aria-hidden="true" /></button>
  </aside>;
}
