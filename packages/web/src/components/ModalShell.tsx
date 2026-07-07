import { type ReactNode, useEffect, useRef } from 'react';

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

/**
 * The scrim + panel shell shared by every v3 centered modal (`editOpen`,
 * `settingsOpen` — `Silo-v3.html`): fixed-inset `rgba(24,17,7,.32)` scrim
 * with `siloFade`, a `siloIn` panel with the focus-trap host (`tabIndex={-1}`
 * + a roving Tab handler), scrim-click-to-close, and a document-level
 * capture-phase Escape handler. Pulled out of `EditModal`/`SettingsModal`
 * (which each had their own copy) once `SettingsModal` landed and `jscpd`
 * flagged the two as ~90 duplicated lines — this is the single place that
 * owns:
 *
 * - focus-in-on-open + focus-restore-on-close (captures
 *   `document.activeElement` at mount, refocuses it on unmount if it's still
 *   in the DOM)
 * - the Tab-trap keydown handler (first/last focusable cycling)
 * - the capture-phase Escape listener (`true` — takes priority over
 *   `AppFrame`'s `RowMenuLayer` bubble-phase listener and any other, since a
 *   modal is always the topmost overlay while open)
 * - the scrim's click-to-close + the panel's click-stopPropagation guard
 *
 * Callers own everything INSIDE the panel (header, tabs, fields, footer) —
 * this only owns the shell chrome + the a11y wiring, so each modal's actual
 * content stays exactly as different as it needs to be (`EditModal`'s form
 * vs. `SettingsModal`'s tabs).
 */
export function ModalShell({
  width,
  ariaLabel,
  onClose,
  children,
  maxHeight,
}: {
  /** The panel's fixed pixel width (v3: 520 for Edit, 560 for Settings). */
  width: number;
  /** `aria-label` on the `role="dialog"` panel. */
  ariaLabel: string;
  onClose: () => void;
  children: ReactNode;
  /** Optional `maxHeight` (v3's Settings panel scrolls internally at `80vh`; Edit has no such cap). */
  maxHeight?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const trapTab = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const panel = e.currentTarget;
    const focusables = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, textarea, select',
      ),
    ).filter((el) => el.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0] as HTMLElement;
    const last = focusables[focusables.length - 1] as HTMLElement;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: scrim dismiss is pointer-only convenience — Escape (handled by the document listener above) is the keyboard-equivalent close path, matching v3.
    // biome-ignore lint/a11y/noStaticElementInteractions: same — a non-interactive click guard, not a control.
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        // K6 (oat-conformance audit): sourced from the shared scrim token
        // (identical value: rgba(24,17,7,.32)) rather than a hardcoded
        // literal, so dark mode's deeper scrim applies automatically.
        background: 'var(--scrim)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 40,
        animation: 'siloFade .16s var(--ease-out)',
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapTab}
        tabIndex={-1}
        style={{
          width,
          maxWidth: 'calc(100vw - 48px)',
          ...(maxHeight ? { maxHeight, overflowY: 'auto' } : {}),
          border: '1px solid var(--line)',
          borderRadius: 14,
          background: 'var(--bg)',
          // K3: 21px has no clean --s* match (between --s5/20px and
          // --s6/24px) — left un-tokenized rather than nudging the panel's
          // vertical padding. 24px → var(--s6) exact.
          padding: '21px var(--s6)',
          // K6: sourced from the shared elevation ramp (not pixel-identical
          // to the old literal, per the brief — the token is now the source
          // of truth).
          boxShadow: 'var(--elev-3)',
          boxSizing: 'border-box',
          outline: 'none',
          // transform-origin stays the default `center` here (modals are the
          // documented exception to "popovers scale from their trigger" —
          // they're not anchored to a control, they appear centered in the
          // viewport, per review-animations-STANDARDS.md's Physicality section).
          animation: 'siloIn .2s var(--ease-out)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The `Title … esc [✕]` header row shared by both modals (v3's
 * `<span>Edit</span>`/`<span>Settings</span>` + the `esc` chip button) —
 * `leading` is the optional extra content between the title and the
 * flex-spacer (Edit's domain label). `showCloseIcon` additionally renders a
 * ✕ icon button (the redesign brief's top-right close, matching
 * `docs/design/refs/settings-reference.png`) — opt-in per caller so
 * `EditModal` keeps its existing esc-chip-only header exactly as before,
 * while `SettingsModal` gets both: the ✕ for the reference's visual parity,
 * the `esc` chip kept alongside it since it's a discoverable affordance for
 * "how do I close this" that predates the ✕ and costs nothing to keep.
 */
export function ModalHeader({
  title,
  onClose,
  leading,
  showCloseIcon,
}: {
  title: string;
  onClose: () => void;
  leading?: ReactNode;
  showCloseIcon?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s2-5)',
        justifyContent: leading ? undefined : 'space-between',
        // K3: 13 → var(--s3) exact; 15 is LEFT un-tokenized (no clean --s*
        // step between --s3-5/14px and --s4/16px, and this governs a
        // deliberate visual difference between the `leading`/no-`leading`
        // cases, not drift).
        marginBottom: leading ? 15 : 'var(--s3)',
      }}
    >
      {/* `h2` (Rams review: heading hierarchy) — nested one level under each
          route's `ContentHeader` `h1`, since a modal is contextually "inside"
          the page it overlays. The dialog's accessible name still comes from
          `ModalShell`'s `aria-label` (unchanged) — this is purely so a
          screen-reader user's heading-navigation actually finds "Edit"/
          "Settings" instead of silence. */}
      <h2
        style={{
          margin: 0,
          fontSize: '1.05rem',
          fontWeight: 500,
          letterSpacing: 'var(--tracking-tight)',
          lineHeight: 'var(--lh-tight)',
          textWrap: 'balance',
        }}
      >
        {title}
      </h2>
      {leading}
      <span style={{ flex: 1 }} />
      <button type="button" onClick={onClose} className="silo-modal-esc">
        esc
      </button>
      {showCloseIcon && (
        <button type="button" onClick={onClose} aria-label="Close" className="silo-settings-close">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
