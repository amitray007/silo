/**
 * The sidebar nav's inline SVG icons (v3, `docs/design/app/Silo-v3.html`):
 * Library (bookmark), Trash (trash can), Settings (sliders). 18×18,
 * `viewBox="0 0 16 16"`, `stroke="currentColor"` (so they inherit the nav
 * item's ink/mut color — no hardcoded hex), stroke-width 1.4, round caps/
 * joins — path data copied from the prototype. Bumped from v3's original
 * 15px per the user-feedback polish pass ("icons look too small" — the
 * Orpheus reference, `docs/design/refs/*.png`, uses larger/cleaner icons);
 * the `viewBox` stays `0 0 16 16` so the path data is untouched, only the
 * rendered `width`/`height` grew.
 */

export function LibraryIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 2.4h8a.6.6 0 0 1 .6.6v10.6l-4.6-2.8-4.6 2.8V3a.6.6 0 0 1 .6-.6Z" />
    </svg>
  );
}

/**
 * The trash-can glyph — `size`/`stroke` are overridable (defaulting to the
 * sidebar nav rail's 18px/`currentColor`) so `Dock.tsx`'s `DockTrashIcon`
 * (12px, `var(--ghost)`, used in the docks' "move to trash"/"empty all"/
 * "delete now" buttons and `TrashRowActions`' delete-now button) can reuse
 * this exact path data instead of duplicating the SVG (jscpd guards
 * production src at 1.5%).
 */
export function TrashIcon({
  size = 18,
  stroke = 'currentColor',
}: {
  size?: number;
  stroke?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke={stroke}
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.8 4.2h10.4" />
      <path d="M6 4.2V2.8h4v1.4" />
      <path d="M4.3 4.2l.6 9h6.2l.6-9" />
      <path d="M6.6 7v3.8M9.4 7v3.8" />
    </svg>
  );
}

export function SettingsIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 5.2h6M11 5.2h2.5M2.5 10.8h2.5M7.5 10.8h6" />
      <circle cx="9.6" cy="5.2" r="1.7" />
      <circle cx="6.4" cy="10.8" r="1.7" />
    </svg>
  );
}
