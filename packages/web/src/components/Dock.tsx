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
 * The shared bottom pill shell (plan 011, V3-5) — matches `Silo-v3.html`'s
 * three dock blocks (`selActive`/`trDockIdle`/`trSelActive`) pixel-for-pixel:
 * centered, `bottom:32px`, `border-radius:999px`, the same shadow, `siloIn`
 * entrance. `padding` defaults to the two selection docks' `9px 12px 9px
 * 18px` (asymmetric — extra room on the left where the "N selected" label
 * sits flush); the idle trash dock passes `'9px 18px'` (symmetric — v3's
 * markup uses a plain padding shorthand there, no label). Pulled into one
 * component because all three docks share this exact shell; without it
 * they'd duplicate ~15 style properties three times over (jscpd guards
 * production src at 1.5%).
 *
 * `position: absolute` (not `fixed`) — every caller mounts this as a direct
 * child of `.silo-content` (the floating content panel, `AppFrame.tsx`'s
 * `<main>`), either straight from `TrashView.tsx` or via `ContentFrame`
 * (`routes/shared/ListHeader.tsx`). `.silo-content` is `position: relative`
 * (`base.css`) specifically to anchor this, so the dock centers over the
 * CONTENT PANEL's own width — not the viewport's. A `fixed` dock centered via
 * `left:0;right:0` centers to the whole viewport instead, which straddles
 * the sidebar/content boundary on desktop (the sidebar's ~232px + the
 * frame's centered-band math skew the panel off-center from the viewport at
 * every width except a coincidence) — this bug is what moved the dock off
 * `fixed`. On mobile (`≤720px`) the sidebar drops out of flow and
 * `.silo-content` already fills the full width, so the dock still spans/
 * centers full-width there with no separate mobile case needed.
 */
export function Dock({
  children,
  // K3 (oat-conformance audit): 9px → var(--s2) (rounded to 8px); 12px →
  // var(--s3) exact. The 18px left offset is LEFT un-tokenized (no clean
  // --s* step between --s4/16px and --s5/20px, and it's the deliberate
  // asymmetric "room for the label" inset the class doc comment describes).
  padding = 'var(--s2) var(--s3) var(--s2) 18px',
}: {
  children: ReactNode;
  padding?: string;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        margin: '0 auto',
        width: 'max-content',
        maxWidth: 'calc(100% - 40px)',
        bottom: 'var(--s8)',
        zIndex: 35,
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s3-5)',
        background: 'var(--bg)',
        border: '1px solid var(--line)',
        borderRadius: 999,
        // K6: dock is an absolutely-positioned overlay (highest prominence,
        // like a modal), so it takes the strongest elevation step rather
        // than the mid-tier --elev-2 popovers use.
        boxShadow: 'var(--elev-3)',
        padding,
        // Bottom-anchored: it slides/scales up off the bottom edge it's
        // pinned to, not its own center (review-animations-STANDARDS.md's
        // origin-aware rule — the same "grow from the anchor" logic applied
        // to a fixed-position dock instead of a trigger-anchored popover).
        transformOrigin: 'bottom center',
        animation: 'siloIn .16s var(--ease-out)',
      }}
    >
      {children}
    </div>
  );
}

/** The `{n} selected` label shared by the two selection docks (`selActive`/`trSelActive`) — same size/weight/color both places. Internal to `SelectionDock` below; not used standalone since both docks now go through that shell. */
function DockSelectedLabel({ count }: { count: number }) {
  return (
    <span
      style={{
        fontSize: 'var(--text-sm)',
        fontWeight: 500,
        color: 'var(--ink)',
        whiteSpace: 'nowrap',
      }}
    >
      {count} selected
    </span>
  );
}

/** The `|` divider between a dock's label and its actions — one shared style for the vertical rule every dock uses. */
export function DockDivider() {
  return <span style={{ width: 1, height: 'var(--s3-5)', background: 'var(--line)' }} />;
}

/**
 * The selection-dock shell (`selActive`/`trSelActive`) shared by the
 * Library's `LibrarySelectionDock` (`routes/shared/ListHeader.tsx`) and the
 * Trash's `TrashSelectionDock` (`routes/TrashView.tsx`): label · divider ·
 * caller-specific action(s) · clear · esc, every time. `children` is the
 * batch-action button(s) between the divider and "Clear" — the one part
 * that's genuinely different per screen (Library only has "move to trash";
 * Trash has both "restore" and "delete now"). Pulled out so the two docks
 * don't each re-lay the identical label/divider/clear/esc-hint chrome
 * (jscpd guards production src at 1.5%).
 */
export function SelectionDock({
  selectedCount,
  onClear,
  children,
}: {
  selectedCount: number;
  onClear: () => void;
  children: ReactNode;
}) {
  return (
    <Dock>
      <DockSelectedLabel count={selectedCount} />
      <DockDivider />
      {children}
      <DockAction onClick={onClear}>Clear</DockAction>
      <DockEscHint />
    </Dock>
  );
}

/** The text/color/cursor styling every dock action button shares (text-only `DockAction` and icon-leading `DockIconAction` alike) — only `display`/`gap` differ (the icon variant needs a flex row to lay out its leading icon + label), so those two stay per-caller rather than folding into this shared base. */
function dockActionStyle(disabled: boolean) {
  return {
    border: 0,
    background: 'none',
    fontFamily: 'inherit',
    fontSize: 'var(--text-sm)',
    fontWeight: 500,
    color: 'var(--mut)',
    cursor: disabled ? 'default' : ('pointer' as const),
    opacity: disabled ? 0.5 : 1,
    padding: 0,
    whiteSpace: 'nowrap' as const,
  };
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
      className="silo-dock-action"
      style={dockActionStyle(disabled)}
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
      className="silo-dock-action"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--s1-5)',
        ...dockActionStyle(disabled),
      }}
    >
      {icon}
      {children}
    </button>
  );
}

/** The `esc` hint chip every dock ends with (v3's `<span>esc</span>` — not a button, purely informational). Internal to `SelectionDock` below (the idle trash dock, `TrashView.tsx`'s `TrashIdleDock`, doesn't end with an esc hint). */
function DockEscHint() {
  return (
    <span
      style={{
        fontSize: '0.6rem',
        color: 'var(--fnt)',
        border: '1px solid var(--line)',
        borderRadius: 5,
        padding: 'var(--s-0-5) var(--s1-5)',
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
