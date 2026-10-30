import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ModalHeader, ModalShell } from './ModalShell';

export function RenameDialog({
  title,
  returnFocus,
  initialValue,
  pending,
  error,
  hint,
  onClose,
  onSave,
}: {
  title: string;
  returnFocus: () => HTMLElement | null | Promise<HTMLElement | null>;
  initialValue: string;
  pending: boolean;
  error?: string | undefined;
  hint?: string;
  onClose: () => void;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  useEffect(() => {
    if (error) input.current?.focus();
  }, [error]);
  return createPortal(
    <ModalShell width={420} ariaLabel={title} onClose={onClose} returnFocus={returnFocus} anchored>
      <ModalHeader title={title} onClose={onClose} />
      <form
        className="silo-rename-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending) onSave(value.trim());
        }}
      >
        <label htmlFor={id}>
          Name
          <input
            ref={input}
            id={id}
            className="silo-field"
            maxLength={200}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            readOnly={pending}
            aria-busy={pending}
            aria-invalid={Boolean(error)}
            aria-describedby={hint ? `${id}-hint` : undefined}
          />
        </label>
        {hint && (
          <p id={`${id}-hint`} className="silo-feed-description">
            {hint}
          </p>
        )}
        {error && (
          <p role="alert" className="silo-feed-error">
            {error}
          </p>
        )}
        <div className="silo-modal-footer">
          <button type="button" className="silo-edit-footer-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="silo-edit-save-btn" aria-disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </ModalShell>,
    document.body,
  );
}
