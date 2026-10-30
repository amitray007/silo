import { type KeyboardEvent, type Ref, useEffect, useRef } from 'react';
import { ReaderIcon } from './reader/ReaderIcon';

export function SidebarFindButton({
  label,
  open,
  onClick,
  ref,
}: {
  label: string;
  open: boolean;
  onClick: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-expanded={open}
      className="silo-icon-btn-sm silo-sidebar-find-toggle"
    >
      <ReaderIcon name="search" />
    </button>
  );
}

export function SidebarFindInput({
  value,
  onChange,
  placeholder,
  autoFocusOnOpen,
  onClose,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoFocusOnOpen: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocusOnOpen) ref.current?.focus();
  }, [autoFocusOnOpen]);
  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (value) {
      onChange('');
      ref.current?.focus();
    } else {
      onClose();
    }
  }
  return (
    <div className="silo-sidebar-find">
      <span className="silo-sidebar-find-icon">
        <ReaderIcon name="search" size={14} />
      </span>
      <input
        ref={ref}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
        className="silo-sidebar-find-input"
      />
      {value && (
        <button
          type="button"
          className="silo-sidebar-find-clear"
          aria-label="Clear"
          onKeyDown={onKeyDown}
          onClick={() => {
            onChange('');
            ref.current?.focus();
          }}
        >
          <ReaderIcon name="close" size={14} />
        </button>
      )}
    </div>
  );
}

export function SidebarFindEmpty({ kind, query }: { kind: 'feeds' | 'tags'; query: string }) {
  return (
    <p className="silo-sidebar-find-empty">
      <span>No {kind} match &quot;</span>
      <span className="silo-sidebar-find-query">{query.trim()}</span>
      <span>&quot;</span>
    </p>
  );
}
