import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import "./ConfirmationDialog.css";

export interface ConfirmationOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface PendingConfirmation {
  options: ConfirmationOptions;
  resolve(value: boolean): void;
}

function ConfirmationDialog({ options, onResult }: {
  options: ConfirmationOptions;
  onResult(value: boolean): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null | undefined>(undefined);
  const id = useId();
  useEffect(() => {
    if (openerRef.current === undefined) {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    const opener = openerRef.current;
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    cancelRef.current?.focus();
    return () => {
      // Removing the dialog leaves the top layer; avoid a close event during StrictMode replay.
      if (opener instanceof HTMLElement && opener.isConnected
        && !opener.closest('[inert], [hidden], [aria-hidden="true"]')
        && !opener.matches(":disabled")) opener.focus();
    };
  }, []);

  return createPortal(<dialog ref={ref} className="confirmation-dialog"
    aria-labelledby={`${id}-title`} aria-describedby={`${id}-message`}
    onCancel={(event) => { event.preventDefault(); onResult(false); }}
    onClose={(event) => { if (!event.currentTarget.open) onResult(false); }}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); onResult(false); }
    }}>
    <h3 id={`${id}-title`}>{options.title}</h3>
    <p id={`${id}-message`} className="confirmation-message">{options.message}</p>
    <div className="confirmation-actions">
      <button ref={cancelRef} type="button" className="confirmation-button" onClick={() => onResult(false)}>
        {options.cancelLabel ?? "取消"}
      </button>
      <button type="button" className="confirmation-button confirmation-accept" data-danger={options.danger || undefined}
        onClick={() => onResult(true)}>{options.confirmLabel ?? "确认"}</button>
    </div>
  </dialog>, document.body);
}

/** Each owner presents one confirmation at a time; competing requests are cancelled. */
export function useConfirmation() {
  const pending = useRef<PendingConfirmation | null>(null);
  const mounted = useRef(false);
  const [request, setRequest] = useState<PendingConfirmation | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const current = pending.current;
      pending.current = null;
      current?.resolve(false);
    };
  }, []);
  const confirm = useCallback((options: ConfirmationOptions): Promise<boolean> => {
    if (!mounted.current || pending.current) return Promise.resolve(false);
    return new Promise(resolve => {
      const next = { options, resolve };
      pending.current = next;
      setRequest(next);
    });
  }, []);
  const settle = useCallback((current: PendingConfirmation, result: boolean) => {
    if (pending.current !== current) return;
    pending.current = null;
    setRequest(null);
    current.resolve(result);
  }, []);
  return {
    confirm,
    dialog: request ? <ConfirmationDialog options={request.options} onResult={result => settle(request, result)} /> : null,
  };
}
