import { type CSSProperties, type ReactNode, useEffect, useRef } from 'react';

/**
 * Tracks whether the user's most recent interaction was via keyboard, so
 * focus-restore-on-close can be modality-aware: refocusing the trigger is
 * correct+necessary for a KEYBOARD user (they must land back where they were,
 * with the focus ring), but for a MOUSE user it just paints a `:focus-visible`
 * ring on a button they clicked and moved on from — visual noise they never
 * asked for. A single set of passive document listeners (registered once,
 * lazily) keeps `lastWasKeyboard` current for every modal. `keydown` flips it
 * true; any pointer interaction flips it false.
 */
let lastWasKeyboard = false;
let modalityListenersAttached = false;

/**
 * Mount-order stack of every currently-open `ModalShell` instance, keyed by a
 * per-instance id — lets each instance's Escape handler ask "am I the
 * topmost?" (the MCP-setup-over-Settings stacked-dialog case, `AccessTab.tsx`
 * → `McpSetupDialog.tsx`). Capture-phase `document` listeners fire in
 * ADD order regardless of `stopPropagation` — `stopPropagation` only stops an
 * event from reaching OTHER nodes, not sibling listeners registered on the
 * SAME node (`document`, here) — so the naive fix (each `ModalShell`
 * `stopPropagation`s its own Escape listener) does NOT make an
 * later-mounted/inner modal's Escape "win" over an earlier-mounted/outer
 * one's; the outer one's listener still runs first and still closes. Instead
 * every instance consults this stack and only calls its own `onClose` when
 * it's the LAST (most-recently-mounted, i.e. topmost) entry — the same
 * "newest wins" precedent `AppFrame.tsx`'s `RowMenuLayer` already uses for
 * Edit-vs-Settings-vs-palette mutual exclusion, just generalized so it works
 * for ANY stacked `ModalShell` pair without each caller having to hand-wire
 * its own mutual-exclusion effect.
 */
let openModalStack: symbol[] = [];

function ensureModalityListeners(): void {
  if (modalityListenersAttached || typeof document === 'undefined') return;
  modalityListenersAttached = true;
  document.addEventListener(
    'keydown',
    () => {
      lastWasKeyboard = true;
    },
    true,
  );
  const pointer = () => {
    lastWasKeyboard = false;
  };
  document.addEventListener('pointerdown', pointer, true);
  document.addEventListener('mousedown', pointer, true);
}

