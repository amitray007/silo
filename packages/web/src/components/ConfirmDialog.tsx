import { type ReactNode, useId } from 'react';
import { ModalShell } from './ModalShell';
import { ReaderIcon } from './reader/ReaderIcon';

/** Shared confirmation surface for actions that already require a second click. */
export function ConfirmDialog({
  title,
  children,
  action,
  actionLabel,
  item = title,
  pending = false,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  action: string;
  actionLabel?: string;
  item?: ReactNode;
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
      width={380}
      ariaLabel={title}
      role="alertdialog"
      describedBy={descriptionId}
      focusPanel={pending}
      onClose={dismiss}
      zIndex={60}
    >
      <div className="silo-confirm-content">
        <div className="silo-confirm-icon">
          <ReaderIcon name="trash" />
        </div>
        <h2>{title}</h2>
        <p id={descriptionId}>{children}</p>
        <div className="silo-confirm-item">
          <ReaderIcon name="sidebar" />
          <span>{item}</span>
        </div>
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
