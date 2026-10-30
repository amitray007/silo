import { useEffect, useRef } from 'react';
import { SearchIcon } from './NavIcons';

export function SidebarFindButton({
  label,
  open,
  onClick,
}: {
  label: string;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-expanded={open}
      className="silo-icon-btn-sm"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: 0,
        background: 'none',
        borderRadius: 6,
        padding: 'var(--s1) 0 var(--s1) var(--s1)',
        color: open ? 'var(--ink)' : 'var(--mut)',
        cursor: 'pointer',
      }}
    >
      <SearchIcon />
    </button>
  );
}

export function SidebarFindInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <input
      ref={ref}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className="silo-field"
      style={{
        margin: '0 4px 3px',
        padding: '4px 8px',
        border: '1px solid var(--line)',
        borderRadius: 7,
        background: 'var(--bg)',
        color: 'var(--ink)',
        font: 'inherit',
        fontSize: 'var(--sidebar-input-size, var(--text-sm))',
        width: 'calc(100% - 8px)',
        boxSizing: 'border-box',
        transition: 'border-color .15s ease',
      }}
    />
  );
}