export function trapDialogTab(e: React.KeyboardEvent<HTMLDivElement>) {
  if (e.key !== 'Tab') return;
  const panel = e.currentTarget;
  const focusables = Array.from(
    panel.querySelectorAll<HTMLElement>(
      'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)',
    ),
  ).filter((el) => el.offsetParent !== null);
  if (focusables.length === 0) {
    e.preventDefault();
    panel.focus();
    return;
  }
  const first = focusables[0] as HTMLElement;
  const last = focusables[focusables.length - 1] as HTMLElement;
  if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/** Shared surface, focus trap, dismissal, and stacked-dialog Escape priority. */
export function ModalShell({
  width,
  ariaLabel,
  onClose,
  children,
  maxHeight,
  zIndex = 40,
  variant = 'sheet',
  role = 'dialog',
  onKeyDown,
  describedBy,
  focusPanel = false,
}: {
  /** Preferred width, capped to the available viewport. */
  width: number;
  /** `aria-label` on the `role="dialog"` panel. */
  ariaLabel: string;
  onClose: () => void;
  children: ReactNode;
  /** Optional height cap; content scrolls within the available space. */
  maxHeight?: string;
  /**
   * The scrim/panel's `z-index`. Defaults to `40` — every pre-existing
   * caller (`EditModal`, `SettingsModal`) gets that byte-for-byte unchanged.
   * A caller that stacks ON TOP of another `ModalShell` (e.g.
   * `McpSetupDialog` opening over `SettingsModal`) passes something higher
   * (50) so it paints above the lower modal's scrim instead of underneath
   * it. See the `openModalStack` comment above for how Escape ALSO resolves
   * the stacked case (z-index alone only fixes paint order, not Escape).
   */
  zIndex?: number;
  variant?: 'sheet' | 'settings';
  role?: 'dialog' | 'alertdialog';
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  describedBy?: string;
  focusPanel?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);
  // This instance's identity in `openModalStack` — a fresh `symbol` per
  // mount (not the `onClose` reference, which callers may recreate every
  // render) so "am I topmost" is stable across re-renders of the same
  // open modal.
  const stackId = useRef<symbol>(undefined);
  if (stackId.current === undefined) stackId.current = Symbol('modal');

  useEffect(() => {
    ensureModalityListeners();
    triggerRef.current = document.activeElement;
    // Snapshot the modality that OPENED the modal — restore-on-close is only
    // for keyboard users (see the tracker above). A mouse-opened modal
    // restoring focus just paints a `:focus-visible` ring on the clicked
    // trigger, which reads as noise.
    const openedViaKeyboard = lastWasKeyboard;
    panelRef.current?.focus();
    return () => {
      if (!openedViaKeyboard) return;
      const trigger = triggerRef.current;
      if (trigger instanceof HTMLElement && document.contains(trigger)) {
        trigger.focus();
      }
    };
  }, []);

  useEffect(() => {
    if (focusPanel) panelRef.current?.focus();
  }, [focusPanel]);

  // Push/pop this instance onto the shared open-modal stack (see the
  // `openModalStack` doc comment above `ensureModalityListeners`) so its
  // Escape handler below can tell whether it's the topmost open `ModalShell`.
  useEffect(() => {
    const id = stackId.current as symbol;
    openModalStack = [...openModalStack, id];
    return () => {
      openModalStack = openModalStack.filter((entry) => entry !== id);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Only the TOPMOST (most-recently-mounted) open `ModalShell` closes on
      // Escape — an outer modal (e.g. Settings) sits earlier in the stack
      // than a dialog stacked on top of it (e.g. the MCP setup dialog) and
      // must stay open. `stopPropagation` (kept for any DOM-tree listeners,
      // e.g. `AppFrame`'s bubble-phase `RowMenuLayer` handler) does NOT
      // achieve this on its own — see the stack comment for why.
      if (openModalStack[openModalStack.length - 1] !== stackId.current) return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: scrim dismiss is pointer-only convenience — Escape (handled by the document listener above) is the keyboard-equivalent close path, matching v3.
    // biome-ignore lint/a11y/noStaticElementInteractions: same — a non-interactive click guard, not a control.
    <div
      onClick={onClose}
      className={`silo-modal-layer silo-modal-layer-${variant}${role === 'alertdialog' ? ' silo-confirm-layer' : ''}`}
      style={{ zIndex }}
    >
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is restricted to dialog or alertdialog; both support aria-modal. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: both allowed roles are interactive dialogs with keyboard focus management. */}
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(event) => {
          trapDialogTab(event);
          onKeyDown?.(event);
        }}
        tabIndex={-1}
        className={`silo-modal-panel silo-modal-panel-${variant}`}
        style={
          { '--modal-width': `${width}px`, '--modal-height': maxHeight ?? '100%' } as CSSProperties
        }
      >
        {children}
      </div>
    </div>
  );
}

/** Shared dialog heading and close controls. */
export function ModalHeader({
  title,
  onClose,
  leading,
  showCloseIcon = true,
}: {
  title: string;
  onClose: () => void;
  leading?: ReactNode;
  showCloseIcon?: boolean;
}) {
  return (
    <div className="silo-modal-header">
      <h2>{title}</h2>
      {leading}
      <span style={{ flex: 1 }} />
      {showCloseIcon && (
        <button type="button" onClick={onClose} aria-label="Close" className="silo-settings-close">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
