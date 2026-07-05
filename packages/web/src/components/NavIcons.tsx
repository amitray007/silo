/**
 * The sidebar nav's inline SVG icons (v3, `docs/design/app/Silo-v3.html`):
 * Library (bookmark), Trash (trash can), Settings (sliders). 15×15,
 * `viewBox="0 0 16 16"`, `stroke="currentColor"` (so they inherit the nav
 * item's ink/mut color — no hardcoded hex), stroke-width 1.4, round caps/
 * joins — copied path-for-path from the prototype.
 */

export function LibraryIcon() {
  return (
    <svg
      width="15"
      height="15"
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

export function TrashIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
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
      width="15"
      height="15"
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
