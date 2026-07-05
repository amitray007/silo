import type { ReactNode } from 'react';
import { TrashIcon } from './NavIcons';

/**
 * `Dock.tsx` owns only the SHELL + shared sub-parts of the bottom docks (the
 * pill, label, divider, actions, esc hint, icons). The concrete docks that
 * compose them live BY THE RULE: a dock reused by >1 route lives with the
 * shared shell that renders it (`LibrarySelectionDock` → `routes/shared/
 * ListHeader.tsx`'s `ContentFrame`, shared by Library + Tag); a dock used by
 * exactly one route lives in that route (`TrashSelectionDock`/`TrashIdleDock`
 * → `routes/TrashView.tsx`). Keep new docks to that rule so `ListHeader.tsx`
 * doesn't become a catch-all for one-route dock components.
 */

/**
 * The shared fixed-bottom pill shell (plan 011, V3-5) — matches
 * `Silo-v3.html`'s three dock blocks (`selActive`/`trDockIdle`/`trSelActive`)
 * pixel-for-pixel: centered, `bottom:32px`, `border-radius:999px`, the same
 * shadow, `siloIn` entrance. `padding` defaults to the two selection docks'
 * `9px 12px 9px 18px` (asymmetric — extra room on the left where the
 * "N selected" label sits flush); the idle trash dock passes `'9px 18px'`
 * (symmetric — v3's markup uses a plain padding shorthand there, no label).
 * Pulled into one component because all three docks share this exact shell;
 * without it they'd duplicate ~15 style properties three times over (jscpd
 * guards production src at 1.5%).
 */
export function Dock({
  children,
  padding = '9px 12px 9px 18px',
}: {
  children: ReactNode;
  padding?: string;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        margin: '0 auto',
        width: 'max-content',
        maxWidth: 'calc(100vw - 40px)',
        bottom: 32,
        zIndex: 35,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        background: 'var(--bg)',
        border: '1px solid var(--line)',
        borderRadius: 999,
        boxShadow: '0 20px 50px -18px rgba(40,28,8,.45)',
        padding,
        animation: 'siloIn .16s ease',
      }}
    >
      {children}
    </div>
  );
}

/** The `{n} selected` label shared by the two selection docks (`selActive`/`trSelActive`) — same size/weight/color both places. */
export function DockSelectedLabel({ count }: { count: number }) {
  return (
    <span
      style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--ink)', whiteSpace: 'nowrap' }}
    >
      {count} selected
    </span>
  );
}

/** The `|` divider between a dock's label and its actions — one shared style for the vertical rule every dock uses. */
export function DockDivider() {
  return <span style={{ width: 1, height: 14, background: 'var(--line)' }} />;
}

/** A text-only dock action (v3's `clear`/`select all`/`empty all`/`restore`/`delete now` buttons, minus the icon ones — see `DockIconAction` for those). `disabled` dims + inactivates it (used to block a double-fire while a bulk op is pending). */
export function DockAction({
  onClick,
  disabled = false,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        border: 0,
        background: 'none',
        fontFamily: 'inherit',
        fontSize: '0.78rem',
        fontWeight: 500,
        color: 'var(--mut)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        padding: 0,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}

/** A dock action with a leading 12×12 trash-can icon (v3's "move to trash"/"empty all") or a restore icon — `icon` is the caller-supplied `<svg>`. `disabled` dims + inactivates it (blocks a double-fire while a bulk op is pending). */
export function DockIconAction({
  onClick,
  icon,
  disabled = false,
  children,
}: {
  onClick: () => void;
  icon: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        border: 0,
        background: 'none',
        fontFamily: 'inherit',
        fontSize: '0.78rem',
        fontWeight: 500,
        color: 'var(--mut)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        padding: 0,
        whiteSpace: 'nowrap',
      }}
    >
      {icon}
      {children}
    </button>
  );
}

/** The `esc` hint chip every dock ends with (v3's `<span>esc</span>` — not a button, purely informational). */
export function DockEscHint() {
  return (
    <span
      style={{
        fontSize: '0.6rem',
        color: 'var(--fnt)',
        border: '1px solid var(--line)',
        borderRadius: 5,
        padding: '2px 5px',
        background: 'var(--bg2)',
      }}
    >
      esc
    </span>
  );
}

/** The trash-can icon shared by "move to trash" (library dock) / "empty all" (trash dock) / "delete now" (trash selection dock + `TrashRowActions`) — reuses `NavIcons.tsx`'s `TrashIcon` at the dock's smaller 12×12/`var(--ghost)` styling rather than duplicating its SVG path data. */
export function DockTrashIcon() {
  return <TrashIcon size={12} stroke="var(--ghost)" />;
}

/** The restore icon (a counter-clockwise arrow) shared by the row-level restore button and the trash selection dock's "restore" action. */
export function DockRestoreIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.2 8a5 5 0 1 0 1.5-3.6" />
      <polyline points="4.6 1.8 4.6 4.6 7.4 4.6" />
    </svg>
  );
}
