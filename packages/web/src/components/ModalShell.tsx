import { type CSSProperties, type ReactNode, useEffect, useRef } from 'react';
import { useEscapeLayer } from '../lib/useEscapeLayer';

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
  anchored = false,
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
   * it. Escape priority is handled by `useEscapeLayer` alongside child popovers.
   */
  zIndex?: number;
  variant?: 'sheet' | 'settings';
  role?: 'dialog' | 'alertdialog';
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  describedBy?: string;
  focusPanel?: boolean;
  anchored?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);
  const backdropPress = useRef(false);

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

  useEscapeLayer(true, onClose);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: scrim dismiss is pointer-only convenience — Escape (handled by the document listener above) is the keyboard-equivalent close path, matching v3.
    // biome-ignore lint/a11y/noStaticElementInteractions: same — a non-interactive click guard, not a control.
    <div
      onPointerDown={(event) => {
        backdropPress.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (backdropPress.current && event.target === event.currentTarget) onClose();
        backdropPress.current = false;
      }}
      className={`silo-modal-layer${anchored ? ' silo-modal-layer-anchored' : ''} silo-modal-layer-${variant}${role === 'alertdialog' ? ' silo-confirm-layer' : ''}`}
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
        {variant === 'settings' ? children : <div className="silo-dialog-content">{children}</div>}
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
      {showCloseIcon && (
        <button type="button" onClick={onClose} aria-label="Close" className="silo-settings-close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6 6 18"
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
