import type { ReactNode } from 'react';
import { usePasteFlash } from '../lib/usePasteFlash';

/** What `onClick` returns to make the button show its own toast — `undefined` shows nothing (a caller that renders its own feedback, e.g. Trash's two-step confirm swap, just returns nothing). */
export type HeaderActionResult = { message: string; ok: boolean } | undefined;

/**
 * The pill-button chrome shared by every `ContentHeader` right-slot action —
 * extracted from `LibraryView.tsx`'s original inline `PasteCaptureButton`
 * (the `.silo-icon-btn-sm` pill: icon + label, `1px solid var(--line)` /
 * `var(--bg2)` / `var(--ink)`, `borderRadius: 6`, `padding: '6px 12px'`) plus
 * its absolutely-positioned inline flash toast (`role="status"`/`"alert"`,
 * `aria-live`). Purely presentational: `icon`/`label` render the button,
 * `disabled` dims + inactivates it, and `onClick` (sync or async) owns ALL
 * behavior. This component owns the flash itself (`usePasteFlash`) so every
 * caller gets the identical toast wiring for free — `onClick` just RETURNS
 * `{ message, ok }` (or nothing) to trigger it, rather than each caller
 * wiring its own `usePasteFlash` + passing message/ok down as props (the
 * "accept flash state" alternative the method file offered; this is the
 * cleaner of the two since the flash's lifecycle — timer, cleanup — stays
 * entirely inside the one component that renders it).
 */
export function HeaderActionButton({
  icon,
  label,
  onClick,
  disabled = false,
  title,
  ariaLabel,
  primary = false,
}: {
  icon: ReactNode;
  label: ReactNode;
  onClick: () => HeaderActionResult | Promise<HeaderActionResult>;
  disabled?: boolean;
  primary?: boolean;
  /** Native `title` tooltip — omitted by default. */
  title?: string;
  /** `aria-label` — omitted by default (falls back to the button's own visible text). */
  ariaLabel?: string;
}) {
  const { message, ok, flash } = usePasteFlash();

  async function handleClick() {
    const result = await onClick();
    if (result) flash(result.message, result.ok);
  }

  return (
    <div style={{ position: 'relative', flex: 'none' }}>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        className={primary ? 'silo-icon-btn-sm silo-header-primary' : 'silo-icon-btn-sm'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--s1-5)',
          border: primary ? '1px solid transparent' : '1px solid var(--line)',
          background: primary ? 'var(--btn)' : 'var(--bg2)',
          borderRadius: 8,
          height: 30,
          fontWeight: 500,
          padding: '0 12px',
          fontSize: 13,
          fontFamily: 'inherit',
          color: primary ? 'var(--btn-ink)' : 'var(--ink)',
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        {icon}
        {label}
      </button>
      {message && (
        <span
          role={ok ? 'status' : 'alert'}
          aria-live={ok ? 'polite' : 'assertive'}
          className="silo-toast"
        >
          {message}
        </span>
      )}
    </div>
  );
}
