import { type ReactNode, useId } from 'react';
import { ModalHeader, ModalShell } from './ModalShell';

/** Shared confirmation surface for actions that already require a second click. */
export function ConfirmDialog({
  title,
  children,
  action,
  actionLabel,
  pending = false,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  action: string;
  actionLabel?: string;
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const descriptionId = useId();
  const dismiss = () => {
    if (!pending) onClose();
  };
  return (
    <ModalShell
      width={400}
      ariaLabel={title}
      role="alertdialog"
      describedBy={descriptionId}
      onClose={dismiss}
      zIndex={60}
    >
      <ModalHeader title={title} onClose={dismiss} showCloseIcon={false} />
      <div className="silo-modal-body">
        <p id={descriptionId}>{children}</p>
      </div>
      <div className="silo-modal-footer">
        <button type="button" className="silo-edit-footer-btn" disabled={pending} onClick={dismiss}>
          Cancel
        </button>
        <button
          type="button"
          className="silo-confirm-btn"
          disabled={pending}
          aria-label={actionLabel}
          onClick={onConfirm}
        >
          {pending ? 'Working…' : action}
        </button>
      </div>
    </ModalShell>
  );
}
